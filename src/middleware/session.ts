import type { Env, UserRow } from "../types";
import { getSession } from "../db/sessions";
import { getUserById } from "../db/users";
import { timingSafeEqualAsync } from "../crypto/tokens";

export const SESSION_COOKIE = "ots_session";
export const HOST_SESSION_COOKIE = "__Host-ots_session";
export const CSRF_HEADER = "x-csrf-token";

/**
 * Parse Cookie header safely:
 * - Null-prototype object avoids prototype pollution / key collisions.
 * - First occurrence wins (RFC 6265 sends host-only / most-specific cookies first,
 *   preventing broader parent-domain cookies from shadowing app cookies).
 * - Malformed percent-encoding never throws a 500 URIError.
 */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (!k || k in out) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(raw);
    } catch {
      out[k] = raw;
    }
  }
  return out;
}

export function isSecureRequest(
  request: Request,
  env: Pick<Env, "ENVIRONMENT">,
): boolean {
  return new URL(request.url).protocol === "https:" || env.ENVIRONMENT !== "local";
}

export function sessionCookieName(secure: boolean): string {
  return secure ? HOST_SESSION_COOKIE : SESSION_COOKIE;
}

export function getSessionTokenFromCookies(
  cookies: Record<string, string>,
  secure: boolean,
): string | undefined {
  return secure ? cookies[HOST_SESSION_COOKIE] : cookies[SESSION_COOKIE];
}

export function sessionCookieHeader(
  rawSessionToken: string,
  expiresAt: string,
  secure: boolean,
): string {
  const name = sessionCookieName(secure);
  const parts = [
    `${name}=${encodeURIComponent(rawSessionToken)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const name = sessionCookieName(secure);
  const parts = [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Clears both __Host- and legacy session cookie names on sign-out/delete. */
export function clearAllSessionCookies(secure: boolean): string[] {
  const out = [clearSessionCookie(secure)];
  if (secure) {
    out.push(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`);
  }
  return out;
}

export interface Authed {
  user: UserRow;
  /** Stored hash ID of the active session row in D1. */
  sessionId: string;
  /** Derived CSRF token for this session. */
  csrfSecret: string;
  /** Present when the session token was rotated; attach via Set-Cookie. */
  rotatedCookie?: string;
}

export function attachRotatedCookie(response: Response, authed: Authed): Response {
  if (!authed.rotatedCookie) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", authed.rotatedCookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function requireUser(
  request: Request,
  env: Env,
): Promise<Authed | Response> {
  const secure = isSecureRequest(request, env);
  const cookies = parseCookies(request.headers.get("cookie"));
  const rawToken = getSessionTokenFromCookies(cookies, secure);
  if (!rawToken) return jsonError(401, "not signed in");
  const verified = await getSession(env.DB, rawToken, env.SESSION_SECRET);
  if (!verified) return jsonError(401, "session expired");
  const user = await getUserById(env.DB, verified.row.user_id);
  if (!user) return jsonError(401, "user gone");
  const rotatedCookie = verified.rotated
    ? sessionCookieHeader(
        verified.rotated.rawToken,
        verified.rotated.expires_at,
        secure,
      )
    : undefined;
  return {
    user,
    sessionId: verified.rotated ? verified.rotated.id : verified.row.id,
    csrfSecret: verified.csrfToken,
    rotatedCookie,
  };
}

export async function requireCsrf(
  request: Request,
  csrfSecret: string,
): Promise<Response | null> {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const token = request.headers.get(CSRF_HEADER) ?? "";
  if (!(await timingSafeEqualAsync(token, csrfSecret))) {
    return jsonError(403, "csrf");
  }
  return null;
}

export function requireAdmin(user: UserRow): Response | null {
  if (user.role !== "admin") return jsonError(403, "admin only");
  return null;
}

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export function jsonOk(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, init);
}
