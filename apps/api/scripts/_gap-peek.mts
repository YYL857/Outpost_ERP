import { getShopState, runAsShop } from "../src/shops/state-cache.js";
import { auditShopGaps } from "../src/modules/sync/gap-audit.js";

function shanghaiYmd(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

for (const id of ["PRJ488078", "PRJ595165"] as const) {
  runAsShop(id, () => {
    const st = getShopState(id);
    const days = new Map<string, number>();
    for (const o of st.orders ?? []) {
      const t = Date.parse(o.placedAt);
      if (!Number.isFinite(t)) continue;
      const d = shanghaiYmd(new Date(t));
      days.set(d, (days.get(d) ?? 0) + 1);
    }
    const recent = [...days.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 10);
    console.log(
      id,
      "orders",
      st.orders?.length ?? 0,
      "sales",
      st.salesFacts?.length ?? 0,
      "ads",
      st.adsFacts?.length ?? 0,
      "catalog",
      st.catalog?.length ?? 0,
      "stock",
      st.stock?.length ?? 0,
    );
    console.log(id, "orderDays", recent);
    console.log(id, "cursors", st.cursors);
    const a = auditShopGaps(id, id, st);
    for (const d of a.domains.filter((x) => !x.ok)) {
      console.log(id, "GAP", d.domain, d.message);
    }
  });
}
