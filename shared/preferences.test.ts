import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_CARD_COLORS, DEFAULT_CONTINUE_PROMPT, preferences } from "./preferences";

// The preferences 1.2.1 and 1.2.2 shipped, before "Move open agents when the default changes".
const shipped = z.object({
  autoSwitch: z.boolean().default(true),
  autoContinue: z.boolean().default(true),
  continuePrompt: z.string().trim().min(1).max(500).default(DEFAULT_CONTINUE_PROMPT),
  balanceNewAgents: z.boolean().default(false),
  autoRedeem: z.boolean().default(false),
  forkOtherProvider: z.boolean().default(false),
  showComposerPill: z.boolean().default(true),
});

describe("preferences", () => {
  it("keeps moving open agents to a new default for preferences saved before the switch existed", () => {
    const saved = shipped.parse({ autoSwitch: false });
    expect(preferences.schema.parse(saved)).toMatchObject({ autoSwitch: false, moveAgentsOnDefaultChange: true });
    expect(preferences.schema.parse({}).moveAgentsOnDefaultChange).toBe(true);
  });

  it("doesn't spend ChatGPT credits for preferences saved before that switch existed", () => {
    const saved = preferences.schema.parse({ autoSwitch: false, moveAgentsOnDefaultChange: false });
    expect(saved.useCredits).toBe(false);
    expect(preferences.schema.parse(shipped.parse({})).useCredits).toBe(false);
  });

  it("can still be read by 1.2.2 after a downgrade", () => {
    const saved = preferences.schema.parse({ autoSwitch: false, moveAgentsOnDefaultChange: false });
    expect(shipped.safeParse(saved)).toMatchObject({ success: true, data: { autoSwitch: false } });
    // Paseo won't load preferences saved under a newer version number, so a new switch mustn't bump it.
    expect(preferences.version).toBe(1);
  });
});


describe("card colors", () => {
  it("fills defaults for saved preferences from before card colors existed", () => {
    expect(preferences.schema.parse(shipped.parse({})).cardColors).toEqual(DEFAULT_CARD_COLORS);
  });

  it("round-trips custom card colors and intensity without changing other settings", () => {
    const custom = { codex: "#aabbcc", claude: "#123456", antigravity: "#FEDCBA", opencodeGo: "#654321", opacity: 0.3 };
    const saved = preferences.schema.parse({ autoSwitch: false, cardColors: custom });
    expect(preferences.schema.parse(JSON.parse(JSON.stringify(saved)))).toMatchObject({ autoSwitch: false, cardColors: custom });
    expect(preferences.schema.parse({ cardColors: { opacity: 0 } }).cardColors.opacity).toBe(0);
  });

  it("rejects invalid colors and out-of-range intensity", () => {
    for (const codex of ["red", "#abc", "#12345g", "#12345678", ""]) {
      expect(preferences.schema.safeParse({ cardColors: { codex } }).success).toBe(false);
    }
    for (const opacity of [-0.01, 0.31, NaN, Infinity, "0.12"]) {
      expect(preferences.schema.safeParse({ cardColors: { opacity } }).success).toBe(false);
    }
  });

  it("resets only card colors while preserving automation preferences", () => {
    const saved = preferences.schema.parse({ autoSwitch: false, cardColors: { codex: "#112233", opacity: 0.25 } });
    const reset = preferences.schema.parse({ ...saved, cardColors: { ...DEFAULT_CARD_COLORS } });
    expect(reset.cardColors).toEqual(DEFAULT_CARD_COLORS);
    expect(reset.autoSwitch).toBe(false);
  });
});
