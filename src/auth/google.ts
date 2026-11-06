import type { Env } from "../types";
import { randomId } from "../crypto/tokens";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

export const IDENTITY_SCOPES = ["openid", "email", "profile"];
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.owned",
];

/** Create events on calendars the user owns, including invites. */
export const EVENT_CREATE_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.owned";

export function tokenCanCreateEvents(scopes: string[]): boolean {
  return scopes.includes(EVENT_CREATE_SCOPE);
}

export function buildGoogleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  nonce?: string;
  accessType?: "online" | "offline";
  prompt?: string;
}): string {
  const u = new URL(GOOGLE_AUTH);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", opts.scopes.join(" "));
  u.searchParams.set("state", opts.state);
  if (opts.nonce) u.searchParams.set("nonce", opts.nonce);
  if (opts.accessType) u.searchParams.set("access_type", opts.accessType);
  if (opts.prompt) u.searchParams.set("prompt", opts.prompt);
  return u.toString();
}

export async function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  expires_in?: number;
}> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetchImpl(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchUserInfo(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}> {
  const res = await fetchImpl(GOOGLE_USERINFO, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  const data = (await res.json()) as {
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
  };
  if (!data.email_verified) throw new Error("email not verified");
  return data;
}

export function newOAuthState(): string {
  return randomId();
}
