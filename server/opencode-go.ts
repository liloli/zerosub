import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { OpenCodeGoViewSchema, type OpenCodeGoView } from "../shared/model";
import { readJson, writeJsonAtomic } from "./json-file";
import { dataDir } from "./paths";

const REFRESH_MS = 10 * 60_000;
const MANUAL_THROTTLE_MS = 15_000;
const WindowSchema = z.object({
  percent: z.number().finite().min(0).max(100),
  resetsAt: z.unknown().optional(),
  reset_in_sec: z.unknown().optional(),
});
const PayloadSchema = z.object({ usage: z.object({
  rolling: WindowSchema, weekly: WindowSchema, monthly: WindowSchema,
}) });
const CacheSchema = z.object({
  fetchedAt: z.string().datetime(), windows: OpenCodeGoViewSchema.shape.windows,
});

export async function readOpenCodeGoKey(): Promise<string | null> {
  const env = process.env.OPENCODE_GO_API_KEY?.trim();
  if (env) return env;
  try {
    return (await readFile(join(homedir(), ".config", "zerosub", "opencode-go-key"), "utf8")).trim() || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Could not read OpenCode Go credentials.");
  }
}

export function parseOpenCodeGoUsage(payload: unknown, now = Date.now()): OpenCodeGoView["windows"] {
  const { usage } = PayloadSchema.parse(payload);
  return ([ ["rolling", "5-hour"], ["weekly", "Weekly"], ["monthly", "Monthly"] ] as const).map(([id, label]) => {
    const window = usage[id];
    const absolute = typeof window.resetsAt === "string" ? Date.parse(window.resetsAt) : NaN;
    const relative = typeof window.reset_in_sec === "number" && Number.isFinite(window.reset_in_sec) && window.reset_in_sec >= 0
      ? now + window.reset_in_sec * 1000 : NaN;
    const reset = new Date(Number.isFinite(absolute) ? absolute : relative);
    return { id, label, usedPercent: window.percent, resetsAt: Number.isFinite(reset.getTime()) ? reset.toISOString() : null };
  });
}

/** Read-only subscription display; never participates in account routing. */
export class OpenCodeGoMonitor {
  private state: OpenCodeGoView = {
    status: "unavailable", refreshing: false, windows: [], lastSuccessAt: null, lastAttemptAt: null, error: null,
  };
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly keyReader = readOpenCodeGoKey,
    private readonly now = Date.now,
    private readonly path = join(dataDir(), "opencode-go-usage.json"),
  ) {}

  view(): OpenCodeGoView { return { ...this.state }; }

  async start(): Promise<void> {
    try {
      const cached = CacheSchema.safeParse(await readJson(this.path));
      if (cached.success) this.state = { ...this.state, windows: cached.data.windows, lastSuccessAt: cached.data.fetchedAt };
    } catch { /* A failed cache read must not prevent a fresh request. */ }
    await this.refresh();
  }

  // Called by the service's existing upkeep timer; no additional poller.
  refresh(manual = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const now = this.now();
    if (this.state.lastAttemptAt && now - Date.parse(this.state.lastAttemptAt) < (manual ? MANUAL_THROTTLE_MS : REFRESH_MS)) return Promise.resolve();
    this.state = { ...this.state, refreshing: true, lastAttemptAt: new Date(now).toISOString() };
    this.inFlight = this.fetch().finally(() => {
      this.state = { ...this.state, refreshing: false };
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetch(): Promise<void> {
    let message = "OpenCode Go usage is unavailable.";
    try {
      const key = await this.keyReader();
      if (!key) {
        this.state = { ...this.state, status: "unavailable", windows: [], lastSuccessAt: null, error: null };
        return;
      }
      this.state = { ...this.state, status: this.state.lastSuccessAt ? "stale" : "loading" };
      const response = await this.fetcher("https://opencode.ai/zen/go/v1/usage", {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000), redirect: "error",
      });
      if (!response.ok) {
        message = `OpenCode Go usage failed (HTTP ${response.status}).`;
        throw new Error(message);
      }
      const windows = parseOpenCodeGoUsage(await response.json(), this.now());
      const fetchedAt = new Date(this.now()).toISOString();
      await writeJsonAtomic(this.path, { fetchedAt, windows });
      this.state = { ...this.state, status: "ok", windows, lastSuccessAt: fetchedAt, error: null };
    } catch {
      // Never expose exception text or response bodies: either can contain credentials.
      this.state = { ...this.state, status: this.state.lastSuccessAt ? "stale" : "error", error: message };
    }
  }
}
