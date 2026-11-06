import type { BusyInterval } from "../types";
import { zonedLocalToUtc, zonedParts } from "./intersect";

/** White through dark green. Index 0 is nobody free. */
export const HEAT_STOPS = [
  "#ffffff",
  "#e8f6e6",
  "#b7e4a8",
  "#78c96a",
  "#3e9e3a",
  "#1f7a2a",
  "#0f5c1c",
];

export function heatFill(freeCount: number, total: number): string {
  if (total <= 0 || freeCount <= 0) return HEAT_STOPS[0];
  const t = Math.max(0, Math.min(1, freeCount / total));
  const idx = Math.min(
    HEAT_STOPS.length - 1,
    Math.max(1, Math.round(t * (HEAT_STOPS.length - 1))),
  );
  return HEAT_STOPS[idx];
}

export interface AvailabilityPerson {
  id: string;
  name: string | null;
  email: string;
}

export interface AvailabilityCellPerson {
  id: string;
  name: string | null;
  email: string;
  status: "free" | "busy";
}

export interface AvailabilityDay {
  date: string;
  weekday: string;
  label: string;
}

export interface AvailabilityRow {
  minutes: number;
  label: string;
}

export interface AvailabilityCell {
  day: string;
  minutes: number;
  label: string;
  start: string;
  end: string;
  freeCount: number;
  people: AvailabilityCellPerson[];
}

export interface AvailabilityGrid {
  timeZone: string;
  slotMinutes: number;
  total: number;
  days: AvailabilityDay[];
  rows: AvailabilityRow[];
  cells: AvailabilityCell[];
}

export interface ZoneDay {
  year: number;
  month: number;
  day: number;
}

export const BUSINESS_DAY_MAX = 5;
export const HEAT_WINDOW_START = 9 * 60;
export const HEAT_WINDOW_END = 17 * 60;

/** Calendar days in [rangeStart, rangeEnd), in the given timezone. */
export function zoneDayKeys(
  rangeStart: Date,
  rangeEnd: Date,
  timeZone: string,
): ZoneDay[] {
  const out: ZoneDay[] = [];
  const seen = new Set<string>();
  let cursor = rangeStart.getTime();
  const end = rangeEnd.getTime();
  if (!(cursor < end)) return out;
  while (cursor < end) {
    const p = zonedParts(new Date(cursor), timeZone);
    const key = `${p.year}-${p.month}-${p.day}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ year: p.year, month: p.month, day: p.day });
    }
    cursor += 12 * 3600 * 1000;
  }
  return out;
}

export function isWeekend(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): boolean {
  const noon = zonedLocalToUtc(year, month, day, 12, 0, 0, timeZone);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(noon);
  return weekday === "Sat" || weekday === "Sun";
}

/** Weekdays in [rangeStart, rangeEnd). Saturday and Sunday are omitted. */
export function businessDayKeys(
  rangeStart: Date,
  rangeEnd: Date,
  timeZone: string,
): ZoneDay[] {
  return includedDayKeys(rangeStart, rangeEnd, timeZone, false);
}

/** Days drawn on the heatmap. Weekends stay out unless showWeekends is set. */
export function includedDayKeys(
  rangeStart: Date,
  rangeEnd: Date,
  timeZone: string,
  showWeekends: boolean,
): ZoneDay[] {
  const days = zoneDayKeys(rangeStart, rangeEnd, timeZone);
  if (showWeekends) return days;
  return days.filter((d) => !isWeekend(d.year, d.month, d.day, timeZone));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function clockLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const min = minutes % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad(min)} ${suffix}`;
}

function atMinutes(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timeZone: string,
): Date {
  if (minutes >= 24 * 60) {
    const next = new Date(Date.UTC(year, month - 1, day));
    next.setUTCDate(next.getUTCDate() + 1);
    return zonedLocalToUtc(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      0,
      0,
      0,
      timeZone,
    );
  }
  return zonedLocalToUtc(
    year,
    month,
    day,
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    timeZone,
  );
}

function overlaps(slotStart: number, slotEnd: number, busy: BusyInterval): boolean {
  return busy.start.getTime() < slotEnd && slotStart < busy.end.getTime();
}

/**
 * One cell per person per slot. A person is busy when any busy interval
 * overlaps the slot. No event titles, guests, or locations are read.
 */
export function buildAvailabilityGrid(input: {
  people: AvailabilityPerson[];
  busyByPerson: BusyInterval[][];
  rangeStart: Date;
  rangeEnd: Date;
  windowStartMinutes: number;
  windowEndMinutes: number;
  slotMinutes?: number;
  showWeekends?: boolean;
  timeZone: string;
}): AvailabilityGrid {
  const slotMinutes = input.slotMinutes ?? 15;
  const timeZone = input.timeZone;
  const days = includedDayKeys(
    input.rangeStart,
    input.rangeEnd,
    timeZone,
    input.showWeekends === true,
  ).map(
    (d) => {
      const noon = zonedLocalToUtc(d.year, d.month, d.day, 12, 0, 0, timeZone);
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
      }).format(noon);
      const label = new Intl.DateTimeFormat("en-US", {
        timeZone,
        month: "short",
        day: "numeric",
      }).format(noon);
      return {
        date: `${d.year}-${pad(d.month)}-${pad(d.day)}`,
        weekday,
        label,
        year: d.year,
        month: d.month,
        day: d.day,
      };
    },
  );
  const rows: AvailabilityRow[] = [];
  for (
    let minutes = input.windowStartMinutes;
    minutes < input.windowEndMinutes;
    minutes += slotMinutes
  ) {
    rows.push({ minutes, label: clockLabel(minutes) });
  }
  const cells: AvailabilityCell[] = [];
  for (const day of days) {
    for (const row of rows) {
      const start = atMinutes(
        day.year,
        day.month,
        day.day,
        row.minutes,
        timeZone,
      );
      const end = atMinutes(
        day.year,
        day.month,
        day.day,
        row.minutes + slotMinutes,
        timeZone,
      );
      const slotStart = start.getTime();
      const slotEnd = end.getTime();
      const people: AvailabilityCellPerson[] = input.people.map(
        (person, index) => {
          const busyList = input.busyByPerson[index] ?? [];
          const isBusy = busyList.some((busy) =>
            overlaps(slotStart, slotEnd, busy),
          );
          return {
            id: person.id,
            name: person.name,
            email: person.email,
            status: isBusy ? "busy" : "free",
          };
        },
      );
      cells.push({
        day: day.date,
        minutes: row.minutes,
        label: row.label,
        start: start.toISOString(),
        end: end.toISOString(),
        freeCount: people.filter((p) => p.status === "free").length,
        people,
      });
    }
  }
  return {
    timeZone,
    slotMinutes,
    total: input.people.length,
    days: days.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      label: d.label,
    })),
    rows,
    cells,
  };
}
