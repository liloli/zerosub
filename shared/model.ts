import { z } from "zod";

/** The two subscription families this plugin manages. Custom provider profiles map onto one of them. */
export const FamilySchema = z.enum(["claude", "codex"]);
export type Family = z.infer<typeof FamilySchema>;

export const FAMILY_LABEL: Record<Family, string> = {
  claude: "Claude",
  codex: "ChatGPT",
};

export const UsageWindowSchema = z.object({
  /** Stable key, e.g. `five_hour`, `seven_day`, `seven_day_opus`, `primary`, `secondary`. */
  id: z.string(),
  label: z.string(),
  /** 0–100. */
  usedPercent: z.number(),
  resetsAt: z.string().nullable(),
  /** How long the window is, in minutes. Only Codex readings have it; `null` when Codex doesn't say. */
  minutes: z.number().nullable().optional(),
});
export type UsageWindow = z.infer<typeof UsageWindowSchema>;

/** Banked limit resets the provider has granted this account (Claude "limit reset", Codex reset credits). */
export const ResetOfferSchema = z.object({
  /** Resets left to use. */
  available: z.number(),
  grants: z.array(z.object({ label: z.string(), available: z.number(), expiresAt: z.string().nullable() })).optional(),
  /** The provider will accept a redeem right now. */
  usableNow: z.boolean(),
  /** Why it can't be used yet, in plain words, when it can't. */
  blockedReason: z.string().nullable(),
  /** Use-by date of the next reset, if it expires. */
  expiresAt: z.string().nullable(),
  /** Which limits a reset refills, e.g. "5-hour", "weekly". Empty when the provider doesn't say. */
  refills: z.array(z.string()),
  /** The provider's own name for the reset, if it gives one. */
  label: z.string().nullable(),
});
export type ResetOffer = z.infer<typeof ResetOfferSchema>;

/** Prepaid credits that keep an account going once its windows run out (ChatGPT credits for Codex). */
export const CreditsSchema = z.object({
  /** Credits left; `null` when the provider doesn't say how many. */
  balance: z.number().nullable(),
  unlimited: z.boolean(),
});
export type Credits = z.infer<typeof CreditsSchema>;

export const UsageSchema = z.object({
  fetchedAt: z.string(),
  windows: z.array(UsageWindowSchema),
  /** Why usage could not be read, if it could not. Old windows may still be shown. */
  error: z.string().nullable(),
  /** Read from the CLI's own cache rather than the provider, so possibly out of date. */
  cached: z.boolean().default(false),
  /** Banked resets, when the provider reports any. */
  resets: ResetOfferSchema.nullable().default(null),
  /** Credits the account can spend past full windows, when the provider reports any. */
  credits: CreditsSchema.nullable().default(null),
});
export type Usage = z.infer<typeof UsageSchema>;

export const AccountKindSchema = z.enum([
  /** The login the CLI uses on its own (`~/.claude`, `~/.codex`). */
  "main",
  /** Created by this plugin: an isolated credential home that shares everything else with main. */
  "managed",
]);
export type AccountKind = z.infer<typeof AccountKindSchema>;

