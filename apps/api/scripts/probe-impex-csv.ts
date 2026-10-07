/**
 * Sample Impex catalog CSV header (one-shot probe).
 */
import {
  clearNoonApiGatewayCache,
  loginNoonApiGateway,
  readNoonCredentialsFile,
} from "../src/platforms/noon/http.js";
import { runImpexExportCsv } from "../src/platforms/noon/impex-client.js";
import type { NoonConnection } from "../src/common/types.js";

process.env.OUTPOST_NOON_CREDENTIALS_FILE =
  process.env.OUTPOST_NOON_CREDENTIALS_FILE ||
  "D:\\noon_credentials_sensitive.json";

async function main() {
  clearNoonApiGatewayCache();
  const cred = readNoonCredentialsFile();
  if (!cred) throw new Error("no cred");
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

  const { exportCode, csv, category } = await runImpexExportCsv(
    connection,
    "noon_catalog_catalogexport",
    { country: "sa", noon_status: "live" },
    { timeoutMs: 180_000, pollMs: 2000 },
  );
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  console.log({ exportCode, category, rows: lines.length - 1 });
  console.log("header:", lines[0]?.slice(0, 500));
  console.log("row1:", lines[1]?.slice(0, 400));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
