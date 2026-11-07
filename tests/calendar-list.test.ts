import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  CalendarListError,
  defaultCalendarSelection,
  listCalendars,
} from "../src/calendar/calendar-list";
import {
  CALENDAR_LIST_SCOPE,
  CALENDAR_SCOPES,
  missingCalendarScopes,
} from "../src/auth/google";
import type { Env, UserRow } from "../src/types";
import type { SessionRow } from "../src/db/sessions";

describe("calendar scopes", () => {
  it("includes freebusy and calendarlist.readonly", () => {
    expect(CALENDAR_SCOPES).toContain(
      "https://www.googleapis.com/auth/calendar.freebusy",
    );
    expect(CALENDAR_SCOPES).toContain(
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    );
  });
});

describe("defaultCalendarSelection", () => {
  it("prefers primary", () => {
    const sel = defaultCalendarSelection([
      { id: "a", summary: "A", primary: false },
      { id: "b", summary: "B", primary: true },
    ]);
    expect(sel).toEqual([{ id: "b", summary: "B", primary: true }]);
  });

  it("falls back to primary literal", () => {
    expect(defaultCalendarSelection([])).toEqual([
      { id: "primary", summary: "Primary", primary: true },
    ]);
  });
});

describe("listCalendars", () => {
  it("maps Google calendarList items", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              { id: "primary", summary: "Work", primary: true },
              { id: "x@group.calendar.google.com", summary: "Side" },
            ],
          }),
          { status: 200 },
        ),
    );
    const list = await listCalendars(
      "tok",
      fetchImpl as unknown as typeof fetch,
    );
    expect(list).toHaveLength(2);
    expect(list[0].primary).toBe(true);
  });

  it("reports a CalendarList error response instead of succeeding", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 403 }),
    );
    await expect(
      listCalendars("tok", fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(CalendarListError);
    await expect(
      listCalendars("tok", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("calendarList failed: 403");
  });
});

describe("GET /api/calendars with a partial grant", () => {
  const session: SessionRow = {
    id: "sess-1",
    user_id: "user-1",
    csrf_secret: "csrf-secret",
    created_at: "2026-11-06T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
  };
  const connected: UserRow = {
    id: "user-1",
    email: "will@chisos.com",
    email_normalized: "will@chisos.com",
    name: "Will Roman",
    role: "host",
    google_sub: null,
    invited_by: null,
    created_at: "2026-11-07T02:53:23.000Z",
    updated_at: "2026-11-07T02:54:20.000Z",
    last_login_at: "2026-11-07T02:53:23.000Z",
    calendar_connected_at: "2026-11-07T02:54:20.000Z",
    token_status: "ok",
  };

  function dbFor(scopes: string): D1Database {
    return {
      prepare(sql: string) {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            if (sql.includes("FROM sessions")) return session;
            if (sql.includes("FROM users")) return connected;
            if (sql.includes("scopes")) {
              return { scopes };
            }
            return null;
          },
          async all() {
            if (sql.includes("calendars_selected")) {
              return {
                results: [
                  {
                    calendar_id: "primary",
                    summary: "Primary",
                    is_primary: 1,
                  },
                ],
              };
            }
            return { results: [] };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
  }

  function env(scopes: string): Env {
    return {
      DB: dbFor(scopes),
      APP_NAME: "Operators: The Owners Scheduler",
      DEFAULT_TIMEZONE: "America/Chicago",
      ENVIRONMENT: "staging",
      ALLOW_PRODUCTION: "false",
      GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "not-used",
      TOKEN_ENCRYPTION_KEY: "not-used",
      SESSION_SECRET: "not-used",
      APP_BASE_URL: "https://scheduler-staging.sovrnty.com",
    };
  }

  it("keeps primary usable when the grant cannot list calendars", async () => {
    const scopes = "https://www.googleapis.com/auth/calendar.freebusy";
    expect(missingCalendarScopes(scopes.split(" "))).toContain(CALENDAR_LIST_SCOPE);
    const res = await worker.fetch(
      new Request("https://scheduler-staging.sovrnty.com/api/calendars", {
        headers: { cookie: "ots_session=sess-1" },
      }),
      env(scopes),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      listError: string;
      available: unknown[];
      selected: Array<{ id: string; primary: boolean }>;
      missingScopes: string[];
      error?: string;
    };
    expect(body.error).toBeUndefined();
    expect(body.listError).toBe("missing_scope");
    expect(body.available).toEqual([]);
    expect(body.selected).toEqual([
      { id: "primary", summary: "Primary", primary: true },
    ]);
    expect(body.missingScopes).toContain(CALENDAR_LIST_SCOPE);
    expect(JSON.stringify(body)).not.toMatch(/refresh|ciphertext|access_token/i);
  });
});
