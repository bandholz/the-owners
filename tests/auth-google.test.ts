import { describe, expect, it, vi } from "vitest";
import {
  buildGoogleAuthUrl,
  exchangeCode,
  fetchUserInfo,
  IDENTITY_SCOPES,
} from "../src/auth/google";
import type { Env } from "../src/types";
import { normalizeEmail } from "../src/db/users";
import { queryFreeBusy } from "../src/calendar/freebusy-client";

describe("buildGoogleAuthUrl", () => {
  it("includes scopes and state", () => {
    const url = buildGoogleAuthUrl({
      clientId: "cid.apps.googleusercontent.com",
      redirectUri: "http://localhost:8787/auth/google/callback",
      scopes: IDENTITY_SCOPES,
      state: "abc",
      nonce: "n",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(u.searchParams.get("client_id")).toContain("apps.googleusercontent.com");
    expect(u.searchParams.get("state")).toBe("abc");
    expect(u.searchParams.get("scope")).toContain("openid");
    expect(u.searchParams.get("scope")).toContain("email");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Eric@Bandholz.COM ")).toBe("eric@bandholz.com");
  });
});

describe("mocked Google endpoints", () => {
  const env = {
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "sec",
  } as Env;

  it("exchangeCode posts form body", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: "at", refresh_token: "rt" }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const tok = await exchangeCode(env, "code", "http://localhost/cb", fetchImpl);
    expect(tok.access_token).toBe("at");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as RequestInit;
    expect(String(init.body)).toContain("grant_type=authorization_code");
  });

  it("fetchUserInfo rejects unverified email", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          sub: "1",
          email: "a@b.com",
          email_verified: false,
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    await expect(fetchUserInfo("at", fetchImpl)).rejects.toThrow(/not verified/);
  });

  it("queryFreeBusy maps busy blocks only", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          calendars: {
            primary: {
              busy: [
                {
                  start: "2026-11-10T16:00:00Z",
                  end: "2026-11-10T17:00:00Z",
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const busy = await queryFreeBusy(
      {
        timeMin: "2026-11-10T00:00:00Z",
        timeMax: "2026-11-11T00:00:00Z",
        calendarIds: ["primary"],
        accessToken: "at",
      },
      fetchImpl,
    );
    expect(busy).toHaveLength(1);
    expect(busy[0].start.toISOString()).toBe("2026-11-10T16:00:00.000Z");
  });
});
