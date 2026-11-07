const CALENDAR_LIST_URL =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
}

export class CalendarListError extends Error {
  status: number;
  constructor(status: number) {
    super(`calendarList failed: ${status}`);
    this.name = "CalendarListError";
    this.status = status;
  }
}

export async function listCalendars(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CalendarListEntry[]> {
  const res = await fetchImpl(`${CALENDAR_LIST_URL}?minAccessRole=reader`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new CalendarListError(res.status);
  const data = (await res.json()) as {
    items?: Array<{ id?: string; summary?: string; primary?: boolean }>;
  };
  return (data.items ?? [])
    .filter((i) => i.id)
    .map((i) => ({
      id: i.id as string,
      summary: i.summary ?? (i.id as string),
      primary: Boolean(i.primary),
    }));
}

/** Default selection: primary calendar, or first entry, or literal "primary". */
export function defaultCalendarSelection(
  entries: CalendarListEntry[],
): CalendarListEntry[] {
  const primary = entries.find((e) => e.primary);
  if (primary) return [primary];
  if (entries[0]) return [entries[0]];
  return [{ id: "primary", summary: "Primary", primary: true }];
}
