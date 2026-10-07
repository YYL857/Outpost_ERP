/**
 * Probe GetContent / products for image URLs.
 */
import {
  clearNoonApiGatewayCache,
  loginNoonApiGateway,
  noonRequest,
  readNoonCredentialsFile,
} from "../src/platforms/noon/http.js";
import type { NoonConnection } from "../src/common/types.js";

process.env.OUTPOST_NOON_CREDENTIALS_FILE =
  process.env.OUTPOST_NOON_CREDENTIALS_FILE ||
  "D:\\noon_credentials_sensitive.json";

async function main() {
  const cred = readNoonCredentialsFile();
  if (!cred) throw new Error("no cred");
  clearNoonApiGatewayCache();
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
  } as NoonConnection;

  const skuParent = "Z7F138677801CCCDA6C22Z";
  const skuChild = "Z7F138677801CCCDA6C22Z-1";
  const partnerSku = "N1SATZWJ001MLT";

  for (const body of [
    { sku_parent: skuParent },
    { sku_parent: skuChild },
    { partner_sku: partnerSku },
    { skus: [partnerSku] },
  ]) {
    try {
      const res = await noonRequest(
        connection,
        "POST",
        "/content/v1/product/content/get",
        body,
      );
      console.log("OK body", JSON.stringify(body));
      console.log(JSON.stringify(res).slice(0, 2000));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log("FAIL", JSON.stringify(body), msg.slice(0, 250));
    }
  }

  for (const path of [
    "/content/v1/products?limit=2",
    "/content/v1/product/list?limit=2",
    "/catalog/v1/products?limit=2",
  ]) {
    try {
      const res = await noonRequest(connection, "GET", path);
      console.log("LIST", path, JSON.stringify(res).slice(0, 1500));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log("LIST FAIL", path, msg.slice(0, 250));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
