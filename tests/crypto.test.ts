import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  timingSafeEqual,
} from "../src/crypto/tokens";

const KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("encryptSecret", () => {
  it("round-trips", async () => {
    const enc = await encryptSecret("refresh-token-value", KEY);
    expect(enc.iv.byteLength).toBe(12);
    expect(enc.tag.byteLength).toBe(16);
    const plain = await decryptSecret(enc, KEY);
    expect(plain).toBe("refresh-token-value");
  });

  it("fails with wrong key", async () => {
    const enc = await encryptSecret("x", KEY);
    const bad =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    await expect(decryptSecret(enc, bad)).rejects.toThrow();
  });
});

describe("timingSafeEqual", () => {
  it("matches equals", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
  });
});
