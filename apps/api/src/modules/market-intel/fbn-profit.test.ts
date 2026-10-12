/**
 * 轻量公式锁：npx tsx src/modules/market-intel/fbn-profit.test.ts
 */
import {
  DEFAULT_FBN_ASSUMPTIONS_GENERAL,
  estimateFbnUnitProfit,
  mergeFbnAssumptions,
  resolveFbnAssumptionsFromQuery,
} from "./fbn-profit.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function assertClose(actual: number, expected: number, digits: number, msg: string) {
  const eps = 10 ** -digits;
  assert(Math.abs(actual - expected) <= eps, `${msg}: got ${actual}, expected ~${expected}`);
}

{
  const assumptions = mergeFbnAssumptions(DEFAULT_FBN_ASSUMPTIONS_GENERAL, {
    purchaseCostSar: 45 / 1.9,
    storageSar: 0,
  });
  const r = estimateFbnUnitProfit(159, assumptions);
  assert(r != null, "row estimate not null");
  const E = 45 / 1.9;
  const K = 159 * 0.15;
  const L = (K + 10.5 + 0) * 0.15;
  const P = 0.5 * 20;
  const sumEM = E + 0.5 + 0.5 + 0.8 + 2.5 + 10.5 + K + L + 0;
  const expectedR = 159 - sumEM - P;
  assertClose(r!.referralFeeSar, K, 2, "referral");
  assertClose(r!.vatPayableSar, L, 2, "vat");
  assertClose(r!.adCostSar, P, 2, "ad");
  assertClose(r!.profitSar, expectedR, 2, "profit");
  assertClose(r!.marginPct!, expectedR / 159, 4, "margin");
  assertClose(r!.multiple!, 159 / E, 2, "multiple");
  assert(r!.profitComplete === true, "complete with purchase");
}

{
  const common = { purchaseCostSar: 45 / 1.9, storageSar: 0 };
  const g = estimateFbnUnitProfit(
    159,
    mergeFbnAssumptions(DEFAULT_FBN_ASSUMPTIONS_GENERAL, common),
  );
  const f = estimateFbnUnitProfit(
    159,
    mergeFbnAssumptions(
      { ...DEFAULT_FBN_ASSUMPTIONS_GENERAL, commissionRate: 0.25 },
      common,
    ),
  );
  assert(g != null && f != null, "both profiles");
  assert(f!.referralFeeSar > g!.referralFeeSar, "25% referral higher");
  assert(f!.profitSar < g!.profitSar, "25% profit lower");
}

{
  const r = estimateFbnUnitProfit(159, DEFAULT_FBN_ASSUMPTIONS_GENERAL);
  assert(r?.profitComplete === false, "incomplete without purchase");
  assert(r?.missing.includes("purchaseCostSar") === true, "missing purchase");
  assert(typeof r?.profitSar === "number", "still estimates platform side");
}

assert(
  estimateFbnUnitProfit(null, DEFAULT_FBN_ASSUMPTIONS_GENERAL) === null,
  "null price",
);
assert(
  estimateFbnUnitProfit(0, DEFAULT_FBN_ASSUMPTIONS_GENERAL) === null,
  "zero price",
);

{
  const a = resolveFbnAssumptionsFromQuery({
    profile: "fashion_25",
    costSar: "80",
    shipSar: "12",
  });
  assert(a.commissionRate === 0.25, "fashion profile");
  assert(a.purchaseCostSar === 80, "legacy costSar");
  assert(a.outboundFeeSar === 12, "legacy shipSar→outbound");
}

console.log("fbn-profit.test.ts: ok");
