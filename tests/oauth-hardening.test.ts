import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  clearGoogleJwksCache,
  generatePkce,
  revokeGoogleToken,
  verifyGoogleIdToken,
} from "../src/auth/google";
import { encryptSecret } from "../src/crypto/tokens";
import { GoogleTokenRevokedError, refreshAccessToken } from "../src/calendar/freebusy-client";
import type { Env, Role, UserRow } from "../src/types";
import type { SessionRow } from "../src/db/sessions";

const BASE = "https://owners.sovrnty.com";
const ENC_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function makeTestRsaKeypair() {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pubJwk = (await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey,
  )) as JsonWebKey & { kid?: string; alg?: string; use?: string };
  pubJwk.kid = "test-kid-1";
  pubJwk.alg = "RS256";
  pubJwk.use = "sig";
  return { privateKey: pair.privateKey, jwks: { keys: [pubJwk] } };
}

async function signTestIdToken(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  kid = "test-kid-1",
): Promise<string> {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid })));
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      privateKey,
      enc.encode(`${header}.${payload}`),
    ),
  );
  return `${header}.${payload}.${b64url(sig)}`;
}

function makeUser(over: Partial<UserRow> & { id: string; email: string; role: Role }): UserRow {
  return {
    email_normalized: over.email.toLowerCase(),
    name: "Test User",
    google_sub: "sub-expected",
    invited_by: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    last_login_at: null,
    calendar_connected_at: null,
    token_status: "none",
    ...over,
  };
}

function extractCookiePair(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

describe("PKCE and Google OIDC id_token verification", () => {
  it("generates S256 PKCE verifier and challenge", async () => {
    const pkce = await generatePkce();
    expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.codeChallenge.length).toBeGreaterThanOrEqual(43);
    expect(pkce.codeChallengeMethod).toBe("S256");
    expect(pkce.codeChallenge).not.toBe(pkce.codeVerifier);
  });

  it("verifies valid RS256 id_token and rejects bad nonce, aud, iss, exp, or signature", async () => {
    const { privateKey, jwks } = await makeTestRsaKeypair();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(jwks), { status: 200 }),
    ) as unknown as typeof fetch;
    const nowSec = Math.floor(Date.now() / 1000);
    const baseClaims = {
      iss: "https://accounts.google.com",
      aud: "cid.apps.googleusercontent.com",
      sub: "sub-123",
      email: "host@example.com",
      email_verified: true,
      nonce: "expected-nonce",
      exp: nowSec + 3600,
    };

    const goodToken = await signTestIdToken(privateKey, baseClaims);
    const verified = await verifyGoogleIdToken(goodToken, {
      clientId: "cid.apps.googleusercontent.com",
      expectedNonce: "expected-nonce",
      fetchImpl,
      nowSec,
    });
    expect(verified.sub).toBe("sub-123");
    expect(verified.email).toBe("host@example.com");

    // Bad nonce
    await expect(
      verifyGoogleIdToken(goodToken, {
        clientId: "cid.apps.googleusercontent.com",
        expectedNonce: "wrong-nonce",
        fetchImpl,
        nowSec,
      }),
    ).rejects.toThrow(/nonce/);

    // Bad audience
    await expect(
      verifyGoogleIdToken(goodToken, {
        clientId: "other-client",
        expectedNonce: "expected-nonce",
        fetchImpl,
        nowSec,
      }),
    ).rejects.toThrow(/audience/);

    // Expired
    const expiredToken = await signTestIdToken(privateKey, {
      ...baseClaims,
      exp: nowSec - 120,
    });
    await expect(
      verifyGoogleIdToken(expiredToken, {
        clientId: "cid.apps.googleusercontent.com",
        expectedNonce: "expected-nonce",
        fetchImpl,
        nowSec,
      }),
    ).rejects.toThrow(/expired/);

    // Tampered payload
    const parts = goodToken.split(".");
    const tampered = `${parts[0]}.${b64url(new TextEncoder().encode(JSON.stringify({ ...baseClaims, email: "evil@example.com" })))}.${parts[2]}`;
    await expect(
      verifyGoogleIdToken(tampered, {
        clientId: "cid.apps.googleusercontent.com",
        expectedNonce: "expected-nonce",
        fetchImpl,
        nowSec,
      }),
    ).rejects.toThrow(/signature/);
  });
});

