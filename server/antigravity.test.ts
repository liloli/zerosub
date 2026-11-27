import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginHookContext } from "@getpaseo/plugin/server";
import { StateViewSchema } from "../shared/model";
import { AntigravityAdapter, AntigravityLogin, AntigravityMonitor, antigravityEmail, parseAntigravityUsage, parseAntigravityWindows } from "./antigravity";
import type { RunResult } from "./process";
import { Service } from "./service";
import { StateStore } from "./state";
import { FamilyResolver, familiesFromConfig } from "./families";
import { Reopener } from "./reopen";

vi.mock("./binaries", () => ({ providerCommand: vi.fn(async () => ({ command: "fake-agy", prefix: ["wrapper"] })) }));
const bucket = (id: string, window: string, fraction: unknown) => ({
  id, name: `${window} Limit Remaining`, description: "The limit will refresh soon.",
  window, remaining_fraction: fraction, reset_time: "2026-11-05T10:14:44Z",
});
const fixture = () => ({
  conversation_id: "", status: "SUCCESS", response: "Gemini Models\tWeekly Limit Remaining\t98%",
  duration_seconds: 0, num_turns: 0,
  usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
  command: { name: "usage", data: { description: "Models share weekly and five-hour limits.", groups: [
    { name: "Gemini Models", description: "Gemini Flash, Gemini Pro", buckets: [bucket("gemini-weekly", "weekly", 0.9803651571273804), bucket("gemini-5h", "5h", 0.9688877463340759)] },
    { name: "Claude and GPT models", description: "Claude Opus, Claude Sonnet, GPT-OSS", buckets: [bucket("3p-weekly", "weekly", 0.03831920027732849), bucket("3p-5h", "5h", 0.87)] },
    { name: "Gemini 4 Argon", description: "Argon", buckets: [bucket("gemini-argon-wtu-weekly", "weekly", 0.68)] },
  ] } },
});
const success = (): RunResult => ({ code: 0, stdout: JSON.stringify(fixture()), stderr: "", timedOut: false });
let directory: string;
let path: string;
let now: number;
const monitors: AntigravityMonitor[] = [];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "zerosub-antigravity-"));
  path = join(directory, "antigravity-usage.json");
  now = Date.parse("2026-10-31T12:00:00Z");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(async () => {
  monitors.splice(0).forEach((monitor) => monitor.stop());
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
function monitor(runner = vi.fn(async () => success())) {
  const subject = new AntigravityMonitor(runner, () => now, path);
  monitors.push(subject);
  return subject;
}

describe("Antigravity parser", () => {
  it("keeps the real groups, bucket order and window labels", () => {
    const groups = parseAntigravityUsage(success().stdout);
    expect(groups.map((group) => group.name)).toEqual(["Gemini Models", "Claude and GPT models", "Gemini 4 Argon"]);
    expect(groups.flatMap((group) => group.buckets.map((b) => b.remainingPercent))).toEqual([98, 97, 4, 87, 68]);
    expect(groups.flatMap((group) => group.buckets.map((b) => b.label))).toEqual(["Weekly", "Five Hour", "Weekly", "Five Hour", "Weekly"]);
  });
  it("rejects signed-out, missing data and invalid JSON", () => {
    expect(() => parseAntigravityUsage(JSON.stringify({ status: "ERROR", response: "  Please sign in.  " }))).toThrow("Please sign in.");
    expect(() => parseAntigravityUsage('{"status":"SUCCESS"}')).toThrow("unavailable");
    expect(() => parseAntigravityUsage("not JSON")).toThrow();
    expect(() => parseAntigravityUsage("null")).toThrow("unavailable");
    expect(() => parseAntigravityUsage(JSON.stringify({ response: "x".repeat(300) }))).toThrow("x".repeat(200));
  });
  it("keeps invalid percentages unknown, zero real, and unknown windows separate", () => {
    const raw = fixture();
    raw.command.data.groups = [{ name: "New group", description: "New", buckets: [undefined, NaN, -1, 2, "0.5", 0].map((value, i) => ({ ...bucket(`bucket-${i}`, "daily", value), reset_time: "bad" })) }];
    const parsed = parseAntigravityUsage(JSON.stringify(raw))[0]!;
    expect(parsed.buckets.map((b) => b.remainingPercent)).toEqual([null, null, null, null, null, 0]);
    expect(parsed.buckets.every((b) => b.label === "daily Limit Remaining" && b.window === "daily" && b.resetsAt === null)).toBe(true);
  });
});

describe("Antigravity monitor", () => {
  it("shares one in-flight command and writes only the normalized cache", async () => {
    let finish!: (value: RunResult) => void;
    const runner = vi.fn(() => new Promise<RunResult>((resolve) => { finish = resolve; }));
    const subject = monitor(runner);
    const first = subject.refresh();
    expect(subject.refresh(true)).toBe(first);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
    expect(runner).toHaveBeenCalledWith("fake-agy", ["wrapper", "-p", "/usage", "--output-format", "json"], { timeoutMs: 30_000 });
    finish(success());
    await first;
    expect(subject.view()).toMatchObject({ status: "ok", refreshing: false, error: null });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, fetchedAt: new Date(now).toISOString(), groups: subject.view().groups });
  });
  it("throttles manual attempts for fifteen seconds", async () => {
    const runner = vi.fn(async () => success());
    const subject = monitor(runner);
    await subject.refresh(true);
    now += 14_999;
    await subject.refresh(true);
    expect(runner).toHaveBeenCalledTimes(1);
    now += 1;
    await subject.refresh(true);
    expect(runner).toHaveBeenCalledTimes(2);
  });
  it("preserves the last success after a failed refresh", async () => {
    const runner = vi.fn(async () => success());
    const subject = monitor(runner);
    await subject.refresh();
    const previous = subject.view();
    runner.mockRejectedValueOnce(new Error("Offline"));
    await subject.refresh();
    expect(subject.view()).toMatchObject({ status: "stale", groups: previous.groups, lastSuccessAt: previous.lastSuccessAt, error: "Offline" });
  });
  it.each([
    [{ code: null, stdout: "", stderr: "spawn agy ENOENT", timedOut: false }, "unavailable"],
    [{ code: null, stdout: "", stderr: "", timedOut: true }, "error"],
    [{ code: 0, stdout: '{"status":"ERROR","response":"Please sign in."}', stderr: "", timedOut: false }, "error"],
  ] as const)("reflects command failure without throwing", async (result, status) => {
    const subject = monitor(vi.fn(async () => result));
    await subject.refresh();
    expect(subject.view()).toMatchObject({ status, groups: [], refreshing: false });
  });
  it("loads cached data before a hanging first refresh", async () => {
    const groups = parseAntigravityUsage(success().stdout);
    await writeFile(path, JSON.stringify({ version: 1, fetchedAt: new Date(now).toISOString(), groups }));
    const subject = monitor(vi.fn(() => new Promise<RunResult>(() => undefined)));
    await subject.start();
    expect(subject.view()).toMatchObject({ status: "stale", groups, refreshing: true });
  });
  it("refreshes every ten minutes and clears its timer on stop", async () => {
    const runner = vi.fn(async () => success());
    const subject = monitor(runner);
    await subject.start();
    await subject.refresh();
    vi.useFakeTimers();
    subject.stop();
    await subject.start();
    await subject.refresh();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await subject.refresh();
    expect(runner).toHaveBeenCalledTimes(3);
    subject.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runner).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
  it.each(["reject", "hang"])("does not block service views when the runner will %s", async (mode) => {
    const subject = monitor(vi.fn(() => mode === "reject" ? Promise.reject(new Error("Offline")) : new Promise<RunResult>(() => undefined)));
    const service = new Service({} as never, new StateStore(join(directory, "service-state.json")),
      { resolve: async () => ({}) } as unknown as FamilyResolver,
      { locate: async () => null } as unknown as Reopener, undefined, undefined, subject);
    const paseo = { agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } }) } } as unknown as PluginHookContext["paseo"];
    await expect(service.view(paseo, true)).resolves.toHaveProperty("antigravity");
    await expect(service.view(paseo)).resolves.toHaveProperty("accounts", []);
    await service.stop();
  });

  it("returns the existing grouped CLI quota contract in zerosub.state v1", async () => {
    const subject = monitor();
    await subject.refresh();
    const service = new Service({} as never, new StateStore(join(directory, "service-state.json")),
      { resolve: async () => ({}) } as unknown as FamilyResolver,
      { locate: async () => null } as unknown as Reopener, undefined, undefined, subject);
    const paseo = { agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } }) } } as unknown as PluginHookContext["paseo"];
    try {
      const state = StateViewSchema.parse(await service.view(paseo));
      expect(state.version).toBe(1);
      const expectedBucket = (id: string, label: string, window: string, remainingPercent: number) => ({
        id, label, window, remainingPercent, resetsAt: "2026-11-05T10:14:44Z",
      });
      expect(state.antigravity).toStrictEqual({
        status: "ok", refreshing: false, lastSuccessAt: new Date(now).toISOString(),
        lastAttemptAt: new Date(now).toISOString(), error: null,
        groups: [
          { name: "Gemini Models", buckets: [expectedBucket("gemini-weekly", "Weekly", "weekly", 98), expectedBucket("gemini-5h", "Five Hour", "5h", 97)] },
          { name: "Claude and GPT models", buckets: [expectedBucket("3p-weekly", "Weekly", "weekly", 4), expectedBucket("3p-5h", "Five Hour", "5h", 87)] },
          { name: "Gemini 4 Argon", buckets: [expectedBucket("gemini-argon-wtu-weekly", "Weekly", "weekly", 68)] },
        ],
      });
    } finally {
      await service.stop();
    }
  });
});

