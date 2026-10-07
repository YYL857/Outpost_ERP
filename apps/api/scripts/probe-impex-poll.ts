import {
  clearNoonApiGatewayCache,
  loginNoonApiGateway,
  readNoonCredentialsFile,
} from "../src/platforms/noon/http.js";

process.env.OUTPOST_NOON_CREDENTIALS_FILE =
  process.env.OUTPOST_NOON_CREDENTIALS_FILE ||
  "D:\\noon_credentials_sensitive.json";

const base = "https://noon-api-gateway.noon.partners";

async function api(
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
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text: text.slice(0, 300) };
}

async function main() {
  clearNoonApiGatewayCache();
  const cred = readNoonCredentialsFile();
  if (!cred) throw new Error("no cred");
  const { cookieHeader } = await loginNoonApiGateway(true);

  const cats = await api(
    cookieHeader,
    cred.project_code,
    "GET",
    "/impex/v1/export/category/list",
  );
  const list =
    (cats.json as { export_categories?: Array<{ export_category_code: string }> })
      ?.export_categories ?? [];
  console.log(
    "categories",
    list.map((c) => c.export_category_code),
  );

  const exportCode = "EXP4T73BB2QE";
  for (let i = 0; i < 20; i++) {
    const st = await api(
      cookieHeader,
      cred.project_code,
      "POST",
      "/impex/v1/export/status",
      { export_code: exportCode },
    );
    const j = st.json as {
      export_status?: string;
      download_url?: string | null;
    };
    console.log(i, st.status, j.export_status, j.download_url);
    if (j.export_status && j.export_status !== "RUNNING") {
      console.log("final", JSON.stringify(j, null, 2).slice(0, 800));
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