/** `disabled`: the user set it aside for a while; it stays signed in but nothing is routed to it. */
export const AccountStatusSchema = z.enum(["ready", "signed_out", "limited", "checking", "disabled"]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const AccountViewSchema = z.object({
  id: z.string(),
  family: FamilySchema,
  label: z.string(),
  kind: AccountKindSchema,
  email: z.string().nullable(),
  plan: z.string().nullable(),
  organization: z.string().nullable(),
  status: AccountStatusSchema,
  isDefault: z.boolean(),
  limitedUntil: z.string().nullable(),
  usage: UsageSchema.nullable(),
  agentCount: z.number(),
  home: z.string().nullable(),
});
export type AccountView = z.infer<typeof AccountViewSchema>;

export const AgentRouteSchema = z.object({
  agentId: z.string(),
  family: FamilySchema,
  /** Account the agent uses now, or will use when its session next opens. */
  accountId: z.string(),
  /** Chosen for this agent explicitly (by the user or an automatic switch) rather than following the default. */
  pinned: z.boolean(),
  /** The live session still runs on a different account and is waiting to be reopened. */
  pendingAccountId: z.string().nullable(),
  /**
   * The conversation can move to another account in place. False for Codex agents that already
   * have history: ChatGPT accounts can't read each other's encrypted reasoning, so switching
   * continues the work in a new agent instead.
   */
  movable: z.boolean(),
  /** The agent started on this account because its weekly reset was near, and is still on it. */
  selectionReason: z.literal("weekly_reset").optional(),
});
export type AgentRoute = z.infer<typeof AgentRouteSchema>;

export const LoginStepSchema = z.enum([
  "starting",
  /** Waiting for the user to finish on the sign-in page (and paste a code, if using `codeUrl`). */
  "waiting",
  "verifying",
  "done",
  "failed",
  "canceled",
]);
export type LoginStep = z.infer<typeof LoginStepSchema>;

export const LoginMethodSchema = z.enum([
  /** Finishes by itself when the link is opened on the daemon machine. */
  "browser",
  /** Works from any device: paste a code back (Claude) or type a code on the page (ChatGPT). */
  "code",
]);
export type LoginMethod = z.infer<typeof LoginMethodSchema>;

export const LoginViewSchema = z.object({
  id: z.string(),
  family: FamilySchema,
  method: LoginMethodSchema,
  /** Set once the account exists (immediately when signing an existing account back in). */
  accountId: z.string().nullable(),
  step: LoginStepSchema,
  /** Link that completes by itself (browser callback) or the device-code page. */
  url: z.string().nullable(),
  /** Link whose page shows a code to paste back; works from any device. */
  codeUrl: z.string().nullable(),
  /** Device code the user types on the sign-in page (ChatGPT device flow). */
  userCode: z.string().nullable(),
  message: z.string().nullable(),
  startedAt: z.string(),
});
export type LoginView = z.infer<typeof LoginViewSchema>;

export const AntigravityGroupSchema = z.object({
  name: z.string(),
  buckets: z.array(z.object({
    id: z.string(), label: z.string(), window: z.string(),
    remainingPercent: z.number().min(0).max(100).nullable(),
    resetsAt: z.string().nullable(),
  })),
});
export const AntigravityViewSchema = z.object({
  status: z.enum(["loading", "ok", "stale", "error", "unavailable"]),
  refreshing: z.boolean(),
  groups: z.array(AntigravityGroupSchema),
  lastSuccessAt: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type AntigravityView = z.infer<typeof AntigravityViewSchema>;

export const OpenCodeGoViewSchema = AntigravityViewSchema.omit({ groups: true }).extend({
  windows: z.array(UsageWindowSchema),
});
export type OpenCodeGoView = z.infer<typeof OpenCodeGoViewSchema>;

export const ModelPlatformSchema = z.enum(["claude", "codex", "opencode", "antigravity"]);
export type ModelPlatform = z.infer<typeof ModelPlatformSchema>;

export const ModelRoleSchema = z.enum(["commander", "coder", "grunt", "scout", "reviewer", "other"]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const TokenTotalsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  reasoningTokens: z.number(),
  totalTokens: z.number(),
  costUsd: z.number(),
  cacheHitRate: z.number().min(0).max(1).nullable(),
  sessionCount: z.number(),
});
export type TokenTotals = z.infer<typeof TokenTotalsSchema>;

export const ModelUsageRowSchema = TokenTotalsSchema.extend({
  platform: ModelPlatformSchema,
  model: z.string(),
  rawModels: z.array(z.string()),
  unconfirmed: z.boolean(),
  role: ModelRoleSchema,
  missingPricing: z.boolean(),
  tokenShare: z.number(),
  platformTokenShare: z.number(),
  costShare: z.number(),
});
export type ModelUsageRow = z.infer<typeof ModelUsageRowSchema>;

export const PlatformUsageRowSchema = TokenTotalsSchema.extend({
  platform: ModelPlatformSchema,
  modelCount: z.number(),
  tokenShare: z.number(),
  costShare: z.number(),
});
export type PlatformUsageRow = z.infer<typeof PlatformUsageRowSchema>;

export const RoleUsageRowSchema = TokenTotalsSchema.extend({
  role: ModelRoleSchema,
  tokenShare: z.number(),
  costShare: z.number(),
});
export type RoleUsageRow = z.infer<typeof RoleUsageRowSchema>;

export const DailyModelUsageSchema = TokenTotalsSchema.omit({ sessionCount: true }).extend({
  platform: ModelPlatformSchema,
  model: z.string(),
  role: ModelRoleSchema,
});
export type DailyModelUsage = z.infer<typeof DailyModelUsageSchema>;

export const DailyUsageRowSchema = TokenTotalsSchema.extend({
  date: z.string(),
  models: z.array(DailyModelUsageSchema),
});
export type DailyUsageRow = z.infer<typeof DailyUsageRowSchema>;

export const ModelUsageSummarySchema = z.object({
  since: z.string(),
  until: z.string(),
  totals: TokenTotalsSchema,
  platforms: z.array(PlatformUsageRowSchema),
  roles: z.array(RoleUsageRowSchema),
  models: z.array(ModelUsageRowSchema),
  daily: z.array(DailyUsageRowSchema),
  limitations: z.array(z.string()),
});
export type ModelUsageSummary = z.infer<typeof ModelUsageSummarySchema>;

export const ModelUsageViewSchema = AntigravityViewSchema.omit({ groups: true }).extend({
  summary: ModelUsageSummarySchema.nullable(),
});
export type ModelUsageView = z.infer<typeof ModelUsageViewSchema>;

export const StateViewSchema = z.object({
  antigravity: AntigravityViewSchema.optional(),
  opencodeGo: OpenCodeGoViewSchema.optional(),
  modelUsage: ModelUsageViewSchema.optional(),
  accounts: z.array(AccountViewSchema),
  agents: z.array(AgentRouteSchema),
  logins: z.array(LoginViewSchema),
  /** Paseo provider IDs (including custom profiles) that route through each family. */
  providers: z.record(z.string(), FamilySchema),
  /** Live sessions can be reopened on another account without waiting for the next session start. */
  canReopen: z.boolean(),
  /**
   * A browser on the daemon's machine can finish a sign-in by itself. False on servers, containers
   * and daemons started over SSH, where only the code sign-in works.
   */
  browserSignIn: z.boolean().default(true),
  showComposerPill: z.boolean(),
  warnings: z.array(z.string()),
});
export type StateView = z.infer<typeof StateViewSchema>;
