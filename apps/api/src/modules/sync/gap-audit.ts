/**
 * 数据完整性审计：相对「期望截止日」检查 sales / orders / ads 是否滞后或空洞。
 * 纯函数，不打外部接口。
 *
 * 口径：
 * - 销量/订单/广告：当天下午才同步「昨天」；下午前只要求覆盖到前天。
 * - 库存/价库/费用快照：当天同步当天（按上次成功时间 freshness）。
 */
import type { AdsFact, AppState, SalesFact } from "../../common/types.js";

export type GapDomain = "sales" | "orders" | "ads" | "stock" | "catalog" | "fees";

export type DomainGap = {
  domain: GapDomain;
  ok: boolean;
  /** 本地已有数据的最大业务日（YYYY-MM-DD） */
  maxDate: string | null;
  /** 期望覆盖到的截止日（日历域：下午前=前天，下午起=昨天；快照域=今天） */
  expectedEnd: string;
  /** 窗口起点（审计用） */
  windowStart: string;
  /** 缺失的日历日（升序） */
  missingDates: string[];
  /** 建议一次 Impex/影刀 覆盖的 from（含） */
  fillFrom: string | null;
  /** 建议覆盖到的 to（含） */
  fillTo: string | null;
  /** 人类可读说明 */
  message: string;
  /** 补数通道 */
  channel: "noon-impex" | "yingdao-ads" | "snapshot" | "none";
};

export type ShopGapReport = {
  shopId: string;
  shopName: string;
  asOf: string;
  /** 日历域期望截止（销量/订单/广告） */
  expectedEnd: string;
  complete: boolean;
  /** 是否计入数据对齐总览成败（默认仅前两家老店） */
  countsTowardHealth?: boolean;
  domains: DomainGap[];
};

export type GapAuditOptions = {
  /** 覆盖日历域期望截止日（默认按下午门禁推算） */
  expectedEnd?: string;
  /** 上海时区：几点起要求覆盖「昨天」（默认 14） */
  lagSyncHourShanghai?: number;
  /** 向回审计天数（默认 90） */
  lookbackDays?: number;
  /** 库存/价库 freshness（ms）；超时记 gap */
  stockStaleMs?: number;
  catalogStaleMs?: number;
  now?: Date;
};

/** 下午起才把「昨天」算进销量/订单/广告期望截止 */
export const DEFAULT_LAG_SYNC_HOUR_SHANGHAI = 14;

export function shanghaiYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function shanghaiHour(d = new Date()): number {
  const raw = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false,
  }).format(d);
  const h = Number(String(raw).trim().slice(0, 2));
  return Number.isFinite(h) ? h % 24 : 0;
}

/**
 * 日历域（sales/orders/ads）期望截止：
 * - 上海 ≥ lagSyncHour：昨天
 * - 此前：前天（昨天尚未到同步窗口）
 */
export function resolveLagExpectedEnd(
  now: Date = new Date(),
  lagSyncHourShanghai = DEFAULT_LAG_SYNC_HOUR_SHANGHAI,
): string {
  const today = shanghaiYmd(now);
  const hour = shanghaiHour(now);
  return hour >= lagSyncHourShanghai
    ? addDaysYmd(today, -1)
    : addDaysYmd(today, -2);
}

/** 快照域（stock/catalog/fees）期望业务日：上海今天 */
export function resolveSnapshotExpectedEnd(now: Date = new Date()): string {
  return shanghaiYmd(now);
}

