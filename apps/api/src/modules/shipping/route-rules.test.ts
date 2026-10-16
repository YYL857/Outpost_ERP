/**
 * pnpm exec tsx src/modules/shipping/route-rules.test.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isCoffeeProduct,
  isGlassesProduct,
  isMonitorBand,
  loadRouteRules,
  saveRouteRules,
  suggestForwarder,
} from "./route-rules.js";

const root = mkdtempSync(join(tmpdir(), "outpost-route-rules-"));
process.env.OUTPOST_ROOT = root;

try {
  assert.equal(isCoffeeProduct("咖啡磨粉机-8002", "N1SAKFJ001BLK"), true);
  assert.equal(isCoffeeProduct("咖啡机垫托盘-黑色", "N2SATP001BLK"), false);
  assert.equal(isMonitorBand("监测手环-黑色(带屏显）", "N2SAJCSH002BLK"), true);
  assert.equal(isGlassesProduct("防蓝光眼镜-黑色"), true);

  const rules = loadRouteRules();
  assert.equal(rules.generalForwarder, "汉沙");

  const coffee = suggestForwarder({
    partnerSku: "N1SAKFJ001BLK",
    name: "咖啡磨粉机-8002",
  });
  assert.equal(coffee.forwarder, "亚优汇");

  const general = suggestForwarder({
    partnerSku: "N1SAETWJ001MLT",
    name: "儿童益智玩具-彩色",
    warehouseType: "普货",
  });
  assert.equal(general.forwarder, "汉沙");

  const batt = suggestForwarder({
    partnerSku: "N1SACDQ001BLK",
    name: "电池充电器-黑色",
    warehouseType: "带电",
  });
  assert.equal(batt.forwarder, "飞坦");

  saveRouteRules({ batteryToHansha: true, batteryToHanshaSince: "2026-10-01" });
  const batt2 = suggestForwarder({
    partnerSku: "N1SACDQ001BLK",
    name: "电池充电器-黑色",
    warehouseType: "带电",
    asOfYmd: "2026-10-15",
  });
  assert.equal(batt2.forwarder, "汉沙");

  console.log("route-rules.test.ts: ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
