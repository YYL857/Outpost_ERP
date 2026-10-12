/**
 * pnpm exec tsx src/modules/shipping/headhaul/headhaul.test.ts
 */
import assert from "node:assert/strict";
import type { ShippingConfig } from "../../../common/types.js";
import type { PackingBoxRow } from "../../../platforms/feishu/normalize/forwarder-board.js";
import type { PackingLineRow } from "../../../platforms/feishu/normalize/packing-lines.js";
import {
  extractFreightQuotes,
  summarizeQuotesByForwarder,
  type FreightRatesPayload,
} from "../../../platforms/feishu/normalize/freight-rates.js";
import {
  classifyCargoFromName,
  resolveCargoKind,
} from "./cargo-name-rules.js";
import { computeBoxHeadhaul } from "./allocate.js";
import { resolveForwarderRate } from "./rate-lookup.js";
import { summarizeSkuHeadhaul } from "./summarize.js";
import { computeHeadhaulRmb } from "../../catalog/assemble.js";

{
  assert.equal(classifyCargoFromName("圆的粘把布4个装"), "general");
  assert.equal(classifyCargoFromName("无线电动牙刷"), "battery");
  assert.equal(classifyCargoFromName("液体喷雾瓶"), "sensitive");
  assert.equal(classifyCargoFromName("充电液体喷雾"), "sensitive_battery");
  assert.equal(classifyCargoFromName("LED台灯"), "lamp");
  assert.equal(
    resolveCargoKind({ productName: "普通抹布", productCargoLabel: "带电普货" }),
    "battery",
  );
}

const shipping: ShippingConfig = {
  airFreightAedPerKg: 0,
  airLeadDays: 10,
  seaFreightAedPerCbm: 0,
  seaLeadDays: 60,
  airFreightRmbPerKg: 65,
  seaFreightRmbPerCbmPlug: 2200,
  seaFreightRmbPerCbmBuiltin: 2400,
  seaFreightRmbPerCbmGeneral: 1830,
  buybackRate: 1.8,
  volumetricDivisor: 6000,
  updatedAt: "2026-09-24T00:00:00.000Z",
};

const rateValues = [
  ["文本", "普货", "带电普货", "敏货", "灯具", "额外费用"],
  [
    "安世通",
    "(空运) 50/KG - (海运) 10/KG",
    "(空运) 60/KG",
    "(空运) 70/KG",
    "",
    "",
  ],
];
const quotes = extractFreightQuotes(rateValues);
const rates: FreightRatesPayload = {
  source: { snapshotPath: null, pulledAt: null, rowCount: 1 },
  quotes,
  byForwarder: summarizeQuotesByForwarder(quotes),
};

{
  const gen = resolveForwarderRate({
    rates,
    forwarder: "安世通",
    cargoKind: "general",
    mode: "air",
    shipping,
  });
  assert.equal(gen?.mid, 50);
  assert.equal(gen?.source, "exact");

  const sensBatt = resolveForwarderRate({
    rates,
    forwarder: "安世通",
    cargoKind: "sensitive_battery",
    mode: "air",
    shipping,
  });
  assert.equal(sensBatt?.mid, 70, "inferred max(sensitive,battery)=70");
  assert.equal(sensBatt?.source, "inferred");
}

const box: PackingBoxRow = {
  boxNo: "2609-477-N3-K",
  ticketNo: "T1",
  logisticsNo: "L1",
  forwarder: "安世通",
  mode: "air",
  modeRaw: "空派",
  pcs: 15,
  asn: "",
  shipAt: null,
  arriveAt: null,
  transitDays: null,
  warehouseStatus: "在途",
  domesticFreight: 30,
  ticketCrossFreight: null,
  boxCrossFreight: 1000,
  weightKg: 10,
  cbm: null,
  lengthCm: 50,
  widthCm: 40,
  heightCm: 30,
  settled: "",
};

const lines: PackingLineRow[] = [
  {
    boxNo: box.boxNo,
    partnerSku: "N1GEN001",
    name: "普通抹布",
    qty: 5,
    unitWeightKg: 1,
    totalWeightKg: 5,
    logisticsNo: "L1",
    ticketNo: "T1",
    mode: "air",
    modeRaw: "空运",
    arriveAt: null,
    warehouseStatus: "在途",
    shipAt: null,
    forwarder: "安世通",
  },
  {
    boxNo: box.boxNo,
    partnerSku: "N1SENS001",
    name: "液体喷雾",
    qty: 5,
    unitWeightKg: 1,
    totalWeightKg: 5,
    logisticsNo: "L1",
    ticketNo: "T1",
    mode: "air",
    modeRaw: "空运",
    arriveAt: null,
    warehouseStatus: "在途",
    shipAt: null,
    forwarder: "安世通",
  },
];

{
  const result = computeBoxHeadhaul({ box, lines, rates, shipping });
  assert.equal(result.lines.length, 2);
  // 计费重 max(10, 50*40*30/6000=10)=10；各行份额 0.5
  // 普货 5kg×50 + 国内15 = 265；敏货 5kg×70 + 国内15 = 365
  const gen = result.lines.find((l) => l.partnerSku === "N1GEN001")!;
  const sens = result.lines.find((l) => l.partnerSku === "N1SENS001")!;
  assert.equal(gen.cargoKind, "general");
  assert.equal(sens.cargoKind, "sensitive");
  assert.ok(sens.unitQuoteRmb > gen.unitQuoteRmb, "sensitive unit quote higher");
  assert.equal(gen.quoteRmb, 265);
  assert.equal(sens.quoteRmb, 365);
  assert.equal(gen.actualRmb, 515); // 1000*0.5 + 15
  assert.equal(sens.actualRmb, 515);
  assert.equal(gen.confidence, "actual");
  assert.equal(gen.unitHeadhaulRmb, 103); // 515/5

  const summaries = summarizeSkuHeadhaul([result]);
  const sGen = summaries.find((s) => s.partnerSku === "N1GEN001")!;
  assert.equal(sGen.basis, "actual");
  assert.equal(sGen.unitHeadhaulRmb, 103);
}

{
  // Catalog：无装箱 override → 单方式；有 override → 用 override
  assert.equal(
    computeHeadhaulRmb({
      chargeableKg: 1,
      volumeCm3: 1_000_000,
      shipping,
      preferAir: true,
    }),
    65,
  );
  assert.equal(
    computeHeadhaulRmb({
      chargeableKg: 1,
      volumeCm3: 1_000_000,
      shipping,
      preferAir: false,
      cargoType: "general",
    }),
    1830,
  );
  assert.equal(
    computeHeadhaulRmb({
      chargeableKg: 1,
      volumeCm3: 3000,
      shipping,
      skuHeadhaulRmb: 12,
    }),
    12,
  );
}

console.log("headhaul.test.ts OK");
