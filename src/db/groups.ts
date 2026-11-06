import { randomId } from "../crypto/tokens";

export interface GroupRow {
  id: string;
  name: string;
  created_at: string;
}

export async function listGroups(db: D1Database): Promise<GroupRow[]> {
  const res = await db
    .prepare("SELECT * FROM user_groups ORDER BY name")
    .all<GroupRow>();
  return res.results ?? [];
}

export async function createGroup(
  db: D1Database,
  name: string,
): Promise<GroupRow> {
  const id = randomId();
  const created_at = new Date().toISOString();
  await db
    .prepare("INSERT INTO user_groups (id, name, created_at) VALUES (?, ?, ?)")
    .bind(id, name.trim(), created_at)
    .run();
  return { id, name: name.trim(), created_at };
}

export async function renameGroup(
  db: D1Database,
  groupId: string,
  name: string,
): Promise<void> {
  await db
    .prepare("UPDATE user_groups SET name = ? WHERE id = ?")
    .bind(name.trim(), groupId)
    .run();
}

export async function deleteGroup(
  db: D1Database,
  groupId: string,
): Promise<void> {
  await db.prepare("DELETE FROM user_groups WHERE id = ?").bind(groupId).run();
}

export async function addGroupMember(
  db: D1Database,
  groupId: string,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)",
    )
    .bind(groupId, userId)
    .run();
}

export async function removeGroupMember(
  db: D1Database,
  groupId: string,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM user_group_members WHERE group_id = ? AND user_id = ?",
    )
    .bind(groupId, userId)
    .run();
}

export async function listGroupMemberIds(
  db: D1Database,
  groupId: string,
): Promise<string[]> {
  const res = await db
    .prepare("SELECT user_id FROM user_group_members WHERE group_id = ?")
    .bind(groupId)
    .all<{ user_id: string }>();
  return (res.results ?? []).map((r) => r.user_id);
}

export async function getGroup(
  db: D1Database,
  groupId: string,
): Promise<GroupRow | null> {
  return db
    .prepare("SELECT * FROM user_groups WHERE id = ?")
    .bind(groupId)
    .first<GroupRow>();
}