describe("Antigravity accounts", () => {
  it("routes the built-in provider and leaves independently configured homes and keys alone", () => {
    expect(familiesFromConfig({}).antigravity).toBe("antigravity");
    const families = familiesFromConfig({
      work: { extends: "antigravity" },
      separate: { extends: "antigravity", command: ["agy", "acp", "--gemini-dir", "/other"] },
      key: { extends: "antigravity", env: { GEMINI_API_KEY: "fixture" } },
    });
    expect(families).toMatchObject({ antigravity: "antigravity", work: "antigravity" });
    expect(families).not.toHaveProperty("separate");
    expect(families).not.toHaveProperty("key");
    expect(familiesFromConfig({ antigravity: { env: { HOME: "/other" } } }).antigravity).toBeUndefined();
    expect(familiesFromConfig({ antigravity: { command: ["agy", "acp", "--app-data-dir=/other"] } }).antigravity).toBeUndefined();
  });

  it.skipIf(process.platform !== "linux")("keeps the CLI environment and isolates the added sign-in", async () => {
    const adapter = new AntigravityAdapter();
    expect(await adapter.env(null)).toEqual({});
    expect(await adapter.env("/isolated")).toMatchObject({
      HOME: "/isolated", SSH_CONNECTION: "paseo", GEMINI_API_KEY: "", GOOGLE_APPLICATION_CREDENTIALS: "",
    });
  });

  it.skipIf(process.platform !== "linux")("passes the pasted code to the official login process", async () => {
    const home = await mkdtemp(join(tmpdir(), "zerosub-agy-login-"));
    const command = join(home, "agy");
    await writeFile(command, '#!/bin/sh\nprintf "https://accounts.google.com/sign-in\\n"\nread -r code\n[ "$code" = "test-code" ]\n', { mode: 0o700 });
    const login = new AntigravityLogin(command, { ...process.env, HOME: home });
    try {
      await vi.waitFor(() => expect(login.progress).toMatchObject({ step: "waiting", codeUrl: "https://accounts.google.com/sign-in" }));
      await expect(login.submitCode("first\nsecond")).rejects.toThrow("single authorization code");
      await login.submitCode("test-code");
      await expect(login.finished).resolves.toMatchObject({ ok: true });
    } finally {
      login.cancel();
      await login.finished;
      await rm(home, { recursive: true });
    }
  });

  it("matches personal Google identities without retaining credential fields", () => {
    expect(antigravityEmail('{"auth_method":"consumer","id_token_email":" Example@Google.com ","token":{}}')).toBe("example@google.com");
    expect(antigravityEmail('{"auth_method":"enterprise","id_token_email":"example@google.com"}')).toBeNull();
    expect(antigravityEmail('{"auth_method":"consumer","id_token_email":"invalid"}')).toBeNull();
    expect(antigravityEmail("malformed JSON")).toBeNull();
  });

  it("shows quota buckets as usage and ignores disabled and malformed windows", () => {
    expect(parseAntigravityWindows(JSON.stringify({ response: [
      "Gemini Models\tWeekly Limit Remaining\t25%\t2026-11-30T19:58:00Z",
      "Claude and GPT models\tFive Hour Limit Remaining\t99.5%\t",
      "Gemini Models\tFive Hour Limit Remaining\tdisabled\t",
      "invalid",
      "Other\tWeekly Limit Remaining\t101%",
    ].join("\n") }))).toEqual([
      { id: "agy-gemini-models-weekly", label: "Weekly · Gemini Models", usedPercent: 75, resetsAt: "2026-11-30T19:58:00.000Z" },
      { id: "agy-claude-and-gpt-models-5-hour", label: "5-hour · Claude and GPT models", usedPercent: 0.5, resetsAt: null },
    ]);
    expect(parseAntigravityWindows("<error>")).toEqual([]);
  });
});
