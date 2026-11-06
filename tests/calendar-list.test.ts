import { describe, expect, it, vi } from "vitest";
import {
  defaultCalendarSelection,
  listCalendars,
} from "../src/calendar/calendar-list";
import { CALENDAR_SCOPES } from "../src/auth/google";

describe("calendar scopes", () => {
  it("includes freebusy and calendarlist.readonly", () => {
    expect(CALENDAR_SCOPES).toContain(
      "https://www.googleapis.com/auth/calendar.freebusy",
    );
    expect(CALENDAR_SCOPES).toContain(
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    );
  });
});

describe("defaultCalendarSelection", () => {
  it("prefers primary", () => {
    const sel = defaultCalendarSelection([
      { id: "a", summary: "A", primary: false },
      { id: "b", summary: "B", primary: true },
    ]);
    expect(sel).toEqual([{ id: "b", summary: "B", primary: true }]);
  });

  it("falls back to primary literal", () => {
    expect(defaultCalendarSelection([])).toEqual([
      { id: "primary", summary: "Primary", primary: true },
    ]);
  });
});

describe("listCalendars", () => {
  it("maps Google calendarList items", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              { id: "primary", summary: "Work", primary: true },
              { id: "x@group.calendar.google.com", summary: "Side" },
            ],
          }),
          { status: 200 },
        ),
    );
    const list = await listCalendars(
      "tok",
      fetchImpl as unknown as typeof fetch,
    );
    expect(list).toHaveLength(2);
    expect(list[0].primary).toBe(true);
  });
});
