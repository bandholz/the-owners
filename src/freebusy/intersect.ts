import type { BusyInterval, FindSlotsInput, FreeSlot } from "../types";

const CT = "America/Chicago";

/** Merge overlapping/adjacent intervals. */
export function mergeIntervals(intervals: BusyInterval[]): BusyInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const out: BusyInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = out[out.length - 1];
    if (cur.start.getTime() <= last.end.getTime()) {
      if (cur.end.getTime() > last.end.getTime()) last.end = cur.end;
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

/** Invert busy → free inside [rangeStart, rangeEnd). */
export function invertBusy(
  busy: BusyInterval[],
  rangeStart: Date,
  rangeEnd: Date,
): BusyInterval[] {
  const merged = mergeIntervals(
    busy
      .map((b) => ({
        start: new Date(Math.max(b.start.getTime(), rangeStart.getTime())),
        end: new Date(Math.min(b.end.getTime(), rangeEnd.getTime())),
      }))
      .filter((b) => b.start < b.end),
  );
  const free: BusyInterval[] = [];
  let cursor = rangeStart;
  for (const b of merged) {
    if (cursor < b.start) free.push({ start: cursor, end: b.start });
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < rangeEnd) free.push({ start: cursor, end: rangeEnd });
  return free;
}

export function intersectTwo(
  a: BusyInterval[],
  b: BusyInterval[],
): BusyInterval[] {
  const out: BusyInterval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = new Date(Math.max(a[i].start.getTime(), b[j].start.getTime()));
    const end = new Date(Math.min(a[i].end.getTime(), b[j].end.getTime()));
    if (start < end) out.push({ start, end });
    if (a[i].end <= b[j].end) i++;
    else j++;
  }
  return out;
}

export function intersectAll(lists: BusyInterval[][]): BusyInterval[] {
  if (lists.length === 0) return [];
  return lists.reduce((acc, cur) => intersectTwo(acc, cur));
}

/** Parts in a timezone via Intl (no deps). */
export function zonedParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Instant for Y-M-D H:M:S in a named zone by binary-searching UTC offset.
 * Correct across DST as long as Intl data is present (Workers / modern Node).
 */
export function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  // Initial guess: treat as UTC
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let n = 0; n < 3; n++) {
    const parts = zonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    utc += desired - asUtc;
  }
  return new Date(utc);
}

export function clipToDailyWindow(
  interval: BusyInterval,
  windowStartMinutes: number,
  windowEndMinutes: number,
  timeZone: string,
): BusyInterval[] {
  const out: BusyInterval[] = [];
  // Walk calendar days covering the interval in the target zone
  let dayCursor = new Date(interval.start.getTime() - 36 * 3600 * 1000);
  const endGuard = new Date(interval.end.getTime() + 36 * 3600 * 1000);
  const seen = new Set<string>();
  while (dayCursor < endGuard) {
    const p = zonedParts(dayCursor, timeZone);
    const key = `${p.year}-${p.month}-${p.day}`;
    if (!seen.has(key)) {
      seen.add(key);
      const winStart = zonedLocalToUtc(
        p.year,
        p.month,
        p.day,
        Math.floor(windowStartMinutes / 60),
        windowStartMinutes % 60,
        0,
        timeZone,
      );
      const winEnd = zonedLocalToUtc(
        p.year,
        p.month,
        p.day,
        Math.floor(windowEndMinutes / 60),
        windowEndMinutes % 60,
        0,
        timeZone,
      );
      const start = new Date(
        Math.max(interval.start.getTime(), winStart.getTime()),
      );
      const end = new Date(Math.min(interval.end.getTime(), winEnd.getTime()));
      if (start < end) out.push({ start, end });
    }
    dayCursor = new Date(dayCursor.getTime() + 12 * 3600 * 1000);
  }
  return out;
}

function formatCt(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(d);
}

export function findSharedSlots(input: FindSlotsInput): FreeSlot[] {
  const {
    busyByUser,
    rangeStart,
    rangeEnd,
    durationMinutes,
    windowStartMinutes,
    windowEndMinutes,
    stepMinutes = 15,
    maxSlots = 50,
    timeZone = CT,
  } = input;

  if (durationMinutes <= 0) return [];
  if (rangeEnd <= rangeStart) return [];
  if (busyByUser.length === 0) return [];

  const freePerUser = busyByUser.map((busy) => {
    const free = invertBusy(busy, rangeStart, rangeEnd);
    return free.flatMap((f) =>
      clipToDailyWindow(f, windowStartMinutes, windowEndMinutes, timeZone),
    );
  });

  const shared = intersectAll(freePerUser);
  const durationMs = durationMinutes * 60_000;
  const stepMs = stepMinutes * 60_000;
  const slots: FreeSlot[] = [];

  for (const block of shared) {
    for (
      let t = block.start.getTime();
      t + durationMs <= block.end.getTime();
      t += stepMs
    ) {
      const start = new Date(t);
      const end = new Date(t + durationMs);
      slots.push({
        start,
        end,
        startCt: formatCt(start, timeZone),
        endCt: formatCt(end, timeZone),
      });
      if (slots.length >= maxSlots) return slots;
    }
  }
  return slots;
}
