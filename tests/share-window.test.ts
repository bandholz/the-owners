import { describe, expect, it } from "vitest";
import { buildAvailabilityGrid } from "../src/freebusy/heatmap";
import {
  clipRangeToShare,
  normalizeShareWindow,
  shareBounds,
  SHARE_MONTH_MS,
  SHARE_WEEK_MS,
  slotIsShared,
  unsharedMasks,
} from "../src/calendar/share-window";

const now = new Date("2026-11-06T18:00:00.000Z");

describe("share windows", () => {
  it("defaults to the full future and rolls week and month forward from now", () => {
    expect(normalizeShareWindow(undefined)).toBe("full");
    expect(normalizeShareWindow("nope")).toBe("full");
    const week = shareBounds("week", now);
    const month = shareBounds("month", now);
    expect(week.until!.getTime() - now.getTime()).toBe(SHARE_WEEK_MS);
    expect(month.until!.getTime() - now.getTime()).toBe(SHARE_MONTH_MS);
    expect(shareBounds("full", now).until).toBeNull();
  });

  it("does not ask for time outside the allowed window", () => {
    const bounds = shareBounds("week", now);
    const inside = clipRangeToShare(
      new Date("2026-11-06T12:00:00.000Z"),
      new Date("2026-11-20T12:00:00.000Z"),
      bounds,
    );
    expect(inside).toEqual({ start: now, end: bounds.until });
    expect(
      clipRangeToShare(
        new Date("2026-12-01T00:00:00.000Z"),
        new Date("2026-12-02T00:00:00.000Z"),
        bounds,
      ),
    ).toBeNull();
  });

  it("hides out-of-window time from a free-slot search without calling it busy on the heatmap", () => {
    const bounds = shareBounds("week", now);
    const rangeStart = new Date("2026-11-06T12:00:00.000Z");
    const rangeEnd = new Date("2026-11-20T12:00:00.000Z");
    const masks = unsharedMasks(rangeStart, rangeEnd, bounds);
    expect(masks).toEqual([
      { start: rangeStart, end: now },
      { start: bounds.until!, end: rangeEnd },
    ]);
    const hidden = new Date(bounds.until!.getTime() + 60 * 60 * 1000);
    expect(slotIsShared(hidden, new Date(hidden.getTime() + 30 * 60 * 1000), bounds)).toBe(
      false,
    );
    const visible = new Date(now.getTime() + 60 * 60 * 1000);
    expect(
      slotIsShared(visible, new Date(visible.getTime() + 30 * 60 * 1000), bounds),
    ).toBe(true);
  });
});

describe("heatmap share status", () => {
  it("lists a person as not shared outside their window and does not count them free or busy", () => {
    const grid = buildAvailabilityGrid({
      timeZone: "America/Chicago",
      rangeStart: new Date("2026-11-10T06:00:00.000Z"),
      rangeEnd: new Date("2026-11-11T06:00:00.000Z"),
      windowStartMinutes: 9 * 60,
      windowEndMinutes: 10 * 60,
      slotMinutes: 30,
      people: [
        {
          id: "a",
          name: "Ada",
          email: "ada@example.com",
          shareFrom: "2026-11-10T15:30:00.000Z",
          shareUntil: "2026-11-10T16:00:00.000Z",
        },
        {
          id: "b",
          name: "Bea",
          email: "bea@example.com",
        },
      ],
      busyByPerson: [[], []],
    });
    const nine = grid.cells.find((cell) => cell.label === "9:00 AM");
    const nineThirty = grid.cells.find((cell) => cell.label === "9:30 AM");
    expect(nine!.people.map((person) => person.status)).toEqual(["unshared", "free"]);
    expect(nine!.freeCount).toBe(1);
    expect(nine!.sharedCount).toBe(1);
    expect(nineThirty!.people[0].status).toBe("free");
    expect(nineThirty!.sharedCount).toBe(2);

    const onlyHidden = buildAvailabilityGrid({
      timeZone: "America/Chicago",
      rangeStart: new Date("2026-11-10T06:00:00.000Z"),
      rangeEnd: new Date("2026-11-11T06:00:00.000Z"),
      windowStartMinutes: 9 * 60,
      windowEndMinutes: 9 * 60 + 30,
      slotMinutes: 30,
      people: [
        {
          id: "a",
          name: "Ada",
          email: "ada@example.com",
          shareUntil: "2026-11-10T15:00:00.000Z",
        },
      ],
      busyByPerson: [[]],
    });
    expect(onlyHidden.cells[0].sharedCount).toBe(0);
    expect(onlyHidden.cells[0].freeCount).toBe(0);
    expect(onlyHidden.cells[0].people[0].status).toBe("unshared");
  });
});
