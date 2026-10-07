import {
  clearNoonApiGatewayCache,
  loginNoonApiGateway,
  readNoonCredentialsFile,
} from "../src/platforms/noon/http.js";

process.env.OUTPOST_NOON_CREDENTIALS_FILE =
  process.env.OUTPOST_NOON_CREDENTIALS_FILE ||
  "D:\\noon_credentials_sensitive.json";

const base = "https://noon-api-gateway.noon.partners";

async function main() {
  clearNoonApiGatewayCache();
  const cred = readNoonCredentialsFile()!;
  const { cookieHeader } = await loginNoonApiGateway(true);
  const res = await fetch(base + "/impex/v1/export/category/list", {
    headers: {
      Cookie: cookieHeader,
      "X-Project": cred.project_code,
      Accept: "application/json",
      "User-Agent": "OutpostErp/0.1",
    },
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2).slice(0, 12000));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
