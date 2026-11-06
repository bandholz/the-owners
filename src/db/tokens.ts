import {
  decryptSecret,
  encryptSecret,
  type EncryptedBlob,
} from "../crypto/tokens";

export async function storeRefreshToken(
  db: D1Database,
  userId: string,
  refreshToken: string,
  scopes: string[],
  hexKey: string,
): Promise<void> {
  const enc = await encryptSecret(refreshToken, hexKey);
  const now = new Date().toISOString();
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
      enc.ciphertext,
      enc.iv,
      enc.tag,
      scopes.join(" "),
      now,
    )
    .run();
  await db
    .prepare(
      `UPDATE users SET token_status = 'ok', calendar_connected_at = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(now, now, userId)
    .run();
}

export async function loadRefreshToken(
  db: D1Database,
  userId: string,
  hexKey: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT refresh_token_ciphertext, refresh_token_iv, refresh_token_tag
       FROM oauth_tokens WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{
      refresh_token_ciphertext: ArrayBuffer;
      refresh_token_iv: ArrayBuffer;
      refresh_token_tag: ArrayBuffer;
    }>();
  if (!row) return null;
  const blob: EncryptedBlob = {
    ciphertext: new Uint8Array(row.refresh_token_ciphertext),
    iv: new Uint8Array(row.refresh_token_iv),
    tag: new Uint8Array(row.refresh_token_tag),
  };
  return decryptSecret(blob, hexKey);
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
