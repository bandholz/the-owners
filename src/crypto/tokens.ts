/**
 * AES-256-GCM helpers for refresh-token encryption at rest.
 * TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes).
 */

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be even-length hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function importKey(hexKey: string): Promise<CryptoKey> {
  const raw = hexToBytes(hexKey);
  if (raw.byteLength !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export interface EncryptedBlob {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  tag: Uint8Array;
}

export async function encryptSecret(
  plaintext: string,
  hexKey: string,
): Promise<EncryptedBlob> {
  const key = await importKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const buf = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded),
  );
  // WebCrypto appends 16-byte tag to ciphertext
  const tag = buf.slice(buf.length - 16);
  const ciphertext = buf.slice(0, buf.length - 16);
  return { ciphertext, iv, tag };
}

export async function decryptSecret(
  blob: EncryptedBlob,
  hexKey: string,
): Promise<string> {
  const key = await importKey(hexKey);
  const combined = new Uint8Array(blob.ciphertext.length + blob.tag.length);
  combined.set(blob.ciphertext, 0);
  combined.set(blob.tag, blob.ciphertext.length);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.iv },
    key,
    combined,
  );
  return new TextDecoder().decode(plain);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.byteLength !== bb.byteLength) {
    // still walk to reduce length leaks a bit
    let diff = aa.byteLength ^ bb.byteLength;
    const n = Math.max(aa.byteLength, bb.byteLength);
    for (let i = 0; i < n; i++) {
      diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
    }
    return false;
  }
  let out = 0;
  for (let i = 0; i < aa.byteLength; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}

export function randomId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
