import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { ScrollView, Text, View } from "react-native";
import { formatAge, formatCredits, usageSummary } from "../shared/format";
import { FAMILY_LABEL, type AccountView, type AntigravityView, type Family } from "../shared/model";
import { useStore, type ZeroSubStore } from "./store";
import { Badge, RemainingBar, UsageBar, useText } from "./ui";

type Theme = PluginWorkspacePanelProps["theme"];

const FAMILIES: readonly Family[] = ["codex", "claude"];

export function groupAccountsByFamily(accounts: readonly AccountView[]): AccountView[] {
  const grouped: AccountView[] = [];
  for (const family of FAMILIES) {
    for (const account of accounts) {
      if (account.family === family) {
        grouped.push(account);
      }
    }
  }
  for (const account of accounts) {
    if (!FAMILIES.includes(account.family)) {
      grouped.push(account);
    }
  }
  return grouped;
}

export function QuotaPanel(props: PluginWorkspacePanelProps & { store: ZeroSubStore }) {
  const { theme, layout, store } = props;
  const { state, error } = useStore(store);
  const text = useText(theme);
  const antigravity =
    state?.antigravity && state.antigravity.status !== "unavailable" ? state.antigravity : null;
  const accounts = state ? groupAccountsByFamily(state.accounts) : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <ScrollView
        contentContainerStyle={{
          padding: layout.compact ? 10 : 12,
          gap: layout.compact ? 8 : 10,
        }}
      >
        {!state && error ? <Text style={text.danger}>Could not reach the daemon: {error}</Text> : null}
        {!state && !error ? <Text style={text.muted}>Loading accounts…</Text> : null}
        {state && accounts.length === 0 && !antigravity ? (
          <Text style={text.muted}>No accounts yet.</Text>
        ) : null}
        {accounts.map((account) => (
          <AccountRow key={account.id} account={account} theme={theme} compact={layout.compact} />
        ))}
        {antigravity ? (
          <AntigravitySection usage={antigravity} theme={theme} compact={layout.compact} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function AccountRow({
  account,
  theme,
  compact,
}: {
  account: AccountView;
  theme: Theme;
  compact: boolean;
}) {
  const text = useText(theme);
  const signedOut = account.status === "signed_out";
  const disabled = account.status === "disabled";
  const faded = disabled ? { opacity: 0.55 } : null;
  const limits = account.usage?.windows ?? [];
  const credits = account.usage?.credits ?? null;

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
      <View
        style={[
          { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 },
          faded,
        ]}
      >
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexShrink: 1, minWidth: 0 }}>
          <Text style={[text.strong, { flexShrink: 1 }]} numberOfLines={1}>
            {account.label}
          </Text>
          <Text style={text.small}>{FAMILY_LABEL[account.family]}</Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
          {account.isDefault ? <Badge theme={theme} label="Default" tone="accent" /> : null}
          {account.status === "limited" ? <Badge theme={theme} label="Limit reached" tone="danger" /> : null}
          {disabled ? <Badge theme={theme} label="Disabled" /> : null}
          {signedOut ? <Badge theme={theme} label="Signed out" tone="warning" /> : null}
        </View>
      </View>

      <View style={[{ gap: compact ? 6 : 8 }, faded]}>
        {signedOut ? (
          <Text style={text.small}>Sign in again to use this account.</Text>
        ) : limits.length > 0 ? (
          limits.map((limit) => <UsageBar key={limit.id} theme={theme} limit={limit} />)
        ) : (
          <Text style={text.small}>{account.usage?.error ?? usageSummary(account) ?? "Checking usage…"}</Text>
        )}
        {!signedOut && credits ? <Text style={text.small}>{formatCredits(credits)}</Text> : null}
      </View>
    </View>
  );
}

function AntigravitySection({
  usage,
  theme,
  compact,
}: {
  usage: AntigravityView;
  theme: Theme;
  compact: boolean;
}) {
  const text = useText(theme);
  const stale = usage.status === "stale" || usage.status === "error";

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
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
        <Text style={text.strong}>Antigravity</Text>
        <Text style={text.small}>
          {usage.lastSuccessAt ? `Updated ${formatAge(usage.lastSuccessAt)}` : "Not loaded yet"}
          {usage.refreshing ? " · Refreshing…" : ""}
        </Text>
      </View>
      <View style={{ gap: compact ? 8 : 10, opacity: stale ? 0.55 : 1 }}>
        {usage.groups.map((group, groupIndex) => (
          <View key={`${group.name}-${groupIndex}`} style={{ gap: 6 }}>
            <Text style={[text.small, { color: theme.colors.foreground, fontWeight: "600" }]}>{group.name}</Text>
            {group.buckets.map((bucket, bucketIndex) => (
              <RemainingBar key={`${bucket.id}-${bucketIndex}`} theme={theme} bucket={bucket} />
            ))}
          </View>
        ))}
      </View>
      {stale && usage.error ? <Text style={text.warning}>{usage.error}</Text> : null}
    </View>
  );
}
