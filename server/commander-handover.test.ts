import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Service } from "./service";

let root: string;
let previousHome: string | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zerosub-handover-"));
  previousHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = root;
});
afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
});

async function configure(config: unknown = { command: "/bin/true", models: { claude: "c-model", codex: "x-model" }, titlePrefix: "[next] " }) {
  await mkdir(join(root, "zerosub"), { recursive: true });
  await writeFile(join(root, "zerosub", "commander-handover.json"), JSON.stringify(config));
}

const agentWith = (agent: object) => ({ agents: { ref: () => ({ refresh: async () => ({ agent }) }) } });

// Exercise routing without starting a real commander from the test process.
describe("commander routing", () => {
  for (const family of ["codex", "claude"]) for (const role of ["commander", "control"]) {
    it(`${family} ${role} bypasses account-tab create/send`, async () => {
      await configure();
      const bridge = vi.fn(async () => ({ agentId: "verified", title: "continued" }));
      const chain = vi.fn(() => { throw new Error("must bypass Codex tab delivery"); });
      const subject = { continueCommander: bridge, continuations: { continue: chain } };
      const paseo = agentWith({ provider: family, currentModeId: "careful", labels: { "wf-role": role } });
      const result = await (Service.prototype as any).continueElsewhere.call(subject, paseo, "source", { family }, "limit", [], "auto");
      expect(result.agentId).toBe("verified");
      expect(bridge).toHaveBeenCalledWith(paseo, "source", family, "careful", [], "limit", undefined);
      expect(chain).not.toHaveBeenCalled();
    });
  }
  for (const [name, labels] of [["worker", { "wf-role": "worker" }], ["unconfigured commander", { "wf-role": "commander" }]] as const) {
    it(`${name} keeps Codex tab reuse`, async () => {
      if (name === "worker") await configure();
      const chain = vi.fn(async () => ({ agentId: "account-tab", title: "tab" }));
      const subject = { continuations: { continue: chain }, continueCommander: vi.fn() };
      const paseo = agentWith({ labels });
      expect((await (Service.prototype as any).continueElsewhere.call(subject, paseo, "source", { family: "codex" }, "limit", [], "auto")).agentId).toBe("account-tab");
      expect(subject.continueCommander).not.toHaveBeenCalled();
    });
  }
  it("refuses a malformed configuration for commanders only", async () => {
    await configure({ command: "relative/path", models: {} });
    const subject = { continuations: { continue: vi.fn(async () => ({ agentId: "tab", title: "tab" })) }, continueCommander: vi.fn() };
    const call = (labels: object) => (Service.prototype as any).continueElsewhere.call(subject, agentWith({ labels }), "source", { family: "codex" }, "limit", [], "auto");
    await expect(call({ "wf-role": "commander" })).rejects.toThrow("commander-handover.json");
    expect((await call({ "wf-role": "worker" })).agentId).toBe("tab");
  });
});

describe("handover command", () => {
  it("runs the configured command with its model and title prefix", async () => {
    const log = join(root, "args.json");
    const command = join(root, "handover");
    await writeFile(command, `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\nconsole.log('{"agentId": "next-1"}');\n`);
    await chmod(command, 0o755);
    await configure({ command, models: { claude: "c-model", codex: "x-model" }, titlePrefix: "[next] " });
    const paseo = agentWith({ provider: "claude", title: "Build", cwd: root, workspaceId: "w1", labels: { "wf-role": "commander" } });
    const result = await (Service.prototype as any).continueCommander.call({}, paseo, "source", "codex", "full", [], "limit", "acct");
    expect(result).toEqual({ agentId: "next-1", title: "[next] Build" });
    const args = JSON.parse(await readFile(log, "utf8"));
    expect(args.slice(0, 12)).toEqual(["--no-wait", "--handover-from", "source", "--provider", "codex/x-model", "--mode", "full",
      "--expected-account", "acct", "--title", "[next] Build", "--workspace"]);
    expect(args[12]).toBe("w1");
  });
});

describe("commander source account survives reopening", () => {
  for (const role of ["commander", "control"]) it(role, async () => {
    await configure();
    const source = { id: "a", family: "claude", home: "/source", kind: "managed" };
    const env = vi.fn(async (home: string) => ({ CLAUDE_CONFIG_DIR: home }));
    const prepareHome = vi.fn(async () => {});
    const subject = {
      attach: vi.fn(), families: { resolve: async () => ({ claude: "claude" }) },
      adapters: { claude: { portable: true, env, prepareHome } },
      deferred: new Map(), activeAt: new Map(),
      store: { read: async () => ({ accounts: [source], sessions: { root: { accountId: "a" } }, bindings: {}, defaults: {} }) },
    };
    const context = { paseo: agentWith({ labels: { "wf-role": role } }) };
    const result = await (Service.prototype as any).route.call(subject, { agentId: "root", provider: "claude", reason: "refresh", purpose: "interactive", env: {} }, context);
    expect(result.env.CLAUDE_CONFIG_DIR).toBe("/source");
    expect(env).toHaveBeenCalledWith("/source");
    expect(prepareHome).toHaveBeenCalledWith("/source");
    expect(subject.activeAt.has("a")).toBe(true);
  });
});
