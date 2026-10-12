/**
 * Probe Impex FBN Inventory Ledger Summary for replenishment (one shop).
 * Usage:
 *   OUTPOST_NOON_CREDENTIALS_FILE=D:\PRJ482387\noon_credentials_sensitive.json npx tsx scripts/probe-impex-stock-summary.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  clearNoonApiGatewayCache,
  loginNoonApiGateway,
  readNoonCredentialsFile,
} from "../src/platforms/noon/http.js";
import {
  IMPEX_EXPORT_CATEGORIES,
  impexDateYmd,
  runImpexExportCsv,
} from "../src/platforms/noon/impex-client.js";
import type { NoonConnection } from "../src/common/types.js";

function yesterdayYmd(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return impexDateYmd(d);
}

async function main() {
  clearNoonApiGatewayCache();
  const cred = readNoonCredentialsFile();
  if (!cred) throw new Error("no credentials");
  await loginNoonApiGateway(true);

  const connection = {
    mode: "live",
    partnerId: cred.project_code,
    apiKey: "",
    apiSecret: "",
    webhookSecret: "",
    baseUrl: "https://noon-api-gateway.noon.partners",
    countryCode: "sa",
    enabled: true,
    lastValidatedAt: null,
    lastError: null,
    portal: {
      portalUrl: "",
      cookie: "",
      ordersUrl: "",
      catalogUrl: "",
      stockUrl: "",
      lastFetchAt: null,
      lastImportAt: null,
      lastImportSummary: null,
    },
  } as NoonConnection;

  const y = yesterdayYmd();
  console.log("project", cred.project_code, "date", y);

  const { exportCode, csv, category } = await runImpexExportCsv(
    connection,
    IMPEX_EXPORT_CATEGORIES.stockFbnSummary,
    { from_date: y, to_date: y },
    { timeoutMs: 180_000, pollMs: 2500 },
  );

  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0] ?? "";
  const outDir = join("scripts", "_out");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(
    outDir,
    `impex-stock-summary-${cred.project_code}-${y}.csv`,
  );
  writeFileSync(outPath, csv, "utf8");

  const ft = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const first = line.split(",")[0]?.trim().toLowerCase() ?? "";
    ft.set(first, (ft.get(first) ?? 0) + 1);
  }

  console.log(
    JSON.stringify(
      {
        exportCode,
        category,
        rows: lines.length - 1,
        outPath,
        header: header.slice(0, 400),
        fulfillmentCounts: Object.fromEntries(ft),
        hasClosingStock: /closing_stock/i.test(header),
        hasPbarcode: /pbarcode/i.test(header),
        hasFulfillmentType: /fulfillment_type/i.test(header),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
