import {
  clearNoonApiGatewayCache,
  loginNoonApiGateway,
  noonRequest,
  readNoonCredentialsFile,
} from "../src/platforms/noon/http.js";
import type { NoonConnection } from "../src/common/types.js";

process.env.OUTPOST_NOON_CREDENTIALS_FILE = "D:\\noon_credentials_sensitive.json";
const cred = readNoonCredentialsFile()!;
clearNoonApiGatewayCache();
await loginNoonApiGateway(true);
const connection = {
  mode: "live",
  partnerId: cred.project_code,
  apiKey: "", apiSecret: "", webhookSecret: "",
  baseUrl: "https://noon-api-gateway.noon.partners",
  countryCode: "sa", enabled: true,
  lastValidatedAt: null, lastError: null,
} as NoonConnection;

const res: any = await noonRequest(connection, "POST", "/content/v1/product/content/get", {
  sku_parent: "Z7F138677801CCCDA6C22Z",
});
console.log("keys", Object.keys(res || {}));
console.log("images", JSON.stringify(res?.images ?? null, null, 2));
console.log("sku_parent", res?.sku_parent);
if (res?.images?.[0]) console.log("first image url", res.images[0].url);
