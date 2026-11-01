import { join } from "node:path";
import { z } from "zod";
import { AntigravityGroupSchema, type AntigravityView } from "../shared/model";
import { providerCommand } from "./binaries";
import { readJson, writeJsonAtomic } from "./json-file";
import { dataDir } from "./paths";
import { run } from "./process";

const REFRESH_MS = 10 * 60_000;
const MANUAL_THROTTLE_MS = 15_000;
const GroupsSchema = z.array(z.object({
  name: z.string(),
  buckets: z.array(z.object({
    id: z.string(), name: z.string(), window: z.string(),
    remaining_fraction: z.unknown().optional(), reset_time: z.unknown().optional(),
  })),
}));

export function parseAntigravityUsage(stdout: string): AntigravityView["groups"] {
  const raw = JSON.parse(stdout);
  const parsed = GroupsSchema.safeParse(raw?.command?.data?.groups);
  if (raw?.status !== "SUCCESS" || !parsed.success) {
    throw new Error(typeof raw?.response === "string" && raw.response.trim()
      ? raw.response.trim().slice(0, 200) : "Antigravity usage is unavailable.");
  }
  return parsed.data.map((group) => ({
    name: group.name,
    buckets: group.buckets.map((bucket) => ({
      id: bucket.id,
      label: bucket.window === "weekly" ? "Weekly" : bucket.window === "5h" ? "Five Hour" : bucket.name,
      window: bucket.window,
      remainingPercent: typeof bucket.remaining_fraction === "number" && Number.isFinite(bucket.remaining_fraction)
        && bucket.remaining_fraction >= 0 && bucket.remaining_fraction <= 1
        ? Math.round(bucket.remaining_fraction * 100) : null,
      resetsAt: typeof bucket.reset_time === "string" && Number.isFinite(Date.parse(bucket.reset_time))
        ? bucket.reset_time : null,
    })),
  }));
}

const CacheSchema = z.object({ version: z.literal(1), fetchedAt: z.string().refine((s) => Number.isFinite(Date.parse(s))), groups: z.array(AntigravityGroupSchema) });

export class AntigravityMonitor {
  private state: AntigravityView = {
    status: "loading", refreshing: false, groups: [], lastSuccessAt: null, lastAttemptAt: null, error: null,
  };
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly runner: typeof run = run,
    private readonly now = Date.now,
    private readonly path = join(dataDir(), "antigravity-usage.json"),
  ) {}

  view(): AntigravityView { return { ...this.state }; }

  async start(): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
    try {
      const cached = CacheSchema.safeParse(await readJson(this.path));
      if (cached.success && !this.state.lastSuccessAt) {
        this.state = { ...this.state, status: "stale", groups: cached.data.groups, lastSuccessAt: cached.data.fetchedAt };
      }
    } catch (error) { this.log(error); }
    if (this.timer) void this.refresh();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  refresh(manual = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const now = this.now();
    if (manual && this.state.lastAttemptAt && now - Date.parse(this.state.lastAttemptAt) < MANUAL_THROTTLE_MS) return Promise.resolve();
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
      const cli = await providerCommand("antigravity");
      const result = await this.runner(cli.command, [...cli.prefix, "-p", "/usage", "--output-format", "json"], { timeoutMs: 30_000 });
      unavailable = result.code === null && /ENOENT|not found|no such file/i.test(result.stderr);
      if (result.timedOut || result.code !== 0) {
        throw new Error(result.timedOut ? "Antigravity usage timed out." : result.stderr.trim().slice(0, 200) || "Antigravity usage failed.");
      }
      const groups = parseAntigravityUsage(result.stdout);
      const fetchedAt = new Date(this.now()).toISOString();
      await writeJsonAtomic(this.path, { version: 1, fetchedAt, groups });
      this.state = { ...this.state, status: "ok", groups, lastSuccessAt: fetchedAt, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = { ...this.state, status: this.state.lastSuccessAt ? "stale" : unavailable ? "unavailable" : "error", error: message.slice(0, 200) };
      this.log(message);
    }
  }

  private log(error: unknown): void { console.warn("[ZeroSub] Antigravity usage", error instanceof Error ? error.message : error); }
}
