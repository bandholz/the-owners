import { describe, expect, it, vi } from "vitest";
import {
  buildAccessEmailIncludes,
  desiredAccessEmailsFromUsers,
  isAccessSyncConfigured,
  syncAccessAllowlist,
} from "../src/access/sync";
import type { Env } from "../src/types";

function baseEnv(over: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    APP_NAME: "t",
    DEFAULT_TIMEZONE: "America/Chicago",
    ENVIRONMENT: "local",
    ALLOW_PRODUCTION: "false",
    GOOGLE_CLIENT_ID: "x",
    GOOGLE_CLIENT_SECRET: "y",
    TOKEN_ENCRYPTION_KEY: "00".repeat(32),
    SESSION_SECRET: "s",
    APP_BASE_URL: "http://localhost:8787",
    ...over,
  };
}

describe("Access sync helpers", () => {
  it("normalizes and sorts emails", () => {
    expect(
      desiredAccessEmailsFromUsers([
        { email: "B@X.com" },
        { email: " a@x.com " },
        { email: "a@x.com" },
      ]),
    ).toEqual(["a@x.com", "b@x.com"]);
  });

  it("builds include selectors", () => {
    expect(buildAccessEmailIncludes(["a@x.com", "b@x.com"])).toEqual([
      { email: { email: "a@x.com" } },
      { email: { email: "b@x.com" } },
    ]);
  });

  it("is inactive without flag/token", () => {
    expect(isAccessSyncConfigured(baseEnv())).toBe(false);
    expect(
      isAccessSyncConfigured(
        baseEnv({
          CF_ACCESS_SYNC_ENABLED: "true",
          CF_API_TOKEN: "tok",
          CF_ACCOUNT_ID: "acct",
          CF_ACCESS_APP_ID: "app",
          CF_ACCESS_POLICY_ID: "pol",
        }),
      ),
    ).toBe(true);
  });

  it("skips network when inactive", async () => {
    const fetchImpl = vi.fn();
    const result = await syncAccessAllowlist(
      baseEnv(),
      ["a@x.com"],
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("PUTs policy when configured", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const env = baseEnv({
      CF_ACCESS_SYNC_ENABLED: "true",
      CF_API_TOKEN: "tok",
      CF_ACCOUNT_ID: "acct",
      CF_ACCESS_APP_ID: "app",
      CF_ACCESS_POLICY_ID: "pol",
    });
    const result = await syncAccessAllowlist(
      env,
      ["Host@Ex.com"],
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.status).toBe("ok");
    expect(result.emails).toEqual(["host@ex.com"]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toContain("/access/apps/app/policies/pol");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(String(init.body));
    expect(body.include).toEqual([{ email: { email: "host@ex.com" } }]);
  });

  it("returns error on non-2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    const env = baseEnv({
      CF_ACCESS_SYNC_ENABLED: "true",
      CF_API_TOKEN: "tok",
      CF_ACCOUNT_ID: "acct",
      CF_ACCESS_APP_ID: "app",
      CF_ACCESS_POLICY_ID: "pol",
    });
    const result = await syncAccessAllowlist(
      env,
      ["a@x.com"],
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.status).toBe("error");
    expect(result.httpStatus).toBe(403);
  });
});
