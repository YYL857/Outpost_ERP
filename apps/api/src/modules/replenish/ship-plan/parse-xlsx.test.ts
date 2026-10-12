/**
 * pnpm exec tsx src/modules/replenish/ship-plan/parse-xlsx.test.ts
 */
import { readFileSync } from "node:fs";
import { parseShipPlanWorkbook } from "./parse-xlsx.js";

const path = process.argv[2] || "D:\\Desktop\\补货(3).xlsx";
const buf = readFileSync(path);
const parsed = parseShipPlanWorkbook(buf);

console.log("sheet:", parsed.sheetName);
console.log("lines:", parsed.lines.length);
console.log("warnings:", parsed.warnings.length);
const dates = [...new Set(parsed.lines.map((l) => l.planDate))];
console.log("planDates:", dates);
const skip = parsed.lines.filter((l) => !l.include);
console.log("skip:", skip.map((l) => l.partnerSku).join(", "));
const airOnly = parsed.lines.filter((l) =>
  /全部/.test(l.note),
);
console.log(
  "air-note samples:",
  airOnly.map((l) => `${l.partnerSku}:${l.legs.map((g) => `${g.mode}×${g.qty}`).join("+")}`),
);
const sample = parsed.lines.slice(0, 3).map((l) => ({
  sku: l.partnerSku,
  name: l.productName,
  air: l.suggestAir,
  sea: l.suggestSea,
  include: l.include,
  legs: l.legs.map((g) => `${g.mode}:${g.qty}`),
  planDate: l.planDate,
}));
console.log(JSON.stringify(sample, null, 2));

if (parsed.lines.length < 40) {
  throw new Error(`expected ~45+ lines, got ${parsed.lines.length}`);
}
const vr = parsed.lines.find((l) => l.partnerSku === "N1SAVRYJ001BLK");
if (!vr || vr.legs.length !== 1 || vr.legs[0]!.mode !== "air") {
  throw new Error("VR 眼镜应合并为全部空运");
}
const noRep = parsed.lines.find((l) => l.partnerSku === "N1SALFQ001WHT");
if (!noRep || noRep.include) {
  throw new Error("理发器应标记不补货");
}
console.log("parse-xlsx.test.ts: ok");