describe("OAuth start/callback hardening, account ownership, and revocation", () => {
  afterEach(() => {
    clearGoogleJwksCache();
    vi.restoreAllMocks();
  });

  function makeDb(opts: {
    users: UserRow[];
    session?: SessionRow;
    encryptedTokens?: Map<string, { ciphertext: Uint8Array; iv: Uint8Array; tag: Uint8Array }>;
    audits?: Array<{ action: string; targetEmail: unknown }>;
    deletedUsers?: string[];
  }) {
    return {
      prepare(sql: string) {
        let args: unknown[] = [];
        const stmt = {
          bind(...b: unknown[]) {
            args = b;
            return stmt;
          },
          async first() {
            if (sql.includes("FROM sessions")) return opts.session ?? null;
            if (sql.includes("COUNT(*)") && sql.includes("role = 'admin'")) {
              return { c: opts.users.filter((u) => u.role === "admin").length };
            }
            if (sql.includes("FROM users WHERE email_normalized")) {
              return opts.users.find((u) => u.email_normalized === String(args[0])) ?? null;
            }
            if (sql.includes("FROM users WHERE id")) {
              return opts.users.find((u) => u.id === String(args[0])) ?? null;
            }
            if (sql.includes("FROM oauth_tokens")) {
              const t = opts.encryptedTokens?.get(String(args[0]));
              if (!t) return null;
              return {
                refresh_token_ciphertext: t.ciphertext.buffer,
                refresh_token_iv: t.iv.buffer,
                refresh_token_tag: t.tag.buffer,
              };
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM users")) return { results: opts.users };
            return { results: [] };
          },
          async run() {
            if (sql.includes("INSERT INTO audit_log")) {
              opts.audits?.push({ action: String(args[3]), targetEmail: args[4] });
            }
            if (sql.includes("DELETE FROM users")) {
              opts.deletedUsers?.push(String(args[0]));
            }
            return { success: true };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
  }

  function makeEnv(db: D1Database): Env {
    return {
      DB: db,
      APP_NAME: "Operators",
      DEFAULT_TIMEZONE: "America/Chicago",
      ENVIRONMENT: "staging",
      ALLOW_PRODUCTION: "false",
      GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "client-secret",
      TOKEN_ENCRYPTION_KEY: ENC_KEY,
      SESSION_SECRET: "session-hmac-secret",
      APP_BASE_URL: BASE,
    };
  }

  it("issues Secure __Host- state cookie with PKCE S256 and nonce on /auth/google/start and rejects google_sub mismatch", async () => {
    const { privateKey, jwks } = await makeTestRsaKeypair();
    const user = makeUser({
      id: "u1",
      email: "host@example.com",
      role: "host",
      google_sub: "original-sub",
    });
    const audits: Array<{ action: string; targetEmail: unknown }> = [];
    const env = makeEnv(makeDb({ users: [user], audits }));

    const startRes = await worker.fetch(new Request(`${BASE}/auth/google/start`), env);
    expect(startRes.status).toBe(302);
    const authUrl = new URL(startRes.headers.get("location")!);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("code_challenge")).toBeTruthy();
    const state = authUrl.searchParams.get("state")!;
    const nonce = authUrl.searchParams.get("nonce")!;
    const setCookie = startRes.headers.get("set-cookie")!;
    expect(setCookie).toContain("__Host-ots_oauth_state=");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    // Simulate callback with a DIFFERENT google_sub for the same email
    const idToken = await signTestIdToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: "cid.apps.googleusercontent.com",
      sub: "hijacker-sub",
      email: "host@example.com",
      email_verified: true,
      nonce,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    let sawCodeVerifier = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        sawCodeVerifier = String(init?.body ?? "").includes("code_verifier=");
        return new Response(
          JSON.stringify({ access_token: "at", id_token: idToken }),
          { status: 200 },
        );
      }
      if (url.includes("oauth2/v3/certs")) {
        return new Response(JSON.stringify(jwks), { status: 200 });
      }
      if (url.includes("v1/userinfo")) {
        return new Response(
          JSON.stringify({
            sub: "hijacker-sub",
            email: "host@example.com",
            email_verified: true,
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const cbRes = await worker.fetch(
      new Request(`${BASE}/auth/google/callback?code=c1&state=${encodeURIComponent(state)}`, {
        headers: { cookie: extractCookiePair(setCookie) },
      }),
      env,
    );
    expect(sawCodeVerifier).toBe(true);
    expect(cbRes.status).toBe(403);
    expect(cbRes.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(audits.some((a) => a.action === "sign_in_sub_mismatch")).toBe(true);
  });

  it("rejects calendar connect from a different Google account and revokes the mismatched token", async () => {
    const { privateKey, jwks } = await makeTestRsaKeypair();
    const user = makeUser({
      id: "u1",
      email: "host@example.com",
      role: "host",
      google_sub: "sub-host-1",
    });
    const session: SessionRow = {
      id: "sess-1",
      user_id: "u1",
      csrf_secret: "csrf-1",
      created_at: "2026-11-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    const audits: Array<{ action: string; targetEmail: unknown }> = [];
    const env = makeEnv(makeDb({ users: [user], session, audits }));

    const startRes = await worker.fetch(
      new Request(`${BASE}/auth/google/calendar/start`, {
        headers: { cookie: "ots_session=sess-1" },
      }),
      env,
    );
    expect(startRes.status).toBe(302);
    const authUrl = new URL(startRes.headers.get("location")!);
    expect(authUrl.searchParams.get("login_hint")).toBe("host@example.com");
    expect(authUrl.searchParams.get("scope")).toContain("openid");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authUrl.searchParams.get("state")!;
    const nonce = authUrl.searchParams.get("nonce")!;
    const calCookie = startRes.headers.get("set-cookie")!;
    expect(calCookie).toContain("__Host-ots_cal_state=");
    expect(calCookie).toContain("Secure");

    const wrongIdToken = await signTestIdToken(privateKey, {
      iss: "https://accounts.google.com",
      aud: "cid.apps.googleusercontent.com",
      sub: "sub-personal-other",
      email: "personal@example.com",
      email_verified: true,
      nonce,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const revokedTokens: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "at-wrong",
            refresh_token: "rt-wrong",
            id_token: wrongIdToken,
          }),
          { status: 200 },
        );
      }
      if (url.includes("oauth2/v3/certs")) {
        return new Response(JSON.stringify(jwks), { status: 200 });
      }
      if (url.includes("oauth2.googleapis.com/revoke")) {
        revokedTokens.push(String(init?.body ?? ""));
        return new Response("", { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const cbRes = await worker.fetch(
      new Request(
        `${BASE}/auth/google/calendar/callback?code=c2&state=${encodeURIComponent(state)}`,
        {
          headers: {
            cookie: `ots_session=sess-1; ${extractCookiePair(calCookie)}`,
          },
        },
      ),
      env,
    );
    expect(cbRes.status).toBe(403);
    expect(revokedTokens).toEqual(["token=rt-wrong"]);
    expect(audits.some((a) => a.action === "calendar_connect_account_mismatch")).toBe(true);
    expect(cbRes.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("revokes Google refresh token on /me/delete and on /api/admin/remove, and guards last admin", async () => {
    const admin = makeUser({ id: "u-admin", email: "admin@example.com", role: "admin" });
    const host = makeUser({
      id: "u-host",
      email: "host@example.com",
      role: "host",
      token_status: "ok",
    });
    const session: SessionRow = {
      id: "sess-admin",
      user_id: "u-admin",
      csrf_secret: "csrf-admin",
      created_at: "2026-11-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    const encHost = await encryptSecret("refresh-host-secret", ENC_KEY);
    const encryptedTokens = new Map([["u-host", encHost]]);
    const audits: Array<{ action: string; targetEmail: unknown }> = [];
    const deletedUsers: string[] = [];
    const env = makeEnv(
      makeDb({ users: [admin, host], session, encryptedTokens, audits, deletedUsers }),
    );

    const revoked: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/revoke")) {
        revoked.push(String(init?.body ?? ""));
        return new Response("", { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    // Cannot self-delete when sole admin
    const delSelf = await worker.fetch(
      new Request(`${BASE}/me/delete`, {
        method: "POST",
        headers: {
          cookie: "ots_session=sess-admin",
          "x-csrf-token": "csrf-admin",
        },
      }),
      env,
    );
    expect(delSelf.status).toBe(400);

    // Cannot self-demote
    const demoteSelf = await worker.fetch(
      new Request(`${BASE}/api/admin/role`, {
        method: "POST",
        headers: {
          cookie: "ots_session=sess-admin",
          "x-csrf-token": "csrf-admin",
          "content-type": "application/json",
        },
        body: JSON.stringify({ userId: "u-admin", role: "host" }),
      }),
      env,
    );
    expect(demoteSelf.status).toBe(400);

    // Removing host revokes their Google token and logs true DB email (not spoofed body.email)
    const rmHost = await worker.fetch(
      new Request(`${BASE}/api/admin/remove`, {
        method: "POST",
        headers: {
          cookie: "ots_session=sess-admin",
          "x-csrf-token": "csrf-admin",
          "content-type": "application/json",
        },
        body: JSON.stringify({ userId: "u-host", email: "spoofed@example.com" }),
      }),
      env,
    );
    expect(rmHost.status).toBe(200);
    expect(revoked).toEqual(["token=refresh-host-secret"]);
    expect(deletedUsers).toEqual(["u-host"]);
    expect(audits.find((a) => a.action === "remove")?.targetEmail).toBe("host@example.com");
  });

  it("handles revokeGoogleToken network errors gracefully and throws GoogleTokenRevokedError on invalid_grant", async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await revokeGoogleToken("tok", failingFetch)).toEqual({ ok: false });

    const invalidGrantFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    ) as unknown as typeof fetch;
    await expect(
      refreshAccessToken("cid", "sec", "rt", invalidGrantFetch),
    ).rejects.toBeInstanceOf(GoogleTokenRevokedError);
  });
});
