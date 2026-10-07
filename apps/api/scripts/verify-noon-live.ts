/**
 * 验证 live：whoami + 单次 catalog(live) Impex（省配额；不连拉 orders）
 */
import {
  clearNoonApiGatewayCache,
  readNoonCredentialsFile,
} from "../src/platforms/noon/http.js";
import { LiveNoonClient } from "../src/platforms/noon/live-client.js";
import type { NoonConnection } from "../src/common/types.js";

process.env.OUTPOST_NOON_CREDENTIALS_FILE =
  process.env.OUTPOST_NOON_CREDENTIALS_FILE ||
  "D:\\noon_credentials_sensitive.json";

async function main() {
  clearNoonApiGatewayCache();
  const cred = readNoonCredentialsFile();
  if (!cred) throw new Error("missing credentials file");

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

  const client = new LiveNoonClient(connection);
  const v = await client.validateCredentials();
  console.log("validate:", v);
  if (!v.ok) process.exit(1);

  const onlyWhoami = process.argv.includes("--whoami-only");
  if (onlyWhoami) {
    console.log("OK (whoami only)");
    return;
  }

  console.log("fetching catalog (live only, 1 Impex slot)…");
  const catalog = await client.fetchCatalogSince(null);
  const hints = client.drainStockHints();
  console.log("catalog rows:", catalog.length, "stock hints:", hints.length);
  if (catalog[0]) {
    console.log("sample:", {
      partner_sku: catalog[0].partner_sku,
      title: catalog[0].title?.slice(0, 60),
      price: catalog[0].price,
      is_active: catalog[0].is_active,
    });
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
