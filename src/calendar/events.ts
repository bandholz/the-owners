export interface CalendarEventDraft {
  title: string;
  start: string;
  end: string;
  attendeeEmails: string[];
  timeZone: string;
}

export interface CreatedCalendarEvent {
  id: string;
  htmlLink: string | null;
}

/**
 * Creates one event on the signed-in user's primary calendar and invites
 * attendees. Google delivers the invite; this app does not write other
 * people's calendars and does not keep the event body.
 */
export async function createCalendarEvent(
  accessToken: string,
  draft: CalendarEventDraft,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedCalendarEvent> {
  const res = await fetchImpl(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary: draft.title,
        start: { dateTime: draft.start, timeZone: draft.timeZone },
        end: { dateTime: draft.end, timeZone: draft.timeZone },
        attendees: draft.attendeeEmails.map((email) => ({ email })),
      }),
    },
  );
  if (res.status === 403) {
    throw new Error("reconnect");
  }
  if (!res.ok) throw new Error(`event create failed: ${res.status}`);
  const data = (await res.json()) as { id?: string; htmlLink?: string };
  return { id: data.id ?? "", htmlLink: data.htmlLink ?? null };
}

export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!eventId) return;
  await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}
