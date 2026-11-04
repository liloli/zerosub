import { describe, expect, it } from "vitest";
import { accountSubtitle, formatAge, formatCredits, formatPlan, formatResetIn, peakUsage, shortLabel, usageSummary } from "./format";
import type { AccountView } from "./model";

const NOW = Date.parse("2026-09-23T12:00:00Z");

describe("formatResetIn", () => {
  it("renders UTC+8 time and countdown for same day and cross day", () => {
    // NOW is 2026-09-23T12:00:00Z -> UTC+8 time 2026-09-23 20:00:00
    expect(formatResetIn("2026-09-23T12:45:00Z", NOW)).toBe("20:45  45m");
    expect(formatResetIn("2026-09-23T14:00:00Z", NOW)).toBe("22:00  2h");
    expect(formatResetIn("2026-09-23T14:10:00Z", NOW)).toBe("22:10  2h 10m");
    expect(formatResetIn("2026-09-26T15:00:00Z", NOW)).toBe("09-26 23:00  3d 3h");
    expect(formatResetIn("2026-09-23T11:00:00Z", NOW)).toBe("now");
    expect(formatResetIn(null, NOW)).toBeNull();
    expect(formatResetIn("not a date", NOW)).toBeNull();
  });

  it("formats user brief examples (same day and cross day in UTC+8)", () => {
    // Brief same-day example: "21:40  4h 26m"
    // now = 17:14 UTC+8 (09:14 UTC), reset = 21:40 UTC+8 (13:40 UTC)
    const now1 = Date.parse("2026-11-01T09:14:00Z");
    expect(formatResetIn("2026-11-01T13:40:00Z", now1)).toBe("21:40  4h 26m");

    // Brief cross-day example: "11-02 08:00  15h"
    // now = 17:00 UTC+8 on 11-01 (09:00 UTC), reset = 08:00 UTC+8 on 11-02 (00:00 UTC)
    const now2 = Date.parse("2026-11-01T09:00:00Z");
    expect(formatResetIn("2026-11-02T00:00:00Z", now2)).toBe("11-02 08:00  15h");
  });

  it("determines same day strictly by UTC+8 date, even when UTC date differs or coincides", () => {
    // When UTC is 2026-11-01 15:00Z (UTC+8 2026-11-01 23:00)
    // and reset is 2026-11-01 17:00Z (UTC is same day 11-01, but UTC+8 is 2026-11-02 01:00)
    // This is cross-day in UTC+8!
    const nowDisplayNight = Date.parse("2026-11-01T15:00:00Z");
    expect(formatResetIn("2026-11-01T17:00:00Z", nowDisplayNight)).toBe("11-02 01:00  2h");
  });

  it("produces identical results regardless of system timezone (non-+8 independence)", () => {
    const originalTZ = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/New_York", "Europe/London", "Asia/Tokyo", "Pacific/Auckland"]) {
        process.env.TZ = tz;
        const now = Date.parse("2026-11-01T09:14:00Z");
        expect(formatResetIn("2026-11-01T13:40:00Z", now)).toBe("21:40  4h 26m");
        expect(formatResetIn("2026-11-02T00:00:00Z", now)).toBe("11-02 08:00  14h 46m");
      }
    } finally {
      process.env.TZ = originalTZ;
    }
  });
});

describe("accountSubtitle", () => {
  it("drops an organization that only repeats the owner", () => {
    const email = "ada@example.com";
    expect(accountSubtitle({ email, organization: "ada@example.com's Organization" })).toBe(email);
    expect(accountSubtitle({ email, organization: "Ada's Organization" })).toBe(email);
    expect(accountSubtitle({ email, organization: email })).toBe(email);
    expect(accountSubtitle({ email, organization: null })).toBe(email);
  });

  it("keeps a real organization", () => {
    expect(accountSubtitle({ email: "a@acme.dev", organization: "Acme Engineering" })).toBe("a@acme.dev · Acme Engineering");
    expect(accountSubtitle({ email: null, organization: null })).toBeNull();
  });
});

describe("formatAge", () => {
  it("reads naturally", () => {
    expect(formatAge("2026-09-23T11:59:30Z", NOW)).toBe("just now");
    expect(formatAge("2026-09-23T11:54:00Z", NOW)).toBe("6m ago");
    expect(formatAge("2026-09-23T09:00:00Z", NOW)).toBe("3h ago");
    expect(formatAge("2026-09-21T12:00:00Z", NOW)).toBe("2d ago");
    expect(formatAge("garbage", NOW)).toBe("just now");
  });
});

describe("account presentation", () => {
  const account: AccountView = {
    id: "claude-a",
    family: "claude",
    label: "work",
    kind: "managed",
    email: "work@example.com",
    plan: "max",
    organization: null,
    status: "ready",
    isDefault: false,
    limitedUntil: null,
    usage: {
      fetchedAt: "2026-09-23T11:59:00Z",
      windows: [
        { id: "five_hour", label: "5-hour", usedPercent: 30, resetsAt: "2026-09-23T14:00:00Z" },
        { id: "seven_day", label: "Weekly", usedPercent: 71.6, resetsAt: "2026-09-25T12:00:00Z" },
      ],
      error: null,
      cached: false,
      resets: null,
      credits: null,
    },
    agentCount: 2,
    home: "/homes/claude-a",
  };

  it("summarises the busiest window", () => {
    expect(peakUsage(account.usage?.windows ?? [])?.id).toBe("seven_day");
    expect(usageSummary(account, NOW)).toBe("72% of weekly used · 09-25 20:00  2d");
  });

  it("puts a reached limit first", () => {
    expect(usageSummary({ ...account, status: "limited", limitedUntil: "2026-09-23T13:30:00Z" }, NOW)).toBe(
      "Limit reached · 21:30  1h 30m",
    );
  });

  it("names the credits a full window falls back on", () => {
    expect(formatCredits({ balance: 57714.93, unlimited: false })).toBe("57,714 ChatGPT credits left");
    expect(formatCredits({ balance: 1, unlimited: false })).toBe("1 ChatGPT credit left");
    expect(formatCredits({ balance: 0.4, unlimited: false })).toBe("Less than 1 ChatGPT credit left");
    expect(formatCredits({ balance: null, unlimited: false })).toBe("ChatGPT credits available");
    expect(formatCredits({ balance: null, unlimited: true })).toBe("Unlimited ChatGPT credits");
  });

  it("names plans and trims long labels", () => {
    expect(formatPlan("prolite")).toBe("Pro Lite");
    expect(formatPlan("max")).toBe("Max");
    expect(formatPlan("something_new")).toBe("Something_new");
    expect(shortLabel({ label: "lovelace@analytical.example" })).toBe("lovelace@analytic…");
  });
});
