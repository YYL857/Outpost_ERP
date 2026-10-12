import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  IMPEX_EXPORT_CATEGORIES,
  runImpexExportCsv,
} from "../src/platforms/noon/impex-client.js";
import { NoonHttpError } from "../src/platforms/noon/http.js";
import {
  runWithContext,
  SYSTEM_SYNC_USER,
} from "../src/auth/context.js";
import type { NoonConnection } from "../src/common/types.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: resolve(apiRoot, "../..", ".env") });

const shops = [
  {
    id: "PRJ396770",
    credentialsFile: "D:\\PRJ396770\\noon_credentials_sensitive.json",
  },
  {
    id: "PRJ482387",
    credentialsFile: "D:\\PRJ482387\\noon_credentials_sensitive.json",
  },
];

for (const shop of shops) {
  process.env.OUTPOST_NOON_CREDENTIALS_FILE = shop.credentialsFile;
  const connection: NoonConnection = {
    mode: "live",
    enabled: true,
    baseUrl: "https://api.noon.com",
    partnerId: shop.id,
    apiKey: "",
    apiSecret: "",
    webhookSecret: "",
    countryCode: "sa",
    pollIntervalMs: 60_000,
  };
  const dir = join(apiRoot, "scripts/_out/gp-sources", shop.id);
  mkdirSync(dir, { recursive: true });

  await runWithContext({ user: SYSTEM_SYNC_USER, shopId: shop.id }, async () => {
    const attempts = [
      { country: "sa", lang: "en" },
      { country: "sa" },
      { from_date: "2026-06-01", to_date: "2026-09-29", country: "sa" },
    ];
    for (const params of attempts) {
      try {
        console.log(shop.id, "invoices try", params);
        const { csv, exportCode } = await runImpexExportCsv(
          connection,
          IMPEX_EXPORT_CATEGORIES.invoices,
          params,
        );
        writeFileSync(join(dir, "invoices.csv"), csv, "utf8");
        console.log(shop.id, "OK", exportCode, csv.length);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const body = e instanceof NoonHttpError ? e.body : "";
        console.log(shop.id, "FAIL", msg, String(body).slice(0, 400));
      }
    }

    try {
      console.log(shop.id, "fees try");
      const { csv, exportCode } = await runImpexExportCsv(
        connection,
        IMPEX_EXPORT_CATEGORIES.fees,
        {
          from_date: "2026-06-01",
          to_date: "2026-09-29",
          country: "sa",
          lang: "en",
        },
      );
      writeFileSync(join(dir, "fees.csv"), csv, "utf8");
      console.log(shop.id, "fees OK", exportCode, csv.length);
    } catch (e) {
      console.log(
        shop.id,
        "fees FAIL",
        e instanceof Error ? e.message : e,
      );
    }
  });
}
