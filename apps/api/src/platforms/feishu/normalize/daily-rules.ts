/**
 * 日报第二步：规则精筛 + delta/watchlist（纯本地，不调飞书、不改云端表）。
 * 输入：DailyBriefInput；输出：给后续 LLM 用的压缩包。
 */
import type {
  DailyBriefInput,
  DailyNormalizedRow,
  DailySheetOverview,
} from "./daily.js";

export type DailyRuleOptions = {
  /** |Δ30销量| 阈值，默认 5 */
  salesDeltaAbsMin?: number;
  /** watchlist 上限，默认 80 */
  watchlistMax?: number;
  /** 销量 Top↑/↓ 条数，默认 15 */
  salesTopN?: number;
};

export type DailyChangeKind =
  | "grade"
  | "online"
  | "clear"
  | "ad_loss"
  | "ad7"
  | "tag"
  | "age"
  | "new_sku"
  | "sales_delta"
  | "ad_bad"
  | "clear_action"
  | "age_risk"
  | "focus_grade"
  | "watch_tag";

export type DailySlimRow = {
  partnerSku: string;
  productName: string;
  onlineStatus: string;
  grade: string;
  problemTags: string;
  clearPriority: string;
  ageRisk: string;
  adLossTag: string;
  ad7Tag: string;
  sales30: number | null;
  visitors30: number | null;
  cvr30: number | null;
  returnRate30: number | null;
  fbn: number | null;
  remark: string;
};

export type DailyDeltaItem = {
  partnerSku: string;
  productName: string;
  kind: DailyChangeKind;
  from?: string;
  to?: string;
  dSales?: number;
  dVisitors?: number;
  sales30?: number | null;
};

export type DailyWatchItem = {
  partnerSku: string;
  productName: string;
  reasons: DailyChangeKind[];
  metrics: DailySlimRow;
  dSales: number | null;
  dVisitors: number | null;
  prevGrade?: string;
  prevOnline?: string;
  prevClear?: string;
};

export type DailyBriefFiltered = {
  version: 1;
  builtAt: string;
  sourceRawRunId: string;
  strategy: "latest_two_dated";
  currentSheet: string;
  previousSheet: string | null;
  reportDate: string | null;
  options: Required<DailyRuleOptions>;
  overview: DailySheetOverview;
  deltaCounts: {
    grade: number;
    online: number;
    clear: number;
    adLoss: number;
    ad7: number;
    tag: number;
    age: number;
    newSku: number;
    salesDeltaAbsGeMin: number;
  };
  deltas: {
    gradeChanges: DailyDeltaItem[];
    onlineChanges: DailyDeltaItem[];
    clearChanges: DailyDeltaItem[];
    salesUpTop: DailyDeltaItem[];
    salesDownTop: DailyDeltaItem[];
  };
  watchlist: DailyWatchItem[];
  noiseStats: {
    currentSkuTotal: number;
    watchlistKept: number;
    droppedFromWatch: number;
    emptyRemark: number;
    emptyReplenishPlan: number;
    noPreviousSheet: boolean;
  };
};

const DEFAULTS: Required<DailyRuleOptions> = {
  salesDeltaAbsMin: 5,
  watchlistMax: 80,
  salesTopN: 15,
};

const CLEAR_ACTION = new Set(["需处理", "淘汰观察"]);
const AD_BAD = new Set(["短期亏损", "长期亏损", "有花费无订单"]);
const AD7_BAD = new Set(["7天广告亏损", "7天有花费无订单"]);
const AGE_WATCH = new Set(["轻度老化", "中度老化", "重度老化"]);
const FOCUS_GRADE_PREFIXES = ["A ", "B ", "X+ ", "X- "];
const WATCH_TAG_PARTS = [
  "高退货风险",
  "低转化",
  "待确认滞销",
  "准S",
  "有曝光无转化新品",
];

function slim(r: DailyNormalizedRow): DailySlimRow {
  return {
    partnerSku: r.partnerSku,
    productName: r.productName,
    onlineStatus: r.onlineStatus,
    grade: r.grade,
    problemTags: r.problemTags,
    clearPriority: r.clearPriority,
    ageRisk: r.ageRisk,
    adLossTag: r.adLossTag,
    ad7Tag: r.ad7Tag,
    sales30: r.sales30,
    visitors30: r.visitors30,
    cvr30: r.cvr30,
    returnRate30: r.returnRate30,
    fbn: r.fbn,
    remark: r.remark,
  };
}

function splitTags(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，;；|/｜]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isFocusGrade(grade: string): boolean {
  return FOCUS_GRADE_PREFIXES.some((p) => grade.startsWith(p));
}

function hasWatchTag(tags: string): boolean {
  const parts = splitTags(tags);
  return parts.some((p) => WATCH_TAG_PARTS.some((w) => p.includes(w)));
}

