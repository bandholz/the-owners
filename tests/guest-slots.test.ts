import { describe, expect, it } from "vitest";
import {
  assertCanFindSlots,
  assertSelectedPeopleForBusy,
  mergeSelectedUserIds,
} from "../src/slots/resolve";
import type { UserRow } from "../src/types";

function user(over: Partial<UserRow> & Pick<UserRow, "id" | "email" | "role" | "token_status">): UserRow {
  return {
    email_normalized: over.email.toLowerCase(),
    name: null,
    google_sub: null,
    invited_by: null,
    created_at: "",
    updated_at: "",
    last_login_at: null,
    calendar_connected_at: null,
    ...over,
  };
}

describe("guest find-a-time rules", () => {
  it("allows guest actor without calendar", () => {
    const guest = user({
      id: "g1",
      email: "guest@x.com",
      role: "guest",
      token_status: "none",
    });
    expect(assertCanFindSlots(guest)).toEqual({ ok: true });
  });

  it("merges group members with explicit ids", () => {
    expect(
      mergeSelectedUserIds({
        userIds: ["a", "b"],
        groupMemberIds: ["b", "c"],
      }).sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("requires selected people to have calendars", () => {
    const hostOk = user({
      id: "h1",
      email: "host@x.com",
      role: "host",
      token_status: "ok",
    });
    const hostBad = user({
      id: "h2",
      email: "host2@x.com",
      role: "host",
      token_status: "none",
    });
    expect(assertSelectedPeopleForBusy([hostOk]).ok).toBe(true);
    const bad = assertSelectedPeopleForBusy([hostOk, hostBad]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/host2@x.com/);
  });

  it("rejects empty selection", () => {
    const r = assertSelectedPeopleForBusy([]);
    expect(r.ok).toBe(false);
  });

  it("rejects guest in selection without calendar", () => {
    const guest = user({
      id: "g1",
      email: "guest@x.com",
      role: "guest",
      token_status: "none",
    });
    const r = assertSelectedPeopleForBusy([guest]);
    expect(r.ok).toBe(false);
  });
});
