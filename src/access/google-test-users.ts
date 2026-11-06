import { normalizeEmail } from "../db/users";

export interface GoogleTestUserDiff {
  /** Invited in app but not yet acked as added in Google Cloud console */
  toAdd: string[];
  /** Acked in console bookkeeping but no longer invited — remove from Google test users */
  toRemove: string[];
  /** Invited and acked */
  inSync: string[];
}

/**
 * Google Cloud OAuth "test users" have no public management API.
 * Diff invite list (source of truth) against admin acks of console state.
 */
export function diffGoogleTestUsers(
  invitedEmails: string[],
  ackedEmails: string[],
): GoogleTestUserDiff {
  const invited = new Set(invitedEmails.map(normalizeEmail).filter(Boolean));
  const acked = new Set(ackedEmails.map(normalizeEmail).filter(Boolean));
  const toAdd: string[] = [];
  const toRemove: string[] = [];
  const inSync: string[] = [];
  for (const e of [...invited].sort()) {
    if (acked.has(e)) inSync.push(e);
    else toAdd.push(e);
  }
  for (const e of [...acked].sort()) {
    if (!invited.has(e)) toRemove.push(e);
  }
  return { toAdd, toRemove, inSync };
}

export const GOOGLE_TEST_USERS_DOC = `
## Google test users (manual)

Google does not expose an API to add/remove OAuth consent **test users** while the app is in Testing mode.

1. Open Google Cloud Console → APIs & Services → OAuth consent screen → Test users.
2. Use the admin API \`GET /api/admin/google-test-users\` (or Admin page) for:
   - **toAdd** — invitees not yet on the Google list; add them in the console, then mark acked.
   - **toRemove** — emails still acked but removed from the app; delete them in the console, then clear ack.
3. Keep this list in sync whenever you invite or remove someone.
`.trim();
