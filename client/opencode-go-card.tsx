import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { formatAge } from "../shared/format";
import type { OpenCodeGoView } from "../shared/model";
import { PlatformIcon } from "./platform-icon";
import { orderUsageWindows } from "./quota-display";
import { Card, UsageBar, useText } from "./ui";

export function OpenCodeGoCard({
  theme,
  usage,
  compact,
}: {
  theme: PluginWorkspacePanelProps["theme"];
  usage: OpenCodeGoView;
  compact?: boolean;
}) {
  const text = useText(theme);
  if (usage.status === "unavailable") return null;
  const stale = usage.status === "stale" || usage.status === "error";

  const isPanel = compact !== undefined;

  const header = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
      <PlatformIcon platform="opencode" />
      <Text style={text.small}>
        {usage.lastSuccessAt ? formatAge(usage.lastSuccessAt) : "Not loaded yet"}
        {usage.refreshing ? " · Refreshing…" : ""}
      </Text>
    </View>
  );

  const content = (
    <>
      {header}
      <View style={{ gap: isPanel ? (compact ? 8 : 10) : 8, opacity: stale ? 0.55 : 1 }}>
        {orderUsageWindows(usage.windows).map((limit) => <UsageBar key={limit.id} theme={theme} limit={limit} />)}
      </View>
      {stale && usage.error ? <Text style={text.warning}>{usage.error}</Text> : null}
    </>
  );

  if (isPanel) {
    return (
      <View
        style={{
          padding: compact ? 10 : 12,
          gap: compact ? 6 : 8,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        }}
      >
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
