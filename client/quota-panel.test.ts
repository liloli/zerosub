import type {
  PluginClientContext,
  PluginWorkspacePanelContribution,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateView } from "../shared/model";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
    useState: <T,>(initial: T) => [initial, vi.fn()],
    useEffect: () => undefined,
    useCallback: <T,>(callback: T) => callback,
    useRef: <T,>(current: T) => ({ current }),
    useSyncExternalStore: <T,>(_subscribe: unknown, getSnapshot: () => T) => getSnapshot(),
  };
});

function hostPrimitive(name: string) {
  const Component = (props: Record<string, unknown>) => ({ hostType: name, props });
  Component.displayName = name;
  return Component;
}

vi.mock("react-native", () => ({
  ActivityIndicator: hostPrimitive("ActivityIndicator"),
  Pressable: hostPrimitive("Pressable"),
  ScrollView: hostPrimitive("ScrollView"),
  Text: hostPrimitive("Text"),
  View: hostPrimitive("View"),
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useHosts: () => [],
  useSettings: () => ({ status: "loading" }),
}));

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: hostPrimitive("Icon"),
  Modal: Object.assign(hostPrimitive("Modal"), { Content: hostPrimitive("ModalContent") }),
  TextInput: hostPrimitive("TextInput"),
  useClipboard: () => ({ copy: vi.fn() }),
  useToast: () => ({ show: vi.fn(), error: vi.fn() }),
}));

vi.mock("@getpaseo/plugin/client/ui", () => ({
  SettingsCard: hostPrimitive("SettingsCard"),
  SettingsSwitch: hostPrimitive("SettingsSwitch"),
}));

import contribute from "../index.client";

const THEME: PluginWorkspacePanelProps["theme"] = {
  colors: {
    surface0: "#111111",
    surface1: "#1a1a1a",
    surface2: "#242424",
    border: "#333333",
    foreground: "#f5f5f5",
    foregroundMuted: "#a0a0a0",
    accent: "#4f8cff",
    accentForeground: "#ffffff",
    statusSuccess: "#3ccb7f",
    statusWarning: "#f5a623",
    statusDanger: "#ff5c5c",
  },
};

function renderText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderText).join("");
  if (typeof node === "object" && "type" in node && "props" in node) {
    const element = node as { type: unknown; props: Record<string, unknown> };
    if (typeof element.type === "function") {
      return renderText((element.type as (props: Record<string, unknown>) => unknown)(element.props));
    }
    return renderText(element.props.children);
  }
  if (typeof node === "object" && "hostType" in node && "props" in node) {
    const hostNode = node as { props: Record<string, unknown> };
    return renderText(hostNode.props.children);
  }
  return "";
}

