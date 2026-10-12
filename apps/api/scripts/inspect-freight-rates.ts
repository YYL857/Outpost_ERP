import { readFileSync } from "node:fs";
import { buildFreightRatesPayload } from "../src/platforms/feishu/normalize/freight-rates.js";

const p =
  "D:/outpost-data/feishu-raw/runs/2026-09-22T02-14-52-052Z_8b0db00d/freight-rates/snapshot.json";
const j = JSON.parse(readFileSync(p, "utf8")) as {
  sheets: Array<{ values: unknown[][] }>;
};
const values = j.sheets[0]!.values;
console.log("headers", values[0]);
const hi = (values[0] ?? []).findIndex((x) => String(x).trim() === "文本");
console.log("--- rows ---");
for (let i = 1; i < values.length; i++) {
  const row = values[i] ?? [];
  const name = String(row[hi] ?? "").trim();
  if (!name) continue;
  const gen = String(row[1] ?? "").slice(0, 50);
  console.log(`${i}\t${JSON.stringify(name)}\t${JSON.stringify(gen)}`);
}
console.log("--- parsed forwarders ---");
process.env.OUTPOST_FEISHU_RAW_DIR = "D:\\outpost-data\\feishu-raw";
console.log(buildFreightRatesPayload().byForwarder.map((x) => x.forwarder));
