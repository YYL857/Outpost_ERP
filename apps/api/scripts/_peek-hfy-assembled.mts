import { writeFileSync } from "node:fs";
import { getShopState, runAsShop } from "../src/shops/state-cache.js";
import { getAssembledCatalogRows } from "../src/modules/catalog/query.js";
import { clearCatalogAssembleCache } from "../src/modules/catalog/query.js";

runAsShop("PRJ482387", () => {
  clearCatalogAssembleCache();
  const st = getShopState("PRJ482387");
  const stock = st.stock ?? [];
  const byF: Record<string, number> = {};
  const qty: Record<string, number> = {};
  for (const r of stock) {
    const f = r.fulfillment || "unknown";
    byF[f] = (byF[f] ?? 0) + 1;
    qty[f] = (qty[f] ?? 0) + (Number(r.qty) || 0);
  }
  const rows = getAssembledCatalogRows(st).rows;
  const zeroFbn = rows.filter((r) => (r.inventory?.fbn ?? 0) <= 0).length;
  const posFbn = rows.filter((r) => (r.inventory?.fbn ?? 0) > 0).length;
  const top = rows.slice(0, 12).map((r) => ({
    sku: r.partnerSku,
    title: (r.title || "").slice(0, 40),
    fbn: r.inventory?.fbn,
    sm: r.inventory?.supermall,
    transit: r.inventory?.inTransit,
    days: r.replenish?.availableDays,
    status: r.replenish?.status,
  }));
  const fbnPosStock = stock.filter(
    (s) => s.fulfillment === "fbn" && (s.qty ?? 0) > 0,
  );
  const out = {
    stockLen: stock.length,
    byF,
    qty,
    assembled: rows.length,
    zeroFbn,
    posFbn,
    fbnPosStockSample: fbnPosStock.slice(0, 15).map((s) => ({
      sku: s.partnerSku,
      wh: s.warehouseCode,
      qty: s.qty,
      updatedAt: s.updatedAt,
    })),
    top,
  };
  writeFileSync(
    "D:/YingDao/Logs/hfy_stock_peek.json",
    JSON.stringify(out, null, 2),
    "utf8",
  );
  console.log("wrote", out.assembled, "zeroFbn", out.zeroFbn, "posFbn", out.posFbn);
});
