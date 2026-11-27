import { timingSafeEqual } from "../crypto/tokens";

export const OAUTH_LOGIN_STATE_COOKIE = "ots_oauth_state";
export const OAUTH_CAL_STATE_COOKIE = "ots_cal_state";
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  nonce: string;
  userId?: string;
  sessionId?: string;
  exp: number;
}

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

export function oauthStateCookieName(baseName: string, secure: boolean): string {
  return secure ? `__Host-${baseName}` : baseName;
}

export function buildOAuthStateCookieHeader(
  baseName: string,
  signedValue: string,
  secure: boolean,
): string {
  const name = oauthStateCookieName(baseName, secure);
  const parts = [
    `${name}=${encodeURIComponent(signedValue)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearOAuthStateCookieHeaders(
  baseName: string,
  secure: boolean,
): string[] {
  const name = oauthStateCookieName(baseName, secure);
  const clear = `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
  if (!secure) return [clear];
  return [
    clear,
    `${baseName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
  ];
}

export function readOAuthStateCookie(
  cookies: Record<string, string>,
  baseName: string,
  secure: boolean,
): string | undefined {
  return cookies[oauthStateCookieName(baseName, secure)];
}

async function signPayload(encodedPayload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(encodedPayload));
  return bytesToBase64Url(new Uint8Array(sig));
}

export async function sealOAuthState(
  payload: OAuthStatePayload,
  secret: string,
): Promise<string> {
  if (!secret) throw new Error("OAuth state signing secret is required");
  const encoded = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const sig = await signPayload(encoded, secret);
  return `${encoded}.${sig}`;
}

export async function verifyOAuthState(
  cookieValue: string | undefined,
  expectedStateParam: string | null,
  secret: string,
  opts?: {
    expectedUserId?: string;
    expectedSessionId?: string;
    nowMs?: number;
  },
): Promise<OAuthStatePayload | null> {
  if (!cookieValue || !expectedStateParam || !secret) return null;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0 || dot !== cookieValue.lastIndexOf(".")) return null;
  const encoded = cookieValue.slice(0, dot);
  const providedSig = cookieValue.slice(dot + 1);
  if (!providedSig) return null;

  const expectedSig = await signPayload(encoded, secret);
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  let payload: OAuthStatePayload;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(encoded));
    payload = JSON.parse(json) as OAuthStatePayload;
  } catch {
    return null;
  }

  const nowMs = opts?.nowMs ?? Date.now();
  if (
    !payload ||
    typeof payload.state !== "string" ||
    typeof payload.codeVerifier !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.exp !== "number" ||
    nowMs >= payload.exp
  ) {
    return null;
  }

  if (!timingSafeEqual(expectedStateParam, payload.state)) return null;

  if (
    opts?.expectedUserId !== undefined &&
    (!payload.userId || !timingSafeEqual(payload.userId, opts.expectedUserId))
  ) {
    return null;
  }
  if (
    opts?.expectedSessionId !== undefined &&
    (!payload.sessionId ||
      !timingSafeEqual(payload.sessionId, opts.expectedSessionId))
  ) {
    return null;
  }

  return payload;
}
