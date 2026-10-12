/**
 * Pull sources for Jun–Sep gross-profit reports:
 * - Feishu accounts (incl. 产品包装采购)
 * - Noon Impex invoices + sales (Jun lookback) per shop
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  IMPEX_EXPORT_CATEGORIES,
  runImpexExportCsv,
} from "../src/platforms/noon/impex-client.js";
import type { NoonConnection } from "../src/common/types.js";
import { existsSync } from "node:fs";
import {
  runWithContext,
  SYSTEM_SYNC_USER,
} from "../src/auth/context.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = resolve(apiRoot, "scripts/_out/gp-sources");
loadDotenv({ path: resolve(apiRoot, "../..", ".env") });
loadDotenv({ path: resolve(apiRoot, ".env") });

const SHOPS = [
  {
    id: "PRJ396770",
    code: "N1",
    name: "HUI Beauty",
    credentialsFile: "D:\\PRJ396770\\noon_credentials_sensitive.json",
  },
  {
    id: "PRJ482387",
    code: "N2",
    name: "HFY-KSA",
    credentialsFile: "D:\\PRJ482387\\noon_credentials_sensitive.json",
  },
] as const;

function connFor(shop: (typeof SHOPS)[number]): NoonConnection {
  process.env.OUTPOST_NOON_CREDENTIALS_FILE = shop.credentialsFile;
  return {
    mode: "live",
    enabled: true,
    baseUrl: process.env.NOON_BASE_URL || "https://api.noon.com",
    partnerId: shop.id,
    apiKey: "",
    apiSecret: "",
    webhookSecret: "",
    countryCode: "sa",
    pollIntervalMs: 60_000,
  };
}

mkdirSync(outRoot, { recursive: true });
writeFileSync(
  join(outRoot, "feishu-run.txt"),
  "2026-09-29T03-47-13-498Z_260f2443",
  "utf8",
);

for (const shop of SHOPS) {
  if (!existsSync(shop.credentialsFile)) {
    console.warn("skip shop, no creds", shop.id);
    continue;
  }
  const shopDir = join(outRoot, shop.id);
  mkdirSync(shopDir, { recursive: true });
  const connection = connFor(shop);
  console.log("\n=== Impex", shop.id, "===");

  const from_date = "2026-06-01";
  const to_date = "2026-09-29";
  const country = "sa";
  const lang = "en";

  await runWithContext({ user: SYSTEM_SYNC_USER, shopId: shop.id }, async () => {
    for (const [label, category] of [
      ["sales", IMPEX_EXPORT_CATEGORIES.sales],
      ["invoices", IMPEX_EXPORT_CATEGORIES.invoices],
    ] as const) {
      try {
        console.log("pulling", label, "...");
        const { csv, exportCode } = await runImpexExportCsv(
          connection,
          category,
          { from_date, to_date, country, lang },
        );
        const path = join(shopDir, `${label}_${from_date}_${to_date}.csv`);
        writeFileSync(path, csv, "utf8");
        console.log("wrote", path, "bytes", csv.length, "export", exportCode);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("FAIL", shop.id, label, msg.slice(0, 300));
        writeFileSync(join(shopDir, `${label}_ERROR.txt`), msg, "utf8");
      }
    }
  });
}

console.log("\nDONE", outRoot);
