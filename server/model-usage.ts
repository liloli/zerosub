import { join } from "node:path";
import { z } from "zod";
import {
  ModelPlatformSchema,
  ModelRoleSchema,
  ModelUsageSummarySchema,
  type DailyModelUsage,
  type DailyUsageRow,
  type ModelPlatform,
  type ModelRole,
  type ModelUsageRow,
  type ModelUsageSummary,
  type ModelUsageView,
  type PlatformUsageRow,
  type RoleUsageRow,
  type TokenTotals,
} from "../shared/model";
import { readJson, writeJsonAtomic } from "./json-file";
import defaultRoleConfigJson from "./model-roles.json";
import { dataDir } from "./paths";
import { run } from "./process";

const CCUSAGE_NAME = "ccusage";
const CCUSAGE_VERSION = "20.0.46";
export const CCUSAGE_PACKAGE = `${CCUSAGE_NAME}@${CCUSAGE_VERSION}`;
const REFRESH_MS = 10 * 60_000;
const MANUAL_THROTTLE_MS = 15_000;
const WINDOW_DAYS = 30;
const MAX_CCUSAGE_BYTES = 16 * 1024 * 1024;
const CCUSAGE_TIMEOUT_MS = 90_000;

export const PLATFORMS: readonly ModelPlatform[] = ["claude", "codex", "opencode", "antigravity"];
export const ROLES: readonly ModelRole[] = ["commander", "coder", "grunt", "scout", "reviewer", "other"];

export const MODEL_USAGE_LIMITATIONS = [
  "Codex interactive TUI sessions mostly omit token_usage events; primarily non-interactive runs are counted.",
  "Antigravity early transcripts lack token fields and Claude placeholder models lack pricing.",
  "Costs are API-equivalent estimates computed by ccusage, not actual subscription charges.",
] as const;

export const ModelRoleConfigSchema = z.object({
  aliases: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  roles: z.array(
    z.object({
      platform: ModelPlatformSchema.optional(),
      match: z.string().min(1),
      role: ModelRoleSchema,
    }),
  ),
});
export type ModelRoleConfig = z.infer<typeof ModelRoleConfigSchema>;

export const DEFAULT_MODEL_ROLE_CONFIG: ModelRoleConfig = ModelRoleConfigSchema.parse(defaultRoleConfigJson);

const BreakdownSchema = z.object({
  modelName: z.string(),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheReadTokens: z.number().default(0),
  cacheCreationTokens: z.number().default(0),
  cost: z.number().default(0),
  missingPricing: z.boolean().optional(),
});