function bySku(rows: DailyNormalizedRow[]): Map<string, DailyNormalizedRow> {
  const m = new Map<string, DailyNormalizedRow>();
  for (const r of rows) m.set(r.partnerSku, r);
  return m;
}

function reasonPriority(r: DailyChangeKind): number {
  const order: DailyChangeKind[] = [
    "clear_action",
    "ad_bad",
    "grade",
    "online",
    "sales_delta",
    "age_risk",
    "watch_tag",
    "focus_grade",
    "clear",
    "ad_loss",
    "ad7",
    "tag",
    "age",
    "new_sku",
  ];
  const i = order.indexOf(r);
  return i < 0 ? 99 : i;
}

/**
 * 从完整 brief 压出规则包（不读写磁盘、不调飞书）。
 */
export function filterDailyBrief(
  brief: DailyBriefInput,
  opts?: DailyRuleOptions,
): DailyBriefFiltered {
  const options: Required<DailyRuleOptions> = {
    salesDeltaAbsMin: opts?.salesDeltaAbsMin ?? DEFAULTS.salesDeltaAbsMin,
    watchlistMax: opts?.watchlistMax ?? DEFAULTS.watchlistMax,
    salesTopN: opts?.salesTopN ?? DEFAULTS.salesTopN,
  };

  const curMap = bySku(brief.current.rows);
  const prevMap = brief.previous ? bySku(brief.previous.rows) : new Map();

  const gradeChanges: DailyDeltaItem[] = [];
  const onlineChanges: DailyDeltaItem[] = [];
  const clearChanges: DailyDeltaItem[] = [];
  const salesDeltas: DailyDeltaItem[] = [];

  const watchAcc = new Map<
    string,
    {
      item: DailyWatchItem;
      score: number;
    }
  >();

  const bump = (
    cur: DailyNormalizedRow,
    reasons: DailyChangeKind[],
    extra?: Partial<DailyWatchItem>,
  ) => {
    const existing = watchAcc.get(cur.partnerSku);
    const dSales = extra?.dSales ?? existing?.item.dSales ?? null;
    const dVisitors = extra?.dVisitors ?? existing?.item.dVisitors ?? null;
    const mergedReasons = [
      ...new Set([...(existing?.item.reasons ?? []), ...reasons]),
    ].sort((a, b) => reasonPriority(a) - reasonPriority(b));
    const score =
      mergedReasons.reduce((s, r) => s + (20 - reasonPriority(r)), 0) +
      Math.min(30, Math.abs(dSales ?? 0));
    watchAcc.set(cur.partnerSku, {
      score,
      item: {
        partnerSku: cur.partnerSku,
        productName: cur.productName,
        reasons: mergedReasons,
        metrics: slim(cur),
        dSales,
        dVisitors,
        prevGrade: extra?.prevGrade ?? existing?.item.prevGrade,
        prevOnline: extra?.prevOnline ?? existing?.item.prevOnline,
        prevClear: extra?.prevClear ?? existing?.item.prevClear,
      },
    });
  };

  let adLossN = 0;
  let ad7N = 0;
  let tagN = 0;
  let ageN = 0;
  let newSkuN = 0;

  for (const cur of brief.current.rows) {
    const prev = prevMap.get(cur.partnerSku);

    if (!prev) {
      if (brief.previous) {
        newSkuN++;
        bump(cur, ["new_sku"]);
      }
    } else {
      const dSales = (cur.sales30 ?? 0) - (prev.sales30 ?? 0);
      const dVisitors = (cur.visitors30 ?? 0) - (prev.visitors30 ?? 0);

      if (cur.grade !== prev.grade) {
        gradeChanges.push({
          partnerSku: cur.partnerSku,
          productName: cur.productName,
          kind: "grade",
          from: prev.grade,
          to: cur.grade,
          sales30: cur.sales30,
          dSales,
        });
        bump(cur, ["grade"], {
          dSales,
          dVisitors,
          prevGrade: prev.grade,
        });
      }
      if (cur.onlineStatus !== prev.onlineStatus) {
        onlineChanges.push({
          partnerSku: cur.partnerSku,
          productName: cur.productName,
          kind: "online",
          from: prev.onlineStatus,
          to: cur.onlineStatus,
          dSales,
        });
        bump(cur, ["online"], {
          dSales,
          dVisitors,
          prevOnline: prev.onlineStatus,
        });
      }
      if (cur.clearPriority !== prev.clearPriority) {
        clearChanges.push({
          partnerSku: cur.partnerSku,
          productName: cur.productName,
          kind: "clear",
          from: prev.clearPriority,
          to: cur.clearPriority,
          dSales,
        });
        bump(cur, ["clear"], {
          dSales,
          dVisitors,
          prevClear: prev.clearPriority,
        });
      }
      if (cur.adLossTag !== prev.adLossTag) {
        adLossN++;
        bump(cur, ["ad_loss"], { dSales, dVisitors });
      }
      if (cur.ad7Tag !== prev.ad7Tag) {
        ad7N++;
        bump(cur, ["ad7"], { dSales, dVisitors });
      }
      if (cur.problemTags !== prev.problemTags) {
        tagN++;
        bump(cur, ["tag"], { dSales, dVisitors });
      }
      if (cur.ageRisk !== prev.ageRisk) {
        ageN++;
        bump(cur, ["age"], { dSales, dVisitors });
      }
      if (Math.abs(dSales) >= options.salesDeltaAbsMin) {
        salesDeltas.push({
          partnerSku: cur.partnerSku,
          productName: cur.productName,
          kind: "sales_delta",
          dSales,
          dVisitors,
          sales30: cur.sales30,
        });
        bump(cur, ["sales_delta"], { dSales, dVisitors });
      }
    }

    // 静态行动规则（相对「今天看昨天表」也要盯的盘）
    const staticReasons: DailyChangeKind[] = [];
    if (CLEAR_ACTION.has(cur.clearPriority)) staticReasons.push("clear_action");
    if (AD_BAD.has(cur.adLossTag) || AD7_BAD.has(cur.ad7Tag)) {
      staticReasons.push("ad_bad");
    }
    if (AGE_WATCH.has(cur.ageRisk)) staticReasons.push("age_risk");
    if (isFocusGrade(cur.grade)) staticReasons.push("focus_grade");
    if (hasWatchTag(cur.problemTags)) staticReasons.push("watch_tag");
    if (staticReasons.length) {
      const prev = prevMap.get(cur.partnerSku);
      bump(cur, staticReasons, {
        dSales: prev
          ? (cur.sales30 ?? 0) - (prev.sales30 ?? 0)
          : null,
        dVisitors: prev
          ? (cur.visitors30 ?? 0) - (prev.visitors30 ?? 0)
          : null,
      });
    }
  }

  salesDeltas.sort(
    (a, b) => Math.abs(b.dSales ?? 0) - Math.abs(a.dSales ?? 0),
  );
  const salesUpTop = salesDeltas
    .filter((x) => (x.dSales ?? 0) > 0)
    .slice(0, options.salesTopN);
  const salesDownTop = salesDeltas
    .filter((x) => (x.dSales ?? 0) < 0)
    .slice(0, options.salesTopN);

  const ranked = [...watchAcc.values()].sort((a, b) => b.score - a.score);
  const watchlist = ranked.slice(0, options.watchlistMax).map((x) => x.item);

  // focus_grade  alone would pull in ~120 A/B/X+/X- — trim: if ONLY focus_grade and no other reason, drop unless sales|clear|ad
  const refined = watchlist.filter((w) => {
    if (w.reasons.length === 1 && w.reasons[0] === "focus_grade") {
      return false;
    }
    return true;
  });
  // if over-trimmed, keep top by score from original without only-focus
  const finalWatch =
    refined.length >= Math.min(20, options.watchlistMax)
      ? refined.slice(0, options.watchlistMax)
      : ranked
          .map((x) => x.item)
          .filter(
            (w) =>
              !(w.reasons.length === 1 && w.reasons[0] === "focus_grade"),
          )
          .slice(0, options.watchlistMax);

  return {
    version: 1,
    builtAt: brief.builtAt,
    sourceRawRunId: brief.sourceRawRunId,
    strategy: brief.strategy,
    currentSheet: brief.current.meta.title,
    previousSheet: brief.previous?.meta.title ?? null,
    reportDate: brief.current.reportDate,
    options,
    overview: brief.current.overview,
    deltaCounts: {
      grade: gradeChanges.length,
      online: onlineChanges.length,
      clear: clearChanges.length,
      adLoss: adLossN,
      ad7: ad7N,
      tag: tagN,
      age: ageN,
      newSku: newSkuN,
      salesDeltaAbsGeMin: salesDeltas.length,
    },
    deltas: {
      gradeChanges: gradeChanges.slice(0, 40),
      onlineChanges: onlineChanges.slice(0, 40),
      clearChanges: clearChanges.slice(0, 40),
      salesUpTop,
      salesDownTop,
    },
    watchlist: finalWatch,
    noiseStats: {
      currentSkuTotal: curMap.size,
      watchlistKept: finalWatch.length,
      droppedFromWatch: Math.max(0, curMap.size - finalWatch.length),
      emptyRemark: brief.current.overview.emptyRemark,
      emptyReplenishPlan: brief.current.overview.emptyReplenishPlan,
      noPreviousSheet: !brief.previous,
    },
  };
}
