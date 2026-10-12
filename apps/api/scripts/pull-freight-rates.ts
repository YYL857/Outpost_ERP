import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const text = readFileSync(resolve(process.cwd(), "../../.env"), "utf8");
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const k = m[1]!.trim();
  let v = m[2]!.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  if (!process.env[k]) process.env[k] = v;
}
process.env.OUTPOST_FEISHU_DOCS_FILE = resolve("config/feishu.docs.json");
process.env.OUTPOST_FEISHU_RAW_DIR = "D:\\outpost-data\\feishu-raw";

const { loadFeishuDocsConfig, pullFeishuRaw } = await import(
  "../src/platforms/feishu/index.js"
);
const cfg = loadFeishuDocsConfig();
const fr = cfg.docs.find((d) => d.id === "freight-rates");
console.log("cfg freight-rates", {
  kind: fr?.kind,
  table: fr?.bitableTableId,
  wiki: fr?.wikiToken,
  enabled: fr?.enabled,
});
const pull = await pullFeishuRaw(cfg, { docIds: ["freight-rates"] });
console.log(JSON.stringify(pull.results[0], null, 2));
