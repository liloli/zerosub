import { describe, expect, it } from "vitest";
import type { UsageWindow } from "../shared/model";
import {
  displayGroupName,
  orderAntigravityBuckets,
  orderUsageWindows,
} from "./quota-display";

describe("displayGroupName", () => {
  it("renames Antigravity group sub-titles for display only", () => {
    expect(displayGroupName("Gemini Models")).toBe("Gemini");
    expect(displayGroupName("Claude and GPT models")).toBe("Claude & GPT");
    expect(displayGroupName("Gemini 4 Argon")).toBe("Gemini 4 Argon");
    expect(displayGroupName("Unknown Models Group")).toBe("Unknown Models Group");
  });
});

describe("orderUsageWindows", () => {
  it("orders 5h on top, weekly below it, and labels them uniformly", () => {
    const input: UsageWindow[] = [
      { id: "seven_day", label: "Weekly", usedPercent: 40, resetsAt: null, minutes: 10_080 },
      { id: "five_hour", label: "5-hour", usedPercent: 10, resetsAt: null, minutes: 300 },
    ];
    const ordered = orderUsageWindows(input);
    expect(ordered.map((w) => [w.label, w.usedPercent])).toEqual([
      ["5h", 10],
      ["weekly", 40],
    ]);
  });

  it("keeps other windows after weekly with their existing label (e.g. OpenCode Go monthly)", () => {
    const input: UsageWindow[] = [
      { id: "monthly", label: "Monthly", usedPercent: 50, resetsAt: null },
      { id: "rolling", label: "5-hour", usedPercent: 5, resetsAt: null },
      { id: "weekly", label: "Weekly", usedPercent: 20, resetsAt: null },
    ];
    const ordered = orderUsageWindows(input);
    expect(ordered.map((w) => [w.label, w.usedPercent])).toEqual([
      ["5h", 5],
      ["weekly", 20],
      ["Monthly", 50],
    ]);
  });

  it("keeps scoped weekly limits after generic weekly with their original label", () => {
    const input: UsageWindow[] = [
      { id: "weekly_opus", label: "Weekly · Opus", usedPercent: 90, resetsAt: null },
      { id: "seven_day", label: "Weekly", usedPercent: 30, resetsAt: null },
      { id: "five_hour", label: "5-hour", usedPercent: 15, resetsAt: null },
    ];
    const ordered = orderUsageWindows(input);
    expect(ordered.map((w) => [w.label, w.usedPercent])).toEqual([
      ["5h", 15],
      ["weekly", 30],
      ["Weekly · Opus", 90],
    ]);
  });
});

describe("orderAntigravityBuckets", () => {
  it("orders 5h on top and weekly below, uniformly labeled", () => {
    const input = [
      { id: "b2", label: "Weekly", window: "weekly", remainingPercent: 80, resetsAt: null },
      { id: "b1", label: "Five Hour", window: "5h", remainingPercent: 95, resetsAt: null },
    ];
    const ordered = orderAntigravityBuckets(input);
    expect(ordered.map((b) => [b.label, b.remainingPercent])).toEqual([
      ["5h", 95],
      ["weekly", 80],
    ]);
  });
});
