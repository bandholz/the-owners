import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEATMAP_SETTINGS,
  normalizeHeatmapSettings,
} from "../src/db/heatmap-settings";

describe("heatmap settings", () => {
  it("defaults to five weekdays, weekends hidden, and 9:00 to 17:00", () => {
    expect(DEFAULT_HEATMAP_SETTINGS).toEqual({
      dayCount: 5,
      showWeekends: false,
      windowStartMinutes: 9 * 60,
      windowEndMinutes: 17 * 60,
      defaultGroupName: "Hosts",
    });
  });

  it("accepts an admin change and rejects a window that is too wide or unordered", () => {
    const ok = normalizeHeatmapSettings({
      dayCount: 7,
      showWeekends: true,
      windowStartMinutes: 8 * 60,
      windowEndMinutes: 18 * 60,
    });
    expect(ok).toEqual({
      ok: true,
      settings: {
        dayCount: 7,
        showWeekends: true,
        windowStartMinutes: 480,
        windowEndMinutes: 18 * 60,
        defaultGroupName: "Hosts",
      },
    });
    const blank = normalizeHeatmapSettings({
      dayCount: 5,
      showWeekends: false,
      windowStartMinutes: 9 * 60,
      windowEndMinutes: 17 * 60,
      defaultGroupName: "",
    });
    expect(blank.ok && blank.settings.defaultGroupName).toBe("");
    expect(
      normalizeHeatmapSettings({
        dayCount: 0,
        showWeekends: false,
        windowStartMinutes: 9 * 60,
        windowEndMinutes: 17 * 60,
      }).ok,
    ).toBe(false);
    expect(
      normalizeHeatmapSettings({
        dayCount: 5,
        showWeekends: false,
        windowStartMinutes: 17 * 60,
        windowEndMinutes: 9 * 60,
      }).ok,
    ).toBe(false);
    const weekendsOff = normalizeHeatmapSettings({
      dayCount: 5,
      showWeekends: "no",
      windowStartMinutes: 9 * 60,
      windowEndMinutes: 17 * 60,
    });
    expect(weekendsOff.ok && weekendsOff.settings.showWeekends).toBe(false);
  });
});
