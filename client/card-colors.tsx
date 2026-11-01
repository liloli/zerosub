import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { CardColorsSchema, DEFAULT_CARD_COLORS, preferences, type CardColors } from "../shared/preferences";

type Theme = PluginSurfaceProps["theme"];
const FIELDS = [
  ["codex", "ChatGPT"],
  ["claude", "Claude"],
  ["antigravity", "Antigravity"],
  ["opencodeGo", "OpenCode Go"],
  ["opacity", "Background intensity (0–0.3)"],
] as const;

export function useCardColors(): CardColors {
  const settings = useSettings(preferences);
  return settings.status === "ready" ? settings.values.cardColors : DEFAULT_CARD_COLORS;
}

export function CardColorsSection({ theme }: { theme: Theme }) {
  const settings = useSettings(preferences);
  const [resetVersion, setResetVersion] = useState(0);
  if (settings.status !== "ready") return null;
  const save = (cardColors: CardColors) => void settings.save({ ...settings.values, cardColors }, settings.revision);
  return (
    <SettingsSection title="Card colors">
      <SettingsCard>
        {FIELDS.map(([field, label]) => (
          <CardColorInput key={`${field}:${resetVersion}`} field={field} label={label} theme={theme}
            colors={settings.values.cardColors} disabled={settings.saving} onSave={save} />
        ))}
        {settings.saveError ? <Text style={{ color: theme.colors.statusDanger }}>{settings.saveError}</Text> : null}
        <SettingsAction label="Restore card colors and intensity" actionLabel="Reset to defaults"
          disabled={settings.saving} onPress={async () => {
            const saved = await settings.save({ ...settings.values, cardColors: { ...DEFAULT_CARD_COLORS } }, settings.revision);
            if (saved) setResetVersion((version) => version + 1);
          }} />
      </SettingsCard>
    </SettingsSection>
  );
}

function CardColorInput({ field, label, theme, colors, disabled, onSave }: {
  field: keyof CardColors;
  label: string;
  theme: Theme;
  colors: CardColors;
  disabled: boolean;
  onSave(colors: CardColors): void;
}) {
  const value = colors[field];
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const parse = (text: string) => CardColorsSchema.safeParse({
    ...colors,
    [field]: field === "opacity" ? (/^(?:\d+|\d*\.\d+)$/.test(text) ? Number(text) : NaN) : text,
  });
  const parsed = parse(draft);
  const error = parsed.success ? null : field === "opacity" ? "Enter a number from 0 to 0.3" : "Use # followed by six hex digits";
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.foreground }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {field !== "opacity" ? <View accessibilityLabel={`${label} color preview`}
          style={{ width: 28, height: 28, borderRadius: 4, borderWidth: 1, borderColor: theme.colors.border,
            backgroundColor: parsed.success ? parsed.data[field] as string : colors[field] as string }} /> : null}
        <TextInput accessibilityLabel={label} value={draft} editable={!disabled}
          autoCapitalize="none" autoCorrect={false} keyboardType={field === "opacity" ? "decimal-pad" : "default"}
          style={{ flex: 1, minWidth: 0, color: theme.colors.foreground, backgroundColor: theme.colors.surface0,
            borderColor: theme.colors.border, borderWidth: 1, borderRadius: 6, padding: 10 }}
          onChangeText={(text) => {
            setDraft(text);
            const result = parse(text);
            if (result.success && result.data[field] !== value) onSave(result.data);
          }} />
      </View>
      {error ? <Text style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
    </View>
  );
}
