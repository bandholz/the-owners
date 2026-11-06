import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { clientScript } from "../src/ui/client";
import type { SessionRow } from "../src/db/sessions";
import type { Env, UserRow } from "../src/types";
import {
  inclusiveDaySpan,
  parseTimeToMinutes,
  TIME_FNS,
  zonedWallTimeToIso,
} from "../src/ui/time";

const BASE = "https://scheduler-staging.sovrnty.com";

function env(db?: D1Database): Env {
  return {
    DB: db as D1Database,
    APP_NAME: "Operators: The Owners Scheduler",
    DEFAULT_TIMEZONE: "America/Chicago",
    ENVIRONMENT: "staging",
    ALLOW_PRODUCTION: "false",
    GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "not-used",
    TOKEN_ENCRYPTION_KEY: "not-used",
    SESSION_SECRET: "not-used",
    APP_BASE_URL: BASE,
  };
}

function user(over: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-1",
    email: "host@example.com",
    email_normalized: "host@example.com",
    name: "Host Example",
    role: "host",
    google_sub: null,
    invited_by: null,
    created_at: "2026-11-06T00:00:00.000Z",
    updated_at: "2026-11-06T00:00:00.000Z",
    last_login_at: null,
    calendar_connected_at: null,
    token_status: "ok",
    ...over,
  };
}

