import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { escapeHtml } from "../src/ui/pages";
import type { Env } from "../src/types";

describe("escapeHtml", () => {
  it("escapes HTML metacharacters including single quotes", () => {
    expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});

describe("OAuth callback uninvited email escaping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("HTML-escapes uninvited email reflected on /auth/google/callback", async () => {
    const hostileEmail = `"<img src=x onerror=alert(1)>'"@example.com`;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "at" }), {
            status: 200,
          });
        }
        if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
          return new Response(
            JSON.stringify({
              sub: "sub-1",
              email: hostileEmail,
              email_verified: true,
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

    const db = {
      prepare() {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            return null;
          },
          async run() {
            return { success: true };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;

    const env: Env = {
      DB: db,
      APP_NAME: "Operators: The Owners Scheduler",
      DEFAULT_TIMEZONE: "America/Chicago",
      ENVIRONMENT: "staging",
      ALLOW_PRODUCTION: "false",
      GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "secret",
      TOKEN_ENCRYPTION_KEY: "00".repeat(32),
      SESSION_SECRET: "session-secret",
      APP_BASE_URL: "https://scheduler-staging.sovrnty.com",
    };

    const res = await worker.fetch(
      new Request(
        "https://scheduler-staging.sovrnty.com/auth/google/callback?code=abc&state=st1",
        { headers: { cookie: "ots_oauth_state=st1" } },
      ),
      env,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&#39;");
    expect(html).toContain("&quot;");
  });
});
