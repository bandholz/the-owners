import { describe, expect, it, vi } from "vitest";
import { CALENDAR_SCOPES, tokenCanCreateEvents } from "../src/auth/google";
import { createCalendarEvent } from "../src/calendar/events";

describe("event creation scope", () => {
  it("keeps free/busy and adds owned-event write access", () => {
    expect(CALENDAR_SCOPES).toContain(
      "https://www.googleapis.com/auth/calendar.freebusy",
    );
    expect(CALENDAR_SCOPES).toContain(
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    );
    expect(CALENDAR_SCOPES).toContain(
      "https://www.googleapis.com/auth/calendar.events.owned",
    );
    expect(tokenCanCreateEvents(CALENDAR_SCOPES)).toBe(true);
    expect(
      tokenCanCreateEvents([
        "https://www.googleapis.com/auth/calendar.freebusy",
      ]),
    ).toBe(false);
  });
});

describe("createCalendarEvent", () => {
  it("creates the event on the caller calendar and invites the others", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "evt-1", htmlLink: "https://calendar.google.com/event?eid=evt-1" }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    const created = await createCalendarEvent(
      "access-token",
      {
        title: "Recording",
        start: "2026-11-10T15:00:00.000Z",
        end: "2026-11-10T16:30:00.000Z",
        attendeeEmails: ["avery@example.com"],
        timeZone: "America/Chicago",
      },
      fetchImpl,
    );
    expect(created.id).toBe("evt-1");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/calendars/primary/events");
    expect(url).toContain("sendUpdates=all");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer access-token",
    );
    const body = JSON.parse(String(init.body));
    expect(body.summary).toBe("Recording");
    expect(body.start.timeZone).toBe("America/Chicago");
    expect(body.end.timeZone).toBe("America/Chicago");
    expect(body.attendees).toEqual([{ email: "avery@example.com" }]);
    expect(body.description).toBeUndefined();
  });

  it("signals reconnect when Google refuses the token", async () => {
    const fetchImpl = vi.fn(async () => new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
    await expect(
      createCalendarEvent(
        "access-token",
        {
          title: "Recording",
          start: "2026-11-10T15:00:00.000Z",
          end: "2026-11-10T16:00:00.000Z",
          attendeeEmails: [],
          timeZone: "America/Chicago",
        },
        fetchImpl,
      ),
    ).rejects.toThrow("reconnect");
  });
});
