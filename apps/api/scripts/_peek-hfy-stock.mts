import { getShopState, runAsShop } from "../src/shops/state-cache.js";

runAsShop("PRJ482387", () => {
  const st = getShopState("PRJ482387");
  const stock = (st.stock ?? []) as Array<Record<string, unknown>>;
  console.log("stock rows", stock.length);
  console.log("keys", stock[0] ? Object.keys(stock[0]) : []);
  const skus = [
    "N2SASJX004WHT",
    "N2SASB002BLK",
    "N2SAYC005WHT",
    "N2SAYC004WHT",
  ];
  for (const s of skus) {
    const hits = stock.filter((r) =>
      String(r.partnerSku ?? r.sku ?? r.noonSku ?? "").includes(s),
    );
    console.log(
      "\n",
      s,
      "hits",
      hits.length,
      hits[0] ? JSON.stringify(hits[0]) : "(none)",
    );
  }
  // field guess totals
  const fields = [
    "fbn",
    "fbnQty",
    "fbnOnHand",
    "qtyFbn",
    "available",
    "onHand",
    "supermall",
    "supermallQty",
    "warehouseId",
    "warehouseType",
  ];
  for (const f of fields) {
    const n = stock.filter((r) => r[f] != null && r[f] !== "").length;
    if (n) console.log("field", f, "nonEmpty", n, "eg", stock.find((r) => r[f] != null)?.[f]);
  }
});
