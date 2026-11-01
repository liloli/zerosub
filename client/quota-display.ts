import type { UsageWindow } from "../shared/model";

export const ANTIGRAVITY_GROUP_DISPLAY_NAMES: Record<string, string> = {
  "Gemini Models": "Gemini",
  "Claude and GPT models": "Claude & GPT",
  "Gemini 4 Argon": "Gemini 4 Argon",
};

export function displayGroupName(name: string): string {
  return ANTIGRAVITY_GROUP_DISPLAY_NAMES[name] ?? name;
}

export function isFiveHourWindow(item: { minutes?: number | null; id?: string; label?: string }): boolean {
  if (item.minutes === 300) return true;
  if (item.id === "five_hour" || item.id === "rolling") return true;
  const l = item.label?.toLowerCase().trim() ?? "";
  return l === "5-hour" || l === "5h" || l === "five hour";
}

export function isWeeklyWindow(item: { minutes?: number | null; id?: string; label?: string }): boolean {
  if (item.minutes === 10_080) return true;
  if (item.id === "seven_day" || item.id === "weekly") return true;
  const l = item.label?.toLowerCase().trim() ?? "";
  return (l === "weekly" || l === "7-day" || l === "seven day") && !l.includes("·");
}

export function formatWindowForDisplay(item: UsageWindow): { window: UsageWindow; rank: number } {
  if (isFiveHourWindow(item)) {
    return { window: { ...item, label: "5h" }, rank: 0 };
  }
  if (isWeeklyWindow(item)) {
    return { window: { ...item, label: "weekly" }, rank: 1 };
  }
  return { window: item, rank: 2 };
}

export function orderUsageWindows(windows: readonly UsageWindow[]): UsageWindow[] {
  return windows
    .map((w, index) => ({ item: formatWindowForDisplay(w), originalIndex: index }))
    .sort((a, b) => a.item.rank - b.item.rank || a.originalIndex - b.originalIndex)
    .map((entry) => entry.item.window);
}

export function isFiveHourBucket(bucket: { window?: string; label?: string }): boolean {
  return (
    bucket.window === "5h" ||
    bucket.label === "5-hour" ||
    bucket.label?.toLowerCase() === "5h" ||
    bucket.label?.toLowerCase() === "five hour"
  );
}

export function isWeeklyBucket(bucket: { window?: string; label?: string }): boolean {
  return (
    bucket.window === "weekly" ||
    bucket.label === "Weekly" ||
    bucket.label?.toLowerCase() === "weekly"
  );
}

export function formatBucketForDisplay<T extends { id: string; label: string; window?: string }>(bucket: T): { bucket: T; rank: number } {
  if (isFiveHourBucket(bucket)) {
    return { bucket: { ...bucket, label: "5h" }, rank: 0 };
  }
  if (isWeeklyBucket(bucket)) {
    return { bucket: { ...bucket, label: "weekly" }, rank: 1 };
  }
  return { bucket, rank: 2 };
}

export function orderAntigravityBuckets<T extends { id: string; label: string; window?: string }>(buckets: readonly T[]): T[] {
  return buckets
    .map((b, index) => ({ item: formatBucketForDisplay(b), originalIndex: index }))
    .sort((a, b) => a.item.rank - b.item.rank || a.originalIndex - b.originalIndex)
    .map((entry) => entry.item.bucket);
}
