import { randomId } from "../crypto/tokens";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionRow {
  id: string;
  user_id: string;
  csrf_secret: string;
  created_at: string;
  expires_at: string;
}

export async function createSession(
  db: D1Database,
  userId: string,
): Promise<SessionRow> {
  const id = randomId();
  const csrf = randomId();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, csrf_secret, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, csrf, now.toISOString(), expires.toISOString())
    .run();
  return {
    id,
    user_id: userId,
    csrf_secret: csrf,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  };
}

export async function getSession(
  db: D1Database,
  sessionId: string,
): Promise<SessionRow | null> {
  const row = await db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first<SessionRow>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
    return null;
  }
  return row;
}

export async function deleteSession(
  db: D1Database,
  sessionId: string,
): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export async function deleteSessionsForUser(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}
