import type { BusyInterval } from "../types";

/** How far ahead a person lets others see free/busy. */
export type ShareWindow = "full" | "week" | "month";

/** Rolling windows from now, not a calendar week or calendar month. */
export const SHARE_WEEK_MS = 7 * 86400000;
export const SHARE_MONTH_MS = 30 * 86400000;

export function normalizeShareWindow(value: unknown): ShareWindow {
  if (value === "week" || value === "month" || value === "full") return value;
  return "full";
}

export interface ShareBounds {
  /** Inclusive. Epoch for full future so the viewed range is not cut off. */
  from: Date;
  /** Exclusive. Null means no end. */
  until: Date | null;
}

export function shareBounds(window: ShareWindow, now: Date): ShareBounds {
  if (window === "week") {
    return { from: now, until: new Date(now.getTime() + SHARE_WEEK_MS) };
  }
  if (window === "month") {
    return { from: now, until: new Date(now.getTime() + SHARE_MONTH_MS) };
  }
  return { from: new Date(0), until: null };
}

/** Portion of [rangeStart, rangeEnd) that this person allows. Null if none. */
export function clipRangeToShare(
  rangeStart: Date,
  rangeEnd: Date,
  bounds: ShareBounds,
): { start: Date; end: Date } | null {
  const startMs = Math.max(rangeStart.getTime(), bounds.from.getTime());
  const endMs = bounds.until
    ? Math.min(rangeEnd.getTime(), bounds.until.getTime())
    : rangeEnd.getTime();
  if (!(startMs < endMs)) return null;
  return { start: new Date(startMs), end: new Date(endMs) };
}

/** A slot is shared only when it sits entirely inside the allowed window. */
export function slotIsShared(
  slotStart: Date,
  slotEnd: Date,
  bounds: ShareBounds,
): boolean {
  const from = bounds.from.getTime();
  const until = bounds.until ? bounds.until.getTime() : Number.POSITIVE_INFINITY;
  return slotStart.getTime() >= from && slotEnd.getTime() <= until;
}

/**
 * Intervals inside the request that this person did not agree to share.
 * Used only so a free-slot search does not treat hidden time as free.
 */
export function unsharedMasks(
  rangeStart: Date,
  rangeEnd: Date,
  bounds: ShareBounds,
): BusyInterval[] {
  const masks: BusyInterval[] = [];
  if (bounds.from.getTime() > rangeStart.getTime()) {
    const end = bounds.until
      ? new Date(Math.min(bounds.from.getTime(), rangeEnd.getTime()))
      : bounds.from;
    if (rangeStart < end) masks.push({ start: rangeStart, end });
  }
  if (bounds.until && bounds.until.getTime() < rangeEnd.getTime()) {
    const start = new Date(Math.max(bounds.until.getTime(), rangeStart.getTime()));
    if (start < rangeEnd) masks.push({ start, end: rangeEnd });
  }
  return masks;
}
