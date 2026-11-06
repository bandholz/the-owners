import type { BusyInterval, Env } from "./types";
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
import {
  deleteRefreshToken,
  loadRefreshToken,
  storeRefreshToken,
} from "./db/tokens";
import {
  getSelectedCalendars,
  replaceSelectedCalendars,
} from "./db/calendars";
import { listGroupMemberIds } from "./db/groups";
import { handleAdmin } from "./admin/routes";
import { findSharedSlots } from "./freebusy/intersect";
import { queryFreeBusy, refreshAccessToken } from "./calendar/freebusy-client";
import {
  defaultCalendarSelection,
  listCalendars,
} from "./calendar/calendar-list";
import {
  assertCanFindSlots,
  assertSelectedPeopleForBusy,
  mergeSelectedUserIds,
} from "./slots/resolve";
import {
  clearSessionCookie,
  jsonError,
  jsonOk,
  parseCookies,
  requireCsrf,
  requireUser,
  SESSION_COOKIE,
  sessionCookieHeader,
} from "./middleware/session";
import {
  adminPage,
  availableTimesPage,
  calendarsPage,
  deletePage,
  escapeHtml,
  homePage,
  htmlPage,
  noticePage,
  toViewer,
} from "./ui/pages";

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
      name: authed.user.name,
      role: authed.user.role,
      calendarOk: authed.user.token_status === "ok",
      isGuest: authed.user.role === "guest",
      timeZone: env.DEFAULT_TIMEZONE,
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
    // Response.redirect() headers are immutable (compat date 2026-11-05),
    // so appending Set-Cookie throws and the top-level catch returns 500.
    const headers = new Headers({ location: loc });
    headers.append(
      "set-cookie",
      `ots_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    );
    return new Response(null, { status: 302, headers });
  }

  if (path === "/auth/google/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(request.headers.get("cookie"));
    if (!code || !state || state !== cookies["ots_oauth_state"]) {
      return htmlPage(
        "Sign-in failed",
        `<h1>Sign-in failed</h1><p class="banner banner-bad">Invalid OAuth state. Start again from the home page.</p><p><a class="btn" href="/">Home</a></p>`,
        env.APP_NAME,
      );
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
        `<h1>Not invited</h1><p>Ask an admin to invite <strong>${escapeHtml(email)}</strong>.</p>`,
        env.APP_NAME,
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
    if (authed.user.role === "guest") {
      return noticePage(toViewer(env, authed.user), {
        title: "Calendar optional",
        active: "calendars",
        heading: "Guests do not need a calendar",
        body: `<p>You can use Available times for hosts and producers without connecting Google Calendar.</p>
         <p><a class="btn btn-primary" href="/app">Available times</a></p>`,
      });
    }
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
    // Same immutable-header constraint as /auth/google/start.
    const headers = new Headers({ location: loc });
    headers.append(
      "set-cookie",
      `ots_cal_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    );
    return new Response(null, { status: 302, headers });
  }

  if (path === "/auth/google/calendar/callback" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(request.headers.get("cookie"));
    if (!code || !state || state !== cookies["ots_cal_state"]) {
      return htmlPage(
        "Calendar connect failed",
        `<h1>Calendar connect failed</h1><p class="banner banner-bad">Invalid state. Try connecting again.</p>`,
        env.APP_NAME,
      );
    }
    const redirectUri = `${env.APP_BASE_URL}/auth/google/calendar/callback`;
    const tokens = await exchangeCode(env, code, redirectUri);
    if (!tokens.refresh_token) {
      return htmlPage(
        "Calendar connect failed",
        `<h1>Calendar connect failed</h1><p class="banner banner-bad">No refresh token returned. Revoke app access in your Google Account and try again.</p>`,
        env.APP_NAME,
      );
    }
    await storeRefreshToken(
      env.DB,
      authed.user.id,
      tokens.refresh_token,
      (tokens.scope ?? CALENDAR_SCOPES.join(" ")).split(/\s+/),
      env.TOKEN_ENCRYPTION_KEY,
    );

    let selection = defaultCalendarSelection([]);
    try {
      const entries = await listCalendars(tokens.access_token);
      selection = defaultCalendarSelection(entries);
    } catch {
      // fall back to primary
    }
    await replaceSelectedCalendars(env.DB, authed.user.id, selection);

    await writeAudit(env, {
      actorUserId: authed.user.id,
      action: "calendar_connect",
      targetEmail: authed.user.email,
    });
    const headers = new Headers({ location: "/calendars" });
    headers.append(
      "set-cookie",
      "ots_cal_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    return new Response(null, { status: 302, headers });
  }

  if (path === "/api/calendars" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    if (authed.user.role === "guest") {
      return jsonError(400, "guests do not connect calendars");
    }
    if (authed.user.token_status !== "ok") {
      return jsonError(400, "calendar not connected");
    }
    const refresh = await loadRefreshToken(
      env.DB,
      authed.user.id,
      env.TOKEN_ENCRYPTION_KEY,
    );
    if (!refresh) return jsonError(400, "missing token");
    const access = await refreshAccessToken(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      refresh,
    );
    const available = await listCalendars(access);
    const selected = await getSelectedCalendars(env.DB, authed.user.id);
    return jsonOk({
      available: available.map((c) => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary,
      })),
      selected: selected.map((c) => ({
        id: c.calendar_id,
        summary: c.summary,
        primary: Boolean(c.is_primary),
      })),
    });
  }

  if (path === "/api/calendars" && request.method === "PUT") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const csrfErr = requireCsrf(request, authed.csrfSecret);
    if (csrfErr) return csrfErr;
    if (authed.user.role === "guest") {
      return jsonError(400, "guests do not connect calendars");
    }
    const body = (await request.json()) as {
      calendars?: Array<{ id: string; summary?: string; primary?: boolean }>;
    };
    if (!body.calendars?.length) {
      return jsonError(400, "select at least one calendar");
    }
    // Only store ids/names — never events
    await replaceSelectedCalendars(
      env.DB,
      authed.user.id,
      body.calendars.map((c) => ({
        id: c.id,
        summary: c.summary ?? c.id,
        primary: Boolean(c.primary),
      })),
    );
    await writeAudit(env, {
      actorUserId: authed.user.id,
      action: "calendar_selection",
      meta: { count: body.calendars.length },
    });
    return jsonOk({ ok: true });
  }

  if (path === "/calendars" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    return calendarsPage(toViewer(env, authed.user));
  }

  if (path === "/me/delete" && request.method === "POST") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const csrfErr = requireCsrf(request, authed.csrfSecret);
    if (csrfErr) return csrfErr;
    await deleteRefreshToken(env.DB, authed.user.id);
    await deleteSession(env.DB, authed.sessionId);
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
    const authed = await requireUser(request, env);
    if (authed instanceof Response) {
      return htmlPage(
        "Delete my data",
        `<h1>Disconnect and delete</h1>
         <p>Sign in to revoke calendar access and delete your account.</p>
         <p><a class="btn btn-primary" href="/auth/google/start">Sign in with Google</a></p>`,
        env.APP_NAME,
      );
    }
    return deletePage(toViewer(env, authed.user));
  }

  if (path === "/api/me" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    return jsonOk({
      email: authed.user.email,
      role: authed.user.role,
      token_status: authed.user.token_status,
      guest: authed.user.role === "guest",
      calendarRequired: authed.user.role !== "guest",
      csrf: authed.csrfSecret,
    });
  }

  if (path === "/api/slots" && request.method === "POST") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const csrfErr = requireCsrf(request, authed.csrfSecret);
    if (csrfErr) return csrfErr;

    const can = assertCanFindSlots(authed.user);
    if (!can.ok) return jsonError(403, can.error);

    const body = (await request.json()) as {
      userIds?: string[];
      groupId?: string;
      rangeStart?: string;
      rangeEnd?: string;
      durationMinutes?: number;
      windowStartMinutes?: number;
      windowEndMinutes?: number;
    };
    if (!body.rangeStart || !body.rangeEnd || !body.durationMinutes) {
      return jsonError(400, "range and duration required");
    }

    let groupMemberIds: string[] = [];
    if (body.groupId) {
      groupMemberIds = await listGroupMemberIds(env.DB, body.groupId);
    }
    const selectedIds = mergeSelectedUserIds({
      userIds: body.userIds,
      groupId: body.groupId,
      groupMemberIds,
    });

    const selectedUsers = [];
    for (const uid of selectedIds) {
      const u = await getUserById(env.DB, uid);
      if (!u) return jsonError(400, `unknown user: ${uid}`);
      selectedUsers.push(u);
    }

    const busyCheck = assertSelectedPeopleForBusy(selectedUsers);
    if (!busyCheck.ok) return jsonError(400, busyCheck.error);

    // Guests (and anyone) only see free/busy for people they selected —
    // never auto-include the actor unless they are in selectedIds.
    if (
      authed.user.role === "guest" &&
      selectedIds.includes(authed.user.id) &&
      authed.user.token_status !== "ok"
    ) {
      return jsonError(
        400,
        "guests cannot include themselves in busy selection without a connected calendar",
      );
    }

    const rangeStart = new Date(body.rangeStart);
    const rangeEnd = new Date(body.rangeEnd);
    if (!(rangeStart < rangeEnd)) return jsonError(400, "bad range");
    if (rangeEnd.getTime() - rangeStart.getTime() > 14 * 86400_000) {
      return jsonError(400, "range max 14 days");
    }

    const busyByUser: BusyInterval[][] = [];
    for (const u of selectedUsers) {
      const refresh = await loadRefreshToken(
        env.DB,
        u.id,
        env.TOKEN_ENCRYPTION_KEY,
      );
      if (!refresh) return jsonError(400, `missing token: ${u.email}`);
      const access = await refreshAccessToken(
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET,
        refresh,
      );
      const cals = await getSelectedCalendars(env.DB, u.id);
      const ids = cals.map((c) => c.calendar_id);
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
      meta: {
        count: slots.length,
        users: selectedIds.length,
        groupId: body.groupId ?? null,
        actorRole: authed.user.role,
      },
    });

    return jsonOk({
      timezone: env.DEFAULT_TIMEZONE,
      selectedUserIds: selectedIds,
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
    return availableTimesPage(toViewer(env, authed.user));
  }

  if (path === "/admin" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    if (authed.user.role !== "admin") return jsonError(403, "admin only");
    return adminPage(toViewer(env, authed.user));
  }

  return jsonError(404, "not found");
}
