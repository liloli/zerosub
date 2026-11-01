import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StateViewSchema } from "../shared/model";
import {
  CCUSAGE_PACKAGE,
  DEFAULT_MODEL_ROLE_CONFIG,
  MODEL_USAGE_LIMITATIONS,
  ModelUsageMonitor,
  aggregateModelUsage,
  classifyModelRole,
  computeCacheHitRate,
  normalizeModelName,
} from "./model-usage";
import type { RunResult } from "./process";
import { Service } from "./service";
import { StateStore } from "./state";

const unifiedFixture = () => ({
  daily: [
    {
      period: "2026-10-30",
      agents: [
        {
          agent: "claude",
          modelBreakdowns: [
            {
              modelName: "claude-opus-5-5",
              inputTokens: 100,
              outputTokens: 500,
              cacheReadTokens: 800,
              cacheCreationTokens: 100,
              cost: 12.5,
            },
            {
              modelName: "claude-sonnet-5-5",
              inputTokens: 200,
              outputTokens: 300,
              cacheReadTokens: 800,
              cacheCreationTokens: 0,
              cost: 2.5,
            },
          ],
        },
        {
          agent: "codex",
          modelBreakdowns: [
            {
              modelName: "gpt-6.1-sol",
              inputTokens: 400,
              outputTokens: 600,
              cacheReadTokens: 3600,
              cacheCreationTokens: 0,
              cost: 5.0,
            },
          ],
        },
        {
          agent: "pi",
          modelBreakdowns: [
            {
              modelName: "ignored-model",
              inputTokens: 9999,
              outputTokens: 9999,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              cost: 99.0,
            },
          ],
        },
      ],
    },
    {
      period: "2026-10-31",
      agents: [
        {
          agent: "opencode",
          modelBreakdowns: [
            {
              modelName: "deepseek-v4.1-flash",
              inputTokens: 300,
              outputTokens: 200,
              cacheReadTokens: 700,
              cacheCreationTokens: 0,
              cost: 1.0,
            },
          ],
        },
        {
          agent: "antigravity",
          modelBreakdowns: [
            {
              modelName: "model_placeholder_m401",
              inputTokens: 100,
              outputTokens: 100,
              cacheReadTokens: 900,
              cacheCreationTokens: 0,
              cost: 0,
              missingPricing: true,
            },
            {
              modelName: "model_placeholder_m404",
              inputTokens: 50,
              outputTokens: 50,
              cacheReadTokens: 150,
              cacheCreationTokens: 0,
              cost: 0,
              missingPricing: true,
            },
            {
              modelName: "model_placeholder_m999",
              inputTokens: 40,
              outputTokens: 10,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              cost: 0,
              missingPricing: true,
            },
            {
              modelName: "gemini-3.8-flash-medium",
              inputTokens: 100,
              outputTokens: 100,
              cacheReadTokens: 300,
              cacheCreationTokens: 0,
              cost: 0.5,
            },
            {
              modelName: "gemini-4-argon",
              inputTokens: 200,
              outputTokens: 100,
              cacheReadTokens: 800,
              cacheCreationTokens: 0,
              cost: 3.5,
            },
          ],
        },
      ],
    },
  ],
  session: [
    {
      agent: "claude",
      modelBreakdowns: [
        { modelName: "claude-opus-5-5" },
        { modelName: "claude-sonnet-5-5" },
      ],
      metadata: { lastActivity: "2026-10-30T10:00:00.000Z" },
    },
    {
      agent: "codex",
      modelBreakdowns: [{ modelName: "gpt-6.1-sol" }],
      metadata: { lastActivity: "2026-10-30T15:00:00.000Z" },
    },
    {
      agent: "opencode",
      modelBreakdowns: [{ modelName: "deepseek-v4.1-flash" }],
      metadata: { lastActivity: "2026-10-31T08:00:00.000Z" },
    },
    {
      agent: "antigravity",
      modelBreakdowns: [
        { modelName: "model_placeholder_m401" },
        { modelName: "MODEL_PLACEHOLDER_M401" },
      ],
      metadata: { lastActivity: "2026-10-31T12:00:00.000Z" },
    },
    {
      agent: "pi",
      modelBreakdowns: [{ modelName: "ignored-model" }],
      metadata: { lastActivity: "2026-10-31T12:00:00.000Z" },
    },
  ],
});

