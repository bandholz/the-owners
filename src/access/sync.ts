/**
 * Cloudflare Access allowlist sync.
 * App invite list (D1 emails) is the source of truth.
 * Inactive until CF_ACCESS_SYNC_ENABLED=true and Access secrets are set.
 * Never creates Access apps; only updates an existing application's policy emails.
 */

import type { Env } from "../types";
import { normalizeEmail } from "../db/users";

export interface AccessSyncResult {
  status: "skipped" | "ok" | "error";
  emails: string[];
  error?: string;
  httpStatus?: number;
}

export function isAccessSyncConfigured(env: Env): boolean {
  return (
    env.CF_ACCESS_SYNC_ENABLED === "true" &&
    Boolean(env.CF_API_TOKEN) &&
    Boolean(env.CF_ACCOUNT_ID) &&
    Boolean(env.CF_ACCESS_APP_ID) &&
    Boolean(env.CF_ACCESS_POLICY_ID)
  );
}

/** Build Access policy include rules: one email selector per invited user. */
export function buildAccessEmailIncludes(
  emails: string[],
): Array<{ email: { email: string } }> {
  const unique = [...new Set(emails.map(normalizeEmail))].filter(Boolean).sort();
  return unique.map((email) => ({ email: { email } }));
}

export function desiredAccessEmailsFromUsers(
  users: Array<{ email: string }>,
): string[] {
  return [...new Set(users.map((u) => normalizeEmail(u.email)))]
    .filter(Boolean)
    .sort();
}

/**
 * PUT Cloudflare Access application policy include list.
 * Uses fetchImpl for tests. No-ops with status skipped when not configured.
 */
export async function syncAccessAllowlist(
  env: Env,
  emails: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<AccessSyncResult> {
  const normalized = desiredAccessEmailsFromUsers(emails.map((e) => ({ email: e })));

  if (!isAccessSyncConfigured(env)) {
    return {
      status: "skipped",
      emails: normalized,
      error:
        "Access sync inactive (missing token/app/policy or CF_ACCESS_SYNC_ENABLED)",
    };
  }

  const include = buildAccessEmailIncludes(normalized);
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/access/apps/${env.CF_ACCESS_APP_ID}/policies/${env.CF_ACCESS_POLICY_ID}`;

  try {
    const res = await fetchImpl(url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${env.CF_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: env.CF_ACCESS_POLICY_NAME || "operators-scheduler-invite-list",
        decision: "allow",
        include,
        exclude: [],
        require: [],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "error",
        emails: normalized,
        httpStatus: res.status,
        error: `Access policy update failed: ${res.status} ${text.slice(0, 200)}`,
      };
    }
    return { status: "ok", emails: normalized, httpStatus: res.status };
  } catch (e) {
    return {
      status: "error",
      emails: normalized,
      error: e instanceof Error ? e.message : "unknown error",
    };
  }
}

export async function persistAccessSyncState(
  db: D1Database,
  result: AccessSyncResult,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE access_sync_state SET
        last_attempt_at = ?,
        last_success_at = CASE WHEN ? = 'ok' THEN ? ELSE last_success_at END,
        last_status = ?,
        last_error = ?,
        last_emails_json = ?
       WHERE id = 1`,
    )
    .bind(
      now,
      result.status,
      now,
      result.status,
      result.error ?? null,
      JSON.stringify(result.emails),
    )
    .run();
}

/** After invite/remove: sync Access from current D1 users. Safe no-op when inactive. */
export async function syncAccessFromDb(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<AccessSyncResult> {
  const res = await env.DB.prepare(
    "SELECT email FROM users ORDER BY email_normalized",
  ).all<{ email: string }>();
  const emails = (res.results ?? []).map((r) => r.email);
  const result = await syncAccessAllowlist(env, emails, fetchImpl);
  try {
    await persistAccessSyncState(env.DB, result);
  } catch {
    // table may be missing in isolated unit tests
  }
  return result;
}
