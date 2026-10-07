import { Router } from "express";
import type { AppState, SalesFact } from "../../common/types.js";

function sumSalesFacts(facts: SalesFact[]) {
  let units = 0;
  let amount = 0;
  const byDate: Record<string, { units: number; amount: number }> = {};
  const bySku = new Map<string, { units: number; amount: number }>();
  for (const f of facts) {
    units += f.units;
    amount += f.amount;
    const d = byDate[f.date] ?? { units: 0, amount: 0 };
    d.units += f.units;
    d.amount += f.amount;
    byDate[f.date] = d;
    const s = bySku.get(f.partnerSku) ?? { units: 0, amount: 0 };
    s.units += f.units;
    s.amount += f.amount;
    bySku.set(f.partnerSku, s);
  }
  const topSkus = [...bySku.entries()]
    .map(([partnerSku, v]) => ({ partnerSku, ...v }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 50);
  return { units, amount, byDate, topSkus, skuCount: bySku.size };
}

/**
 * 销量统计：
 * - 主数据 = salesFacts（SOP Sales，SKU×日）
 * - 补充 = orders（履约单据，非日销量主表）
 */
export function createSalesRouter(getState: () => AppState) {
  const router = Router();

  router.get("/summary", (_req, res) => {
    const state = getState();
    const facts = state.salesFacts;
    const sales = sumSalesFacts(facts);
    const orders = state.orders;
    const orderGmv = orders.reduce((s, o) => s + o.totalAmount, 0);
    const orderUnits = orders.reduce((s, o) => s + o.itemCount, 0);
    const byStatus: Record<string, number> = {};
    for (const o of orders) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    }
    res.json({
      data: {
        source: "NOON salesFacts + orders",
        primary: "salesFacts",
        salesFactCount: facts.length,
        salesSkuCount: sales.skuCount,
        salesUnits: sales.units,
        salesAmount: round2(sales.amount),
        orderCount: orders.length,
        orderGmv: round2(orderGmv),
        orderUnits,
        currency: orders[0]?.currency ?? "SAR",
        byStatus,
        // 兼容旧字段：GMV/件数优先展示销售报表
        gmv: round2(sales.amount || orderGmv),
        units: sales.units || orderUnits,
      },
    });
  });

  router.get("/facts", (_req, res) => {
    const facts = [...getState().salesFacts].sort((a, b) =>
      a.date === b.date
        ? a.partnerSku.localeCompare(b.partnerSku)
        : b.date.localeCompare(a.date),
    );
    res.json({
      data: facts.slice(0, 500),
      meta: { source: "NOON salesFacts", total: facts.length },
    });
  });

  router.get("/top-skus", (_req, res) => {
    const { topSkus } = sumSalesFacts(getState().salesFacts);
    res.json({ data: topSkus, meta: { source: "NOON salesFacts" } });
  });

  router.get("/orders", (_req, res) => {
    res.json({
      data: getState().orders,
      meta: { source: "NOON orders", role: "fulfillment_supplement" },
    });
  });

  return router;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
