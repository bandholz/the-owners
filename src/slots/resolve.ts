import type { UserRow } from "../types";

export interface ResolvePeopleInput {
  userIds?: string[];
  groupId?: string;
  groupMemberIds?: string[];
}

/**
 * Guests may find times without connecting a calendar.
 * Busy is fetched only for selected people who have calendar connected.
 */
export function assertCanFindSlots(
  _actor: UserRow,
): { ok: true } | { ok: false; error: string } {
  return { ok: true };
}

export function mergeSelectedUserIds(input: ResolvePeopleInput): string[] {
  const set = new Set<string>();
  for (const id of input.userIds ?? []) if (id) set.add(id);
  for (const id of input.groupMemberIds ?? []) if (id) set.add(id);
  return [...set];
}

/**
 * Every selected person whose busy time is needed must have a connected calendar.
 * Empty selection rejected.
 */
export function assertSelectedPeopleForBusy(
  selected: UserRow[],
): { ok: true } | { ok: false; error: string } {
  if (selected.length === 0) {
    return {
      ok: false,
      error: "select at least one person (or a group with members)",
    };
  }
  for (const u of selected) {
    if (u.token_status !== "ok") {
      return {
        ok: false,
        error: `calendar not connected for ${u.email} (${u.role})`,
      };
    }
  }
  return { ok: true };
}

/** Guests do not need their own calendar to call find-a-time. */
export function actorMustHaveCalendar(actor: UserRow): boolean {
  return actor.role !== "guest";
}