describe("explorer quota panel", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders both quota surfaces with OpenCode Go after Antigravity, using three used windows", async () => {
    const state: StateView = {
      accounts: [
        {
          id: "claude-work",
          family: "claude",
          label: "work-claude",
          kind: "managed",
          email: "work@example.com",
          plan: "max",
          organization: null,
          status: "ready",
          isDefault: true,
          limitedUntil: null,
          usage: {
            fetchedAt: "2026-11-01T11:58:00Z",
            windows: [
              { id: "five_hour", label: "5-hour", usedPercent: 34, resetsAt: "2026-11-01T14:00:00Z" },
              { id: "seven_day", label: "Weekly", usedPercent: 72, resetsAt: "2026-11-03T12:00:00Z" },
            ],
            error: null,
            cached: false,
            resets: null,
            credits: null,
          },
          agentCount: 1,
          home: null,
        },
      ],
      antigravity: {
        status: "ok",
        refreshing: false,
        lastSuccessAt: "2026-11-01T11:55:00Z",
        lastAttemptAt: "2026-11-01T11:55:00Z",
        error: null,
        groups: [
          {
            name: "Gemini Pro",
            buckets: [
              {
                id: "pro-5h",
                label: "5-hour",
                window: "5h",
                remainingPercent: 80,
                resetsAt: "2026-11-01T16:00:00Z",
              },
            ],
          },
        ],
      },
      agents: [],
      logins: [],
      providers: { claude: "claude" },
      canReopen: true,
      browserSignIn: true,
      showComposerPill: false,
      warnings: [],
    };
    state.opencodeGo = {
      status: "ok", refreshing: false, error: null,
      lastSuccessAt: "2026-11-01T11:55:00Z", lastAttemptAt: "2026-11-01T11:55:00Z",
      windows: [
        { id: "rolling", label: "5-hour", usedPercent: 0, resetsAt: "2026-11-01T14:00:00Z" },
        { id: "weekly", label: "Weekly", usedPercent: 40, resetsAt: "2026-11-03T12:00:00Z" },
        { id: "monthly", label: "Monthly", usedPercent: 49, resetsAt: "2026-11-08T12:00:00Z" },
      ],
    };

    const panels: PluginWorkspacePanelContribution[] = [];
    const rpc = vi.fn().mockResolvedValue(state);
    const client = {
      rpc,
      openSurface: vi.fn(),
      addSurface: () => () => undefined,
      addSidebarItem: () => () => undefined,
      addWorkspacePanel: (panel: PluginWorkspacePanelContribution) => {
        panels.push(panel);
        return () => undefined;
      },
      addSettingsScreen: () => () => undefined,
      addTimelineRenderer: () => () => undefined,
      addCommandCenterItem: () => () => undefined,
      addSlashCommand: () => () => undefined,
      addComposerPill: () => ({ update: () => undefined, remove: () => undefined }),
      paseo: {
        agents: {
          list: async () => ({
            subscription: { subscribe: () => undefined },
          }),
        },
      },
    };

    const cleanup = contribute(client as unknown as PluginClientContext);
    await Promise.resolve();

    expect(panels).toHaveLength(1);
    const panel = panels[0]!;
    expect(panel).toMatchObject({
      id: "quota",
      title: "Quota",
      context: "workspace",
      locations: ["explorer"],
    });
    expect(rpc).toHaveBeenCalledTimes(1);

    if (panel.context !== "workspace") throw new Error("expected workspace panel");
    const props: PluginWorkspacePanelProps = {
      context: "workspace",
      workspaceId: "ws-1",
      theme: THEME,
      host: { id: "local", label: "Local" },
      layout: { compact: true, platform: "web" },
    };

    const output = renderText(createElement(panel.Component, props));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(output).toContain("work-claude");
    expect(output).toContain("5-hour");
    expect(output).toContain("66% · resets 22:00 (2h)");
    expect(output).toContain("Weekly");
    expect(output).toContain("28% · resets 11-03 20:00 (2d)");
    expect(output).toContain("Antigravity");
    expect(output).toContain("Gemini Pro");
    expect(output).toContain("80% · resets 11-02 00:00 (4h)");
    expect(output.indexOf("OpenCode Go")).toBeGreaterThan(output.indexOf("Antigravity"));
    expect(output).toContain("100% · resets 22:00 (2h)");
    expect(output).toContain("60% · resets 11-03 20:00 (2d)");
    expect(output).toContain("Monthly");
    expect(output).toContain("51% · resets 11-08 20:00 (7d)");

    const { AccountsSurface } = await import("./accounts-surface");
    const { createZeroSubStore } = await import("./store");
    const store = createZeroSubStore(client as unknown as PluginClientContext);
    await store.refresh();
    const accountsProps = { ...props, store } as unknown as Parameters<typeof AccountsSurface>[0];
    const accountsOutput = renderText(createElement(AccountsSurface, accountsProps));
    expect(accountsOutput.indexOf("OpenCode Go")).toBeGreaterThan(accountsOutput.indexOf("Antigravity"));
    expect(accountsOutput).toContain("51% · resets 11-08 20:00 (7d)");
    state.opencodeGo = { ...state.opencodeGo, status: "error", error: "OpenCode Go usage failed (HTTP 401)." };
    await store.refresh();
    expect(renderText(createElement(AccountsSurface, accountsProps))).toContain("OpenCode Go usage failed (HTTP 401).");
    state.opencodeGo = { ...state.opencodeGo, status: "unavailable" };
    await store.refresh();
    expect(renderText(createElement(AccountsSurface, accountsProps))).not.toContain("OpenCode Go");
    delete state.opencodeGo;
    await store.refresh();
    expect(renderText(createElement(AccountsSurface, accountsProps))).not.toContain("OpenCode Go");
    store.stop();

    cleanup();
  });

  it("groups accounts by family with ChatGPT accounts first and preserves within-family order", async () => {
    const makeAccount = (id: string, family: "claude" | "codex", label: string): StateView["accounts"][number] => ({
      id,
      family,
      label,
      kind: "managed",
      email: `${id}@example.com`,
      plan: "pro",
      organization: null,
      status: "ready",
      isDefault: false,
      limitedUntil: null,
      usage: null,
      agentCount: 0,
      home: null,
    });

    const state: StateView = {
      accounts: [
        makeAccount("chatgpt-alpha", "codex", "alpha-chatgpt"),
        makeAccount("claude-one", "claude", "one-claude"),
        makeAccount("chatgpt-beta", "codex", "beta-chatgpt"),
        makeAccount("claude-two", "claude", "two-claude"),
      ],
      antigravity: {
        status: "ok",
        refreshing: false,
        lastSuccessAt: "2026-11-01T11:55:00Z",
        lastAttemptAt: "2026-11-01T11:55:00Z",
        error: null,
        groups: [
          {
            name: "Gemini Flash",
            buckets: [
              {
                id: "flash-5h",
                label: "5-hour",
                window: "5h",
                remainingPercent: 90,
                resetsAt: null,
              },
            ],
          },
        ],
      },
      agents: [],
      logins: [],
      providers: { claude: "claude", codex: "codex" },
      canReopen: true,
      browserSignIn: true,
      showComposerPill: false,
      warnings: [],
    };

    const panels: PluginWorkspacePanelContribution[] = [];
    const rpc = vi.fn().mockResolvedValue(state);
    const client = {
      rpc,
      openSurface: vi.fn(),
      addSurface: () => () => undefined,
      addSidebarItem: () => () => undefined,
      addWorkspacePanel: (panel: PluginWorkspacePanelContribution) => {
        panels.push(panel);
        return () => undefined;
      },
      addSettingsScreen: () => () => undefined,
      addTimelineRenderer: () => () => undefined,
      addCommandCenterItem: () => () => undefined,
      addSlashCommand: () => () => undefined,
      addComposerPill: () => ({ update: () => undefined, remove: () => undefined }),
      paseo: {
        agents: {
          list: async () => ({
            subscription: { subscribe: () => undefined },
          }),
        },
      },
    };

    const cleanup = contribute(client as unknown as PluginClientContext);
    await Promise.resolve();

    const panel = panels[0]!;
    if (panel.context !== "workspace") throw new Error("expected workspace panel");
    const props: PluginWorkspacePanelProps = {
      context: "workspace",
      workspaceId: "ws-1",
      theme: THEME,
      host: { id: "local", label: "Local" },
      layout: { compact: true, platform: "web" },
    };

    const output = renderText(createElement(panel.Component, props));
    const posAlpha = output.indexOf("alpha-chatgpt");
    const posBeta = output.indexOf("beta-chatgpt");
    const posClaudeOne = output.indexOf("one-claude");
    const posClaudeTwo = output.indexOf("two-claude");
    const posAntigravity = output.indexOf("Antigravity");

    expect(posAlpha).toBeGreaterThan(-1);
    expect(posBeta).toBeGreaterThan(-1);
    expect(posClaudeOne).toBeGreaterThan(-1);
    expect(posClaudeTwo).toBeGreaterThan(-1);
    expect(posAntigravity).toBeGreaterThan(-1);

    expect(posAlpha).toBeLessThan(posBeta);
    expect(posBeta).toBeLessThan(posClaudeOne);
    expect(posClaudeOne).toBeLessThan(posClaudeTwo);
    expect(posClaudeTwo).toBeLessThan(posAntigravity);

    cleanup();
  });

  it("assigns distinct vibrant brand tints to ChatGPT, Claude, Antigravity, and OpenCode Go", async () => {
    const { platformTint } = await import("./quota-panel");
    const { DEFAULT_CARD_COLORS } = await import("../shared/preferences");

    expect(platformTint("codex", THEME)).toBe("#10A37F");
    expect(platformTint("claude", THEME)).toBe("#D97757");
    expect(platformTint("antigravity", THEME)).toBe("#4285F4");
    expect(platformTint("opencodeGo", THEME)).toBe(DEFAULT_CARD_COLORS.opencodeGo);
    expect(DEFAULT_CARD_COLORS.opencodeGo).toBe("#8B5CF6");
    expect(DEFAULT_CARD_COLORS.opacity).toBe(0.12);
  });

  describe("quota remaining unification and display hierarchy", () => {
    it("converts used percent to remaining percent symmetrically and preserves remaining percent", async () => {
      const { quotaRemainingPercent } = await import("./ui");

      // Used -> Remaining (100 - used)
      expect(quotaRemainingPercent(0, true)).toBe(100);
      expect(quotaRemainingPercent(34, true)).toBe(66);
      expect(quotaRemainingPercent(72, true)).toBe(28);
      expect(quotaRemainingPercent(100, true)).toBe(0);
      expect(quotaRemainingPercent(-10, true)).toBe(100); // clamped
      expect(quotaRemainingPercent(120, true)).toBe(0); // clamped

      // Already remaining (raw preserved and clamped)
      expect(quotaRemainingPercent(80, false)).toBe(80);
      expect(quotaRemainingPercent(0, false)).toBe(0);
      expect(quotaRemainingPercent(100, false)).toBe(100);
      expect(quotaRemainingPercent(-5, false)).toBe(0);
      expect(quotaRemainingPercent(110, false)).toBe(100);

      // Unknown / missing data: must return null (NEVER 100%)
      expect(quotaRemainingPercent(null, true)).toBeNull();
      expect(quotaRemainingPercent(undefined, true)).toBeNull();
      expect(quotaRemainingPercent(Number.NaN, true)).toBeNull();
      expect(quotaRemainingPercent(null, false)).toBeNull();
      expect(quotaRemainingPercent(undefined, false)).toBeNull();
      expect(quotaRemainingPercent(Number.NaN, false)).toBeNull();
    });

    it("applies symmetric remaining color thresholds (<=10 danger, <=30 warning, >30 success)", async () => {
      const { quotaRemainingColor } = await import("./ui");

      // Danger (<=10% remaining, symmetric with used >= 90%)
      expect(quotaRemainingColor(0, THEME.colors)).toBe(THEME.colors.statusDanger);
      expect(quotaRemainingColor(5, THEME.colors)).toBe(THEME.colors.statusDanger);
      expect(quotaRemainingColor(10, THEME.colors)).toBe(THEME.colors.statusDanger);

      // Warning (<=30% remaining, symmetric with used >= 70%)
      expect(quotaRemainingColor(11, THEME.colors)).toBe(THEME.colors.statusWarning);
      expect(quotaRemainingColor(25, THEME.colors)).toBe(THEME.colors.statusWarning);
      expect(quotaRemainingColor(30, THEME.colors)).toBe(THEME.colors.statusWarning);

      // Success (>30% remaining, symmetric with used < 70%)
      expect(quotaRemainingColor(31, THEME.colors)).toBe(THEME.colors.statusSuccess);
      expect(quotaRemainingColor(66, THEME.colors)).toBe(THEME.colors.statusSuccess);
      expect(quotaRemainingColor(100, THEME.colors)).toBe(THEME.colors.statusSuccess);
    });

    it("parses reset strings into dateTime and countdown parts", async () => {
      const { parseResetText } = await import("./ui");

      expect(parseResetText("21:40 (4h 26m)")).toEqual({
        dateTime: "21:40",
        countdown: "(4h 26m)",
      });
      expect(parseResetText("11-04 17:24 (3d)")).toEqual({
        dateTime: "11-04 17:24",
        countdown: "(3d)",
      });
      expect(parseResetText("now")).toEqual({
        dateTime: "now",
      });
    });

    it("renders UsageBar and RemainingBar without used/left and handles unknown data gracefully", async () => {
      const { UsageBar, RemainingBar } = await import("./ui");

      // Normal UsageBar
      const normalBar = createElement(UsageBar, {
        theme: THEME,
        limit: { id: "5h", label: "5-hour", usedPercent: 34, resetsAt: "2026-11-01T14:00:00Z" },
      });
      const normalText = renderText(normalBar);
      expect(normalText).toContain("66% · resets 22:00 (2h)");
      expect(normalText).not.toContain("used");
      expect(normalText).not.toContain("left");

      // Unknown UsageBar: must NOT render 100%
      const unknownBar = createElement(UsageBar, {
        theme: THEME,
        limit: { id: "5h", label: "5-hour", usedPercent: null as unknown as number, resetsAt: null },
      });
      const unknownText = renderText(unknownBar);
      expect(unknownText).toContain("unknown");
      expect(unknownText).not.toContain("100%");
      expect(unknownText).not.toContain("used");
      expect(unknownText).not.toContain("left");

      // Normal RemainingBar
      const normalRemBar = createElement(RemainingBar, {
        theme: THEME,
        bucket: { id: "gemini", label: "Gemini", window: "daily", remainingPercent: 80, resetsAt: "2026-11-01T16:00:00Z" },
      });
      const normalRemText = renderText(normalRemBar);
      expect(normalRemText).toContain("80% · resets 11-02 00:00 (4h)");
      expect(normalRemText).not.toContain("left");
      expect(normalRemText).not.toContain("used");

      // Unknown RemainingBar: must NOT render 100%
      const unknownRemBar = createElement(RemainingBar, {
        theme: THEME,
        bucket: { id: "gemini", label: "Gemini", window: "daily", remainingPercent: null, resetsAt: null },
      });
      const unknownRemText = renderText(unknownRemBar);
      expect(unknownRemText).toContain("unknown");
      expect(unknownRemText).not.toContain("100%");
      expect(unknownRemText).not.toContain("left");
    });
  });
});
