import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env, UserRow } from "../src/types";
import type { SessionRow } from "../src/db/sessions";

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

function stubDb(session: SessionRow | null, user: UserRow | null): D1Database {
  return {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (sql.includes("FROM sessions")) return session;
          if (sql.includes("FROM users")) return user;
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function stateFromCookie(setCookie: string, name: string): string {
  const raw = setCookie.split(";")[0]?.slice(name.length + 1) ?? "";
  return decodeURIComponent(raw);
}

describe("Google OAuth start redirects", () => {
  it("issues a 302 and ots_oauth_state cookie without throwing", async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/auth/google/start`),
      env(),
    );
    expect(res.status).toBe(302);
    const loc = res.headers.get("location");
    expect(loc).toBeTruthy();
    const url = new URL(loc!);
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${BASE}/auth/google/callback`,
    );
    expect(url.searchParams.get("client_id")).toBe(
      "cid.apps.googleusercontent.com",
    );
    const stateCookie = res.headers.get("set-cookie");
    expect(stateCookie).toBeTruthy();
    expect(stateCookie!.startsWith("ots_oauth_state=")).toBe(true);
    expect(stateCookie).toContain("HttpOnly");
    expect(stateCookie).toContain("SameSite=Lax");
    expect(stateCookie).toContain("Max-Age=600");
    expect(url.searchParams.get("state")).toBe(
      stateFromCookie(stateCookie!, "ots_oauth_state"),
    );
    expect(await res.text()).not.toContain("internal error");
  });

  it("issues a 302 and ots_cal_state cookie for a signed-in host", async () => {
    const session: SessionRow = {
      id: "sess-1",
      user_id: "user-1",
      csrf_secret: "csrf",
      created_at: "2026-11-06T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    const user: UserRow = {
      id: "user-1",
      email: "host@example.com",
      email_normalized: "host@example.com",
      name: "Host",
      role: "host",
      google_sub: null,
      invited_by: null,
      created_at: "2026-11-06T00:00:00.000Z",
      updated_at: "2026-11-06T00:00:00.000Z",
      last_login_at: null,
      calendar_connected_at: null,
      token_status: "none",
    };
    const res = await worker.fetch(
      new Request(`${BASE}/auth/google/calendar/start`, {
        headers: { cookie: "ots_session=sess-1" },
      }),
      env(stubDb(session, user)),
    );
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${BASE}/auth/google/calendar/callback`,
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("calendar.freebusy");
    expect(scope).toContain("calendar.calendarlist.readonly");
    expect(scope).toContain("calendar.events.owned");
    const stateCookie = res.headers.get("set-cookie");
    expect(stateCookie).toBeTruthy();
    expect(stateCookie!.startsWith("ots_cal_state=")).toBe(true);
    expect(url.searchParams.get("state")).toBe(
      stateFromCookie(stateCookie!, "ots_cal_state"),
    );
  });

  it("does not delete the account when starting calendar reconnect", async () => {
    const ran: string[] = [];
    const session: SessionRow = {
      id: "sess-1",
      user_id: "user-1",
      csrf_secret: "csrf",
      created_at: "2026-11-06T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    const user: UserRow = {
      id: "user-1",
      email: "aaron@9operators.com",
      email_normalized: "aaron@9operators.com",
      name: "Aaron",
      role: "host",
      google_sub: null,
      invited_by: null,
      created_at: "2026-11-06T00:00:00.000Z",
      updated_at: "2026-11-06T00:00:00.000Z",
      last_login_at: null,
      calendar_connected_at: "2026-11-06T00:00:00.000Z",
      token_status: "ok",
    };
    const db = {
      prepare(sql: string) {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            if (sql.includes("FROM sessions")) return session;
            if (sql.includes("FROM users")) return user;
            return null;
          },
          async run() {
            ran.push(sql);
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
    const res = await worker.fetch(
      new Request(`${BASE}/auth/google/calendar/start`, {
        headers: { cookie: "ots_session=sess-1" },
      }),
      env(db),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("prompt=consent");
    expect(ran.join("\n")).not.toContain("DELETE FROM users");
  });

  it("still deletes the account on disconnect", async () => {
    const ran: string[] = [];
    const session: SessionRow = {
      id: "sess-1",
      user_id: "user-1",
      csrf_secret: "csrf-secret",
      created_at: "2026-11-06T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    const user: UserRow = {
      id: "user-1",
      email: "aaron@9operators.com",
      email_normalized: "aaron@9operators.com",
      name: "Aaron",
      role: "host",
      google_sub: null,
      invited_by: null,
      created_at: "2026-11-06T00:00:00.000Z",
      updated_at: "2026-11-06T00:00:00.000Z",
      last_login_at: null,
      calendar_connected_at: "2026-11-06T00:00:00.000Z",
      token_status: "ok",
    };
    const db = {
      prepare(sql: string) {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            if (sql.includes("FROM sessions")) return session;
            if (sql.includes("FROM users")) return user;
            return null;
          },
          async run() {
            ran.push(sql);
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
    const res = await worker.fetch(
      new Request(`${BASE}/me/delete`, {
        method: "POST",
        headers: {
          cookie: "ots_session=sess-1",
          "x-csrf-token": "csrf-secret",
        },
      }),
      env(db),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(ran.some((sql) => sql.includes("DELETE FROM oauth_tokens"))).toBe(true);
    expect(ran.some((sql) => sql.includes("DELETE FROM users"))).toBe(true);
  });
});
