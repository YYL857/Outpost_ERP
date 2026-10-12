/**
 * 月度毛利关账快照。
 * 纯利 = (Net Proceeds − 平台四费 − VAT) × 锁定汇率 − 采购 − 头程 − 包装。
 * 导入 Statement CSV 只更新草稿 settlementMonths，不改已关账快照。
 */
import type { AppState, GpMonthClose } from "../../common/types.js";
import {
  evaluateCloseGate,
  findActiveClose,
} from "./statement-settlement.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CloseGpMonthResult =
  | { ok: true; close: GpMonthClose }
  | { ok: false; error: string; status: number; gate?: ReturnType<typeof evaluateCloseGate> };

export function closeGpMonth(
  state: AppState,
  month: string,
  opts?: { replace?: boolean; closedBy?: "schedule" | "manual" },
): CloseGpMonthResult {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, error: "月份格式应为 YYYY-MM", status: 400 };
  }
  if (!state.gpMonthCloses) state.gpMonthCloses = [];

  const existing = findActiveClose(state, month);
  if (existing && !opts?.replace) {
    return {
      ok: false,
      error: `${month} 已关账（${existing.closedAt}）。更正请传 replace: true。`,
      status: 409,
    };
  }

  const gate = evaluateCloseGate(state, month);
  if (!gate.ok || !gate.settlement) {
    const fail = gate.checks.filter((c) => !c.ok).map((c) => c.detail);
    return {
      ok: false,
      error: fail.join("；") || `${month} 门禁未通过`,
      status: 409,
      gate,
    };
  }

  const s = gate.settlement;
  const netAfter = s.netProceedsSar - s.platformFeesSar - s.vatSar;
  const pureProfitCny = round2(
    netAfter * gate.fx -
      gate.costs.purchaseCny -
      gate.costs.headhaulCny -
      gate.costs.packagingCny,
  );
  const caveats = [
    "包装暂无入库源记 0。",
    "平台费仅含账单四费，不补样板写死差额。",
  ];
  if (gate.fxCaveat) caveats.unshift(gate.fxCaveat);
  if (gate.costs.skuMissingCost > 0) {
    caveats.push(
      `缺价 SKU ${gate.costs.skuMissingCost} 个（${gate.costs.missingSkus.join("、") || "—"}）`,
    );
  }

  const close: GpMonthClose = {
    month,
    status: "closed",
    closedAt: new Date().toISOString(),
    closedBy: opts?.closedBy ?? "manual",
    fx: gate.fx,
    sourceFile: s.sourceFile,
    gate: gate.checks,
    caveats,
    missingSkus: gate.costs.missingSkus,
    netProceedsSar: s.netProceedsSar,
    platformFeesSar: s.platformFeesSar,
    vatSar: s.vatSar,
    purchaseCny: gate.costs.purchaseCny,
    headhaulCny: gate.costs.headhaulCny,
    packagingCny: gate.costs.packagingCny,
    pureProfitCny,
    coverage: {
      minDate: s.minDate,
      maxDate: s.maxDate,
      statementCount: s.statementCount ?? 0,
    },
  };

  if (existing && opts?.replace) {
    existing.status = "superseded";
  }
  state.gpMonthCloses.push(close);
  return { ok: true, close };
}
