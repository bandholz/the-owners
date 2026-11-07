/** Central Time helpers. Calendar math only — no event details. */

export function hourInZone(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const raw = fmt.formatToParts(date).find((p) => p.type === "hour")?.value;
  const hour = Number(raw);
  if (!Number.isFinite(hour)) return 0;
  return hour === 24 ? 0 : hour;
}

export function greetingFor(date: Date, timeZone: string): string {
  const hour = hourInZone(date, timeZone);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function greetingName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  return first || null;
}

export function roleLabel(role: string): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "host":
      return "Host";
    case "producer":
      return "Producer";
    case "guest":
      return "Guest";
    default:
      return role;
  }
}

export function zonedWallTimeToIso(
  dateStr: string,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) throw new Error("bad date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);

  const offsetAt = (instant: number): number => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(instant))) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    let h = Number(parts.hour);
    if (h === 24) h = 0;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      h,
      Number(parts.minute),
      Number(parts.second),
    );
    return asUtc - instant;
  };

  let instant = utcGuess - offsetAt(utcGuess);
  instant = utcGuess - offsetAt(instant);
  return new Date(instant).toISOString();
}

export function parseTimeToMinutes(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function inclusiveDaySpan(
  startDate: string,
  endDate: string,
): number | null {
  const start = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  const end = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate);
  if (!start || !end) return null;
  const ms =
    Date.UTC(Number(end[1]), Number(end[2]) - 1, Number(end[3])) -
    Date.UTC(Number(start[1]), Number(start[2]) - 1, Number(start[3]));
  if (ms < 0) return null;
  return Math.round(ms / 86400000) + 1;
}

/**
 * Browser copy of the range helpers. Tests compare this string with the
 * TypeScript functions so the page script cannot drift.
 */
export const TIME_FNS = `
function zonedWallTimeToIso(dateStr, hour, minute, timeZone) {
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(dateStr);
  if (!match) throw new Error("bad date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  function offsetAt(instant) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = {};
    const list = fmt.formatToParts(new Date(instant));
    for (let i = 0; i < list.length; i++) {
      if (list[i].type !== "literal") parts[list[i].type] = list[i].value;
    }
    let h = Number(parts.hour);
    if (h === 24) h = 0;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      h,
      Number(parts.minute),
      Number(parts.second),
    );
    return asUtc - instant;
  }
  let instant = utcGuess - offsetAt(utcGuess);
  instant = utcGuess - offsetAt(instant);
  return new Date(instant).toISOString();
}
function parseTimeToMinutes(value) {
  const m = /^(\\d{2}):(\\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
function inclusiveDaySpan(startDate, endDate) {
  const start = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(startDate);
  const end = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(endDate);
  if (!start || !end) return null;
  const ms =
    Date.UTC(Number(end[1]), Number(end[2]) - 1, Number(end[3])) -
    Date.UTC(Number(start[1]), Number(start[2]) - 1, Number(start[3]));
  if (ms < 0) return null;
  return Math.round(ms / 86400000) + 1;
}
`;
