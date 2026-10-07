import {
  clearNoonApiGatewayCache,
  loginNoonApiGateway,
  readNoonCredentialsFile,
} from "../src/platforms/noon/http.js";

process.env.OUTPOST_NOON_CREDENTIALS_FILE =
  process.env.OUTPOST_NOON_CREDENTIALS_FILE ||
  "D:\\noon_credentials_sensitive.json";

const base = "https://noon-api-gateway.noon.partners";

async function hit(
  cookie: string,
  project: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "User-Agent": "OutpostErp/0.1",
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-Project": project,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    path,
    method,
    status: res.status,
    preview: text.slice(0, 400).replace(/\s+/g, " "),
  };
}

async function main() {
  clearNoonApiGatewayCache();
  const cred = readNoonCredentialsFile();
  if (!cred) throw new Error("no cred");
  const { cookieHeader } = await loginNoonApiGateway(true);
  const cat = await hit(
    cookieHeader,
    cred.project_code,
    "GET",
    "/impex/v1/export/category/list",
  );
  const body = {
    export_category_code: "noon_catalog_catalogexport",
    params: { country: "ae", noon_status: "live" },
  };
  const paths = [
    "/impex/v1/export/create",
    "/impex/v1/export",
    "/impex/v1/exports",
    "/impex/v1/job/create",
    "/impex/v1/export/job/create",
    "/impex/v1/export/request",
    "/impex/v1/export/enqueue",
  ];
  const createTries = [];
  for (const path of paths) {
    createTries.push(await hit(cookieHeader, cred.project_code, "POST", path, body));
  }
  // also try stock paths from docs naming
  const stockTries = [];
  for (const path of [
    "/stock/v1/stock/get",
    "/stock/v1/get",
    "/stock/v1/stock-get",
    "/stock/v1/stocks/get",
  ]) {
    stockTries.push(
      await hit(cookieHeader, cred.project_code, "POST", path, { items: [] }),
    );
  }
  console.log(JSON.stringify({ cat, createTries, stockTries }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
