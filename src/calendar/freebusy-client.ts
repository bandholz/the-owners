import type { BusyInterval } from "../types";

const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";

export interface FreeBusyQuery {
  timeMin: string; // RFC3339
  timeMax: string;
  calendarIds: string[];
  accessToken: string;
}

/**
 * Calls Google FreeBusy. Returns busy intervals only — never persists the payload.
 */
export async function queryFreeBusy(
  q: FreeBusyQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<BusyInterval[]> {
  const res = await fetchImpl(FREEBUSY_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${q.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin: q.timeMin,
      timeMax: q.timeMax,
      items: q.calendarIds.map((id) => ({ id })),
    }),
  });
  if (!res.ok) throw new Error(`freeBusy failed: ${res.status}`);
  const data = (await res.json()) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }>;
  };
  const busy: BusyInterval[] = [];
  for (const cal of Object.values(data.calendars ?? {})) {
    for (const b of cal.busy ?? []) {
      busy.push({ start: new Date(b.start), end: new Date(b.end) });
    }
  }
  return busy;
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}
