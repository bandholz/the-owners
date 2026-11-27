import { hmacSha256Hex, randomToken } from "../crypto/tokens";

export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days hard cap
export const SESSION_IDLE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours sliding window
export const SESSION_ROTATE_AFTER_MS = 12 * 60 * 60 * 1000; // rotate token every 12h
export const SESSION_ROTATION_GRACE_MS = 60 * 1000; // 60s grace for concurrent requests

export interface SessionRow {
  /** Stored hash of the raw session cookie token (never the raw token). */
  id: string;
  user_id: string;
  /** Random per-session salt stored in D1; real CSRF token is derived via HMAC. */
  csrf_secret: string;
  created_at: string;
  expires_at: string;
  max_expires_at?: string | null;
}

export interface IssuedSession {
  /** Raw 256-bit bearer token sent ONLY in Set-Cookie, never stored in D1. */
  rawToken: string;
  /** Stored hash in D1 sessions.id. */
  id: string;
  user_id: string;
  /** Derived CSRF token returned by /api/me and checked by requireCsrf. */
  csrfToken: string;
  created_at: string;
  expires_at: string;
  max_expires_at: string;
}

export async function hashSessionToken(
  rawToken: string,
  sessionSecret: string,
): Promise<string> {
  return hmacSha256Hex(sessionSecret, `session:${rawToken}`);
}

export async function deriveCsrfToken(
  sessionIdHash: string,
  csrfSalt: string,
  sessionSecret: string,
): Promise<string> {
  return hmacSha256Hex(sessionSecret, `csrf:${sessionIdHash}:${csrfSalt}`);
}

export async function createSession(
  db: D1Database,
  userId: string,
  sessionSecret = "",
  opts?: { now?: Date; maxExpiresAt?: Date },
): Promise<IssuedSession> {
  const rawToken = randomToken(32);
  const idHash = await hashSessionToken(rawToken, sessionSecret);
  const csrfSalt = randomToken(32);
  const now = opts?.now ?? new Date();
  const maxExpires =
    opts?.maxExpiresAt ?? new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);
  const idleExpires = new Date(
    Math.min(now.getTime() + SESSION_IDLE_TTL_MS, maxExpires.getTime()),
  );
  const createdAt = now.toISOString();
  const expiresAt = idleExpires.toISOString();
  const maxExpiresAt = maxExpires.toISOString();

  try {
    await db
      .prepare(
        `INSERT INTO sessions (id, user_id, csrf_secret, created_at, expires_at, max_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(idHash, userId, csrfSalt, createdAt, expiresAt, maxExpiresAt)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!msg.includes("no such column")) throw err;
    await db
      .prepare(
        `INSERT INTO sessions (id, user_id, csrf_secret, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(idHash, userId, csrfSalt, createdAt, expiresAt)
      .run();
  }

  const csrfToken = await deriveCsrfToken(idHash, csrfSalt, sessionSecret);
  return {
    rawToken,
    id: idHash,
    user_id: userId,
    csrfToken,
    created_at: createdAt,
    expires_at: expiresAt,
    max_expires_at: maxExpiresAt,
  };
}

export interface VerifiedSession {
  row: SessionRow;
  csrfToken: string;
  rotated?: IssuedSession;
}

export async function getSession(
  db: D1Database,
  rawToken: string,
  sessionSecret = "",
  now = new Date(),
): Promise<VerifiedSession | null> {
  if (!rawToken) return null;
  const idHash = await hashSessionToken(rawToken, sessionSecret);
  const row = await db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .bind(idHash)
    .first<SessionRow>();
  if (!row) return null;

  const nowMs = now.getTime();
  const createdMs = new Date(row.created_at).getTime();
  const expiresMs = new Date(row.expires_at).getTime();
  const maxExpiresMs = row.max_expires_at
    ? new Date(row.max_expires_at).getTime()
    : createdMs + SESSION_ABSOLUTE_TTL_MS;

  if (
    !Number.isFinite(expiresMs) ||
    !Number.isFinite(maxExpiresMs) ||
    nowMs >= expiresMs ||
    nowMs >= maxExpiresMs
  ) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(idHash).run();
    return null;
  }

  const csrfToken = await deriveCsrfToken(row.id, row.csrf_secret, sessionSecret);

  // Rotate token once it is older than SESSION_ROTATE_AFTER_MS unless it is
  // already in a short rotation grace window. Keep a 60s grace window on the
  // old token so parallel in-flight API requests do not race and fail with 401.
  const ageMs = nowMs - createdMs;
  const remainingMs = expiresMs - nowMs;
  if (
    ageMs >= SESSION_ROTATE_AFTER_MS &&
    remainingMs > SESSION_ROTATION_GRACE_MS * 2 &&
    maxExpiresMs - nowMs > SESSION_ROTATION_GRACE_MS * 2
  ) {
    const rotated = await createSession(db, row.user_id, sessionSecret, {
      now,
      maxExpiresAt: new Date(maxExpiresMs),
    });
    const graceEnd = new Date(
      Math.min(expiresMs, nowMs + SESSION_ROTATION_GRACE_MS),
    ).toISOString();
    await db
      .prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .bind(graceEnd, row.id)
      .run();
    return { row, csrfToken, rotated };
  }

  // Sliding idle refresh (never extending past max_expires_at).
  const desiredExpiresMs = Math.min(nowMs + SESSION_IDLE_TTL_MS, maxExpiresMs);
  if (
    remainingMs > SESSION_ROTATION_GRACE_MS * 2 &&
    desiredExpiresMs - expiresMs > 60 * 60 * 1000
  ) {
    const nextExpires = new Date(desiredExpiresMs).toISOString();
    await db
      .prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .bind(nextExpires, row.id)
      .run();
    row.expires_at = nextExpires;
  }

  return { row, csrfToken };
}

export async function deleteSession(
  db: D1Database,
  sessionIdHash: string,
): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionIdHash).run();
}

export async function deleteSessionByRawToken(
  db: D1Database,
  rawToken: string,
  sessionSecret = "",
): Promise<void> {
  if (!rawToken) return;
  const idHash = await hashSessionToken(rawToken, sessionSecret);
  await deleteSession(db, idHash);
}

export async function deleteSessionsForUser(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

export async function pruneExpiredSessions(
  db: D1Database,
  now = new Date(),
): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .bind(now.toISOString())
    .run();
}
