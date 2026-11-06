import type { Env, UserRow } from "../types";
import { getSession } from "../db/sessions";
import { getUserById } from "../db/users";
import { timingSafeEqual } from "../crypto/tokens";

export const SESSION_COOKIE = "ots_session";
export const CSRF_HEADER = "x-csrf-token";

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookieHeader(
  sessionId: string,
  expiresAt: string,
  secure: boolean,
): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export interface Authed {
  user: UserRow;
  sessionId: string;
  csrfSecret: string;
}

export async function requireUser(
  request: Request,
  env: Env,
): Promise<Authed | Response> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return jsonError(401, "not signed in");
  const session = await getSession(env.DB, sid);
  if (!session) return jsonError(401, "session expired");
  const user = await getUserById(env.DB, session.user_id);
  if (!user) return jsonError(401, "user gone");
  return { user, sessionId: session.id, csrfSecret: session.csrf_secret };
}

export function requireCsrf(request: Request, csrfSecret: string): Response | null {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const token = request.headers.get(CSRF_HEADER) ?? "";
  if (!timingSafeEqual(token, csrfSecret)) {
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
