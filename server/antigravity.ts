import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AntigravityGroupSchema, type AntigravityView, type UsageWindow } from "../shared/model";
import { ProgressEmitter, spawnEnv, type EnvPatch, type FamilyAdapter, type Identity, type LoginHandle, type RedeemReply, type UsageRead } from "./adapter";
import { providerCommand } from "./binaries";
import { ANTIGRAVITY_AUTH_ENV } from "./families";
import { readJson, writeJsonAtomic } from "./json-file";
import { dataDir } from "./paths";
import { firstUrl, run, stripAnsi } from "./process";

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

const unsupported = "Isolated Antigravity accounts are supported on Linux.";
const signedOut = /please sign in|authentication required|not signed in/i;

/** Only consumer OAuth establishes a match; an enterprise identity can cover several organizations. */
export function antigravityEmail(raw: string): string | null {
  try {
    const auth = JSON.parse(raw) as { auth_method?: unknown; id_token_email?: unknown } | null;
    const email = typeof auth?.id_token_email === "string" ? auth.id_token_email.trim().toLowerCase() : "";
    return auth?.auth_method === "consumer" && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
  } catch {
    return null;
  }
}

async function signedInEmail(env: NodeJS.ProcessEnv): Promise<string | null> {
  if (ANTIGRAVITY_AUTH_ENV.some((key) => env[key])) return null;
  const configDir = join(env.HOME || homedir(), ".gemini", "antigravity-cli");
  const settings = await readJson(join(configDir, "settings.json")) as { auth?: { type?: unknown }; modelProvider?: unknown } | null | undefined;
  if (settings?.modelProvider || (settings?.auth?.type && settings.auth.type !== "oauth-personal")) return null;
  // Use agy's current store. An SSH login and the desktop login can belong to different accounts.
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) {
    return antigravityEmail(await readFile(join(configDir, "antigravity-oauth-token"), "utf8"));
  }
  const secret = await run("secret-tool", ["lookup", "service", "gemini", "username", "antigravity"], { env, timeoutMs: 3_000 });
  return secret.code === 0 ? antigravityEmail(secret.stdout) : null;
}

export function parseAntigravityWindows(output: string): UsageWindow[] {
  let body: unknown;
  try {
    body = JSON.parse(output);
  } catch {
    return [];
  }
  if (!body || typeof body !== "object" || !("response" in body) || typeof body.response !== "string") return [];
  const windows = new Map<string, UsageWindow>();
  for (const line of body.response.split("\n")) {
    const [group, period, remaining, reset] = line.trim().split("\t");
    if (!group || !/^(Weekly|Five Hour) Limit Remaining$/.test(period ?? "") || !/^\d{1,3}(?:\.\d+)?%$/.test(remaining ?? "")) continue;
    const left = Number(remaining!.slice(0, -1));
    if (left > 100) continue;
    const span = period === "Weekly Limit Remaining" ? "Weekly" : "5-hour";
    const key = group.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!key) continue;
    const id = `agy-${key}-${span.toLowerCase()}`;
    const resets = Date.parse(reset ?? "");
    windows.set(id, { id, label: `${span} · ${group}`, usedPercent: 100 - left, resetsAt: Number.isFinite(resets) ? new Date(resets).toISOString() : null });
  }
  return [...windows.values()];
}

export class AntigravityAdapter implements FamilyAdapter {
  readonly family = "antigravity" as const;
  readonly portable = false;
  readonly usageSpacingMs = 5 * 60_000;

  async env(home: string | null): Promise<EnvPatch> {
    if (!home) return {};
    if (process.platform !== "linux") throw new Error(unsupported);
    // Linux agy uses an account-specific token file in SSH mode instead of the shared desktop keyring.
    return { HOME: home, SSH_CONNECTION: "paseo", ...Object.fromEntries(ANTIGRAVITY_AUTH_ENV.map((key) => [key, ""])) };
  }

