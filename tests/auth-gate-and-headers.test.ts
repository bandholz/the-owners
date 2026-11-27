import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env, Role, UserRow } from "../src/types";
import type { SessionRow } from "../src/db/sessions";

const BASE = "https://owners.sovrnty.com";

function makeUser(role: Role = "host"): UserRow {
  return {
    id: `user-${role}`,
    email: `${role}@example.com`,
    email_normalized: `${role}@example.com`,
    name: role,
    role,
    google_sub: `sub-${role}`,
    invited_by: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    last_login_at: null,
    calendar_connected_at: null,
    token_status: "none",
  };
}

function makeEnv(opts?: {
  session?: SessionRow | null;
  user?: UserRow | null;
  deletedSessions?: string[];
}): Env {
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first() {
          if (sql.includes("FROM sessions")) {
            if (opts?.session && bound[0] === opts.session.id) return opts.session;
            return null;
          }
          if (sql.includes("FROM users")) return opts?.user ?? null;
          return null;
        },
        async all() {
          return { results: opts?.user ? [opts.user] : [] };
        },
        async run() {
          if (sql.includes("DELETE FROM sessions")) {
            opts?.deletedSessions?.push(String(bound[0] ?? ""));
          }
          return { success: true };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return {
    DB: db,
    APP_NAME: "Operators: The Owners Scheduler",
    DEFAULT_TIMEZONE: "America/Chicago",
    ENVIRONMENT: "staging",
    ALLOW_PRODUCTION: "false",
    GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "secret",
    TOKEN_ENCRYPTION_KEY: "00".repeat(32),
    SESSION_SECRET: "session-secret",
    APP_BASE_URL: BASE,
  };
}

describe("fail-closed sole-gate authentication", () => {
  it("allows only minimal /health and sign-in gate / without a session", async () => {
    const env = makeEnv();
    const health = await worker.fetch(new Request(`${BASE}/health`), env);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const home = await worker.fetch(new Request(`${BASE}/`), env);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Sign in with Google");
  });

  it("rejects all non-public pages, APIs, and unknown routes with 401 when unauthenticated", async () => {
    const env = makeEnv();
    const routes: Array<[string, string]> = [
      ["GET", "/me/delete"],
      ["POST", "/me/delete"],
      ["GET", "/calendars"],
      ["GET", "/app"],
      ["GET", "/admin"],
      ["GET", "/api/me"],
      ["GET", "/api/people"],
      ["GET", "/api/groups"],
      ["POST", "/api/groups"],
      ["GET", "/api/calendars"],
      ["PUT", "/api/calendars"],
      ["POST", "/api/slots"],
      ["GET", "/api/admin/users"],
      ["POST", "/api/admin/invite"],
      ["GET", "/auth/google/calendar/start"],
      ["GET", "/auth/google/calendar/callback?code=a&state=b"],
      ["GET", "/does-not-exist"],
    ];

    for (const [method, path] of routes) {
      const res = await worker.fetch(new Request(`${BASE}${path}`, { method }), env);
      expect(res.status, `${method} ${path} should fail closed`).toBe(401);
    }
  });

  it("enforces admin role on /admin, /api/admin/*, and group mutations", async () => {
    const session: SessionRow = {
      id: "sess-host",
      user_id: "user-host",
      csrf_secret: "csrf-123",
      created_at: "2026-11-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    const env = makeEnv({ session, user: makeUser("host") });

    const adminPage = await worker.fetch(
      new Request(`${BASE}/admin`, { headers: { cookie: "ots_session=sess-host" } }),
      env,
    );
    expect(adminPage.status).toBe(403);

    const adminApi = await worker.fetch(
      new Request(`${BASE}/api/admin/users`, {
        headers: { cookie: "ots_session=sess-host" },
      }),
      env,
    );
    expect(adminApi.status).toBe(403);

    const groupCreate = await worker.fetch(
      new Request(`${BASE}/api/groups`, {
        method: "POST",
        headers: {
          cookie: "ots_session=sess-host",
          "x-csrf-token": "csrf-123",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Hosts" }),
      }),
      env,
    );
    expect(groupCreate.status).toBe(403);
  });
});

describe("logout CSRF and origin defense-in-depth", () => {
  const session: SessionRow = {
    id: "sess-1",
    user_id: "user-host",
    csrf_secret: "csrf-secret-xyz",
    created_at: "2026-11-01T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
  };

  it("rejects GET /auth/logout with 405", async () => {
    const deleted: string[] = [];
    const env = makeEnv({ session, user: makeUser("host"), deletedSessions: deleted });
    const res = await worker.fetch(
      new Request(`${BASE}/auth/logout`, {
        method: "GET",
        headers: { cookie: "ots_session=sess-1" },
      }),
      env,
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(deleted).toEqual([]);
  });

  it("requires valid CSRF on POST /auth/logout and deletes session when valid", async () => {
    const deleted: string[] = [];
    const env = makeEnv({ session, user: makeUser("host"), deletedSessions: deleted });

    const bad = await worker.fetch(
      new Request(`${BASE}/auth/logout`, {
        method: "POST",
        headers: { cookie: "ots_session=sess-1" },
      }),
      env,
    );
    expect(bad.status).toBe(403);
    expect(deleted).toEqual([]);

    const ok = await worker.fetch(
      new Request(`${BASE}/auth/logout`, {
        method: "POST",
        headers: {
          cookie: "ots_session=sess-1",
          "content-type": "application/x-www-form-urlencoded",
          origin: BASE,
        },
        body: "csrf=csrf-secret-xyz",
      }),
      env,
    );
    expect(ok.status).toBe(302);
    expect(deleted).toEqual(["sess-1"]);
    expect(ok.headers.get("set-cookie")).toContain("Secure");
    expect(ok.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("blocks cross-origin and cross-site state-changing requests", async () => {
    const env = makeEnv({ session, user: makeUser("host") });
    const badOrigin = await worker.fetch(
      new Request(`${BASE}/api/slots`, {
        method: "POST",
        headers: {
          cookie: "ots_session=sess-1",
          "x-csrf-token": "csrf-secret-xyz",
          origin: "https://evil.example",
        },
        body: "{}",
      }),
      env,
    );
    expect(badOrigin.status).toBe(403);

    const crossSite = await worker.fetch(
      new Request(`${BASE}/api/slots`, {
        method: "POST",
        headers: {
          cookie: "ots_session=sess-1",
          "x-csrf-token": "csrf-secret-xyz",
          "sec-fetch-site": "cross-site",
        },
        body: "{}",
      }),
      env,
    );
    expect(crossSite.status).toBe(403);
  });
});

describe("security headers and wrangler config", () => {
  it("applies security headers and Cache-Control: no-store on HTML and JSON APIs", async () => {
    const session: SessionRow = {
      id: "sess-1",
      user_id: "user-host",
      csrf_secret: "csrf-1",
      created_at: "2026-11-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    const env = makeEnv({ session, user: makeUser("host") });

    const htmlRes = await worker.fetch(new Request(`${BASE}/`), env);
    expect(htmlRes.headers.get("cache-control")).toBe("no-store");
    expect(htmlRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(htmlRes.headers.get("x-frame-options")).toBe("DENY");
    expect(htmlRes.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(htmlRes.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(htmlRes.headers.get("strict-transport-security")).toContain("max-age=31536000");

    const apiRes = await worker.fetch(
      new Request(`${BASE}/api/me`, { headers: { cookie: "ots_session=sess-1" } }),
      env,
    );
    expect(apiRes.status).toBe(200);
    expect(apiRes.headers.get("cache-control")).toBe("no-store");
    expect(apiRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(apiRes.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("disables workers_dev and preview_urls across top-level, staging, and production", () => {
    const raw = readFileSync("wrangler.jsonc", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const cfg = JSON.parse(raw) as {
      workers_dev: boolean;
      preview_urls: boolean;
      env: Record<string, { workers_dev: boolean; preview_urls: boolean }>;
    };
    expect(cfg.workers_dev).toBe(false);
    expect(cfg.preview_urls).toBe(false);
    expect(cfg.env.staging.workers_dev).toBe(false);
    expect(cfg.env.staging.preview_urls).toBe(false);
    expect(cfg.env.production.workers_dev).toBe(false);
    expect(cfg.env.production.preview_urls).toBe(false);
  });
});
