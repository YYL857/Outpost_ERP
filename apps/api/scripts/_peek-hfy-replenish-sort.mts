import {
  clearCatalogAssembleCache,
  getAssembledCatalogRows,
} from "../src/modules/catalog/query.js";
import { getShopState, runAsShop } from "../src/shops/state-cache.js";

runAsShop("PRJ482387", () => {
  clearCatalogAssembleCache();
  const st = getShopState("PRJ482387");
  console.log("disk/cache stock rows", st.stock.length);
  const { rows } = getAssembledCatalogRows(st);
  const ranked = [...rows].sort((a, b) => {
    const rank = (s: string) =>
      s === "urgent" ? 0 : s === "stable" ? 1 : s === "skip" ? 3 : 2;
    const d = rank(a.replenish.status) - rank(b.replenish.status);
    if (d) return d;
    const ad = a.replenish.availableDays ?? 9999;
    const bd = b.replenish.availableDays ?? 9999;
    if (ad !== bd) return ad - bd;
    return (b.sales.d7.units ?? 0) - (a.sales.d7.units ?? 0);
  });
  console.log("--- first 8 (same as 补货首页排序) ---");
  for (const r of ranked.slice(0, 8)) {
    console.log(
      JSON.stringify({
        sku: r.partnerSku,
        orphan: r.listingType === "orphan",
        fbn: r.inventory.fbn,
        sm: r.inventory.supermall,
        tr: r.inventory.inTransit,
        d7: r.sales.d7.units,
        status: r.replenish.status,
      }),
    );
  }
  const withFbn = ranked.filter((r) => r.inventory.fbn > 0);
  console.log("--- with FBN>0 count", withFbn.length, "first 3 ---");
  for (const r of withFbn.slice(0, 3)) {
    console.log(
      JSON.stringify({
        sku: r.partnerSku,
        fbn: r.inventory.fbn,
        d7: r.sales.d7.units,
        status: r.replenish.status,
        days: r.replenish.availableDays,
      }),
    );
  }
});
