import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CARD_COLORS, preferences } from "../shared/preferences";

const host = vi.hoisted(() => ({ settings: {} as Record<string, any> }));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => host.settings }));
vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"),
  useState: (value: unknown) => [value, vi.fn()],
  useEffect: () => undefined,
}));
vi.mock("react-native", () => ({ Text: "Text", TextInput: "TextInput", View: "View" }));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  SettingsAction: "SettingsAction", SettingsCard: "SettingsCard", SettingsSection: "SettingsSection",
}));
import { CardColorsSection, useCardColors } from "./card-colors";

const theme = { colors: { foreground: "#ffffff", foregroundMuted: "#aaaaaa", surface0: "#111111", border: "#444444", statusDanger: "#ff0000" } };
function nodes(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...nodes(node.props?.children)];
}
function render() {
  return nodes(CardColorsSection({ theme: theme as any }));
}
function input(label: string) {
  return render().find((node) => node.type === "TextInput" && node.props.accessibilityLabel === label).props;
}

describe("card color settings", () => {
  beforeEach(() => {
    host.settings = {
      status: "ready", values: preferences.schema.parse({ autoSwitch: false }), revision: "r1", saving: false, saveError: null,
      save: vi.fn(async (values, revision) => {
        expect(revision).toBe(host.settings.revision);
        host.settings.values = preferences.schema.parse(values);
        host.settings.revision = "r2";
        return true;
      }),
    };
  });

  it("shows the four defaults and shared intensity", () => {
    expect(input("ChatGPT").value).toBe("#10A37F");
    expect(input("Claude").value).toBe("#D97757");
    expect(input("Antigravity").value).toBe("#4285F4");
    expect(input("OpenCode Go").value).toBe("#8B5CF6");
    expect(input("Background intensity (0–0.3)").value).toBe("0.12");
  });

  it("saves valid edits through host preferences and updates card consumers and previews", () => {
    input("ChatGPT").onChangeText("#123456");
    expect(host.settings.save).toHaveBeenCalledTimes(1);
    expect(useCardColors().codex).toBe("#123456");
    const swatch = render().find((node) => node.props.accessibilityLabel === "ChatGPT color preview");
    expect(swatch.props.style.backgroundColor).toBe("#123456");
    input("Background intensity (0–0.3)").onChangeText("0.25");
    expect(useCardColors().opacity).toBe(0.25);
    expect(host.settings.values.autoSwitch).toBe(false);
  });

  it("does not save invalid hex or intensity edits", () => {
    for (const value of ["", "#abc", "#12345g", "red"]) input("ChatGPT").onChangeText(value);
    for (const value of ["", "0.", "-0.1", "0.31", "Infinity"]) input("Background intensity (0–0.3)").onChangeText(value);
    expect(host.settings.save).not.toHaveBeenCalled();
    expect(useCardColors()).toEqual(DEFAULT_CARD_COLORS);
  });

  it("resets only card colors through the existing host save operation", async () => {
    host.settings.values.cardColors = { ...DEFAULT_CARD_COLORS, codex: "#123456", opacity: 0.3 };
    const reset = render().find((node) => node.props.actionLabel === "Reset to defaults");
    await reset.props.onPress();
    expect(useCardColors()).toEqual(DEFAULT_CARD_COLORS);
    expect(host.settings.values.autoSwitch).toBe(false);
  });
});
