import { clearCatalogAssembleCache, getAssembledCatalogRows } from "../src/modules/catalog/query.js";
import { getShopState, runAsShop } from "../src/shops/state-cache.js";

runAsShop("PRJ482387", () => {
  clearCatalogAssembleCache();
  const st = getShopState("PRJ482387");
  const { rows } = getAssembledCatalogRows(st);
  const withFbn = rows.filter((r) => (r.inventory?.fbn ?? 0) > 0).length;
  const zero = rows.filter((r) => (r.inventory?.fbn ?? 0) <= 0).length;
  const top = [...rows]
    .sort((a, b) => (b.sales?.d7?.units ?? 0) - (a.sales?.d7?.units ?? 0))
    .slice(0, 5);
  console.log(
    JSON.stringify(
      {
        stockRows: st.stock.length,
        assembled: rows.length,
        withFbn,
        zeroFbn: zero,
        sample: top.map((r) => ({
          sku: r.partnerSku,
          fbn: r.inventory.fbn,
          sm: r.inventory.supermall,
          d7: r.sales.d7.units,
          days: r.replenish.availableDays,
        })),
      },
      null,
      2,
    ),
  );
});
