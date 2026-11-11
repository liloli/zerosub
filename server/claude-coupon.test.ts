import { describe, expect, it, vi } from "vitest";
vi.mock("./process", () => ({ run: vi.fn(async () => ({ stdout: "2.1.99 (Claude Code)" })), stripAnsi: (s: string) => s, firstUrl: () => null }));
import { apiHeaders } from "./claude";
import { parseClaudeResets } from "./claude-resets";
describe("Claude coupon read", () => {
  it("sends CLI user agent", async () => {
    expect((await apiHeaders("fake"))["User-Agent"]).toBe("claude-cli/2.1.99 (external, cli)");
  });
  it("keeps coupon types and expiry separate", () => {
    const grants = ["Full reset", "Fable reset"].map((label, i) => ({ id: `g${i}`, label, resets_left: i + 1, ends_at: `2026-11-${17 + i}T00:00:00Z` }));
    expect(parseClaudeResets({ eligible: true, grants }).offer?.grants).toEqual(grants.map(g => ({ label: g.label, available: g.resets_left, expiresAt: g.ends_at.replace("Z", ".000Z") })));
  });
  it("leaves empty and failed reads unknown", () => {
    for (const block of [null, undefined, {}, { eligible: false, grants: [] }]) expect(parseClaudeResets(block).offer).toBeNull();
  });
});