function stubDb(session: SessionRow | null, row: UserRow | null): D1Database {
  return {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (sql.includes("FROM sessions")) return session;
          if (sql.includes("FROM users")) return row;
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

const session: SessionRow = {
  id: "sess-1",
  user_id: "user-1",
  csrf_secret: "csrf-secret",
  created_at: "2026-11-06T00:00:00.000Z",
  expires_at: "2099-01-01T00:00:00.000Z",
};

function authed(row: UserRow) {
  return env(stubDb(session, row));
}

async function html(path: string, row?: UserRow): Promise<string> {
  const res = await worker.fetch(
    new Request(`${BASE}${path}`, {
      headers: row ? { cookie: "ots_session=sess-1" } : {},
    }),
    row ? authed(row) : env(),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(res.headers.get("content-security-policy")).toContain("connect-src 'self'");
  expect(res.headers.get("cache-control")).toContain("no-store");
  const text = await res.text();
  expect(text.toLowerCase()).not.toContain("find a time");
  expect(text).not.toContain("Sidekick");
  expect(text).not.toContain("Shopify");
  expect(text).not.toContain("Beardbrand");
  expect(text).not.toContain('id="nav-search"');
  expect(text).not.toContain("⌘K");
  expect(text.toLowerCase()).not.toContain("when2meet");
  return text;
}

describe("staging screens", () => {
  it("shows a sign-in gate when signed out", async () => {
    const text = await html("/");
    expect(text).toContain("Sign in with Google");
    expect(text).toContain("Invite-only");
    expect(text).toContain("Available times are shown in Central Time");
    expect(text).not.toContain("nav-signout");
  });

  it("renders home chrome for a signed-in host", async () => {
    const text = await html("/", user());
    expect(text).toContain('id="nav-home"');
    expect(text).toContain('id="nav-times"');
    expect(text).toContain(">Available times<");
    expect(text).toContain('id="nav-calendars"');
    expect(text).toContain('id="nav-signout"');
    expect(text).toContain('href="/auth/logout"');
    expect(text).not.toContain('id="nav-admin"');
    expect(text).toContain("host@example.com");
    expect(text).toContain('<span class="dot dot-ok"></span>Connected');
    expect(text).toContain("Central");
    expect(text).toContain("America/Chicago");
    expect(text).toMatch(/Good (morning|afternoon|evening), Host/);
    expect(text).toContain('aria-current="page"');
    expect(text).toContain("x-csrf-token");
    expect(text).toContain('id="heat-app"');
    expect(text).toContain('id="heat-group"');
    expect(text).toContain('id="heat-person"');
    expect(text).toContain('id="heat-people"');
    expect(text).toContain("heat-controls");
    expect(text).toContain("heat-chips");
    expect(text).not.toContain('id="heat-window-start"');
    expect(text).not.toContain('id="heat-window-end"');
    expect(text).toContain("Hover a time to see who is free and who is busy.");
    expect(text).toContain("0/0 Available");
    expect(text).toContain("/api/availability");
    expect(text).toContain("five business days");
    expect(text).toContain("9:00 AM–5:00 PM");
    expect(text).toContain('id="heat-rules"');
    expect(text).toContain("/api/heatmap-settings");
  });

  it("escapes the signed-in email", async () => {
    const text = await html(
      "/",
      user({ email: `a<b>"c@example.com`, name: "A<B" }),
    );
    expect(text).toContain("a&lt;b&gt;&quot;c@example.com");
    expect(text).not.toContain("a<b>");
    expect(text).toContain("Good ");
    expect(text).toContain(", A&lt;B");
  });

  it("offers calendar connect when a host has not connected", async () => {
    const text = await html("/", user({ token_status: "none", name: null }));
    expect(text).toContain("Connect Google Calendar");
    expect(text).toContain('<span class="dot dot-warn"></span>Not connected');
    expect(text).toContain('href="/auth/google/calendar/start"');
  });

  it("lets a guest open available times without a calendar", async () => {
    const text = await html(
      "/",
      user({ role: "guest", token_status: "none", name: "Guest Person" }),
    );
    expect(text).toContain('<span class="dot"></span>Not required');
    expect(text).toContain("without connecting a calendar");
    expect(text).toContain('data-guest="true"');
    expect(text).not.toContain('id="nav-admin"');
    const times = await html(
      "/app",
      user({ role: "guest", token_status: "none", name: "Guest Person" }),
    );
    expect(times).toContain("<h1>Available times</h1>");
    expect(times).toContain('data-guest="true"');
    expect(times).toContain("Guests can look up available times");
    expect(times).toContain("/api/slots");
    expect(times).toContain("/api/people");
    expect(times).toContain("/api/groups");
    expect(times).toContain("Show available times");
  });

  it("renders the calendar picker for a connected user", async () => {
    const text = await html("/calendars", user());
    expect(text).toContain("<h1>Calendars</h1>");
    expect(text).toContain('data-state="ready"');
    expect(text).toContain(
      "Choose which calendars count toward busy time. It only shows as Busy or Free. Event details are never stored or shared with others.",
    );
    expect(text).toContain("/api/calendars");
    expect(text).toContain('"PUT"');
    expect(text).toContain("x-csrf-token");
    expect(text).toContain('aria-current="page"');
    expect(text).toContain('href="/calendars"');
  });

  it("does not ask a guest to connect a calendar", async () => {
    const text = await html(
      "/calendars",
      user({ role: "guest", token_status: "none" }),
    );
    expect(text).toContain('data-state="guest"');
    expect(text).toContain("No calendar needed");
    expect(text).toContain('href="/app"');
  });

  it("points a host without a calendar at connect", async () => {
    const text = await html("/calendars", user({ token_status: "none" }));
    expect(text).toContain('data-state="connect"');
    expect(text).toContain('href="/auth/google/calendar/start"');
  });

  it("renders available times for a host", async () => {
    const text = await html("/app", user());
    expect(text).toContain("<h1>Available times</h1>");
    expect(text).toContain('id="times-form"');
    expect(text).toContain('id="group-id"');
    expect(text).toContain('id="people-list"');
    expect(text).toContain("POST");
    expect(text).toContain("/api/slots");
    expect(text).toContain("America/Chicago");
    const nav = text.indexOf('id="nav-times"');
    expect(text.slice(nav, nav + 180)).toContain('aria-current="page"');
  });

  it("keeps admin navigation off the host chrome and renders admin tools for an admin", async () => {
    const denied = await worker.fetch(
      new Request(`${BASE}/admin`, { headers: { cookie: "ots_session=sess-1" } }),
      authed(user()),
    );
    expect(denied.status).toBe(403);

    const text = await html("/admin", user({ role: "admin", name: "Ada Admin" }));
    expect(text).toContain('id="nav-admin"');
    expect(text).toContain("<h1>Admin</h1>");
    expect(text).toContain('id="invite-form"');
    expect(text).toContain('id="invite-email"');
    expect(text).toContain('id="invite-role"');
    expect(text).toContain("Invite");
    expect(text).toContain('id="group-create-form"');
    expect(text).toContain('id="access-sync-btn"');
    expect(text).toContain("Google test users");
    expect(text).toContain("/api/admin/invite");
    expect(text).toContain("/api/admin/remove");
    expect(text).toContain("/api/admin/role");
    expect(text).toContain("/api/admin/access-sync");
    expect(text).toContain("/api/admin/google-test-users/ack");
    expect(text).toContain("/api/admin/google-test-users/unack");
    expect(text).toContain("/api/groups");
    expect(text).toContain("x-csrf-token");
    expect(text).toContain("Mark added");
    expect(text).toContain("Sync Access now");
    expect(text).toContain('id="heatmap-settings-form"');
    expect(text).toContain('id="heat-day-count"');
    expect(text).toContain('id="heat-show-weekends"');
    expect(text).toContain('id="heat-admin-start"');
    expect(text).toContain('id="heat-admin-end"');
    expect(text).toContain("Include Saturday and Sunday");
    expect(text).toContain("Save heatmap");
    expect(text).toContain("/api/admin/heatmap-settings");
    expect(text).not.toContain('id="heat-window-start"');
  });

  it("tells a guest that calendar connect is optional", async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/auth/google/calendar/start`, {
        headers: { cookie: "ots_session=sess-1" },
      }),
      authed(user({ role: "guest", token_status: "none" })),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Available times");
    expect(text.toLowerCase()).not.toContain("find a time");
    expect(text).toContain('href="/app"');
  });

  it("still refuses unsigned app and admin pages", async () => {
    const app = await worker.fetch(new Request(`${BASE}/app`), env());
    expect(app.status).toBe(401);
    const admin = await worker.fetch(new Request(`${BASE}/admin`), env());
    expect(admin.status).toBe(401);
    const grid = await worker.fetch(
      new Request(`${BASE}/api/availability`, { method: "POST" }),
      env(),
    );
    expect(grid.status).toBe(401);
    const settings = await worker.fetch(
      new Request(`${BASE}/api/heatmap-settings`),
      env(),
    );
    expect(settings.status).toBe(401);
  });

  it("returns default heatmap rules when nothing is saved", async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/api/heatmap-settings`, {
        headers: { cookie: "ots_session=sess-1" },
      }),
      authed(user()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dayCount: 5,
      showWeekends: false,
      windowStartMinutes: 9 * 60,
      windowEndMinutes: 17 * 60,
    });
  });

  it("requires a csrf token before building the availability grid", async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/api/availability`, {
        method: "POST",
        headers: {
          cookie: "ots_session=sess-1",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      authed(user()),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf" });
  });
});

describe("page script time helpers", () => {
  it("parses and matches the Central Time range helpers", () => {
    const script = clientScript();
    new Function(script);
    expect(script).toContain("x-csrf-token");
    expect(script).toContain("/api/availability");
    expect(script).toContain("heat-person");
    expect(script).toContain("Add a person");
    expect(script).toContain("business days");
    expect(script).toContain("/api/heatmap-settings");
    expect(script).toContain("/api/admin/heatmap-settings");
    expect(script).not.toContain("heat-window-start");
    expect(script).toContain('names("Free"');
    expect(script).toContain('names("Busy"');
    expect(script).not.toContain("nav-search");
    expect(script).not.toMatch(/find a time/i);
    const api = new Function(
      `${TIME_FNS}; return { zonedWallTimeToIso, parseTimeToMinutes, inclusiveDaySpan };`,
    )() as {
      zonedWallTimeToIso: typeof zonedWallTimeToIso;
      parseTimeToMinutes: typeof parseTimeToMinutes;
      inclusiveDaySpan: typeof inclusiveDaySpan;
    };
    expect(api.zonedWallTimeToIso("2026-11-06", 0, 0, "America/Chicago")).toBe(
      zonedWallTimeToIso("2026-11-06", 0, 0, "America/Chicago"),
    );
    expect(api.zonedWallTimeToIso("2026-07-06", 9, 30, "America/Chicago")).toBe(
      "2026-07-06T14:30:00.000Z",
    );
    expect(api.parseTimeToMinutes("09:00")).toBe(9 * 60);
    expect(api.parseTimeToMinutes("17:00")).toBe(17 * 60);
    expect(api.parseTimeToMinutes("24:00")).toBeNull();
    expect(api.inclusiveDaySpan("2026-11-06", "2026-11-19")).toBe(14);
    expect(api.inclusiveDaySpan("2026-11-19", "2026-11-06")).toBeNull();
  });
});
