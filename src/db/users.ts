import type { Env, Role, UserRow } from "../types";
import { randomId } from "../crypto/tokens";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<UserRow | null> {
  return db
    .prepare("SELECT * FROM users WHERE email_normalized = ?")
    .bind(normalizeEmail(email))
    .first<UserRow>();
}

export async function getUserById(
  db: D1Database,
  id: string,
): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const res = await db
    .prepare("SELECT * FROM users ORDER BY email_normalized")
    .all<UserRow>();
  return res.results ?? [];
}

export async function inviteUser(
  db: D1Database,
  email: string,
  role: Role,
  invitedBy: string | null,
): Promise<UserRow> {
  const now = new Date().toISOString();
  const id = randomId();
  const normalized = normalizeEmail(email);
  await db
    .prepare(
      `INSERT INTO users
        (id, email, email_normalized, name, role, invited_by, created_at, updated_at, token_status)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'none')`,
    )
    .bind(id, email.trim(), normalized, role, invitedBy, now, now)
    .run();
  const row = await getUserById(db, id);
  if (!row) throw new Error("invite insert failed");
  return row;
}

export async function removeUser(db: D1Database, userId: string): Promise<void> {
  // FK cascades wipe sessions, tokens, calendars, group membership
  await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
}

export async function setRole(
  db: D1Database,
  userId: string,
  role: Role,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
    .bind(role, now, userId)
    .run();
}

export async function markLogin(
  db: D1Database,
  userId: string,
  googleSub: string,
  name: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE users SET google_sub = ?, name = COALESCE(?, name),
        last_login_at = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(googleSub, name, now, now, userId)
    .run();
}

export async function writeAudit(
  env: Env,
  entry: {
    actorUserId?: string | null;
    action: string;
    targetEmail?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (id, at, actor_user_id, action, target_email, meta_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId(),
      new Date().toISOString(),
      entry.actorUserId ?? null,
      entry.action,
      entry.targetEmail ?? null,
      entry.meta ? JSON.stringify(entry.meta) : null,
    )
    .run();
}
