/**
 * eta / 今日关注规则自检
 * pnpm exec tsx src/platforms/alibaba-1688/eta.test.ts
 */
import {
  extractTrackingNo,
  isAttentionTransit,
  parseEtaDate,
  shanghaiToday,
} from "./eta.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const today = shanghaiToday();
assert(parseEtaDate("预计今日达") === today, "今日达 → eta");
assert(parseEtaDate("2026-09-24 派送") === "2026-09-24", "iso eta");
assert(extractTrackingNo("运单号：SF1234567890123") === "SF1234567890123", "tracking");
assert(
  extractTrackingNo("订单号 3317054772103002469 下单账号") === "",
  "订单号不得当成运单号",
);
assert(
  extractTrackingNo("运输中 韵达 435367969959420 已离开深圳") === "435367969959420",
  "15位运单应保留",
);
assert(isAttentionTransit("派送中", "待收货", null, today), "派送中");
assert(isAttentionTransit("运输中", "待收货", today, today), "eta=today");
assert(!isAttentionTransit("已发货", "待收货", null, today), "待收货 alone not attention");

console.log("eta.test.ts OK");
