import { writeFileSync } from "node:fs";
import { getShopState, runAsShop } from "../src/shops/state-cache.js";
import {
  clearCatalogAssembleCache,
  getAssembledCatalogRows,
} from "../src/modules/catalog/query.js";

runAsShop("PRJ482387", () => {
  clearCatalogAssembleCache();
  const st = getShopState("PRJ482387");
  const rows = getAssembledCatalogRows(st).rows;

  const withFbn = rows
    .filter((r) => (r.inventory?.fbn ?? 0) > 0)
    .sort((a, b) => (b.inventory?.fbn ?? 0) - (a.inventory?.fbn ?? 0));
  const urgentZero = rows.filter(
    (r) =>
      (r.inventory?.fbn ?? 0) <= 0 &&
      (r.replenish?.status === "urgent" || (r.replenish?.availableDays ?? 0) === 0) &&
      (r.sales?.d7?.units ?? 0) > 0,
  );

  // 截图常见品名关键字
  const needles = [
    "Nail",
    "Car Charger",
    "120W",
    "UV",
    "Ear",
    "Lamp",
    "Cooler",
    "Callus",
    "Backdrop",
    "Monitor Light",
  ];
  const hits = rows
    .filter((r) => needles.some((n) => (r.title || "").includes(n)))
    .map((r) => ({
      sku: r.partnerSku,
      title: (r.title || "").slice(0, 50),
      fbn: r.inventory?.fbn,
      sm: r.inventory?.supermall,
      transit: r.inventory?.inTransit,
      days: r.replenish?.availableDays,
      status: r.replenish?.status,
      d7: r.sales?.d7?.units,
      d90: r.sales?.d90?.units,
    }));

  const summary = {
    total: rows.length,
    withFbn: withFbn.length,
    fbnQtySum: withFbn.reduce((n, r) => n + (r.inventory?.fbn ?? 0), 0),
    urgentZeroWithSales: urgentZero.length,
    topFbn: withFbn.slice(0, 20).map((r) => ({
      sku: r.partnerSku,
      title: (r.title || "").slice(0, 45),
      fbn: r.inventory?.fbn,
      sm: r.inventory?.supermall,
      days: r.replenish?.availableDays,
      status: r.replenish?.status,
      d7: r.sales?.d7?.units,
    })),
    screenshotHits: hits,
    stockLedgerUpdated: [
      ...new Set((st.stock ?? []).map((s) => s.updatedAt)),
    ]
      .sort()
      .slice(-8),
    stockFbnRows: (st.stock ?? []).filter((s) => s.fulfillment === "fbn").length,
  };
  writeFileSync(
    "D:/YingDao/Logs/hfy_fbn_truth.json",
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(summary, null, 2));
});
