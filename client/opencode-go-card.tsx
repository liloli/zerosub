import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { formatAge } from "../shared/format";
import type { OpenCodeGoView } from "../shared/model";
import { Card, UsageBar, useText } from "./ui";

import { useCardColors } from "./card-colors";

export function OpenCodeGoCard({
  theme,
  usage,
  compact,
}: {
  theme: PluginWorkspacePanelProps["theme"];
  usage: OpenCodeGoView;
  compact?: boolean;
}) {
  const colors = useCardColors();
  const text = useText(theme);
  if (usage.status === "unavailable") return null;
  const stale = usage.status === "stale" || usage.status === "error";

  const isPanel = compact !== undefined;

  const header = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
      <Text
        style={isPanel ? text.strong : text.heading}
        accessibilityRole={isPanel ? undefined : "header"}
      >
        OpenCode Go
      </Text>
      <Text style={text.small}>
        {usage.lastSuccessAt ? `Updated ${formatAge(usage.lastSuccessAt)}` : "Not loaded yet"}
        {usage.refreshing ? " · Refreshing…" : ""}
      </Text>
    </View>
  );

  const content = (
    <>
      {header}
      <View style={{ gap: isPanel ? (compact ? 8 : 10) : 8, opacity: stale ? 0.55 : 1 }}>
        {usage.windows.map((limit) => <UsageBar key={limit.id} theme={theme} limit={limit} />)}
      </View>
      {stale && usage.error ? <Text style={text.warning}>{usage.error}</Text> : null}
    </>
  );

  if (isPanel) {
    return (
      <View
        style={{
          position: "relative",
          padding: compact ? 10 : 12,
          gap: compact ? 6 : 8,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface0,
          overflow: "hidden",
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.opencodeGo,
            opacity: colors.opacity,
          }}
        />
        {content}
      </View>
    );
  }

  return (
    <Card theme={theme}>
      {content}
    </Card>
  );
}
