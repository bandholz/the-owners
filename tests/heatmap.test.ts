import { describe, expect, it } from "vitest";
import {
  buildAvailabilityGrid,
  businessDayKeys,
  heatFill,
  HEAT_STOPS,
  HEAT_WINDOW_END,
  HEAT_WINDOW_START,
  includedDayKeys,
  zoneDayKeys,
} from "../src/freebusy/heatmap";

const CT = "America/Chicago";

describe("availability heatmap", () => {
  it("paints partial availability and lists every person as free or busy", () => {
    const grid = buildAvailabilityGrid({
      timeZone: CT,
      rangeStart: new Date("2026-11-10T06:00:00.000Z"),
      rangeEnd: new Date("2026-11-11T06:00:00.000Z"),
      windowStartMinutes: 9 * 60,
      windowEndMinutes: 10 * 60 + 15,
      slotMinutes: 15,
      people: [
        { id: "a", name: "Ada Host", email: "ada@example.com" },
        { id: "b", name: null, email: "beau@example.com" },
      ],
      busyByPerson: [
        [
          {
            start: new Date("2026-11-10T15:00:00.000Z"),
            end: new Date("2026-11-10T16:00:00.000Z"),
          },
        ],
        [],
      ],
    });

    expect(grid.timeZone).toBe(CT);
    expect(grid.total).toBe(2);
    expect(grid.days.map((d) => d.date)).toEqual(["2026-11-10"]);
    expect(grid.days[0].weekday).toBe("Tue");
    expect(grid.rows.map((r) => r.label)).toEqual([
      "9:00 AM",
      "9:15 AM",
      "9:30 AM",
      "9:45 AM",
      "10:00 AM",
    ]);

    const nine = grid.cells.find((c) => c.label === "9:00 AM");
    const ten = grid.cells.find((c) => c.label === "10:00 AM");
    expect(nine).toBeTruthy();
    expect(ten).toBeTruthy();
    expect(nine!.freeCount).toBe(1);
    expect(nine!.people).toEqual([
      {
        id: "a",
        name: "Ada Host",
        email: "ada@example.com",
        status: "busy",
      },
      {
        id: "b",
        name: null,
        email: "beau@example.com",
        status: "free",
      },
    ]);
    expect(ten!.freeCount).toBe(2);
    expect(ten!.people.map((p) => p.status)).toEqual(["free", "free"]);
    expect(nine!.start).toBe("2026-11-10T15:00:00.000Z");
    expect(JSON.stringify(grid)).not.toMatch(
      /title|location|description|attendees|summary|event/i,
    );
  });

  it("keeps a date range to the Chicago calendar days inside it", () => {
    const days = zoneDayKeys(
      new Date("2026-11-04T06:00:00.000Z"),
      new Date("2026-11-11T06:00:00.000Z"),
      CT,
    );
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ year: 2026, month: 11, day: 4 });
    expect(days[6]).toEqual({ year: 2026, month: 11, day: 10 });
  });

  it("skips Saturday and Sunday and uses 9:00 AM to 5:00 PM", () => {
    const grid = buildAvailabilityGrid({
      timeZone: CT,
      rangeStart: new Date("2026-11-06T06:00:00.000Z"),
      rangeEnd: new Date("2026-11-11T06:00:00.000Z"),
      windowStartMinutes: HEAT_WINDOW_START,
      windowEndMinutes: HEAT_WINDOW_END,
      people: [{ id: "a", name: "Ada", email: "ada@example.com" }],
      busyByPerson: [[]],
    });
    expect(grid.days.map((d) => d.weekday)).toEqual(["Fri", "Mon", "Tue"]);
    expect(grid.days.map((d) => d.date)).not.toContain("2026-11-07");
    expect(grid.days.map((d) => d.date)).not.toContain("2026-11-08");
    expect(grid.rows[0].label).toBe("9:00 AM");
    expect(grid.rows[grid.rows.length - 1].label).toBe("4:45 PM");
    expect(grid.rows.some((r) => r.label === "5:00 PM")).toBe(false);
    const withWeekends = buildAvailabilityGrid({
      timeZone: CT,
      rangeStart: new Date("2026-11-06T06:00:00.000Z"),
      rangeEnd: new Date("2026-11-11T06:00:00.000Z"),
      windowStartMinutes: HEAT_WINDOW_START,
      windowEndMinutes: HEAT_WINDOW_END,
      showWeekends: true,
      people: [{ id: "a", name: "Ada", email: "ada@example.com" }],
      busyByPerson: [[]],
    });
    expect(withWeekends.days.map((d) => d.weekday)).toEqual([
      "Fri",
      "Sat",
      "Sun",
      "Mon",
      "Tue",
    ]);
    expect(
      includedDayKeys(
        new Date("2026-11-06T06:00:00.000Z"),
        new Date("2026-11-11T06:00:00.000Z"),
        CT,
        false,
      ),
    ).toHaveLength(3);
    expect(
      businessDayKeys(
        new Date("2026-11-09T06:00:00.000Z"),
        new Date("2026-11-17T06:00:00.000Z"),
        CT,
      ),
    ).toHaveLength(6);
  });

  it("scales fill from none free to everyone free", () => {
    expect(heatFill(0, 5)).toBe(HEAT_STOPS[0]);
    expect(heatFill(5, 5)).toBe(HEAT_STOPS[HEAT_STOPS.length - 1]);
    expect(heatFill(1, 5)).not.toBe(heatFill(4, 5));
  });
});
