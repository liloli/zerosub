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

  it("registers in explorer and renders account and Antigravity quotas from the shared store", async () => {
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
    expect(output).toContain("34% used · resets in 2h");
    expect(output).toContain("Weekly");
    expect(output).toContain("72% used · resets in 2d");
    expect(output).toContain("Antigravity");
    expect(output).toContain("Gemini Pro");
    expect(output).toContain("80% left · Resets in 4h");

    cleanup();
  });
});
