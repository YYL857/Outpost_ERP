import { Router } from "express";
import type { AppState } from "../../common/types.js";

/** Best Sell：按本地已同步订单粗排（真实可接 NOON 爆款接口） */
export function createAnalyticsRouter(getState: () => AppState) {
  const router = Router();

  router.get("/best-sell", (_req, res) => {
    const state = getState();
    const map = new Map<
      string,
      { partnerSku: string; title: string; units: number; gmv: number }
    >();

    for (const item of state.catalog) {
      map.set(item.partnerSku, {
        partnerSku: item.partnerSku,
        title: item.title,
        units: 0,
        gmv: 0,
      });
    }

    // 无 SKU 明细时，用订单金额分摊演示排行
    const catalogSkus = [...map.keys()];
    state.orders.forEach((order, idx) => {
      const sku =
        order.partnerSku ??
        catalogSkus[idx % Math.max(catalogSkus.length, 1)] ??
        "UNMAPPED";
      const title =
        state.catalog.find((c) => c.partnerSku === sku)?.title ?? sku;
      const prev = map.get(sku) ?? {
        partnerSku: sku,
        title,
        units: 0,
        gmv: 0,
      };
      prev.units += order.itemCount;
      prev.gmv += order.totalAmount;
      map.set(sku, prev);
    });

    const rows = [...map.values()]
      .filter((r) => r.units > 0 || r.gmv > 0)
      .sort((a, b) => b.units - a.units || b.gmv - a.gmv);

    res.json({ data: rows, meta: { source: "NOON synced local" } });
  });

  return router;
}
