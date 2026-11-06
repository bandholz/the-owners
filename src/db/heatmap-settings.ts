export interface HeatmapSettings {
  dayCount: number;
  showWeekends: boolean;
  windowStartMinutes: number;
  windowEndMinutes: number;
}

export const DEFAULT_HEATMAP_SETTINGS: HeatmapSettings = {
  dayCount: 5,
  showWeekends: false,
  windowStartMinutes: 9 * 60,
  windowEndMinutes: 17 * 60,
};

const DAY_MAX = 14;
const WINDOW_MAX_MINUTES = 16 * 60;

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "yes";
}

export function normalizeHeatmapSettings(input: {
  dayCount?: unknown;
  showWeekends?: unknown;
  windowStartMinutes?: unknown;
  windowEndMinutes?: unknown;
}): { ok: true; settings: HeatmapSettings } | { ok: false; error: string } {
  const dayCount = Number(input.dayCount);
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > DAY_MAX) {
    return { ok: false, error: "day count must be 1 to 14" };
  }
  const start = Number(input.windowStartMinutes);
  const end = Number(input.windowEndMinutes);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start % 15 !== 0 ||
    end % 15 !== 0
  ) {
    return { ok: false, error: "window must use 15 minute steps" };
  }
  if (start < 0 || end > 24 * 60 || end <= start) {
    return { ok: false, error: "bad daily window" };
  }
  if (end - start > WINDOW_MAX_MINUTES) {
    return { ok: false, error: "daily window max 16 hours" };
  }
  return {
    ok: true,
    settings: {
      dayCount,
      showWeekends: asBool(input.showWeekends),
      windowStartMinutes: start,
      windowEndMinutes: end,
    },
  };
}

interface SettingsRow {
  day_count: number;
  show_weekends: number;
  window_start_minutes: number;
  window_end_minutes: number;
}

export async function getHeatmapSettings(db: D1Database): Promise<HeatmapSettings> {
  try {
    const row = await db
      .prepare(
        `SELECT day_count, show_weekends, window_start_minutes, window_end_minutes
         FROM heatmap_settings WHERE id = 1`,
      )
      .first<SettingsRow>();
    if (!row) return { ...DEFAULT_HEATMAP_SETTINGS };
    const parsed = normalizeHeatmapSettings({
      dayCount: row.day_count,
      showWeekends: row.show_weekends,
      windowStartMinutes: row.window_start_minutes,
      windowEndMinutes: row.window_end_minutes,
    });
    return parsed.ok ? parsed.settings : { ...DEFAULT_HEATMAP_SETTINGS };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("no such table")) return { ...DEFAULT_HEATMAP_SETTINGS };
    throw err;
  }
}

export async function saveHeatmapSettings(
  db: D1Database,
  settings: HeatmapSettings,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO heatmap_settings (
         id, day_count, show_weekends, window_start_minutes, window_end_minutes,
         updated_at, updated_by_user_id
       ) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         day_count = excluded.day_count,
         show_weekends = excluded.show_weekends,
         window_start_minutes = excluded.window_start_minutes,
         window_end_minutes = excluded.window_end_minutes,
         updated_at = excluded.updated_at,
         updated_by_user_id = excluded.updated_by_user_id`,
    )
    .bind(
      settings.dayCount,
      settings.showWeekends ? 1 : 0,
      settings.windowStartMinutes,
      settings.windowEndMinutes,
      now,
      userId,
    )
    .run();
}
