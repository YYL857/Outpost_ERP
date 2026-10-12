/**
 * 财务解读载荷：口径与财务报表 overview 相同，只取汇总，不送发票明细。
 */
import type { AppState } from "../../common/types.js";

export type FinanceInterpretPayload = {
  kind: "finance";
  asOf: string;
  shopName: string;
  orderCount: number;
  units: number;
  revenueSar: number;
  revenueCny: number;
  platformFees: {
    feeSkuCount: number;
    avgCommissionRate: number;
    commissionSar: number;
    outboundFeeSar: number;
    taxSar: number;
    totalSar: number;
    totalCny: number;
  };
  invoices: { count: number; amountSar: number };
  airCostCny: number;
  reviewCostCny: number;
  profitCny: number;
  buybackRate: number;
  softNotes: string[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildFinanceInterpretPayload(
  state: AppState,
  shopName: string,
): FinanceInterpretPayload {
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
  const platformCommission = revenueSar * avgCommissionRate;
  const platformFeesSar = platformCommission + platformOutbound + platformTax;
  const platformFeesCny = platformFeesSar * state.shipping.buybackRate;
  const profitCny = revenueCny - airCostCny - reviewCostCny - platformFeesCny;

  const invoices = state.invoiceDocs ?? [];
  const invoiceAmount = invoices.reduce((s, i) => s + (i.amount || 0), 0);

  const softNotes: string[] = [];
  if (state.orders.length === 0) softNotes.push("没有订单，收入为 0");
  if (feeSkuCount === 0) softNotes.push("没有平台费用快照，佣金与出库费无法按 SKU 核对");
  if (invoices.length === 0) softNotes.push("尚未同步发票");
  softNotes.push("头程按件数×0.5kg×空运费率估算，与财务报表页同一口径");

  return {
    kind: "finance",
    asOf: new Date().toISOString(),
    shopName,
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
    invoices: { count: invoices.length, amountSar: round2(invoiceAmount) },
    airCostCny: round2(airCostCny),
    reviewCostCny: round2(reviewCostCny),
    profitCny: round2(profitCny),
    buybackRate: state.shipping.buybackRate,
    softNotes,
  };
}

export function financeHasNumbers(payload: FinanceInterpretPayload): boolean {
  return (
    payload.orderCount > 0 ||
    payload.platformFees.feeSkuCount > 0 ||
    payload.invoices.count > 0
  );
}
