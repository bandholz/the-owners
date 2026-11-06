import type { BusyInterval, Env, UserRow } from "./types";
import {
  buildGoogleAuthUrl,
  CALENDAR_SCOPES,
  tokenCanCreateEvents,
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
  setShareWindow,
  writeAudit,
} from "./db/users";
import {
  deleteRefreshToken,
  loadRefreshToken,
  loadTokenScopes,
  storeRefreshToken,
} from "./db/tokens";
import {
  getSelectedCalendars,
  replaceSelectedCalendars,
} from "./db/calendars";
import { listGroupMemberIds } from "./db/groups";
import { handleAdmin } from "./admin/routes";
import { findSharedSlots } from "./freebusy/intersect";
import { buildAvailabilityGrid, includedDayKeys } from "./freebusy/heatmap";
import { getHeatmapSettings } from "./db/heatmap-settings";
import { queryFreeBusy, refreshAccessToken } from "./calendar/freebusy-client";
import {
  clipRangeToShare,
  normalizeShareWindow,
  shareBounds,
  unsharedMasks,
} from "./calendar/share-window";
import { createCalendarEvent, deleteCalendarEvent } from "./calendar/events";
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
  calendarsPage,
  deletePage,
  escapeHtml,
  homePage,
  htmlPage,
  noticePage,
  toViewer,
} from "./ui/pages";

async function loadUserBusy(
  env: Env,
  user: UserRow,
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date(),
  options?: { unsharedIfDisconnected?: boolean },
): Promise<
  | {
      busy: BusyInterval[];
      shareFrom: string | null;
      shareUntil: string | null;
      unshared?: boolean;
    }
  | Response
