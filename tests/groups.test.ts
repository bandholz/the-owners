import { describe, expect, it } from "vitest";
import { mergeSelectedUserIds } from "../src/slots/resolve";

/**
 * Group membership resolution is covered here; D1 CRUD is exercised via
 * admin route shape (create/rename/delete/members) once migrations apply locally.
 */
describe("group pick for find-a-time", () => {
  it("union of group + individuals for slots selection", () => {
    const ids = mergeSelectedUserIds({
      userIds: ["producer-1"],
      groupId: "all-hosts",
      groupMemberIds: ["host-1", "host-2", "producer-1"],
    });
    expect(new Set(ids)).toEqual(
      new Set(["producer-1", "host-1", "host-2"]),
    );
  });
});
