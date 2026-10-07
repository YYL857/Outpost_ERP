import { Router } from "express";
import type { AppState } from "../../common/types.js";

/**
 * 财务报表：
 * - 收入：orders
 * - 平台费用：feeSnapshots（佣金/出库费/税）— 与本地运费/测评分栏，不混科目
 * - 本地成本：shipping / review 配置估算
 */
export function createFinanceRouter(getState: () => AppState) {
  const router = Router();

  router.get("/overview", (_req, res) => {
    const state = getState();
    const revenueSar = state.orders.reduce((s, o) => s + o.totalAmount, 0);
    const revenueCny = revenueSar * state.shipping.buybackRate;

    const units = state.orders.reduce((s, o) => s + o.itemCount, 0);
    const airCostAed = units * 0.5 * state.shipping.airFreightAedPerKg;
    const airCostCny = airCostAed * state.shipping.buybackRate;

    const reviewCostCny =
      units * (state.review.commissionRmb + state.review.expressFeeRmb);

    let platformOutbound = 0;
    let platformTax = 0;
    for (const f of state.feeSnapshots) {
      platformOutbound += f.outboundFee || 0;
      platformTax += f.taxAmount || 0;
    }

    const feeSkuCount = state.feeSnapshots.length;
    const avgCommissionRate =
      feeSkuCount === 0
        ? 0
        : state.feeSnapshots.reduce((s, f) => s + (f.commissionRate || 0), 0) /
          feeSkuCount;
    // 平台佣金金额：均费率 × 订单收入（与本地成本分开展示）
    const platformCommission = revenueSar * avgCommissionRate;

    const platformFeesSar = platformCommission + platformOutbound + platformTax;
    const platformFeesCny = platformFeesSar * state.shipping.buybackRate;

    const profitCny =
      revenueCny - airCostCny - reviewCostCny - platformFeesCny;

    res.json({
      data: {
        source: "NOON orders + feeSnapshots + local cost config",
        orderCount: state.orders.length,
        units,
        revenueSar: round2(revenueSar),
        revenueCny: round2(revenueCny),
        platformFees: {
          feeSkuCount,
          avgCommissionRate: round2(avgCommissionRate),
          commissionSar: round2(platformCommission),
          outboundFeeSar: round2(platformOutbound),
          taxSar: round2(platformTax),
          totalSar: round2(platformFeesSar),
          totalCny: round2(platformFeesCny),
        },
        airCostCny: round2(airCostCny),
        reviewCostCny: round2(reviewCostCny),
        profitCny: round2(profitCny),
        snapshot: {
          buybackRate: state.shipping.buybackRate,
          airFreightAedPerKg: state.shipping.airFreightAedPerKg,
          reviewCommissionRmb: state.review.commissionRmb,
          takenAt: new Date().toISOString(),
        },
      },
    });
  });

  router.get("/fees", (_req, res) => {
    const fees = [...getState().feeSnapshots].sort((a, b) =>
      a.partnerSku.localeCompare(b.partnerSku),
    );
    res.json({
      data: fees.slice(0, 500),
      meta: { source: "NOON feeSnapshots", total: fees.length },
    });
  });

  return router;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