const UnifiedReportSchema = z.object({
  daily: z
    .array(
      z.object({
        period: z.string(),
        agents: z
          .array(
            z.object({
              agent: z.string(),
              modelBreakdowns: z.array(BreakdownSchema).default([]),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  session: z
    .array(
      z.object({
        agent: z.string(),
        modelsUsed: z.array(z.string()).default([]),
        modelBreakdowns: z.array(BreakdownSchema).default([]),
        metadata: z
          .object({
            lastActivity: z.string().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      }),
    )
    .default([]),
});

const CodexDailySchema = z.object({
  daily: z
    .array(
      z.object({
        date: z.string(),
        models: z
          .record(
            z.string(),
            z.object({
              reasoningOutputTokens: z.number().default(0),
            }),
          )
          .default({}),
      }),
    )
    .default([]),
});

const CacheSchema = z.object({
  version: z.literal(1),
  fetchedAt: z.string().refine((s) => Number.isFinite(Date.parse(s))),
  summary: ModelUsageSummarySchema,
});

export function normalizeModelName(
  platform: ModelPlatform,
  rawModel: string,
  config: ModelRoleConfig = DEFAULT_MODEL_ROLE_CONFIG,
): { model: string; unconfirmed: boolean } {
  const lower = rawModel.toLowerCase();
  const alias = Object.entries(config.aliases[platform] ?? {}).find(([k]) => k.toLowerCase() === lower)?.[1];
  if (alias) return { model: alias, unconfirmed: false };
  return /^model_placeholder_/i.test(rawModel)
    ? { model: `${rawModel} (unconfirmed)`, unconfirmed: true }
    : { model: rawModel, unconfirmed: false };
}

export function classifyModelRole(
  platform: ModelPlatform,
  normalizedModel: string,
  config: ModelRoleConfig = DEFAULT_MODEL_ROLE_CONFIG,
): ModelRole {
  const lower = normalizedModel.toLowerCase();
  return (
    config.roles.find((r) => (!r.platform || r.platform === platform) && lower.includes(r.match.toLowerCase()))
      ?.role ?? "other"
  );
}

export function computeCacheHitRate(
  inputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): number | null {
  const promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  return promptTokens > 0 ? cacheReadTokens / promptTokens : null;
}

export function formatDateInTimeZone(timestampMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestampMs));
}

interface MutableBucket {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

function emptyBucket(): MutableBucket {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: 0 };
}

function addBucket(target: MutableBucket, add: MutableBucket): void {
  target.inputTokens += add.inputTokens;
  target.outputTokens += add.outputTokens;
  target.cacheReadTokens += add.cacheReadTokens;
  target.cacheWriteTokens += add.cacheWriteTokens;
  target.reasoningTokens += add.reasoningTokens;
  target.costUsd += add.costUsd;
}

function finalizeTotals(bucket: MutableBucket, sessionCount: number): TokenTotals {
  const totalTokens =
    bucket.inputTokens + bucket.outputTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens;
  return {
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    cacheReadTokens: bucket.cacheReadTokens,
    cacheWriteTokens: bucket.cacheWriteTokens,
    reasoningTokens: bucket.reasoningTokens,
    totalTokens,
    costUsd: bucket.costUsd,
    cacheHitRate: computeCacheHitRate(bucket.inputTokens, bucket.cacheReadTokens, bucket.cacheWriteTokens),
    sessionCount,
  };
}

function isTargetPlatform(agent: string): agent is ModelPlatform {
  return (PLATFORMS as readonly string[]).includes(agent);
}

export function aggregateModelUsage(options: {
  unified: unknown;
  codexDaily?: unknown;
  since: string;
  until: string;
  timeZone?: string;
  roleConfig?: ModelRoleConfig;
}): ModelUsageSummary {
  const { since, until, timeZone = "UTC", roleConfig = DEFAULT_MODEL_ROLE_CONFIG } = options;
  const unified = UnifiedReportSchema.parse(options.unified);
  const codexDaily = options.codexDaily ? CodexDailySchema.parse(options.codexDaily) : { daily: [] };

  const codexReasoning = new Map<string, number>();
  for (const day of codexDaily.daily) {
    for (const [rawModel, stats] of Object.entries(day.models)) {
      if (stats.reasoningOutputTokens > 0) {
        codexReasoning.set(`${day.date}\0${rawModel}`, stats.reasoningOutputTokens);
      }
    }
  }

  const modelEntries = new Map<
    string,
    {
      platform: ModelPlatform;
      model: string;
      rawModels: Set<string>;
      unconfirmed: boolean;
      role: ModelRole;
      missingPricing: boolean;
      bucket: MutableBucket;
      sessionCount: number;
    }
  >();
  const dayModels = new Map<string, Map<string, { platform: ModelPlatform; model: string; role: ModelRole; bucket: MutableBucket }>>();

  const ensureModel = (platform: ModelPlatform, rawModel: string) => {
    const { model, unconfirmed } = normalizeModelName(platform, rawModel, roleConfig);
    const key = `${platform}\0${model}`;
    let entry = modelEntries.get(key);
    if (!entry) {
      entry = {
        platform,
        model,
        rawModels: new Set(),
        unconfirmed,
        role: classifyModelRole(platform, model, roleConfig),
        missingPricing: false,
        bucket: emptyBucket(),
        sessionCount: 0,
      };
      modelEntries.set(key, entry);
    }
    entry.rawModels.add(rawModel);
    if (unconfirmed) entry.unconfirmed = true;
    return { key, entry };
  };

  for (const dayRow of unified.daily) {
    const date = dayRow.period;
    for (const agentRow of dayRow.agents) {
      if (!isTargetPlatform(agentRow.agent)) continue;
      const platform = agentRow.agent;
      for (const mb of agentRow.modelBreakdowns) {
        const { key, entry } = ensureModel(platform, mb.modelName);
        const reasoningTokens =
          platform === "codex" ? (codexReasoning.get(`${date}\0${mb.modelName}`) ?? 0) : 0;
        const delta: MutableBucket = {
          inputTokens: mb.inputTokens,
          outputTokens: mb.outputTokens,
          cacheReadTokens: mb.cacheReadTokens,
          cacheWriteTokens: mb.cacheCreationTokens,
          reasoningTokens,
          costUsd: mb.cost,
        };
        addBucket(entry.bucket, delta);
        if (mb.missingPricing) entry.missingPricing = true;

        let perDay = dayModels.get(date);
        if (!perDay) {
          perDay = new Map();
          dayModels.set(date, perDay);
        }
        let dayEntry = perDay.get(key);
        if (!dayEntry) {
          dayEntry = { platform, model: entry.model, role: entry.role, bucket: emptyBucket() };
          perDay.set(key, dayEntry);
        }
        addBucket(dayEntry.bucket, delta);
      }
    }
  }

  const platformSessions = new Map<ModelPlatform, number>();
  const roleSessions = new Map<ModelRole, number>();
  const daySessions = new Map<string, number>();
  let totalSessions = 0;

  for (const session of unified.session) {
    if (!isTargetPlatform(session.agent)) continue;
    const platform = session.agent;
    totalSessions += 1;
    platformSessions.set(platform, (platformSessions.get(platform) ?? 0) + 1);

    const rawNames =
      session.modelBreakdowns.length > 0
        ? session.modelBreakdowns.map((m) => m.modelName)
        : session.modelsUsed;
    const seenKeys = new Set<string>();
    const seenRoles = new Set<ModelRole>();
    for (const rawName of rawNames) {
      const { key, entry } = ensureModel(platform, rawName);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        entry.sessionCount += 1;
      }
      seenRoles.add(entry.role);
    }
    for (const role of seenRoles) {
      roleSessions.set(role, (roleSessions.get(role) ?? 0) + 1);
    }

    const lastActivity = session.metadata?.lastActivity;
    if (lastActivity) {
      const ts = Date.parse(lastActivity);
      if (Number.isFinite(ts)) {
        const date = formatDateInTimeZone(ts, timeZone);
        if (date >= since && date <= until) {
          daySessions.set(date, (daySessions.get(date) ?? 0) + 1);
        }
      }
    }
  }

  const grandBucket = emptyBucket();
  const platformBuckets = new Map<ModelPlatform, { bucket: MutableBucket; modelCount: number }>();
  const roleBuckets = new Map<ModelRole, MutableBucket>();
  for (const platform of PLATFORMS) platformBuckets.set(platform, { bucket: emptyBucket(), modelCount: 0 });
  for (const role of ROLES) roleBuckets.set(role, emptyBucket());

  for (const entry of modelEntries.values()) {
    addBucket(grandBucket, entry.bucket);
    const plat = platformBuckets.get(entry.platform)!;
    addBucket(plat.bucket, entry.bucket);
    plat.modelCount += 1;
    addBucket(roleBuckets.get(entry.role)!, entry.bucket);
  }

  const grandTotals = finalizeTotals(grandBucket, totalSessions);
  const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

  const platforms: PlatformUsageRow[] = PLATFORMS.map((platform) => {
    const plat = platformBuckets.get(platform)!;
    const totals = finalizeTotals(plat.bucket, platformSessions.get(platform) ?? 0);
    return {
      platform,
      ...totals,
      modelCount: plat.modelCount,
      tokenShare: share(totals.totalTokens, grandTotals.totalTokens),
      costShare: share(totals.costUsd, grandTotals.costUsd),
    };
  });

  const platformTokenTotals = new Map<ModelPlatform, number>(
    platforms.map((p) => [p.platform, p.totalTokens]),
  );

  const roles: RoleUsageRow[] = ROLES.map((role) => {
    const totals = finalizeTotals(roleBuckets.get(role)!, roleSessions.get(role) ?? 0);
    return {
      role,
      ...totals,
      tokenShare: share(totals.totalTokens, grandTotals.totalTokens),
      costShare: share(totals.costUsd, grandTotals.costUsd),
    };
  });

  const models: ModelUsageRow[] = [...modelEntries.values()]
    .map((entry) => {
      const totals = finalizeTotals(entry.bucket, entry.sessionCount);
      return {
        platform: entry.platform,
        model: entry.model,
        rawModels: [...entry.rawModels].sort(),
        unconfirmed: entry.unconfirmed,
        role: entry.role,
        missingPricing: entry.missingPricing,
        ...totals,
        tokenShare: share(totals.totalTokens, grandTotals.totalTokens),
        platformTokenShare: share(totals.totalTokens, platformTokenTotals.get(entry.platform) ?? 0),
        costShare: share(totals.costUsd, grandTotals.costUsd),
      };
    })
    .sort(
      (a, b) =>
        b.totalTokens - a.totalTokens ||
        a.platform.localeCompare(b.platform) ||
        a.model.localeCompare(b.model),
    );

  const allDates = new Set<string>([...dayModels.keys(), ...daySessions.keys()]);
  const daily: DailyUsageRow[] = [...allDates]
    .sort()
    .map((date) => {
      const dayBucket = emptyBucket();
      const entries = dayModels.get(date);
      const dayModelRows: DailyModelUsage[] = [];
      if (entries) {
        for (const item of entries.values()) {
          addBucket(dayBucket, item.bucket);
          const { sessionCount: _, ...modelTotals } = finalizeTotals(item.bucket, 0);
          dayModelRows.push({
            platform: item.platform,
            model: item.model,
            role: item.role,
            ...modelTotals,
          });
        }
        dayModelRows.sort(
          (a, b) =>
            b.totalTokens - a.totalTokens ||
            a.platform.localeCompare(b.platform) ||
            a.model.localeCompare(b.model),
        );
      }
      return {
        date,
        ...finalizeTotals(dayBucket, daySessions.get(date) ?? 0),
        models: dayModelRows,
      };
    });

  return {
    since,
    until,
    totals: grandTotals,
    platforms,
    roles,
    models,
    daily,
    limitations: [...MODEL_USAGE_LIMITATIONS],
  };
}

/** Read-only 30-day multi-platform token summary via ccusage, cached for 10 minutes. */
export class ModelUsageMonitor {
  private state: ModelUsageView = {
    status: "loading",
    refreshing: false,
    summary: null,
    lastSuccessAt: null,
    lastAttemptAt: null,
    error: null,
  };
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly runner: typeof run = run,
    private readonly now = Date.now,
    private readonly path = join(dataDir(), "model-usage.json"),
    private readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    private readonly roleConfig: ModelRoleConfig = DEFAULT_MODEL_ROLE_CONFIG,
  ) {}

  view(): ModelUsageView {
    return { ...this.state };
  }

  async start(): Promise<void> {
    try {
      const cached = CacheSchema.safeParse(await readJson(this.path));
      if (cached.success) {
        const age = this.now() - Date.parse(cached.data.fetchedAt);
        if (age >= 0 && age < REFRESH_MS) {
          this.state = {
            ...this.state,
            status: "ok",
            summary: cached.data.summary,
            lastSuccessAt: cached.data.fetchedAt,
            lastAttemptAt: cached.data.fetchedAt,
            error: null,
          };
          return;
        }
        this.state = {
          ...this.state,
          status: "stale",
          summary: cached.data.summary,
          lastSuccessAt: cached.data.fetchedAt,
        };
      }
    } catch (error) {
      this.log(error);
    }
    await this.refresh();
  }

  // Called by Service.tick() and Service.view(); 10-minute cache prevents running npx on each panel poll/refresh.
  refresh(manual = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const now = this.now();
    if (this.state.lastSuccessAt && now - Date.parse(this.state.lastSuccessAt) < REFRESH_MS) {
      return Promise.resolve();
    }
    if (
      this.state.lastAttemptAt &&
      now - Date.parse(this.state.lastAttemptAt) < (manual ? MANUAL_THROTTLE_MS : REFRESH_MS)
    ) {
      return Promise.resolve();
    }
    this.state = { ...this.state, refreshing: true, lastAttemptAt: new Date(now).toISOString() };
    this.inFlight = this.fetch().finally(() => {
      this.state = { ...this.state, refreshing: false };
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetch(): Promise<void> {
    let unavailable = false;
    try {
      const now = this.now();
      const since = formatDateInTimeZone(now - WINDOW_DAYS * 86_400_000, this.timeZone);
      const until = formatDateInTimeZone(now, this.timeZone);
      const runOpts = { timeoutMs: CCUSAGE_TIMEOUT_MS, maxOutputBytes: MAX_CCUSAGE_BYTES };

      const [unifiedRes, codexRes] = await Promise.all([
        this.runner(
          "npx",
          [
            "-y",
            CCUSAGE_PACKAGE,
            "--sections",
            "daily,session",
            "--by-agent",
            "--timezone",
            this.timeZone,
            "--json",
            "--since",
            since,
            "--until",
            until,
          ],
          runOpts,
        ),
        this.runner(
          "npx",
          [
            "-y",
            CCUSAGE_PACKAGE,
            "codex",
            "daily",
            "--timezone",
            this.timeZone,
            "--json",
            "--since",
            since,
            "--until",
            until,
          ],
          runOpts,
        ),
      ]);

      unavailable = unifiedRes.code === null && /ENOENT|not found|no such file/i.test(unifiedRes.stderr);
      if (unifiedRes.timedOut || unifiedRes.code !== 0) {
        throw new Error(
          unifiedRes.timedOut
            ? "Model usage summary timed out."
            : unifiedRes.stderr.trim().slice(0, 200) || "Model usage summary failed.",
        );
      }

      const unifiedJson: unknown = JSON.parse(unifiedRes.stdout);
      let codexJson: unknown = undefined;
      if (!codexRes.timedOut && codexRes.code === 0 && codexRes.stdout.trim()) {
        try {
          codexJson = JSON.parse(codexRes.stdout);
        } catch {
          // Optional Codex reasoning breakdown: keep unified token/cost totals if absent.
        }
      }

      const summary = aggregateModelUsage({
        unified: unifiedJson,
        codexDaily: codexJson,
        since,
        until,
        timeZone: this.timeZone,
        roleConfig: this.roleConfig,
      });
      const fetchedAt = new Date(this.now()).toISOString();
      await writeJsonAtomic(this.path, { version: 1, fetchedAt, summary });
      this.state = { ...this.state, status: "ok", summary, lastSuccessAt: fetchedAt, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = {
        ...this.state,
        status: this.state.lastSuccessAt ? "stale" : unavailable ? "unavailable" : "error",
        error: message.slice(0, 200),
      };
      this.log(message);
    }
  }

  private log(error: unknown): void {
    console.warn("[ZeroSub] Model usage", error instanceof Error ? error.message : error);
  }
}
