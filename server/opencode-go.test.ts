import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeGoMonitor, parseOpenCodeGoUsage, readOpenCodeGoKey } from "./opencode-go";
import { Service } from "./service";
import { StateStore } from "./state";
import { StateViewSchema } from "../shared/model";

const secret = "fixture-private-credential";
const fixture = () => ({ usage: {
  rolling: { status: "ok", percent: 0, resetsAt: "2026-11-01T13:40:10.000Z" },
  weekly: { status: "ok", percent: 40, resetsAt: "2026-11-02T00:00:00.000Z" },
  monthly: { status: "ok", percent: 49, resetsAt: "2026-11-07T11:57:22.000Z" },
} });
let directory: string;
let path: string;
let now: number;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "zerosub-go-"));
  path = join(directory, "usage.json");
  now = Date.parse("2026-11-01T08:00:00Z");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
const response = () => new Response(JSON.stringify(fixture()));
function monitor(fetcher = vi.fn(async () => response()), keyReader = async (): Promise<string | null> => secret) {
  return new OpenCodeGoMonitor(fetcher, keyReader, () => now, path);
}

describe("OpenCode Go usage", () => {
  it("keeps percentages in used units, including zero and sub-one percentages", () => {
    const data = fixture();
    data.usage.rolling.percent = 0.5;
    const windows = parseOpenCodeGoUsage(data, now);
    expect(windows.map((w) => [w.label, w.usedPercent])).toEqual([["5-hour", 0.5], ["Weekly", 40], ["Monthly", 49]]);
    expect(windows[1]?.resetsAt).toBe(data.usage.weekly.resetsAt);
    expect(parseOpenCodeGoUsage(fixture(), now)[0]?.usedPercent).toBe(0);
  });

  it("parses reset_in_sec, prefers valid absolute resets, and leaves unknown resets unknown", () => {
    const data = { usage: {
      rolling: { percent: 10, reset_in_sec: 3600 },
      weekly: { percent: 40, resetsAt: "2026-11-02T00:00:00Z", reset_in_sec: 1 },
      monthly: { percent: 49, resetsAt: "invalid", reset_in_sec: -1 },
    } };
    expect(parseOpenCodeGoUsage(data, now).map((w) => w.resetsAt)).toEqual([
      "2026-11-01T09:00:00.000Z", "2026-11-02T00:00:00.000Z", null,
    ]);
    expect(() => parseOpenCodeGoUsage({ usage: {} })).toThrow();
    for (const percent of [-1, 101, NaN, "40", null]) {
      expect(() => parseOpenCodeGoUsage({ usage: { ...fixture().usage, rolling: { percent } } })).toThrow();
    }
  });

  it("uses the dedicated environment key before the file, and hides missing credentials", async () => {
    vi.stubEnv("HOME", directory);
    vi.stubEnv("OPENCODE_GO_API_KEY", "");
    vi.stubEnv("OPENCODE_API_KEY", "unused-legacy-key");
    expect(await readOpenCodeGoKey()).toBeNull();
    await mkdir(join(directory, ".config", "zerosub"), { recursive: true });
    await writeFile(join(directory, ".config", "zerosub", "opencode-go-key"), "file-credential\n", { mode: 0o600 });
    expect(await readOpenCodeGoKey()).toBe("file-credential");
    vi.stubEnv("OPENCODE_GO_API_KEY", " env-credential ");
    expect(await readOpenCodeGoKey()).toBe("env-credential");
    const fetcher = vi.fn(async () => response());
    const subject = monitor(fetcher, async () => null);
    await subject.start();
    expect(subject.view()).toMatchObject({ status: "unavailable", windows: [], lastSuccessAt: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("shares requests, throttles refreshes, and writes only normalized data", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const subject = monitor(fetcher);
    const first = subject.refresh();
    expect(subject.refresh(true)).toBe(first);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledWith("https://opencode.ai/zen/go/v1/usage", expect.objectContaining({
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" }, redirect: "error",
    }));
    finish(new Response(JSON.stringify({ ...fixture(), key: secret })));
    await first;
    const cached = await readFile(path, "utf8");
    expect(JSON.parse(cached)).toEqual({ fetchedAt: new Date(now).toISOString(), windows: subject.view().windows });
    expect(cached).not.toContain(secret);
    now += 14_999;
    await subject.refresh(true);
    expect(fetcher).toHaveBeenCalledOnce();
    now += 1;
    const second = subject.refresh(true);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    finish(response());
    await second;
    now += 599_999;
    await subject.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 1;
    const third = subject.refresh();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    finish(response());
    await third;
  });

  it("restores cached windows after failure, clears them when the key disappears", async () => {
    await monitor().refresh();
    const fetcher = vi.fn(async () => { throw new Error(secret); });
    const keyReader = vi.fn(async (): Promise<string | null> => secret);
    const subject = monitor(fetcher, keyReader);
    await subject.start();
    expect(subject.view()).toMatchObject({ status: "stale", windows: parseOpenCodeGoUsage(fixture(), now) });
    expect(JSON.stringify(subject.view())).not.toContain(secret);
    keyReader.mockResolvedValue(null);
    now += 15_000;
    await subject.refresh(true);
    expect(subject.view()).toMatchObject({ status: "unavailable", windows: [], lastSuccessAt: null });
  });

  it.each(["http", "network", "parse", "credentials"])("reports %s failures without leaking key in RPC, cache, or logs", async (kind) => {
    const logs = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn(async () => {
      if (kind === "network") throw new Error(secret);
      if (kind === "http") return new Response(secret, { status: 401 });
      return new Response(secret);
    });
    const subject = monitor(fetcher, async () => {
      if (kind === "credentials") throw new Error(secret);
      return secret;
    });
    await subject.refresh();
    expect(subject.view()).toMatchObject({ status: "error", windows: [], refreshing: false });
    const service = new Service({} as never, new StateStore(join(directory, "state.json")),
      { resolve: async () => ({}) } as never, { locate: async () => null } as never, undefined, subject);
    const paseo = { agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } }) } } as never;
    const state = await service.view(paseo, true);
    expect(StateViewSchema.parse(state).opencodeGo?.status).toBe("error");
    expect(state.accounts).toEqual([]);
    expect(JSON.stringify([state, logs.mock.calls, errors.mock.calls])).not.toContain(secret);
    await expect(readFile(path)).rejects.toHaveProperty("code", "ENOENT");
    await service.stop();
  });

  it("does not block other account views while the usage request hangs", async () => {
    const subject = monitor(vi.fn(() => new Promise<Response>(() => undefined)));
    const service = new Service({} as never, new StateStore(join(directory, "state.json")),
      { resolve: async () => ({}) } as never, { locate: async () => null } as never, undefined, subject);
    const paseo = { agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } }) } } as never;
    await expect(service.view(paseo, true)).resolves.toMatchObject({ accounts: [], opencodeGo: { refreshing: true } });
    await service.stop();
  });
});
