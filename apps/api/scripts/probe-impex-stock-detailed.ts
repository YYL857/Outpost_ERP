/**
 * Probe Impex FBN Inventory Ledger Detailed (warehouse-level?).
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
  const { exportCode, csv, category } = await runImpexExportCsv(
    connection,
    IMPEX_EXPORT_CATEGORIES.stockFbnDetailed,
    { from_date: y, to_date: y },
    { timeoutMs: 180_000, pollMs: 2500 },
  );
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const outDir = join("scripts", "_out");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(
    outDir,
    `impex-stock-detailed-${cred.project_code}-${y}.csv`,
  );
  writeFileSync(outPath, csv, "utf8");
  console.log(
    JSON.stringify(
      {
        exportCode,
        category,
        rows: lines.length - 1,
        outPath,
        header: lines[0]?.slice(0, 600),
        row1: lines[1]?.slice(0, 400),
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
