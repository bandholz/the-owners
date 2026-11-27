import {
  decryptSecret,
  encryptSecret,
  type EncryptedBlob,
} from "../crypto/tokens";

const CURRENT_KEY_VERSION = 1;

export function tokenAadForUser(userId: string): string {
  return `oauth_tokens:${userId}`;
}

export async function storeRefreshToken(
  db: D1Database,
  userId: string,
  refreshToken: string,
  scopes: string[],
  hexKey: string,
): Promise<void> {
  const enc = await encryptSecret(refreshToken, hexKey, tokenAadForUser(userId));
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO oauth_tokens
          (user_id, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag, scopes, updated_at, key_version, aad_bound)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(user_id) DO UPDATE SET
           refresh_token_ciphertext = excluded.refresh_token_ciphertext,
           refresh_token_iv = excluded.refresh_token_iv,
           refresh_token_tag = excluded.refresh_token_tag,
           scopes = excluded.scopes,
           updated_at = excluded.updated_at,
           key_version = excluded.key_version,
           aad_bound = excluded.aad_bound`,
      )
      .bind(
        userId,
        enc.ciphertext,
        enc.iv,
        enc.tag,
        scopes.join(" "),
        now,
        CURRENT_KEY_VERSION,
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!msg.includes("no such column")) throw err;
    // Fallback before migration 0006 is applied: store with AAD-less encryption
    // only if the column does not exist yet.
    const legacy = await encryptSecret(refreshToken, hexKey);
    await db
      .prepare(
        `INSERT INTO oauth_tokens
          (user_id, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag, scopes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           refresh_token_ciphertext = excluded.refresh_token_ciphertext,
           refresh_token_iv = excluded.refresh_token_iv,
           refresh_token_tag = excluded.refresh_token_tag,
           scopes = excluded.scopes,
           updated_at = excluded.updated_at`,
      )
      .bind(
        userId,
        legacy.ciphertext,
        legacy.iv,
        legacy.tag,
        scopes.join(" "),
        now,
      )
      .run();
  }
  await db
    .prepare(
      `UPDATE users SET token_status = 'ok', calendar_connected_at = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(now, now, userId)
    .run();
}

interface TokenRow {
  refresh_token_ciphertext: ArrayBuffer;
  refresh_token_iv: ArrayBuffer;
  refresh_token_tag: ArrayBuffer;
  scopes?: string;
  key_version?: number;
  aad_bound?: number;
}

export async function loadRefreshToken(
  db: D1Database,
  userId: string,
  hexKey: string,
  previousHexKey?: string,
): Promise<string | null> {
  let row: TokenRow | null = null;
  let hasMetaCols = true;
  try {
    row = await db
      .prepare(
        `SELECT refresh_token_ciphertext, refresh_token_iv, refresh_token_tag, scopes, key_version, aad_bound
         FROM oauth_tokens WHERE user_id = ?`,
      )
      .bind(userId)
      .first<TokenRow>();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!msg.includes("no such column")) throw err;
    hasMetaCols = false;
    row = await db
      .prepare(
        `SELECT refresh_token_ciphertext, refresh_token_iv, refresh_token_tag
         FROM oauth_tokens WHERE user_id = ?`,
      )
      .bind(userId)
      .first<TokenRow>();
  }
  if (!row) return null;

  const blob: EncryptedBlob = {
    ciphertext: new Uint8Array(row.refresh_token_ciphertext),
    iv: new Uint8Array(row.refresh_token_iv),
    tag: new Uint8Array(row.refresh_token_tag),
  };
  const aad = row.aad_bound === 1 ? tokenAadForUser(userId) : undefined;

  let plaintext: string;
  let needsReencrypt = hasMetaCols && row.aad_bound !== 1;
  try {
    plaintext = await decryptSecret(blob, hexKey, aad);
  } catch (err) {
    if (!previousHexKey) throw err;
    plaintext = await decryptSecret(blob, previousHexKey, aad);
    needsReencrypt = true;
  }

  if (needsReencrypt && hasMetaCols) {
    try {
      const upgraded = await encryptSecret(
        plaintext,
        hexKey,
        tokenAadForUser(userId),
      );
      await db
        .prepare(
          `UPDATE oauth_tokens
           SET refresh_token_ciphertext = ?, refresh_token_iv = ?, refresh_token_tag = ?,
               key_version = ?, aad_bound = 1, updated_at = ?
           WHERE user_id = ?`,
        )
        .bind(
          upgraded.ciphertext,
          upgraded.iv,
          upgraded.tag,
          CURRENT_KEY_VERSION,
          new Date().toISOString(),
          userId,
        )
        .run();
    } catch {
      // Best-effort lazy re-encryption; do not block caller if update fails.
    }
  }

  return plaintext;
}

export async function deleteRefreshToken(
  db: D1Database,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare("DELETE FROM oauth_tokens WHERE user_id = ?").bind(userId).run();
  await db
    .prepare(
      `UPDATE users SET token_status = 'revoked', calendar_connected_at = NULL, updated_at = ? WHERE id = ?`,
    )
    .bind(now, userId)
    .run();
  await db
    .prepare("DELETE FROM calendars_selected WHERE user_id = ?")
    .bind(userId)
    .run();
}
