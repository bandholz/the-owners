import { describe, expect, it } from "vitest";
import {
  clipToDailyWindow,
  findSharedSlots,
  intersectAll,
  invertBusy,
  mergeIntervals,
  zonedLocalToUtc,
  zonedParts,
} from "../src/freebusy/intersect";

describe("mergeIntervals", () => {
  it("merges overlaps", () => {
    const a = new Date("2026-11-10T15:00:00Z");
    const b = new Date("2026-11-10T16:00:00Z");
    const c = new Date("2026-11-10T15:30:00Z");
    const d = new Date("2026-11-10T17:00:00Z");
    const m = mergeIntervals([
      { start: a, end: b },
      { start: c, end: d },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0].start).toEqual(a);
    expect(m[0].end).toEqual(d);
  });
});

describe("invertBusy", () => {
  it("returns full range when no busy", () => {
    const start = new Date("2026-11-10T14:00:00Z");
    const end = new Date("2026-11-10T20:00:00Z");
    const free = invertBusy([], start, end);
    expect(free).toEqual([{ start, end }]);
  });

  it("splits around busy", () => {
    const start = new Date("2026-11-10T14:00:00Z");
    const end = new Date("2026-11-10T20:00:00Z");
    const free = invertBusy(
      [{ start: new Date("2026-11-10T16:00:00Z"), end: new Date("2026-11-10T17:00:00Z") }],
      start,
      end,
    );
    expect(free).toHaveLength(2);
    expect(free[0]).toEqual({
      start,
      end: new Date("2026-11-10T16:00:00Z"),
    });
    expect(free[1]).toEqual({
      start: new Date("2026-11-10T17:00:00Z"),
      end,
    });
  });
});

describe("intersectAll", () => {
  it("intersects two free lists", () => {
    const a = [
      {
        start: new Date("2026-11-10T15:00:00Z"),
        end: new Date("2026-11-10T18:00:00Z"),
      },
    ];
    const b = [
      {
        start: new Date("2026-11-10T16:00:00Z"),
        end: new Date("2026-11-10T19:00:00Z"),
      },
    ];
    expect(intersectAll([a, b])).toEqual([
      {
        start: new Date("2026-11-10T16:00:00Z"),
        end: new Date("2026-11-10T18:00:00Z"),
      },
    ]);
  });
});

describe("America/Chicago windowing", () => {
  it("zonedLocalToUtc round-trips a CST winter noon", () => {
    // 2026-01-15 12:00 CT = 18:00 UTC (CST, UTC-6)
    const d = zonedLocalToUtc(2026, 1, 15, 12, 0, 0, "America/Chicago");
    expect(d.toISOString()).toBe("2026-01-15T18:00:00.000Z");
    const parts = zonedParts(d, "America/Chicago");
    expect(parts.hour).toBe(12);
    expect(parts.day).toBe(15);
  });

  it("handles CDT summer offset", () => {
    // 2026-07-15 12:00 CT = 17:00 UTC (CDT, UTC-5)
    const d = zonedLocalToUtc(2026, 7, 15, 12, 0, 0, "America/Chicago");
    expect(d.toISOString()).toBe("2026-07-15T17:00:00.000Z");
  });

  it("clips to 9-17 CT", () => {
    const start = zonedLocalToUtc(2026, 1, 15, 7, 0, 0, "America/Chicago");
    const end = zonedLocalToUtc(2026, 1, 15, 20, 0, 0, "America/Chicago");
    const clipped = clipToDailyWindow(
      { start, end },
      9 * 60,
      17 * 60,
      "America/Chicago",
    );
    expect(clipped).toHaveLength(1);
    expect(clipped[0].start.toISOString()).toBe(
      zonedLocalToUtc(2026, 1, 15, 9, 0, 0, "America/Chicago").toISOString(),
    );
    expect(clipped[0].end.toISOString()).toBe(
      zonedLocalToUtc(2026, 1, 15, 17, 0, 0, "America/Chicago").toISOString(),
    );
  });
});

describe("findSharedSlots", () => {
  it("finds a 60-minute slot when both free in window", () => {
    // Jan 15 2026, both free all day UTC-wise inside CT window
    const rangeStart = zonedLocalToUtc(2026, 1, 15, 0, 0, 0, "America/Chicago");
    const rangeEnd = zonedLocalToUtc(2026, 1, 16, 0, 0, 0, "America/Chicago");
    const slots = findSharedSlots({
      busyByUser: [[], []],
      rangeStart,
      rangeEnd,
      durationMinutes: 60,
      windowStartMinutes: 9 * 60,
      windowEndMinutes: 17 * 60,
      stepMinutes: 60,
      maxSlots: 10,
      timeZone: "America/Chicago",
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].start.toISOString()).toBe(
      zonedLocalToUtc(2026, 1, 15, 9, 0, 0, "America/Chicago").toISOString(),
    );
    expect(slots[0].end.toISOString()).toBe(
      zonedLocalToUtc(2026, 1, 15, 10, 0, 0, "America/Chicago").toISOString(),
    );
    expect(slots[0].startCt).toMatch(/Jan/);
  });

  it("returns empty when one user is busy all window", () => {
    const rangeStart = zonedLocalToUtc(2026, 1, 15, 0, 0, 0, "America/Chicago");
    const rangeEnd = zonedLocalToUtc(2026, 1, 16, 0, 0, 0, "America/Chicago");
    const busyAll = [
      {
        start: zonedLocalToUtc(2026, 1, 15, 9, 0, 0, "America/Chicago"),
        end: zonedLocalToUtc(2026, 1, 15, 17, 0, 0, "America/Chicago"),
      },
    ];
    const slots = findSharedSlots({
      busyByUser: [[], busyAll],
      rangeStart,
      rangeEnd,
      durationMinutes: 30,
      windowStartMinutes: 9 * 60,
      windowEndMinutes: 17 * 60,
      timeZone: "America/Chicago",
    });
    expect(slots).toEqual([]);
  });
});
