import {
  clearNoonApiGatewayCache,
  loginNoonApiGateway,
  readNoonCredentialsFile,
} from "../src/platforms/noon/http.ts";

const base = "https://noon-api-gateway.noon.partners";
const ua = "OutpostErp/0.1 (PartnerAPI)";

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
      "User-Agent": ua,
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-Project": project,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let keys: string[] = [];
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") keys = Object.keys(parsed).slice(0, 15);
  } catch {
    /* ignore */
  }
  return {
    method,
    path,
    status: res.status,
    keys,
    preview: text.slice(0, 280).replace(/\s+/g, " "),
  };
}

async function main() {
  process.env.OUTPOST_NOON_CREDENTIALS_FILE =
    process.env.OUTPOST_NOON_CREDENTIALS_FILE ||
    "D:\\noon_credentials_sensitive.json";
  clearNoonApiGatewayCache();
  const cred = readNoonCredentialsFile();
  if (!cred) throw new Error("no credentials");
  const session = await loginNoonApiGateway(true);
  const tests = [
    await hit(session.cookieHeader, cred.project_code, "POST", "/content/v1/categories/list", {}),
    await hit(session.cookieHeader, cred.project_code, "GET", "/impex/v1/export/category/list"),
    await hit(session.cookieHeader, cred.project_code, "GET", "/impex/v1/export-category/list"),
    await hit(session.cookieHeader, cred.project_code, "GET", "/fbpi/v1/orders"),
    await hit(session.cookieHeader, cred.project_code, "POST", "/stock/v1/stock/get", { items: [] }),
    await hit(session.cookieHeader, cred.project_code, "GET", "/offer/v1/product/TEST-MISSING"),
    await hit(session.cookieHeader, cred.project_code, "GET", "/identity/v1/whoami"),
  ];
  console.log(JSON.stringify({ project: cred.project_code, tests }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