  async available(): Promise<{ ok: boolean; detail: string | null }> {
    if (process.platform !== "linux") return { ok: false, detail: unsupported };
    const { command } = await providerCommand(this.family);
    const result = await run(command, ["acp", "--help"], { timeoutMs: 10_000 }).catch(() => null);
    const ok = result?.code === 0 && /--login\b/.test(`${result.stdout}\n${result.stderr}`);
    return { ok, detail: ok ? null : "Install an agy version with ACP terminal sign-in (1.5 or later)." };
  }

  async prepareHome(home: string): Promise<void> {
    if (process.platform !== "linux") throw new Error(unsupported);
    await mkdir(home, { recursive: true, mode: 0o700 });
  }

  async identity(home: string | null): Promise<Identity> {
    const { command } = await providerCommand(this.family);
    const env = spawnEnv(await this.env(home), this.family);
    const result = await run(command, ["models"], { env, timeoutMs: 20_000 });
    if (result.code !== 0 && !signedOut.test(`${result.stdout}\n${result.stderr}`)) throw new Error("Antigravity could not check the sign-in.");
    const email = result.code === 0 ? await signedInEmail(env).catch(() => null) : null;
    return { signedIn: result.code === 0, email, plan: null, organization: null, identity: email && `antigravity|${email}` };
  }

  async usage(home: string | null): Promise<UsageRead> {
    const { command } = await providerCommand(this.family);
    const result = await run(command, ["-p", "/usage", "--output-format", "json"], {
      env: spawnEnv(await this.env(home), this.family), timeoutMs: 20_000,
    });
    const windows = result.code === 0 ? parseAntigravityWindows(result.stdout) : [];
    return {
      fetchedAt: new Date().toISOString(), windows, cached: false, resets: null,
      error: windows.length ? null : "Antigravity did not report usage. Check /usage inside agy.",
    };
  }

  async login(home: string | null): Promise<LoginHandle> {
    const { command } = await providerCommand(this.family);
    return new AntigravityLogin(command, spawnEnv(await this.env(home), this.family));
  }

  // Removing a managed home deletes its file-backed login with it.
  async logout(): Promise<void> {}

  async redeemReset(): Promise<RedeemReply> {
    return { outcome: "none", message: "Antigravity has no banked resets in ZeroSub.", left: null };
  }

  detectLimit(): null { return null; }
  detectSignOut(): null { return null; }
}

export class AntigravityLogin extends ProgressEmitter implements LoginHandle {
  readonly finished: Promise<{ ok: boolean; message: string | null }>;
  private readonly child;
  private ended = false;
  private submitted = false;

  constructor(command: string, env: NodeJS.ProcessEnv) {
    super();
    this.child = spawn(command, ["acp", "--login", "--disable-telemetry"], { env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const read = (chunk: string) => {
      output = (output + chunk).slice(-8192);
      const codeUrl = firstUrl(stripAnsi(output), /^https:\/\/accounts\.google\.com\//);
      if (codeUrl && codeUrl !== this.progress.codeUrl) this.update({ step: "waiting", codeUrl });
    };
    this.child.stdout.setEncoding("utf8").on("data", read);
    this.child.stderr.setEncoding("utf8").on("data", read);
    this.child.stdin.on("error", () => undefined);
    this.finished = new Promise((resolve) => {
      this.child.once("error", () => resolve({ ok: false, message: "Could not start Antigravity sign-in." }));
      this.child.once("close", (code) => {
        this.ended = true;
        resolve({ ok: code === 0, message: code === 0 ? null : "Antigravity sign-in did not finish. Start again for a fresh link." });
      });
    });
  }

  async submitCode(code: string): Promise<void> {
    if (this.ended || this.submitted || !this.progress.codeUrl) throw new Error("Start Antigravity sign-in again for a fresh link.");
    if (!code.trim() || /[\r\n]/.test(code)) throw new Error("Paste a single authorization code or redirect URL.");
    this.submitted = true;
    this.child.stdin.end(`${code.trim()}\n`);
  }

  cancel(): void {
    if (this.ended) return;
    this.child.kill("SIGTERM");
    setTimeout(() => {
      if (!this.ended) this.child.kill("SIGKILL");
    }, 3_000).unref();
  }
}