export function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function eachYmd(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

function orderPlacedYmd(placedAt: string): string | null {
  const t = Date.parse(placedAt);
  if (!Number.isFinite(t)) return null;
  return shanghaiYmd(new Date(t));
}

function salesDateSet(facts: SalesFact[]): Set<string> {
  const s = new Set<string>();
  for (const f of facts) {
    const d = (f.date || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) s.add(d);
  }
  return s;
}

function ordersDateSet(orders: AppState["orders"]): Set<string> {
  const s = new Set<string>();
  for (const o of orders) {
    const d = orderPlacedYmd(o.placedAt);
    if (d) s.add(d);
  }
  return s;
}

/** 精确单日 from=to 优先；区间覆盖则展开到窗口内 */
function adsDateSet(
  facts: AdsFact[],
  windowStart: string,
  expectedEnd: string,
): Set<string> {
  const s = new Set<string>();
  for (const f of facts) {
    const from = (f.fromDate || "").trim();
    const to = (f.toDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      continue;
    }
    if (from === to) {
      if (from >= windowStart && from <= expectedEnd) s.add(from);
      continue;
    }
    for (const d of eachYmd(
      from < windowStart ? windowStart : from,
      to > expectedEnd ? expectedEnd : to,
    )) {
      s.add(d);
    }
  }
  return s;
}

function maxOfSet(dates: Set<string>): string | null {
  let max: string | null = null;
  for (const d of dates) {
    if (!max || d > max) max = d;
  }
  return max;
}

function missingInWindow(
  present: Set<string>,
  windowStart: string,
  expectedEnd: string,
): string[] {
  return eachYmd(windowStart, expectedEnd).filter((d) => !present.has(d));
}

function calendarDomainGap(input: {
  domain: GapDomain;
  present: Set<string>;
  windowStart: string;
  expectedEnd: string;
  channel: DomainGap["channel"];
  emptyMessage: string;
  /**
   * lag：只盯尾部（maxDate < expectedEnd），零销/无广告日不算洞。
   * holes：窗口内每个日历日都要有事实（偏严，一般不用）。
   */
  mode?: "lag" | "holes";
}): DomainGap {
  const {
    domain,
    present,
    windowStart,
    expectedEnd,
    channel,
    emptyMessage,
    mode = "lag",
  } = input;
  const maxDate = maxOfSet(present);
  if (present.size === 0) {
    return {
      domain,
      ok: false,
      maxDate: null,
      expectedEnd,
      windowStart,
      missingDates: eachYmd(windowStart, expectedEnd),
      fillFrom: windowStart,
      fillTo: expectedEnd,
      message: emptyMessage,
      channel,
    };
  }

  const missingDates =
    mode === "holes"
      ? missingInWindow(present, windowStart, expectedEnd)
      : maxDate && maxDate < expectedEnd
        ? eachYmd(addDaysYmd(maxDate, 1), expectedEnd)
        : [];

  // 一次覆盖：从最早缺失日（或窗口起点）拉到期望截止
  const fillFrom = missingDates[0] ?? null;
  const fillTo = missingDates.length ? expectedEnd : null;
  const ok = missingDates.length === 0;
  const message = ok
    ? `齐全 · 最大日 ${maxDate} · 期望截止 ${expectedEnd}`
    : `滞后 ${missingDates.length} 天：${maxDate} → 缺至 ${expectedEnd}；建议一次覆盖 ${fillFrom}～${fillTo}`;
  return {
    domain,
    ok,
    maxDate,
    expectedEnd,
    windowStart,
    missingDates,
    fillFrom,
    fillTo,
    message,
    channel,
  };
}

function snapshotStaleGap(input: {
  domain: "stock" | "catalog" | "fees";
  lastAt: string | null;
  staleMs: number;
  nowMs: number;
  expectedEnd: string;
  windowStart: string;
  emptyOk: boolean;
}): DomainGap {
  const { domain, lastAt, staleMs, nowMs, expectedEnd, windowStart, emptyOk } =
    input;
  if (!lastAt) {
    return {
      domain,
      ok: emptyOk,
      maxDate: null,
      expectedEnd,
      windowStart,
      missingDates: emptyOk ? [] : [expectedEnd],
      fillFrom: emptyOk ? null : windowStart,
      fillTo: emptyOk ? null : expectedEnd,
      message: emptyOk
        ? "无快照（允许空）"
        : "从未成功拉取，需一次全量快照",
      channel: "snapshot",
    };
  }
  const ts = Date.parse(lastAt);
  const age = Number.isFinite(ts) ? nowMs - ts : Number.POSITIVE_INFINITY;
  const ok = age <= staleMs;
  return {
    domain,
    ok,
    maxDate: lastAt.slice(0, 10),
    expectedEnd,
    windowStart,
    missingDates: ok ? [] : [expectedEnd],
    fillFrom: ok ? null : windowStart,
    fillTo: ok ? null : expectedEnd,
    message: ok
      ? `新鲜 · 上次 ${lastAt}`
      : `过期 · 上次 ${lastAt}（>${Math.round(staleMs / 3600_000)}h）`,
    channel: "snapshot",
  };
}

/**
 * 审计单店：sales/orders/ads 按日历；stock/catalog/fees 按上次成功时间。
 */
export function auditShopGaps(
  shopId: string,
  shopName: string,
  state: AppState,
  opts: GapAuditOptions = {},
): ShopGapReport {
  const now = opts.now ?? new Date();
  const lagHour =
    opts.lagSyncHourShanghai ??
    Number(process.env.OUTPOST_LAG_SYNC_HOUR_SHANGHAI ?? DEFAULT_LAG_SYNC_HOUR_SHANGHAI);
  const lagExpectedEnd =
    opts.expectedEnd ??
    resolveLagExpectedEnd(
      now,
      Number.isFinite(lagHour) ? lagHour : DEFAULT_LAG_SYNC_HOUR_SHANGHAI,
    );
  const snapshotExpectedEnd = resolveSnapshotExpectedEnd(now);
  const lookback = Math.max(7, Math.min(180, opts.lookbackDays ?? 90));
  const windowStart = addDaysYmd(lagExpectedEnd, -(lookback - 1));
  const stockStaleMs = opts.stockStaleMs ?? 6 * 60 * 60 * 1000;
  const catalogStaleMs = opts.catalogStaleMs ?? 12 * 60 * 60 * 1000;
  const nowMs = now.getTime();

  const salesPresent = salesDateSet(state.salesFacts ?? []);
  const ordersPresent = ordersDateSet(state.orders ?? []);
  const adsPresent = adsDateSet(
    state.adsFacts ?? [],
    windowStart,
    lagExpectedEnd,
  );

  const sales = calendarDomainGap({
    domain: "sales",
    present: salesPresent,
    windowStart,
    expectedEnd: lagExpectedEnd,
    channel: "noon-impex",
    emptyMessage: `无 salesFacts；建议一次 Impex 销售报表 ${windowStart}～${lagExpectedEnd}`,
  });
  const orders = calendarDomainGap({
    domain: "orders",
    present: ordersPresent,
    windowStart,
    expectedEnd: lagExpectedEnd,
    channel: "noon-impex",
    emptyMessage: `无订单；建议一次 Impex 订单导出 ${windowStart}～${lagExpectedEnd}`,
  });
  const ads = calendarDomainGap({
    domain: "ads",
    present: adsPresent,
    windowStart,
    expectedEnd: lagExpectedEnd,
    channel: "yingdao-ads",
    emptyMessage: `无广告事实；需影刀导出 ads_sku_YYYY-MM-DD_YYYY-MM-DD.csv（口径 ${windowStart}～${lagExpectedEnd}）`,
  });

  const stockJob = state.syncJobs.find((j) => j.domain === "stock");
  const catalogJob = state.syncJobs.find((j) => j.domain === "catalog");
  const feesJob = state.syncJobs.find((j) => j.domain === "fees");
  const stock = snapshotStaleGap({
    domain: "stock",
    lastAt: state.cursors.stockSince ?? stockJob?.lastSuccessAt ?? null,
    staleMs: stockStaleMs,
    nowMs,
    expectedEnd: snapshotExpectedEnd,
    windowStart,
    emptyOk: false,
  });
  const catalog = snapshotStaleGap({
    domain: "catalog",
    lastAt: state.cursors.catalogSince ?? catalogJob?.lastSuccessAt ?? null,
    staleMs: catalogStaleMs,
    nowMs,
    expectedEnd: snapshotExpectedEnd,
    windowStart,
    emptyOk: false,
  });
  const fees = snapshotStaleGap({
    domain: "fees",
    lastAt: state.cursors.feesSince ?? feesJob?.lastSuccessAt ?? null,
    staleMs: 24 * 60 * 60 * 1000,
    nowMs,
    expectedEnd: snapshotExpectedEnd,
    windowStart,
    emptyOk: (state.feeSnapshots ?? []).length > 0,
  });

  const domains = [sales, orders, ads, catalog, stock, fees];
  return {
    shopId,
    shopName,
    asOf: now.toISOString(),
    expectedEnd: lagExpectedEnd,
    complete: domains.every((d) => d.ok),
    domains,
  };
}

export function domainsNeedingFill(report: ShopGapReport): DomainGap[] {
  return report.domains.filter((d) => !d.ok && d.fillFrom && d.fillTo);
}
