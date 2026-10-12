/**
 * Statement 结算聚合自测
 * pnpm exec tsx src/modules/finance/statement-settlement.test.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectDomainFromFilename } from "../../platforms/noon/portal/parsers.js";
import {
  aggregateStatementCsv,
  buildSettlementSummary,
  computeMonthCosts,
  evaluateCloseGate,
  lastDayOfMonth,
  upsertSettlementMonths,
} from "./statement-settlement.js";
import { closeGpMonth } from "./gp-close.js";
import type { AppState } from "../../common/types.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) {
    console.error("FAIL:", msg, "got", a, "expected", b);
    process.exit(1);
  }
}

function assertClose(a: number, b: number, msg: string, eps = 0.02) {
  if (Math.abs(a - b) > eps) {
    console.error("FAIL:", msg, "got", a, "expected", b);
    process.exit(1);
  }
}

assertEq(
  detectDomainFromFilename("noon_financeweb_statements_2026-06_09.csv"),
  "statements",
  "statements domain",
);
assertEq(
  detectDomainFromFilename("statements_2026-09.csv"),
  "statements",
  "statements_ prefix",
);
assertEq(
  detectDomainFromFilename("transactionview_fees.csv"),
  "fees",
  "transactionview stays fees",
);
assert(
  detectDomainFromFilename("noon_financeweb_transactionviewreport.csv") ===
    "fees",
  "transactionview report is fees not statements",
);

const sampleCsv = [
  "Contract,Date,Transaction,Reference,Details EN,Amount",
  "X,2026-07-15,statement,PS-1,Net Proceeds,1000.50",
  "X,2026-07-15,statement,PS-1,Advertising Fee,-100.00",
  "X,2026-07-15,statement,PS-1,Referral Fee,-200.00",
  "X,2026-07-15,statement,PS-1,FBN Outbound Fee,-50.25",
  "X,2026-07-15,statement,PS-1,Return Administration Fee,-10.00",
  "X,2026-07-15,statement,PS-1,VAT Payable,-80.00",
  "X,2026-07-20,statement,PS-2,Net Proceeds,500.00",
  "X,2026-08-01,statement,PS-3,Net Proceeds,200.00",
  "X,2026-08-01,statement,PS-3,Warranty Fee,-5.00",
].join("\n");

const months = aggregateStatementCsv(sampleCsv);
assertEq(months.length, 2, "two months");
const jul = months.find((m) => m.month === "2026-07")!;
assert(jul, "july present");
assertClose(jul.netProceedsSar, 1500.5, "july net proceeds");
assertClose(jul.platformFeesSar, 360.25, "july platform fees");
assertClose(jul.vatSar, 80, "july vat");
assertClose(jul.feeBreakdown.advertising, 100, "adv");
assertClose(jul.feeBreakdown.referral, 200, "ref");
assertClose(jul.feeBreakdown.fbnOutbound, 50.25, "fbn");
assertClose(jul.feeBreakdown.returnAdmin, 10, "return admin");
assertEq(jul.minDate, "2026-07-15", "min date");
assertEq(jul.maxDate, "2026-07-20", "max date");
assertEq(jul.statementCount, 2, "july NP rows");
assertEq(jul.hasMonthEndStatement, false, "july not month-end");

const aug = months.find((m) => m.month === "2026-08")!;
assertClose(aug.netProceedsSar, 200, "aug np");
assertClose(aug.otherFeesSar, 5, "warranty in other");
assertClose(aug.platformFeesSar, 0, "aug no core fees");

const costs = computeMonthCosts(
  [
    {
      partnerSku: "A",
      date: "2026-07-10",
      units: 2,
      amount: 100,
      updatedAt: "",
    },
    {
      partnerSku: "B",
      date: "2026-07-11",
      units: 1,
      amount: 50,
      updatedAt: "",
    },
  ],
  [
    {
      partnerSku: "A",
      purchaseCost: 10,
      headhaul: 3,
      preferAir: true,
      updatedAt: "",
    },
  ],
  "2026-07",
);
assertClose(costs.purchaseCny, 20, "purchase 2×10");
assertClose(costs.headhaulCny, 6, "headhaul 2×3");
assertEq(costs.skuMissingCost, 1, "B missing cost");

const state = {
  settlementMonths: [],
  gpMonthCloses: [],
  orders: [],
  salesFacts: [
    {
      partnerSku: "A",
      date: "2026-07-10",
      units: 2,
      amount: 100,
      updatedAt: "",
    },
  ],
  skuLocalCosts: [
    {
      partnerSku: "A",
      purchaseCost: 10,
      headhaul: 3,
      preferAir: true,
      updatedAt: "",
    },
  ],
  shipping: { buybackRate: 1.76 },
} as unknown as AppState;

upsertSettlementMonths(state, months, "sample.csv", "2026-09-30T00:00:00.000Z");
assertEq(state.settlementMonths.length, 2, "upserted months");

const summary = buildSettlementSummary(state, { from: "2026-07", to: "2026-07" });
assertEq(summary.basis, "noon_statement", "basis");
assertEq(summary.months.length, 1, "filtered one month");
assertClose(summary.months[0]!.pureProfitCny, (1500.5 - 360.25 - 80) * 1.76 - 20 - 6, "pure profit");
assert(summary.caveats.some((c) => c.includes("skuLocalCosts")), "cost caveat");
assertEq(summary.months[0]!.closeStatus, "incomplete", "july incomplete");
assertEq(summary.targetMonth.length, 7, "target month yyyy-mm");

const juneCsv = [
  "Date,Details EN,Amount",
  "2026-06-04,Net Proceeds,100",
  "2026-06-10,Net Proceeds,100",
  "2026-06-17,Net Proceeds,100",
  "2026-06-24,Net Proceeds,100",
  "2026-06-30,Net Proceeds,100",
  "2026-06-30,Advertising Fee,-20",
  "2026-06-30,Referral Fee,-10",
  "2026-06-30,FBN Outbound Fee,-5",
  "2026-06-30,Return Administration Fee,-1",
  "2026-06-30,VAT Payable,-8",
].join("\n");
const juneMonths = aggregateStatementCsv(juneCsv);
const june = juneMonths.find((m) => m.month === "2026-06")!;
assertEq(june.statementCount, 5, "june 5 NP");
assertEq(june.hasMonthEndStatement, true, "june month-end");
assertEq(june.maxDate, "2026-06-30", "june max");

const closeState = {
  ...state,
  gpMonthCloses: [],
  settlementMonths: [],
  salesFacts: [
    {
      partnerSku: "A",
      date: "2026-06-10",
      units: 2,
      amount: 100,
      updatedAt: "",
    },
  ],
} as unknown as AppState;
upsertSettlementMonths(closeState, juneMonths, "june.csv");
const juneGate = evaluateCloseGate(closeState, "2026-06");
assertEq(juneGate.ok, true, "june gate ok");
const closed1 = closeGpMonth(closeState, "2026-06", { closedBy: "manual" });
assert(closed1.ok, "june closed");
if (closed1.ok) {
  assertClose(closed1.close.netProceedsSar, 500, "closed NP");
}
const again = closeGpMonth(closeState, "2026-06");
assertEq(again.ok, false, "second close without replace");

upsertSettlementMonths(
  closeState,
  aggregateStatementCsv(
    juneCsv.replace("2026-06-30,Net Proceeds,100", "2026-06-30,Net Proceeds,999"),
  ),
  "june-v2.csv",
);
assertClose(
  closeState.settlementMonths.find((m) => m.month === "2026-06")!.netProceedsSar,
  1399,
  "draft NP updated",
);
const still = closeState.gpMonthCloses.find((c) => c.status === "closed")!;
assertClose(still.netProceedsSar, 500, "snapshot unchanged after upsert");
assertEq(
  buildSettlementSummary(closeState, { from: "2026-06", to: "2026-06" })
    .months[0]!.netProceedsSar,
  500,
  "summary uses snapshot",
);

const replaced = closeGpMonth(closeState, "2026-06", { replace: true });
assert(replaced.ok, "replace close");
if (replaced.ok) {
  assertClose(replaced.close.netProceedsSar, 1399, "new snapshot NP");
}
assertEq(
  closeState.gpMonthCloses.filter((c) => c.status === "superseded").length,
  1,
  "old superseded",
);
assertEq(
  closeState.gpMonthCloses.filter((c) => c.status === "closed").length,
  1,
  "one active close",
);

// 真账单抽样：若 gp-sources 存在则校验非空月份
const realPath = resolve(
  process.cwd(),
  "scripts/_out/gp-sources/PRJ396770/noon_financeweb_statements_2026-06_09.csv",
);
try {
  const real = readFileSync(realPath, "utf8");
  const realMonths = aggregateStatementCsv(real);
  assert(realMonths.length >= 3, "real statement has >=3 months");
  const sep = realMonths.find((m) => m.month === "2026-09");
  if (sep) {
    assert(sep.netProceedsSar > 0, "sep net proceeds > 0");
    assert(sep.maxDate.startsWith("2026-09"), "sep max date");
    assertEq(sep.statementCount, 4, "sep 4 weekly NP");
    assertEq(sep.hasMonthEndStatement, false, "sep missing 09-30");
    const sepState = {
      ...state,
      gpMonthCloses: [],
      settlementMonths: [],
    } as unknown as AppState;
    upsertSettlementMonths(sepState, realMonths, "hui.csv");
    const gate = evaluateCloseGate(sepState, "2026-09");
    assertEq(gate.ok, false, "sep close rejected");
    assertEq(gate.coverageComplete, false, "sep coverage incomplete");
    const closeFail = closeGpMonth(sepState, "2026-09");
    assertEq(closeFail.ok, false, "sep closeGpMonth 409");

    const patched = `${real}\nMPB854XPSESA,title,2026-09-30,statement,PS-396770-SA20260930,Net Proceeds,ar,100.00,0`;
    const withEnd = aggregateStatementCsv(patched);
    const sep2 = withEnd.find((m) => m.month === "2026-09")!;
    assertEq(sep2.hasMonthEndStatement, true, "patched month-end");
    assert(sep2.statementCount >= 5, "patched 5 NP");
    assert(sep2.maxDate >= lastDayOfMonth("2026-09"), "patched coverage");
  }
  console.log(
    "real HUI months:",
    realMonths.map((m) => `${m.month}:${m.netProceedsSar}`).join(", "),
  );
} catch {
  console.log("skip real CSV (file missing)");
}

console.log("OK statement-settlement");
