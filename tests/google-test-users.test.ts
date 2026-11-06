import { describe, expect, it } from "vitest";
import { diffGoogleTestUsers } from "../src/access/google-test-users";

describe("diffGoogleTestUsers", () => {
  it("lists adds and removes", () => {
    const diff = diffGoogleTestUsers(
      ["Eric@Bandholz.com", "host@chisos.example"],
      ["eric@bandholz.com", "old@gone.example"],
    );
    expect(diff.toAdd).toEqual(["host@chisos.example"]);
    expect(diff.toRemove).toEqual(["old@gone.example"]);
    expect(diff.inSync).toEqual(["eric@bandholz.com"]);
  });

  it("all toAdd when nothing acked", () => {
    const diff = diffGoogleTestUsers(["a@x.com", "b@x.com"], []);
    expect(diff.toAdd).toEqual(["a@x.com", "b@x.com"]);
    expect(diff.toRemove).toEqual([]);
  });
});