> {
  if (options?.unsharedIfDisconnected && user.token_status !== "ok") {
    return { busy: [], shareFrom: null, shareUntil: null, unshared: true };
  }
  const window = normalizeShareWindow(user.share_window);
  const bounds = shareBounds(window, now);
  const shareFrom = window === "full" ? null : bounds.from.toISOString();
  const shareUntil = bounds.until ? bounds.until.toISOString() : null;
  const clip = clipRangeToShare(rangeStart, rangeEnd, bounds);
  const hidden = unsharedMasks(rangeStart, rangeEnd, bounds);
  if (!clip) {
    return { busy: hidden, shareFrom, shareUntil };
  }
  const refresh = await loadRefreshToken(
    env.DB,
    user.id,
    env.TOKEN_ENCRYPTION_KEY,
  );
  if (!refresh) {
    if (options?.unsharedIfDisconnected) {
      return { busy: [], shareFrom: null, shareUntil: null, unshared: true };
    }
    return jsonError(400, `missing token: ${user.email}`);
  }
  const access = await refreshAccessToken(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    refresh,
  );
  const cals = await getSelectedCalendars(env.DB, user.id);
  const ids = cals.map((c) => c.calendar_id);
  if (!ids.length) ids.push("primary");
  const visible = await queryFreeBusy({
    timeMin: clip.start.toISOString(),
    timeMax: clip.end.toISOString(),
    calendarIds: ids,
    accessToken: access,
  });
  return { busy: [...visible, ...hidden], shareFrom, shareUntil };
}

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
        body: `<p>You can use Home to see when hosts and producers are free without connecting Google Calendar.</p>
         <p><a class="btn btn-primary" href="/">Home</a></p>`,
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

  if (path === "/api/heatmap-settings" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    return jsonOk(await getHeatmapSettings(env.DB));
  }

  if (path === "/api/me" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const scopes = await loadTokenScopes(env.DB, authed.user.id);
    return jsonOk({
      email: authed.user.email,
      role: authed.user.role,
      token_status: authed.user.token_status,
      guest: authed.user.role === "guest",
      calendarRequired: authed.user.role !== "guest",
      canCreateEvents:
        authed.user.token_status === "ok" && tokenCanCreateEvents(scopes),
      shareWindow: normalizeShareWindow(authed.user.share_window),
      csrf: authed.csrfSecret,
    });
  }

  if (path === "/api/me/share-window" && request.method === "POST") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const csrfErr = requireCsrf(request, authed.csrfSecret);
    if (csrfErr) return csrfErr;
    if (authed.user.role === "guest") {
      return jsonError(400, "guests do not share a calendar");
    }
    const body = (await request.json()) as { window?: unknown };
    if (body.window !== "full" && body.window !== "week" && body.window !== "month") {
      return jsonError(400, "window must be full, week, or month");
    }
    try {
      await setShareWindow(env.DB, authed.user.id, body.window);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("no such column")) {
        return jsonError(
          503,
          "calendar sharing is not available until the database migration is applied",
        );
      }
      throw err;
    }
    await writeAudit(env, {
      actorUserId: authed.user.id,
      action: "share_window",
      meta: { window: body.window },
    });
    return jsonOk({ shareWindow: body.window });
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
      const loaded = await loadUserBusy(env, u, rangeStart, rangeEnd);
      if (loaded instanceof Response) return loaded;
      busyByUser.push(loaded.busy);
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

  if (path === "/api/availability" && request.method === "POST") {
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
      includeWeekends?: boolean;
    };
    if (!body.rangeStart || !body.rangeEnd) {
      return jsonError(400, "range required");
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

    if (selectedUsers.length === 0) {
      return jsonError(400, "select at least one person (or a group with members)");
    }

    const rangeStart = new Date(body.rangeStart);
    const rangeEnd = new Date(body.rangeEnd);
    if (!(rangeStart < rangeEnd)) return jsonError(400, "bad range");
    const settings = await getHeatmapSettings(env.DB);
    const includeWeekends = settings.showWeekends;
    const calendarDays = includedDayKeys(
      rangeStart,
      rangeEnd,
      env.DEFAULT_TIMEZONE,
      true,
    ).length;
    const included = includedDayKeys(
      rangeStart,
      rangeEnd,
      env.DEFAULT_TIMEZONE,
      includeWeekends,
    );
    if (included.length === 0) {
      return jsonError(
        400,
        includeWeekends ? "no days in range" : "no weekdays in range",
      );
    }
    if (included.length > settings.dayCount) {
      return jsonError(400, `range max ${settings.dayCount} days`);
    }
    if (calendarDays > 24) return jsonError(400, `range max ${settings.dayCount} days`);
    const windowStartMinutes = settings.windowStartMinutes;
    const windowEndMinutes = settings.windowEndMinutes;

    const busyByPerson: BusyInterval[][] = [];
    const shareByPerson: Array<{
      shareFrom: string | null;
      shareUntil: string | null;
      unshared?: boolean;
    }> = [];
    for (const u of selectedUsers) {
      const loaded = await loadUserBusy(env, u, rangeStart, rangeEnd, new Date(), {
        unsharedIfDisconnected: true,
      });
      if (loaded instanceof Response) return loaded;
      busyByPerson.push(loaded.busy);
      shareByPerson.push({
        shareFrom: loaded.shareFrom,
        shareUntil: loaded.shareUntil,
        unshared: loaded.unshared === true,
      });
    }

    const grid = buildAvailabilityGrid({
      people: selectedUsers.map((u, index) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        shareFrom: shareByPerson[index]?.shareFrom ?? null,
        shareUntil: shareByPerson[index]?.shareUntil ?? null,
        unshared: shareByPerson[index]?.unshared === true,
      })),
      busyByPerson,
      rangeStart,
      rangeEnd,
      windowStartMinutes,
      windowEndMinutes,
      slotMinutes: 30,
      showWeekends: includeWeekends,
      timeZone: env.DEFAULT_TIMEZONE,
    });

    await writeAudit(env, {
      actorUserId: authed.user.id,
      action: "availability_grid",
      meta: {
        users: selectedIds.length,
        days: grid.days.length,
        groupId: body.groupId ?? null,
        actorRole: authed.user.role,
      },
    });

    return jsonOk({
      timezone: grid.timeZone,
      slotMinutes: grid.slotMinutes,
      total: grid.total,
      windowStartMinutes,
      windowEndMinutes,
      dayCount: settings.dayCount,
      showWeekends: settings.showWeekends,
      includeWeekends,
      people: selectedUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
      })),
      days: grid.days,
      rows: grid.rows,
      cells: grid.cells.map((cell) => ({
        day: cell.day,
        minutes: cell.minutes,
        label: cell.label,
        start: cell.start,
        end: cell.end,
        freeCount: cell.freeCount,
        people: cell.people.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          status: p.status,
        })),
      })),
    });
  }

  if (path === "/api/events" && request.method === "POST") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    const csrfErr = requireCsrf(request, authed.csrfSecret);
    if (csrfErr) return csrfErr;

    const body = (await request.json()) as {
      title?: string;
      ranges?: Array<{ start?: string; end?: string }>;
      userIds?: string[];
    };
    const title = body.title?.trim() ?? "";
    if (!title || title.length > 140) {
      return jsonError(400, "title required");
    }
    const ranges = body.ranges ?? [];
    if (!ranges.length || ranges.length > 8) {
      return jsonError(400, "select one or more time ranges");
    }
    for (const range of ranges) {
      const start = new Date(range.start ?? "");
      const end = new Date(range.end ?? "");
      if (!(start < end)) return jsonError(400, "bad time range");
      if (end.getTime() - start.getTime() > 12 * 3600_000) {
        return jsonError(400, "each event must be 12 hours or less");
      }
    }
    const userIds = [...new Set((body.userIds ?? []).filter(Boolean))];
    if (!userIds.length) return jsonError(400, "select at least one person");

    if (authed.user.token_status !== "ok") {
      return jsonError(400, "Connect Google Calendar before creating an event.");
    }
    const scopes = await loadTokenScopes(env.DB, authed.user.id);
    if (!tokenCanCreateEvents(scopes)) {
      return Response.json(
        {
          error:
            "Reconnect Google Calendar to create events. The current connection can only read free/busy.",
          reconnect: true,
        },
        { status: 403 },
      );
    }

    const attendees: string[] = [];
    for (const uid of userIds) {
      const person = await getUserById(env.DB, uid);
      if (!person) return jsonError(400, `unknown user: ${uid}`);
      const email = person.email?.trim();
      if (!email) return jsonError(400, "a selected person has no email");
      if (normalizeEmail(email) === normalizeEmail(authed.user.email)) continue;
      if (!attendees.some((existing) => normalizeEmail(existing) === normalizeEmail(email))) {
        attendees.push(email);
      }
    }

    const refresh = await loadRefreshToken(
      env.DB,
      authed.user.id,
      env.TOKEN_ENCRYPTION_KEY,
    );
    if (!refresh) {
      return jsonError(400, "Connect Google Calendar before creating an event.");
    }
    const access = await refreshAccessToken(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      refresh,
    );

    const created: Array<{ id: string; htmlLink: string | null; start: string; end: string }> = [];
    try {
      for (const range of ranges) {
        const event = await createCalendarEvent(access, {
          title,
          start: new Date(range.start ?? "").toISOString(),
          end: new Date(range.end ?? "").toISOString(),
          attendeeEmails: attendees,
          timeZone: env.DEFAULT_TIMEZONE,
        });
        created.push({
          id: event.id,
          htmlLink: event.htmlLink,
          start: new Date(range.start ?? "").toISOString(),
          end: new Date(range.end ?? "").toISOString(),
        });
      }
    } catch (err) {
      const leftover: string[] = [];
      for (const event of created) {
        try {
          await deleteCalendarEvent(access, event.id);
        } catch {
          if (event.htmlLink) leftover.push(event.htmlLink);
        }
      }
      if (err instanceof Error && err.message === "reconnect") {
        return Response.json(
          {
            error:
              "Reconnect Google Calendar to create events. The current connection can only read free/busy.",
            reconnect: true,
            leftover,
          },
          { status: 403 },
        );
      }
      return Response.json(
        {
          error: leftover.length
            ? "Could not create every event. Remove the ones already added in Google Calendar and try again."
            : "Could not create every event. Nothing was left on the calendar.",
          leftover,
        },
        { status: 502 },
      );
    }

    await writeAudit(env, {
      actorUserId: authed.user.id,
      action: "create_events",
      meta: { count: created.length, attendees: attendees.length },
    });

    return jsonOk({
      created: created.map((event) => ({
        htmlLink: event.htmlLink,
        start: event.start,
        end: event.end,
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
    return new Response(null, { status: 302, headers: { location: "/" } });
  }

  if (path === "/admin" && request.method === "GET") {
    const authed = await requireUser(request, env);
    if (authed instanceof Response) return authed;
    if (authed.user.role !== "admin") return jsonError(403, "admin only");
    return adminPage(toViewer(env, authed.user));
  }

  return jsonError(404, "not found");
}
