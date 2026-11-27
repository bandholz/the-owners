/**
 * AES-256-GCM helpers for refresh-token encryption at rest, plus
 * constant-time comparison and HMAC/token helpers for sessions and CSRF.
 * TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes).
 */

const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;

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

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
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
  aad?: string,
): Promise<EncryptedBlob> {
  const key = await importKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const algorithm = {
    name: "AES-GCM" as const,
    iv,
    tagLength: AES_GCM_TAG_BYTES * 8,
    ...(aad !== undefined
      ? { additionalData: new TextEncoder().encode(aad) }
      : {}),
  };
  const buf = new Uint8Array(await crypto.subtle.encrypt(algorithm, key, encoded));
  const tag = buf.slice(buf.length - AES_GCM_TAG_BYTES);
  const ciphertext = buf.slice(0, buf.length - AES_GCM_TAG_BYTES);
  return { ciphertext, iv, tag };
}

export async function decryptSecret(
  blob: EncryptedBlob,
  hexKey: string,
  aad?: string,
): Promise<string> {
  if (blob.iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new Error("invalid AES-GCM IV length");
  }
  if (blob.tag.byteLength !== AES_GCM_TAG_BYTES) {
    throw new Error("invalid AES-GCM tag length");
  }
  const key = await importKey(hexKey);
  const combined = new Uint8Array(blob.ciphertext.length + blob.tag.length);
  combined.set(blob.ciphertext, 0);
  combined.set(blob.tag, blob.ciphertext.length);
  const algorithm = {
    name: "AES-GCM" as const,
    iv: blob.iv,
    tagLength: AES_GCM_TAG_BYTES * 8,
    ...(aad !== undefined
      ? { additionalData: new TextEncoder().encode(aad) }
      : {}),
  };
  const plain = await crypto.subtle.decrypt(algorithm, key, combined);
  return new TextDecoder().decode(plain);
}

/**
 * Synchronous constant-time comparison kept for sync callers/tests.
 * Prefer timingSafeEqualAsync (SHA-256 + WebCrypto timingSafeEqual) for secrets.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  const n = Math.max(aa.byteLength, bb.byteLength);
  let diff = aa.byteLength ^ bb.byteLength;
  for (let i = 0; i < n; i++) {
    diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Constant-time string comparison using fixed-size SHA-256 digests so input
 * length cannot leak via timing. Uses Cloudflare Workers' native
 * crypto.subtle.timingSafeEqual when available.
 */
export async function timingSafeEqualAsync(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (x: BufferSource, y: BufferSource) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(ha, hb);
  }
  const ua = new Uint8Array(ha);
  const ub = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < ua.byteLength; i++) {
    diff |= ua[i] ^ ub[i];
  }
  return diff === 0;
}

export function randomId(): string {
  return crypto.randomUUID();
}

/** Cryptographically random URL-safe token (default 32 bytes / 256 bits). */
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToBase64Url(buf);
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  if (!secret) {
    return sha256Hex(message);
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}
