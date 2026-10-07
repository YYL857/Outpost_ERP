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
    preview: text.slice(0, 500).replace(/\s+/g, " "),
  };
}

async function main() {
  clearNoonApiGatewayCache();
  const cred = readNoonCredentialsFile();
  if (!cred) throw new Error("no cred");
  const { cookieHeader } = await loginNoonApiGateway(true);

  // reuse known export or create one
  const created = await hit(
    cookieHeader,
    cred.project_code,
    "POST",
    "/impex/v1/export/create",
    {
      export_category_code: "noon_catalog_catalogexport",
      params: { country: "ae", noon_status: "live" },
    },
  );
  console.log("created", created);
  const codeMatch = created.preview.match(/EXP[A-Z0-9]+/);
  const exportCode = codeMatch?.[0] ?? "EXP4T73BB2QE";

  const statusPaths = [
    `/impex/v1/export/${exportCode}`,
    `/impex/v1/export/get?export_code=${exportCode}`,
    `/impex/v1/export/status?export_code=${exportCode}`,
    `/impex/v1/export/download?export_code=${exportCode}`,
  ];
  const gets = [];
  for (const path of statusPaths) {
    gets.push(await hit(cookieHeader, cred.project_code, "GET", path));
  }
  const posts = [];
  for (const path of [
    "/impex/v1/export/get",
    "/impex/v1/export/status",
    "/impex/v1/export/download",
    "/impex/v1/export/result",
  ]) {
    posts.push(
      await hit(cookieHeader, cred.project_code, "POST", path, {
        export_code: exportCode,
      }),
    );
  }
  console.log(JSON.stringify({ exportCode, gets, posts }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
