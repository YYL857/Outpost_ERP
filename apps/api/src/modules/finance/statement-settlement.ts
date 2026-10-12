/**
 * Noon Statement of Account → 按月结算聚合（对齐 _rebuild_gp_summary_fx176.load_statement）
 */
import type {
  AppState,
  GpCloseGateCheck,
  SalesFact,
  SettlementMonth,
  SkuLocalCost,
} from "../../common/types.js";

export const DEFAULT_GP_FX = 1.76;
export const MISSING_COST_UNIT_PCT_LIMIT = 5;

export const CORE_FEE_DETAILS = [
  "Advertising Fee",
  "Referral Fee",
  "FBN Outbound Fee",
  "Return Administration Fee",
] as const;

export const OTHER_FEE_DETAILS = [
  "Damaged Returns Fee",
  "Advertising Fee (Subsidy)",
  "Warranty Fee",
  "Return Refund",
] as const;

type FeeKey = "advertising" | "referral" | "fbnOutbound" | "returnAdmin";

const CORE_FEE_MAP: Record<(typeof CORE_FEE_DETAILS)[number], FeeKey> = {
  "Advertising Fee": "advertising",
  "Referral Fee": "referral",
  "FBN Outbound Fee": "fbnOutbound",
  "Return Administration Fee": "returnAdmin",
};

