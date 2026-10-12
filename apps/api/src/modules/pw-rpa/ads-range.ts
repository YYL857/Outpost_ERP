/** Ad Manager 日期下拉 ↔ 文件名区间。默认仍是昨天（from=to）。 */

export const ADS_RANGE_MODES = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "last90",
  "ytd",
  "all",
  "custom",
  "days",
] as const;

export type AdsRangeMode = (typeof ADS_RANGE_MODES)[number];

export const ADS_RANGE_LABELS: Record<AdsRangeMode, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  last90: "Last 90 days",
  ytd: "Year to Date",
  all: "All time",
  custom: "Custom range",
  days: "Last N days",
};

const ISO = /^20\d{2}-\d{2}-\d{2}$/;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function inclusiveWindow(days: number): { fromDate: string; toDate: string } {
  const n = Math.max(1, Math.floor(days));
  const to = startOfLocalDay();
  const from = addDays(to, -(n - 1));
  return { fromDate: ymd(from), toDate: ymd(to) };
}

export function isAdsRangeMode(s: string): s is AdsRangeMode {
  return (ADS_RANGE_MODES as readonly string[]).includes(s);
}

export type AdsRangeInput = {
  range?: string;
  days?: number;
  fromDate?: string;
  toDate?: string;
};

export type AdsRangeResolved = {
  range: AdsRangeMode;
  days: number;
  fromDate: string;
  toDate: string;
  label: string;
};

export function resolveAdsRange(input: AdsRangeInput = {}): AdsRangeResolved {
  const raw = String(input.range || "yesterday").trim().toLowerCase();
  let range: AdsRangeMode = isAdsRangeMode(raw) ? raw : "yesterday";
  const fromIn = String(input.fromDate || "").trim();
  const toIn = String(input.toDate || "").trim();

  if (range === "custom" || (fromIn && toIn && raw === "custom")) {
    if (!ISO.test(fromIn) || !ISO.test(toIn)) {
      throw new Error("custom 需要 fromDate / toDate（YYYY-MM-DD）");
    }
    const fromDate = fromIn <= toIn ? fromIn : toIn;
    const toDate = fromIn <= toIn ? toIn : fromIn;
    const ms =
      startOfLocalDay(new Date(`${toDate}T00:00:00`)).getTime() -
      startOfLocalDay(new Date(`${fromDate}T00:00:00`)).getTime();
    const days = Math.max(1, Math.round(ms / 86400000) + 1);
    return { range: "custom", days, fromDate, toDate, label: ADS_RANGE_LABELS.custom };
  }

  if (range === "today") {
    const d = ymd(startOfLocalDay());
    return { range, days: 1, fromDate: d, toDate: d, label: ADS_RANGE_LABELS.today };
  }
  if (range === "yesterday") {
    const d = ymd(addDays(startOfLocalDay(), -1));
    return { range, days: 1, fromDate: d, toDate: d, label: ADS_RANGE_LABELS.yesterday };
  }
  if (range === "last7") {
    return { range, days: 7, ...inclusiveWindow(7), label: ADS_RANGE_LABELS.last7 };
  }
  if (range === "last30") {
    return { range, days: 30, ...inclusiveWindow(30), label: ADS_RANGE_LABELS.last30 };
  }
  if (range === "last90") {
    return { range, days: 90, ...inclusiveWindow(90), label: ADS_RANGE_LABELS.last90 };
  }
  if (range === "ytd") {
    const to = startOfLocalDay();
    const from = new Date(to.getFullYear(), 0, 1);
    const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    return { range, days, fromDate: ymd(from), toDate: ymd(to), label: ADS_RANGE_LABELS.ytd };
  }
  if (range === "all") {
    const to = startOfLocalDay();
    const from = new Date(2019, 0, 1);
    const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    return { range, days, fromDate: ymd(from), toDate: ymd(to), label: ADS_RANGE_LABELS.all };
  }

  const days = Math.max(1, Math.min(90, Math.floor(input.days ?? 7)));
  return {
    range: "days",
    days,
    ...inclusiveWindow(days),
    label: `Last ${days} days`,
  };
}