const codexDailyFixture = () => ({
  daily: [
    {
      date: "2026-10-30",
      models: {
        "gpt-6.1-sol": { reasoningOutputTokens: 250 },
      },
    },
  ],
});

describe("model usage aggregation", () => {
  let directory: string;
  let cachePath: string;
  let now: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zerosub-model-usage-"));
    cachePath = join(directory, "model-usage.json");
    now = Date.parse("2026-11-01T12:00:00.000Z");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("normalizes Antigravity placeholders and marks unknown placeholders unconfirmed", () => {
    expect(normalizeModelName("antigravity", "model_placeholder_m401")).toEqual({
      model: "AGY Opus",
      unconfirmed: false,
    });
    expect(normalizeModelName("antigravity", "MODEL_PLACEHOLDER_M404")).toEqual({
      model: "AGY Sonnet",
      unconfirmed: false,
    });
    expect(normalizeModelName("antigravity", "model_placeholder_m999")).toEqual({
      model: "model_placeholder_m999 (unconfirmed)",
      unconfirmed: true,
    });
    expect(normalizeModelName("claude", "claude-opus-5-5")).toEqual({
      model: "claude-opus-5-5",
      unconfirmed: false,
    });
  });

  it("classifies models into roles via declarative config without hardcoded logic", () => {
    expect(classifyModelRole("claude", "claude-opus-5-5")).toBe("commander");
    expect(classifyModelRole("claude", "claude-sonnet-5-5")).toBe("scout");
    expect(classifyModelRole("codex", "gpt-6-astra")).toBe("commander");
    expect(classifyModelRole("codex", "gpt-6.1-sol")).toBe("coder");
    expect(classifyModelRole("codex", "gpt-6-luna")).toBe("scout");
    expect(classifyModelRole("opencode", "deepseek-v4.1-flash")).toBe("reviewer");
    expect(classifyModelRole("antigravity", "AGY Opus")).toBe("reviewer");
    expect(classifyModelRole("antigravity", "AGY Sonnet")).toBe("scout");
    expect(classifyModelRole("antigravity", "gemini-4-argon")).toBe("coder");
    expect(classifyModelRole("antigravity", "gemini-3.8-flash-medium")).toBe("grunt");
    expect(classifyModelRole("opencode", "mimo-v2.6-flash")).toBe("other");

    const customConfig = {
      aliases: {},
      roles: [{ platform: "opencode" as const, match: "mimo", role: "grunt" as const }],
    };
    expect(classifyModelRole("opencode", "mimo-v2.6-flash", customConfig)).toBe("grunt");
  });

  it("computes cache hit rate and handles zero prompt tokens", () => {
    expect(computeCacheHitRate(100, 800, 100)).toBeCloseTo(0.8, 6);
    expect(computeCacheHitRate(400, 3600, 0)).toBeCloseTo(0.9, 6);
    expect(computeCacheHitRate(50, 0, 0)).toBe(0);
    expect(computeCacheHitRate(0, 0, 0)).toBeNull();
  });

  it("merges four platforms, computes shares, session counts, reasoning tokens, and limitations", () => {
    const summary = aggregateModelUsage({
      unified: unifiedFixture(),
      codexDaily: codexDailyFixture(),
      since: "2026-10-02",
      until: "2026-11-01",
      timeZone: "UTC",
      roleConfig: DEFAULT_MODEL_ROLE_CONFIG,
    });

    expect(summary.platforms.map((p) => p.platform)).toEqual([
      "claude",
      "codex",
      "opencode",
      "antigravity",
    ]);
    expect(summary.totals.sessionCount).toBe(4);
    expect(summary.totals.reasoningTokens).toBe(250);
    expect(summary.totals.costUsd).toBeCloseTo(25.0, 6);

    const claude = summary.platforms.find((p) => p.platform === "claude")!;
    expect(claude.totalTokens).toBe(2800);
    expect(claude.cacheWriteTokens).toBe(100);
    expect(claude.sessionCount).toBe(1);
    expect(claude.modelCount).toBe(2);

    const codex = summary.platforms.find((p) => p.platform === "codex")!;
    expect(codex.totalTokens).toBe(4600);
    expect(codex.reasoningTokens).toBe(250);
    expect(codex.cacheHitRate).toBeCloseTo(0.9, 6);

    const agyOpus = summary.models.find((m) => m.platform === "antigravity" && m.model === "AGY Opus")!;
    expect(agyOpus.role).toBe("reviewer");
    expect(agyOpus.unconfirmed).toBe(false);
    expect(agyOpus.missingPricing).toBe(true);
    expect(agyOpus.sessionCount).toBe(1);
    expect(agyOpus.cacheHitRate).toBeCloseTo(0.9, 6);

    const unconfirmed = summary.models.find((m) => m.unconfirmed)!;
    expect(unconfirmed.model).toBe("model_placeholder_m999 (unconfirmed)");
    expect(unconfirmed.role).toBe("other");

    const sumPlatformShares = summary.platforms.reduce((acc, p) => acc + p.tokenShare, 0);
    const sumModelShares = summary.models.reduce((acc, m) => acc + m.tokenShare, 0);
    expect(sumPlatformShares).toBeCloseTo(1, 6);
    expect(sumModelShares).toBeCloseTo(1, 6);

    for (const platform of summary.platforms) {
      const within = summary.models
        .filter((m) => m.platform === platform.platform)
        .reduce((acc, m) => acc + m.platformTokenShare, 0);
      expect(within).toBeCloseTo(1, 6);
    }

    expect(summary.daily.map((d) => [d.date, d.sessionCount, d.reasoningTokens])).toEqual([
      ["2026-10-30", 2, 250],
      ["2026-10-31", 2, 0],
    ]);
    expect(summary.limitations).toEqual([...MODEL_USAGE_LIMITATIONS]);
  });

  it("caches results for 10 minutes across refreshes and restarts, and exposes summary on StateView", async () => {
    const okResult = (payload: unknown): RunResult => ({
      code: 0,
      stdout: JSON.stringify(payload),
      stderr: "",
      timedOut: false,
    });
    const runner = vi.fn(async (_cmd: string, args: readonly string[]) => {
      if (args.includes("codex")) return okResult(codexDailyFixture());
      return okResult(unifiedFixture());
    });

    const monitor = new ModelUsageMonitor(runner, () => now, cachePath, "UTC");
    await monitor.start();

    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0]?.[0]).toBe("npx");
    expect(runner.mock.calls[0]?.[1]).toContain(CCUSAGE_PACKAGE);
    expect(monitor.view().status).toBe("ok");
    expect(monitor.view().summary?.totals.totalTokens).toBe(11_600);

    // Within 10 minutes, neither background nor manual refresh spawns npx again.
    now += 9 * 60_000;
    await monitor.refresh(true);
    await monitor.refresh(false);
    expect(runner).toHaveBeenCalledTimes(2);

    // A restarted monitor within 10 minutes loads disk cache without spawning npx.
    const restarted = new ModelUsageMonitor(runner, () => now, cachePath, "UTC");
    await restarted.start();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(restarted.view().status).toBe("ok");

    // Past 10 minutes, refresh updates and keeps stale data if a later run fails.
    now += 60_001;
    await monitor.refresh();
    expect(runner).toHaveBeenCalledTimes(4);

    runner.mockImplementationOnce(async () => ({
      code: 1,
      stdout: "",
      stderr: "boom",
      timedOut: false,
    }));
    now += 10 * 60_000;
    await monitor.refresh();
    expect(monitor.view().status).toBe("stale");
    expect(monitor.view().summary?.totals.totalTokens).toBe(11_600);

    const cachedRaw = await readFile(cachePath, "utf8");
    expect(JSON.parse(cachedRaw).version).toBe(1);

    const service = new Service(
      {} as never,
      new StateStore(join(directory, "state.json")),
      { resolve: async () => ({}) } as never,
      { locate: async () => null } as never,
      undefined,
      undefined,
      restarted,
    );
    const paseo = {
      agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } }) },
    } as never;
    const state = await service.view(paseo, false);
    expect(StateViewSchema.parse(state).modelUsage?.summary?.totals.totalTokens).toBe(11_600);
    await service.stop();
  });
});
