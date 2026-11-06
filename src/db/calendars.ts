export async function replaceSelectedCalendars(
  db: D1Database,
  userId: string,
  calendars: Array<{ id: string; summary: string; primary?: boolean }>,
): Promise<void> {
  await db
    .prepare("DELETE FROM calendars_selected WHERE user_id = ?")
    .bind(userId)
    .run();
  for (const c of calendars) {
    await db
      .prepare(
        `INSERT INTO calendars_selected (user_id, calendar_id, summary, is_primary)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(userId, c.id, c.summary, c.primary ? 1 : 0)
      .run();
  }
}

export async function getSelectedCalendars(
  db: D1Database,
  userId: string,
): Promise<
  Array<{ calendar_id: string; summary: string | null; is_primary: number }>
> {
  const res = await db
    .prepare(
      "SELECT calendar_id, summary, is_primary FROM calendars_selected WHERE user_id = ?",
    )
    .bind(userId)
    .all<{ calendar_id: string; summary: string | null; is_primary: number }>();
  return res.results ?? [];
}
