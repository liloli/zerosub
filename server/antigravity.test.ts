import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginHookContext } from "@getpaseo/plugin/server";
import { AntigravityMonitor, parseAntigravityUsage } from "./antigravity";
import type { RunResult } from "./process";
import { Service } from "./service";
import { StateStore } from "./state";
import { FamilyResolver } from "./families";
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
      { locate: async () => null } as unknown as Reopener, subject);
    const paseo = { agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } }) } } as unknown as PluginHookContext["paseo"];
    await expect(service.view(paseo, true)).resolves.toHaveProperty("antigravity");
    await expect(service.view(paseo)).resolves.toHaveProperty("accounts", []);
    await service.stop();
  });
});
