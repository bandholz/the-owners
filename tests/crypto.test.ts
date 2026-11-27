import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  timingSafeEqual,
  timingSafeEqualAsync,
} from "../src/crypto/tokens";

const KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("encryptSecret", () => {
  it("round-trips with and without AAD", async () => {
    const enc = await encryptSecret("refresh-token-value", KEY);
    expect(enc.iv.byteLength).toBe(12);
    expect(enc.tag.byteLength).toBe(16);
    const plain = await decryptSecret(enc, KEY);
    expect(plain).toBe("refresh-token-value");

    const bound = await encryptSecret("refresh-token-value", KEY, "oauth_tokens:u1");
    expect(await decryptSecret(bound, KEY, "oauth_tokens:u1")).toBe(
      "refresh-token-value",
    );
    await expect(
      decryptSecret(bound, KEY, "oauth_tokens:u2"),
    ).rejects.toThrow();
  });

  it("fails with wrong key or invalid IV/tag lengths", async () => {
    const enc = await encryptSecret("x", KEY);
    const bad =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    await expect(decryptSecret(enc, bad)).rejects.toThrow();
    await expect(
      decryptSecret({ ...enc, iv: new Uint8Array(8) }, KEY),
    ).rejects.toThrow(/IV/);
    await expect(
      decryptSecret({ ...enc, tag: new Uint8Array(8) }, KEY),
    ).rejects.toThrow(/tag/);
  });
});

describe("timingSafeEqual", () => {
  it("matches equals synchronously and asynchronously", async () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);

    expect(await timingSafeEqualAsync("abc", "abc")).toBe(true);
    expect(await timingSafeEqualAsync("abc", "abd")).toBe(false);
    expect(await timingSafeEqualAsync("abc", "ab")).toBe(false);
  });
});
