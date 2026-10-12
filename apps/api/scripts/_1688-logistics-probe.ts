/**
 * 小批验证：全部 → 批量查询弹窗 → 解析（不经 HTTP）
 *
 * pnpm exec tsx scripts/_1688-logistics-probe.ts
 * pnpm exec tsx scripts/_1688-logistics-probe.ts 3155514998781530494
 */
import { fetchBuyerOrderLogistics } from "../src/platforms/alibaba-1688/index.js";

const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const orderIds =
  ids.length > 0
    ? ids
    : [
        "3155514998781530494",
        "3131319794950530494",
        "3085039417092530494",
      ];

console.log("probe orders:", orderIds.length, orderIds.join(","));
const r = await fetchBuyerOrderLogistics(orderIds, {
  headed: true,
  batchSize: Math.min(30, orderIds.length),
  interactiveLogin: false,
  timeoutMs: 60_000,
});
const ok = r.orders.filter((o) => o.ok).length;
console.log("result:", r.message);
console.log("ok:", ok, "/", r.orders.length, "durationMs:", r.durationMs);
console.log("runPath:", r.runPath);
console.log("screenshot:", r.screenshotPath || "(none)");
for (const o of r.orders) {
  console.log(
    "-",
    o.orderId,
    o.ok ? "OK" : "FAIL",
    o.orderStatus || "-",
    o.trackingNo || "-",
    o.transitStatus || "-",
    o.message,
  );
}
process.exit(ok > 0 ? 0 : 1);
