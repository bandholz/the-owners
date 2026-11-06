import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../src/db/users";

/**
 * Invite-only rule: exact normalized email match.
 * Google may return different casing; we never fuzzy-match domains.
 */
describe("allowlist exact match", () => {
  const invited = new Set(["eric@bandholz.com", "aaron@operators.example"]);

  function isInvited(email: string): boolean {
    return invited.has(normalizeEmail(email));
  }

  it("accepts exact invited email ignoring case", () => {
    expect(isInvited("Eric@Bandholz.com")).toBe(true);
  });

  it("rejects close cousins", () => {
    expect(isInvited("eric+tag@bandholz.com")).toBe(false);
    expect(isInvited("eric@bandholz.co")).toBe(false);
    expect(isInvited("")).toBe(false);
  });
});
