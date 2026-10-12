/**
 * One-shot: list all sheets in Feishu accounts / packing docs.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { loadFeishuDocsConfig } from "../src/platforms/feishu/index.js";
import { createFeishuHttpClient } from "../src/platforms/feishu/http.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: resolve(apiRoot, "../..", ".env") });
loadDotenv({ path: resolve(apiRoot, ".env") });

const cfg = loadFeishuDocsConfig({ requireCredentials: true });
const http = createFeishuHttpClient(cfg.credentials);

for (const id of ["accounts", "packing", "product"]) {
  const doc = cfg.docs.find((d) => d.id === id);
  if (!doc?.spreadsheetToken) {
    console.log(id, "NO TOKEN");
    continue;
  }
  const sheets = await http.listSheets(doc.spreadsheetToken);
  console.log(
    "\n==",
    id,
    doc.spreadsheetToken,
    "==\n",
    sheets.map((s) => `${s.sheetId}\t${s.title}`).join("\n"),
  );
}