function num(raw: unknown): number {
  const n = Number(String(raw ?? "0").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return `${month}-28`;
  const d = new Date(Date.UTC(y, m, 0));
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${month}-${dd}`;
}

type Agg = {
  netProceeds: number;
  vat: number;
  core: Record<FeeKey, number>;
  otherRaw: number;
  minDate: string;
  maxDate: string;
  rowCount: number;
  statementCount: number;
  hasMonthEndStatement: boolean;
};

function emptyAgg(): Agg {
  return {
    netProceeds: 0,
    vat: 0,
    core: { advertising: 0, referral: 0, fbnOutbound: 0, returnAdmin: 0 },
    otherRaw: 0,
    minDate: "",
    maxDate: "",
    rowCount: 0,
    statementCount: 0,
    hasMonthEndStatement: false,
  };
}

/** 解析 Statement CSV 文本 → 月聚合（不含 sourceFile/importedAt） */
export function aggregateStatementCsv(content: string): Omit<
  SettlementMonth,
  "sourceFile" | "importedAt"
>[] {
  const raw = content.replace(/^\uFEFF/, "").trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);

  const iDate = idx("date");
  const iDetail = idx("details en");
  const iAmount = idx("amount");
  if (iDate < 0 || iDetail < 0 || iAmount < 0) {
    throw new Error(
      "Statement CSV 缺少必要列 Date / Details EN / Amount",
    );
  }

  const by = new Map<string, Agg>();

  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsvLine(lines[li]!);
    const date = String(cols[iDate] ?? "").trim().slice(0, 10);
    const month = date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;

    const detail = String(cols[iDetail] ?? "").trim();
    const amt = num(cols[iAmount]);

    let agg = by.get(month);
    if (!agg) {
      agg = emptyAgg();
      by.set(month, agg);
    }
    agg.rowCount += 1;
    if (!agg.minDate || date < agg.minDate) agg.minDate = date;
    if (!agg.maxDate || date > agg.maxDate) agg.maxDate = date;

    if (detail === "Net Proceeds") {
      agg.netProceeds += amt;
      agg.statementCount += 1;
      if (date === lastDayOfMonth(month)) agg.hasMonthEndStatement = true;
    } else if (detail.includes("VAT")) {
      agg.vat += amt < 0 ? -amt : amt;
    } else if (detail in CORE_FEE_MAP) {
      const key = CORE_FEE_MAP[detail as (typeof CORE_FEE_DETAILS)[number]];
      agg.core[key] += amt;
    } else if ((OTHER_FEE_DETAILS as readonly string[]).includes(detail)) {
      agg.otherRaw += amt;
    }
  }

  const months = [...by.keys()].sort();
  return months.map((month) => {
    const a = by.get(month)!;
    // 与 Python 一致：platform = -sum(raw core amounts)；分项展示用绝对值
    const platformFeesSar = round2(
      -(
        a.core.advertising +
        a.core.referral +
        a.core.fbnOutbound +
        a.core.returnAdmin
      ),
    );
    return {
      month,
      netProceedsSar: round2(a.netProceeds),
      vatSar: round2(a.vat),
      platformFeesSar,
      feeBreakdown: {
        advertising: round2(Math.abs(a.core.advertising)),
        referral: round2(Math.abs(a.core.referral)),
        fbnOutbound: round2(Math.abs(a.core.fbnOutbound)),
        returnAdmin: round2(Math.abs(a.core.returnAdmin)),
      },
      otherFeesSar: round2(-a.otherRaw),
      minDate: a.minDate,
      maxDate: a.maxDate,
      rowCount: a.rowCount,
      statementCount: a.statementCount,
      hasMonthEndStatement: a.hasMonthEndStatement,
    };
  });
}

/** 简易 CSV 行拆分（支持引号） */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function upsertSettlementMonths(
  state: AppState,
  months: Omit<SettlementMonth, "sourceFile" | "importedAt">[],
  sourceFile: string,
  importedAt = new Date().toISOString(),
): number {
  if (!state.settlementMonths) state.settlementMonths = [];
  const map = new Map(
    state.settlementMonths.map((m) => [m.month, m] as const),
  );
  for (const m of months) {
    map.set(m.month, {
      ...m,
      statementCount: m.statementCount ?? 0,
      hasMonthEndStatement: m.hasMonthEndStatement ?? false,
      sourceFile,
      importedAt,
    });
  }
  state.settlementMonths = [...map.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  return months.length;
}

export type SettlementCostLeg = {
  purchaseCny: number;
  headhaulCny: number;
  packagingCny: number;
  units: number;
  missingUnits: number;
  missingUnitPct: number;
  skuWithCost: number;
  skuMissingCost: number;
  missingSkus: string[];
};

/** 当月销量 × skuLocalCosts（头程为单字段；包装暂无 state 源 → 0） */
export function computeMonthCosts(
  salesFacts: SalesFact[],
  skuLocalCosts: SkuLocalCost[],
  month: string,
): SettlementCostLeg {
  const costBy = new Map(skuLocalCosts.map((c) => [c.partnerSku, c]));
  let purchaseCny = 0;
  let headhaulCny = 0;
  let units = 0;
  let missingUnits = 0;
  let skuWithCost = 0;
  let skuMissingCost = 0;
  const seenMissing = new Set<string>();
  const seenWith = new Set<string>();

  for (const f of salesFacts) {
    if (!f.date.startsWith(month)) continue;
    const qty = f.units || 0;
    units += qty;
    const c = costBy.get(f.partnerSku);
    if (!c || (!(c.purchaseCost > 0) && !(c.headhaul > 0))) {
      missingUnits += qty;
      if (!seenMissing.has(f.partnerSku)) {
        seenMissing.add(f.partnerSku);
        skuMissingCost += 1;
      }
      continue;
    }
    if (!seenWith.has(f.partnerSku)) {
      seenWith.add(f.partnerSku);
      skuWithCost += 1;
    }
    purchaseCny += qty * (c.purchaseCost || 0);
    headhaulCny += qty * (c.headhaul || 0);
  }

  const missingUnitPct =
    units > 0 ? round2((missingUnits / units) * 100) : 0;

  return {
    purchaseCny: round2(purchaseCny),
    headhaulCny: round2(headhaulCny),
    packagingCny: 0,
    units: round2(units),
    missingUnits: round2(missingUnits),
    missingUnitPct,
    skuWithCost,
    skuMissingCost,
    missingSkus: [...seenMissing].slice(0, 20),
  };
}

export type SettlementMonthRow = SettlementMonth & {
  netProceedsCny: number;
  platformFeesCny: number;
  vatCny: number;
  platformFeePct: number | null;
  /** (NP − fees − VAT) SAR */
  netAfterFeesSar: number;
  netAfterFeesCny: number;
  costs: SettlementCostLeg;
  /** 纯利 CNY：netAfterFees×fx − 采购 − 头程 − 包装 */
  pureProfitCny: number;
  coverageComplete: boolean;
  lastDayOfMonth: string;
  closeStatus: "open" | "incomplete" | "closed";
  closedAt: string | null;
};

export type SettlementSummary = {
  basis: "noon_statement";
  fx: number;
  months: SettlementMonthRow[];
  totals: {
    netProceedsSar: number;
    platformFeesSar: number;
    vatSar: number;
    netProceedsCny: number;
    platformFeesCny: number;
    vatCny: number;
    purchaseCny: number;
    headhaulCny: number;
    packagingCny: number;
    pureProfitCny: number;
  };
  caveats: string[];
  costBasis: string;
  targetMonth: string;
};

export type CloseGateResult = {
  month: string;
  ok: boolean;
  fx: number;
  fxCaveat: string | null;
  checks: GpCloseGateCheck[];
  costs: SettlementCostLeg;
  settlement: SettlementMonth | null;
  coverageComplete: boolean;
};

export function lockedFx(state: AppState): {
  fx: number;
  caveat: string | null;
} {
  if (state.shipping.buybackRate > 0) {
    return { fx: state.shipping.buybackRate, caveat: null };
  }
  return {
    fx: DEFAULT_GP_FX,
    caveat: `购汇汇率未配置，关账锁定 ${DEFAULT_GP_FX}（样板常用）。`,
  };
}

/** 上海日历的上一个完整自然月 YYYY-MM */
export function previousCalendarMonth(now = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m] = day.split("-").map(Number);
  if (!y || !m) return day.slice(0, 7);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function findActiveClose(state: AppState, month: string) {
  return (state.gpMonthCloses ?? []).find(
    (c) => c.month === month && c.status === "closed",
  );
}

/**
 * 关账门禁。纯利 = (NP − 四费 − VAT) × 锁定汇率 − 采购 − 头程 − 包装。
 * 包装暂 0，不挡关账。
 */
export function evaluateCloseGate(
  state: AppState,
  month: string,
): CloseGateResult {
  const { fx, caveat: fxCaveat } = lockedFx(state);
  const last = lastDayOfMonth(month);
  const settlement =
    (state.settlementMonths ?? []).find((m) => m.month === month) ?? null;
  const costs = computeMonthCosts(
    state.salesFacts ?? [],
    state.skuLocalCosts ?? [],
    month,
  );
  const coverageComplete = Boolean(
    settlement?.maxDate && settlement.maxDate >= last,
  );
  const statementCount = settlement?.statementCount ?? 0;
  const hasMonthEnd =
    settlement?.hasMonthEndStatement === true ||
    (typeof settlement?.statementCount !== "number" && coverageComplete);

  const checks: GpCloseGateCheck[] = [];

  if (!settlement) {
    checks.push({
      id: "imported",
      ok: false,
      detail: `${month} 尚未导入 Statement CSV。`,
    });
  } else {
    checks.push({
      id: "imported",
      ok: true,
      detail: `已导入 ${settlement.sourceFile || "statements.csv"}`,
    });
  }

  checks.push({
    id: "coverage",
    ok: coverageComplete,
    detail: coverageComplete
      ? `账单覆盖至 ${settlement!.maxDate}（月末 ${last}）`
      : `账单覆盖至 ${settlement?.maxDate || "—"}，需要月末 ${last} 段。`,
  });

  const countOk = statementCount >= 4 && Boolean(hasMonthEnd);
  checks.push({
    id: "statements",
    ok: countOk,
    detail: `Net Proceeds 段 ${statementCount} 条（需≥4），月末段 ${
      hasMonthEnd ? "有" : "无"
    }。`,
  });

  const amtOk = Boolean(
    settlement && settlement.netProceedsSar > 0 && settlement.platformFeesSar >= 0,
  );
  checks.push({
    id: "amounts",
    ok: amtOk,
    detail: settlement
      ? `NP ${settlement.netProceedsSar} / 四费 ${settlement.platformFeesSar} SAR`
      : "无账单金额",
  });

  const monthFacts = (state.salesFacts ?? []).filter((f) =>
    f.date.startsWith(month),
  );
  const monthOrders = (state.orders ?? []).filter((o) =>
    String(o.placedAt || "").startsWith(month),
  );
  const salesOk =
    costs.units > 0 ||
    monthFacts.length > 0 ||
    (costs.units === 0 && monthOrders.length === 0);
  checks.push({
    id: "sales",
    ok: salesOk,
    detail: salesOk
      ? `销量件数 ${costs.units}（空月允许）`
      : `有 ${monthOrders.length} 笔订单但无 ${month} 销量事实。`,
  });

  const costOk = costs.missingUnitPct < MISSING_COST_UNIT_PCT_LIMIT;
  checks.push({
    id: "costs",
    ok: costOk,
    detail: costOk
      ? `缺价件数 ${costs.missingUnitPct}%（阈值 ${MISSING_COST_UNIT_PCT_LIMIT}%）`
      : `缺价件数 ${costs.missingUnitPct}% ≥ ${MISSING_COST_UNIT_PCT_LIMIT}%，拒绝关账。`,
  });

  checks.push({
    id: "fx",
    ok: true,
    detail: fxCaveat || `锁定汇率 ${fx}`,
  });

  return {
    month,
    ok: checks.every((c) => c.ok),
    fx,
    fxCaveat,
    checks,
    costs,
    settlement,
    coverageComplete,
  };
}

export function buildSettlementSummary(
  state: AppState,
  opts?: { from?: string; to?: string },
): SettlementSummary {
  const { fx } = lockedFx(state);
  const from = opts?.from?.slice(0, 7) || "";
  const to = opts?.to?.slice(0, 7) || "";

  let months = [...(state.settlementMonths ?? [])].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  if (from) months = months.filter((m) => m.month >= from);
  if (to) months = months.filter((m) => m.month <= to);

  const caveats: string[] = [];
  if (!(state.shipping.buybackRate > 0)) {
    caveats.push(`购汇汇率未配置，CNY 暂按 ${fx} 换算（样板常用 1.76）。`);
  }
  if (months.length === 0) {
    caveats.push(
      "尚无账单月数据。请将 noon_financeweb_statements_*.csv 放入 portal-imports 后自动/手动导入。",
    );
  }

  const rows: SettlementMonthRow[] = months.map((m) => {
    const last = lastDayOfMonth(m.month);
    const coverageComplete = Boolean(m.maxDate && m.maxDate >= last);
    const closed = findActiveClose(state, m.month);
    const closeStatus: SettlementMonthRow["closeStatus"] = closed
      ? "closed"
      : coverageComplete
        ? "open"
        : "incomplete";
    if (!coverageComplete && m.maxDate) {
      caveats.push(
        `${m.month} 账单覆盖至 ${m.maxDate}（月末 ${last}），可能缺月末段。`,
      );
    }
    const netAfterFeesSar = round2(
      (closed?.netProceedsSar ?? m.netProceedsSar) -
        (closed?.platformFeesSar ?? m.platformFeesSar) -
        (closed?.vatSar ?? m.vatSar),
    );
    const costs = computeMonthCosts(
      state.salesFacts ?? [],
      state.skuLocalCosts ?? [],
      m.month,
    );
    const frozenCosts = closed
      ? {
          ...costs,
          purchaseCny: closed.purchaseCny,
          headhaulCny: closed.headhaulCny,
          packagingCny: closed.packagingCny,
        }
      : costs;
    const np = closed?.netProceedsSar ?? m.netProceedsSar;
    const fee = closed?.platformFeesSar ?? m.platformFeesSar;
    const vat = closed?.vatSar ?? m.vatSar;
    const rowFx = closed?.fx ?? fx;
    const netAfterFeesCny = round2(netAfterFeesSar * rowFx);
    const pureProfitCny = closed
      ? closed.pureProfitCny
      : round2(
          netAfterFeesCny -
            frozenCosts.purchaseCny -
            frozenCosts.headhaulCny -
            frozenCosts.packagingCny,
        );
    return {
      ...m,
      netProceedsSar: np,
      platformFeesSar: fee,
      vatSar: vat,
      netProceedsCny: round2(np * rowFx),
      platformFeesCny: round2(fee * rowFx),
      vatCny: round2(vat * rowFx),
      platformFeePct: np > 0 ? round2((fee / np) * 1000) / 10 : null,
      netAfterFeesSar,
      netAfterFeesCny,
      costs: frozenCosts,
      pureProfitCny,
      coverageComplete,
      lastDayOfMonth: last,
      closeStatus,
      closedAt: closed?.closedAt ?? null,
    };
  });

  if (rows.some((r) => r.costs.skuMissingCost > 0)) {
    caveats.push(
      "部分当月有销 SKU 无采购/头程成本（skuLocalCosts），纯利可能偏高。",
    );
  }
  caveats.push(
    "成本腿：采购/头程 = 当月 salesFacts.units × skuLocalCosts（非装箱票级摊）；包装暂无入库源记 0。",
  );
  caveats.push(
    "平台费仅含账单四费 Advertising+Referral+FBN Outbound+Return Admin；不补样板写死差额。",
  );

  const totals = {
    netProceedsSar: round2(rows.reduce((s, r) => s + r.netProceedsSar, 0)),
    platformFeesSar: round2(rows.reduce((s, r) => s + r.platformFeesSar, 0)),
    vatSar: round2(rows.reduce((s, r) => s + r.vatSar, 0)),
    netProceedsCny: round2(rows.reduce((s, r) => s + r.netProceedsCny, 0)),
    platformFeesCny: round2(rows.reduce((s, r) => s + r.platformFeesCny, 0)),
    vatCny: round2(rows.reduce((s, r) => s + r.vatCny, 0)),
    purchaseCny: round2(rows.reduce((s, r) => s + r.costs.purchaseCny, 0)),
    headhaulCny: round2(rows.reduce((s, r) => s + r.costs.headhaulCny, 0)),
    packagingCny: round2(rows.reduce((s, r) => s + r.costs.packagingCny, 0)),
    pureProfitCny: round2(rows.reduce((s, r) => s + r.pureProfitCny, 0)),
  };

  // 去重 caveat（覆盖提示可能重复月份但内容不同，保留全部 coverage 行）
  const uniq: string[] = [];
  for (const c of caveats) {
    if (!uniq.includes(c)) uniq.push(c);
  }

  return {
    basis: "noon_statement",
    fx,
    months: rows,
    totals,
    caveats: uniq,
    costBasis:
      "salesFacts×skuLocalCosts (purchase+headhaul); packaging=0; fx=shipping.buybackRate || 1.76",
    targetMonth: previousCalendarMonth(),
  };
}
