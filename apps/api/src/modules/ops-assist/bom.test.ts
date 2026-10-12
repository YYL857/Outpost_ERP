/**
 * BOM 只汇总物料并调用现有公式。
 * npx tsx src/modules/ops-assist/bom.test.ts
 */
import { quoteBom } from "./bom.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function assertClose(actual: number, expected: number, msg: string) {
  assert(Math.abs(actual - expected) <= 0.02, `${msg}: got ${actual}, expected ~${expected}`);
}

{
  const quoted = quoteBom({
    sellPriceSar: 100,
    profile: "general_15",
    lines: [
      { name: "外壳", category: "purchase", unitCostSar: 10, qty: 2 },
      { name: "芯片", category: "purchase", unitCostSar: 5, qty: 1 },
      { name: "空运", category: "first_mile", unitCostSar: 3, qty: 1 },
      { name: "入仓", category: "warehouse", unitCostSar: 1, qty: 2 },
    ],
  });
  assert(!("error" in quoted), "quote should succeed");
  if ("error" in quoted) process.exit(1);
  assertClose(quoted.breakdown.purchaseCostSar ?? -1, 25, "purchase");
  assertClose(quoted.breakdown.firstMileSar, 3, "first mile");
  assertClose(quoted.breakdown.inboundListingSar, 0, "listing replaced");
  assertClose(quoted.breakdown.inboundPickSar, 0, "pick replaced");
  assertClose(quoted.breakdown.inboundHandleSar, 2, "warehouse sum");
  assert(quoted.breakdown.profitComplete, "purchase present");
  assertClose(quoted.breakdown.referralFeeSar, 15, "15% commission");
}

{
  const quoted = quoteBom({
    sellPriceSar: 80,
    profile: "fashion_25",
    lines: [],
  });
  assert(!("error" in quoted), "price-only quote");
  if ("error" in quoted) process.exit(1);
  assert(quoted.breakdown.purchaseCostSar == null, "no purchase");
  assert(!quoted.breakdown.profitComplete, "marked incomplete");
  assertClose(quoted.breakdown.referralFeeSar, 20, "25% commission");
  assert(quoted.usedDefaults.some((n) => n.includes("头程")), "default first mile noted");
}

{
  const bad = quoteBom({ sellPriceSar: 0, profile: "general_15", lines: [] });
  assert("error" in bad, "reject zero price");
}

console.log("bom.test ok");
