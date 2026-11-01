import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { formatAge } from "../shared/format";
import type { OpenCodeGoView } from "../shared/model";
import { Card, UsageBar, useText } from "./ui";

export function OpenCodeGoCard({ theme, usage }: { theme: PluginWorkspacePanelProps["theme"]; usage: OpenCodeGoView }) {
  const text = useText(theme);
  if (usage.status === "unavailable") return null;
  const stale = usage.status === "stale" || usage.status === "error";
  return (
    <Card theme={theme}>
      <Text style={text.heading} accessibilityRole="header">OpenCode Go</Text>
      <Text style={text.small}>
        {usage.lastSuccessAt ? `Updated ${formatAge(usage.lastSuccessAt)}` : "Not loaded yet"}
        {usage.refreshing ? " · Refreshing…" : ""}
      </Text>
      <View style={{ gap: 8, opacity: stale ? 0.55 : 1 }}>
        {usage.windows.map((limit) => <UsageBar key={limit.id} theme={theme} limit={limit} />)}
      </View>
      {stale && usage.error ? <Text style={text.warning}>{usage.error}</Text> : null}
    </Card>
  );
}
