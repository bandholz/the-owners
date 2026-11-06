import type { Env } from "./types";
import {
  buildGoogleAuthUrl,
  CALENDAR_SCOPES,
  exchangeCode,
  fetchUserInfo,
  IDENTITY_SCOPES,
  newOAuthState,
} from "./auth/google";
import { createSession, deleteSession } from "./db/sessions";
import {
  getUserByEmail,
  getUserById,
  listUsers,
  markLogin,
  normalizeEmail,
  removeUser,
  writeAudit,
} from "./db/users";
import { deleteRefreshToken, storeRefreshToken } from "./db/tokens";
import { handleAdmin } from "./admin/routes";
import { findSharedSlots } from "./freebusy/intersect";
import { queryFreeBusy, refreshAccessToken } from "./calendar/freebusy-client";
import { loadRefreshToken } from "./db/tokens";
import {
  clearSessionCookie,
  jsonError,
  jsonOk,
  requireCsrf,
  requireUser,
  sessionCookieHeader,
  SESSION_COOKIE,
  parseCookies,
} from "./middleware/session";
import { homePage, htmlPage } from "./ui/pages";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error("unhandled", err instanceof Error ? err.message : err);
      return jsonError(500, "internal error");
    }
  },
};

async function handle(request: Request, env: Env): Promise<Response> {
  if (env.ENVIRONMENT === "production" && env.ALLOW_PRODUCTION !== "true") {
    return jsonError(503, "production disabled until Eric approves");
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/health") {
    return jsonOk({
      ok: true,
      env: env.ENVIRONMENT,
      tz: env.DEFAULT_TIMEZONE,
    });
  }

  const admin = await handleAdmin(request, env, path);
  if (admin) return admin;

  if (path === "/" && request.method === "GET") {
    const cookies = parseCookies(request.headers.get("cookie"));
    const sid = cookies[SESSION_COOKIE];
    if (!sid) return homePage({ appName: env.APP_NAME, signedIn: false });
    const authed = await requireUser(request, env);
    if (authed instanceof Response) {
      return homePage({ appName: env.APP_NAME, signedIn: false });
    }
    return homePage({
      appName: env.APP_NAME,
      signedIn: true,
      email: authed.user.email,
      role: authed.user.role,
      calendarOk: authed.user.token_status === "ok",
    });
  }

  if (path === "/auth/google/start" && request.method === "GET") {
    const state = newOAuthState();
    const redirectUri = `${env.APP_BASE_URL}/auth/google/callback`;
    const loc = buildGoogleAuthUrl({
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri,
      scopes: IDENTITY_SCOPES,
      state,
      nonce: newOAuthState(),
    });
    const res = Response.redirect(loc, 302);
    // stash state in a short-lived cookie
    res.headers.append(
      "set-cookie",
      `ots_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    );
    return res;
  }

  if (path === "/auth/google/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(request.headers.get("cookie"));
    if (!code || !state || state !== cookies["ots_oauth_state"]) {
      return htmlPage("Sign-in failed", `<p class="error">Invalid OAuth state.</p>`);
    }
    const redirectUri = `${env.APP_BASE_URL}/auth/google/callback`;
    const tokens = await exchangeCode(env, code, redirectUri);
    const info = await fetchUserInfo(tokens.access_token);
    const email = normalizeEmail(info.email);
    const user = await getUserByEmail(env.DB, email);
    if (!user) {
      await writeAudit(env, {
        action: "sign_in_denied",
        targetEmail: email,
      });
      return htmlPage(
        "Not invited",
        `<h1>Not invited</h1><p>Ask an admin to invite <strong>${email}</strong>.</p>`,
      );
    }
    await markLogin(env.DB, user.id, info.sub, info.name ?? null);
    const session = await createSession(env.DB, user.id);
    await writeAudit(env, {
      actorUserId: user.id,
      action: "sign_in",
      targetEmail: email,
    });
    const secure = url.protocol === "https:";
    const headers = new Headers({ location: "/" });
    headers.append(
      "set-cookie",
      sessionCookieHeader(session.id, session.expires_at, secure),
    );
    headers.append(
      "set-cookie",
      "ots_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    return new Response(null, { status: 302, headers });
  }

  if (path === "/auth/logout") {
    const cookies = parseCookies(request.headers.get("cookie"));
    if (cookies[SESSION_COOKIE]) {
      await deleteSession(env.DB, cookies[SESSION_COOKIE]);
    }
    const secure = url.protocol === "https:";
    const headers = new Headers({ location: "/" });
    headers.append("set-cookie", clearSessionCookie(secure));
    return new Response(null, { status: 302, headers });
  }

  if (path === "/auth/google/calendar/start" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const state = newOAuthState();
    const redirectUri = `${env.APP_BASE_URL}/auth/google/calendar/callback`;
    const loc = buildGoogleAuthUrl({
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri,
      scopes: CALENDAR_SCOPES,
      state,
      accessType: "offline",
      prompt: "consent",
    });
    const res = Response.redirect(loc, 302);
    res.headers.append(
      "set-cookie",
      `ots_cal_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    );
    return res;
  }

  if (path === "/auth/google/calendar/callback" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(request.headers.get("cookie"));
    if (!code || !state || state !== cookies["ots_cal_state"]) {
      return htmlPage("Calendar connect failed", `<p class="error">Invalid state.</p>`);
    }
    const redirectUri = `${env.APP_BASE_URL}/auth/google/calendar/callback`;
    const tokens = await exchangeCode(env, code, redirectUri);
    if (!tokens.refresh_token) {
      return htmlPage(
        "Calendar connect failed",
        `<p class="error">No refresh token returned. Revoke app access in Google Account and retry.</p>`,
      );
    }
    await storeRefreshToken(
      env.DB,
      authed.user.id,
      tokens.refresh_token,
      (tokens.scope ?? CALENDAR_SCOPES.join(" ")).split(" "),
      env.TOKEN_ENCRYPTION_KEY,
    );
    // Default to primary calendar until calendarList scope is approved
    await env.DB.prepare(
      `INSERT OR REPLACE INTO calendars_selected (user_id, calendar_id, summary, is_primary)
       VALUES (?, 'primary', 'Primary', 1)`,
    )
      .bind(authed.user.id)
      .run();
    await writeAudit(env, {
      actorUserId: authed.user.id,
      action: "calendar_connect",
      targetEmail: authed.user.email,
    });
    const headers = new Headers({ location: "/" });
    headers.append(
      "set-cookie",
      "ots_cal_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    return new Response(null, { status: 302, headers });
  }

  if (path === "/me/delete" && request.method === "POST") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const csrfErr = requireCsrf(request, authed.csrfSecret);
    if (csrfErr) return csrfErr;
    await deleteRefreshToken(env.DB, authed.user.id);
    await deleteSession(env.DB, authed.sessionId);
    // Full account delete for non-admins; admins keep row but wipe tokens via above
    await writeAudit(env, {
      actorUserId: authed.user.id,
      action: "calendar_disconnect",
      targetEmail: authed.user.email,
    });
    await removeUser(env.DB, authed.user.id);
    const secure = url.protocol === "https:";
    const headers = new Headers({ location: "/" });
    headers.append("set-cookie", clearSessionCookie(secure));
    return new Response(null, { status: 302, headers });
  }

  if (path === "/me/delete" && request.method === "GET") {
    return htmlPage(
      "Delete my data",
      `<h1>Disconnect &amp; delete</h1>
       <p>This revokes calendar access and deletes your account row and tokens.</p>
       <form method="post"><button type="submit">Delete my data</button></form>
       <p class="muted">CSRF header required for API clients; browser form needs JS CSRF in a later polish pass.</p>`,
    );
  }

  if (path === "/api/me" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    return jsonOk({
      email: authed.user.email,
      role: authed.user.role,
      token_status: authed.user.token_status,
      csrf: authed.csrfSecret,
    });
  }

  if (path === "/api/slots" && request.method === "POST") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const csrfErr = requireCsrf(request, authed.csrfSecret);
    if (csrfErr) return csrfErr;

    const body = (await request.json()) as {
      userIds?: string[];
      rangeStart?: string;
      rangeEnd?: string;
      durationMinutes?: number;
      windowStartMinutes?: number;
      windowEndMinutes?: number;
    };
    if (
      !body.userIds?.length ||
      !body.rangeStart ||
      !body.rangeEnd ||
      !body.durationMinutes
    ) {
      return jsonError(400, "userIds, range, duration required");
    }

    const rangeStart = new Date(body.rangeStart);
    const rangeEnd = new Date(body.rangeEnd);
    if (!(rangeStart < rangeEnd)) return jsonError(400, "bad range");
    // Cap 14 days
    if (rangeEnd.getTime() - rangeStart.getTime() > 14 * 86400_000) {
      return jsonError(400, "range max 14 days");
    }

    const busyByUser: import("./types").BusyInterval[][] = [];
    for (const uid of body.userIds) {
      const u = await getUserById(env.DB, uid);
      if (!u || u.token_status !== "ok") {
        return jsonError(400, `user not connected: ${uid}`);
      }
      const refresh = await loadRefreshToken(
        env.DB,
        uid,
        env.TOKEN_ENCRYPTION_KEY,
      );
      if (!refresh) return jsonError(400, `missing token: ${uid}`);
      const access = await refreshAccessToken(
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET,
        refresh,
      );
      const cals = await env.DB.prepare(
        "SELECT calendar_id FROM calendars_selected WHERE user_id = ?",
      )
        .bind(uid)
        .all<{ calendar_id: string }>();
      const ids = (cals.results ?? []).map((c) => c.calendar_id);
      if (!ids.length) ids.push("primary");
      const busy = await queryFreeBusy({
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        calendarIds: ids,
        accessToken: access,
      });
      busyByUser.push(busy);
    }

    const slots = findSharedSlots({
      busyByUser,
      rangeStart,
      rangeEnd,
      durationMinutes: body.durationMinutes,
      windowStartMinutes: body.windowStartMinutes ?? 9 * 60,
      windowEndMinutes: body.windowEndMinutes ?? 17 * 60,
      timeZone: env.DEFAULT_TIMEZONE,
    });

    await writeAudit(env, {
      actorUserId: authed.user.id,
      action: "find_slots",
      meta: { count: slots.length, users: body.userIds.length },
    });

    return jsonOk({
      timezone: env.DEFAULT_TIMEZONE,
      slots: slots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        startCt: s.startCt,
        endCt: s.endCt,
      })),
    });
  }

  if (path === "/api/people" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const users = await listUsers(env.DB);
    return jsonOk({
      people: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        token_status: u.token_status,
      })),
    });
  }

  if (path === "/app" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    return htmlPage(
      "Find a time",
      `<h1>Find a time</h1>
       <p class="muted">UI polish later. Use <code>POST /api/slots</code> with CSRF from <code>GET /api/me</code>.</p>
       <p><a href="/">Home</a></p>`,
    );
  }

  if (path === "/admin" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    if (authed.user.role !== "admin") return jsonError(403, "admin only");
    return htmlPage(
      "Admin",
      `<h1>Admin</h1>
       <p>Invite/remove via <code>/api/admin/*</code>. CSRF from <code>/api/me</code>.</p>
       <p><a href="/">Home</a></p>`,
    );
  }

  return jsonError(404, "not found");
}
