import type { Env } from "../types";
import { timingSafeEqual } from "../crypto/tokens";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke";
const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";
const FETCH_TIMEOUT_MS = 8000;

export const IDENTITY_SCOPES = ["openid", "email", "profile"];
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export async function generatePkce(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = bytesToBase64Url(raw);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = bytesToBase64Url(new Uint8Array(digest));
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}

export function buildGoogleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  nonce?: string;
  accessType?: "online" | "offline";
  prompt?: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256";
  loginHint?: string;
}): string {
  const u = new URL(GOOGLE_AUTH);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", opts.scopes.join(" "));
  u.searchParams.set("state", opts.state);
  if (opts.nonce) u.searchParams.set("nonce", opts.nonce);
  if (opts.accessType) u.searchParams.set("access_type", opts.accessType);
  if (opts.prompt) u.searchParams.set("prompt", opts.prompt);
  if (opts.codeChallenge) {
    u.searchParams.set("code_challenge", opts.codeChallenge);
    u.searchParams.set(
      "code_challenge_method",
      opts.codeChallengeMethod ?? "S256",
    );
  }
  if (opts.loginHint) u.searchParams.set("login_hint", opts.loginHint);
  return u.toString();
}

export async function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
  codeVerifier?: string,
): Promise<{
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  expires_in?: number;
}> {
  const params: Record<string, string> = {
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };
  if (codeVerifier) {
    params.code_verifier = codeVerifier;
  }
  const body = new URLSearchParams(params);
  const res = await fetchImpl(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchUserInfo(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}> {
  const res = await fetchImpl(GOOGLE_USERINFO, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  const data = (await res.json()) as {
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
  };
  if (!data.email_verified) throw new Error("email not verified");
  return data;
}

export interface GoogleJwk {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

let jwksCache: { keys: GoogleJwk[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

export function clearGoogleJwksCache(): void {
  jwksCache = null;
}

async function fetchGoogleJwks(
  fetchImpl: typeof fetch,
  forceRefresh = false,
): Promise<{ keys: GoogleJwk[]; fromCache: boolean }> {
  const useCache = fetchImpl === fetch;
  if (
    useCache &&
    !forceRefresh &&
    jwksCache &&
    Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS
  ) {
    return { keys: jwksCache.keys, fromCache: true };
  }
  const res = await fetchImpl(GOOGLE_JWKS, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`google jwks failed: ${res.status}`);
  }
  const data = (await res.json()) as { keys?: GoogleJwk[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  if (useCache) {
    jwksCache = { keys, fetchedAt: Date.now() };
  }
  return { keys, fromCache: false };
}

async function importGoogleJwk(jwk: GoogleJwk, alg: string): Promise<CryptoKey> {
  if (alg === "RS256" && jwk.kty === "RSA") {
    return crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  }
  if (alg === "ES256" && jwk.kty === "EC") {
    return crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  }
  throw new Error(`unsupported id_token alg/kty: ${alg}/${jwk.kty}`);
}

export interface VerifiedGoogleIdClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  nonce?: string;
}

/**
 * Cryptographically verifies a Google OIDC id_token against Google's JWKS,
 * validating signature, iss, aud, exp, nbf, nonce, and email_verified.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  opts: {
    clientId: string;
    expectedNonce: string;
    fetchImpl?: typeof fetch;
    nowSec?: number;
  },
): Promise<VerifiedGoogleIdClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed id_token");
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: {
    iss?: string;
    aud?: string | string[];
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    nonce?: string;
    exp?: number;
    nbf?: number;
  };
  try {
    header = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(headerB64)),
    ) as { alg?: string; kid?: string };
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payloadB64)),
    );
  } catch {
    throw new Error("unparseable id_token");
  }

  const alg = header.alg ?? "";
  if (alg !== "RS256" && alg !== "ES256") {
    throw new Error(`unsupported id_token alg: ${alg}`);
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const sigBytes = base64UrlToBytes(sigB64);
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const verifyAlg =
    alg === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5" }
      : { name: "ECDSA", hash: "SHA-256" };

  const tryVerify = async (keys: GoogleJwk[]): Promise<boolean> => {
    const jwk = header.kid
      ? keys.find((k) => k.kid === header.kid)
      : keys.length === 1
        ? keys[0]
        : undefined;
    if (!jwk) return false;
    const key = await importGoogleJwk(jwk, alg);
    return crypto.subtle.verify(verifyAlg, key, sigBytes, signingInput);
  };

  const first = await fetchGoogleJwks(fetchImpl, false);
  let validSig = await tryVerify(first.keys);
  if (!validSig && first.fromCache) {
    const fresh = await fetchGoogleJwks(fetchImpl, true);
    validSig = await tryVerify(fresh.keys);
  }
  if (!validSig) throw new Error("invalid id_token signature");

  if (
    payload.iss !== "https://accounts.google.com" &&
    payload.iss !== "accounts.google.com"
  ) {
    throw new Error("invalid id_token issuer");
  }

  const audMatch = Array.isArray(payload.aud)
    ? payload.aud.includes(opts.clientId)
    : payload.aud === opts.clientId;
  if (!audMatch) throw new Error("invalid id_token audience");

  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSec - 60) {
    throw new Error("id_token expired");
  }
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) {
    throw new Error("id_token not yet valid");
  }

  if (
    typeof payload.nonce !== "string" ||
    !timingSafeEqual(payload.nonce, opts.expectedNonce)
  ) {
    throw new Error("id_token nonce mismatch");
  }

  if (!payload.sub || !payload.email) {
    throw new Error("id_token missing subject or email");
  }
  if (payload.email_verified !== true) {
    throw new Error("email not verified");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: true,
    name: payload.name,
    nonce: payload.nonce,
  };
}

/**
 * Best-effort revocation of a Google OAuth token at Google's revocation
 * endpoint. Never throws or includes token values in logs.
 */
export async function revokeGoogleToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status?: number }> {
  if (!token) return { ok: false };
  try {
    const res = await fetchImpl(GOOGLE_REVOKE, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  }
}

export function newOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}
