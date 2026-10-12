import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../src/platforms/noon/portal/parsers.js";

const phasePath =
  "D:/outpost-data/shops/PRJ396770/ops_daily/运营面板_今天_2026-09-28.csv";
const goldenPath =
  "D:/Desktop/FLOW/pipelines/noon_ops_daily/golden/运营面板_今天_golden.csv";

const phase = parseCsv(readFileSync(phasePath, "utf8"));
const golden = parseCsv(readFileSync(goldenPath, "utf8"));
const gBySku = new Map(golden.map((r) => [r.sku, r]));

let matched = 0;
let salesEq = 0;
let priceEq = 0;
let onlineEq = 0;
let fbnEq = 0;
let smEq = 0;
const sample: unknown[] = [];

for (const p of phase) {
  const g = gBySku.get(p.sku);
  if (!g) continue;
  matched += 1;
  const se = Number(p["30销量"]) === Number(g["30销量"]);
  const pe = Math.abs(Number(p["在线价"]) - Number(g["在线价"])) < 0.011;
  const oe = p["当前在线状态"] === g["当前在线状态"];
  const fe = Number(p.fbn) === Number(g.fbn);
  const sme = Number(p.supermall) === Number(g.supermall);
  if (se) salesEq += 1;
  if (pe) priceEq += 1;
  if (oe) onlineEq += 1;
  if (fe) fbnEq += 1;
  if (sme) smEq += 1;
  if (sample.length < 8 && (!se || !fe || !pe)) {
    sample.push({
      sku: p.sku,
      psku: p.psku,
      pSales: p["30销量"],
      gSales: g["30销量"],
      pRet: p["近30天退货率"],
      gRet: g["近30天退货率"],
      pPrice: p["在线价"],
      gPrice: g["在线价"],
      pFbn: p.fbn,
      gFbn: g.fbn,
      pSm: p.supermall,
      gSm: g.supermall,
      pOnline: p["当前在线状态"],
      gOnline: g["当前在线状态"],
    });
  }
}

const summary = {
  phaseRows: phase.length,
  goldenRows: golden.length,
  matched,
  salesEq,
  priceEq,
  onlineEq,
  fbnEq,
  smEq,
  sample,
};
console.log(JSON.stringify(summary, null, 2));

const outDir = "D:/Desktop/FLOW/pipelines/noon_ops_daily/output";
mkdirSync(outDir, { recursive: true });
const dest = join(
  outDir,
  "运营面板_今天_outpost_phase1_PRJ396770_2026-09-28.csv",
);
writeFileSync(dest, readFileSync(phasePath));
console.log("copied", dest);
