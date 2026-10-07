import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const monorepoRoot = resolve(apiRoot, "../..");
loadDotenv({ path: resolve(monorepoRoot, ".env") });
loadDotenv({ path: resolve(apiRoot, ".env") });

export type AppEnv = {
  port: number;
  dataDriver: "json" | "postgres";
  databaseUrl: string;
  /** JSON 状态文件目录；默认 apps/api/.data，本地推荐 D:\\outpost-data\\json */
  dataDir: string;
  noonMode: "mock" | "live" | "portal" | "inherit";
  noonBaseUrl: string;
  noonPartnerId: string;
  noonApiKey: string;
  noonApiSecret: string;
  noonWebhookSecret: string;
  noonCountry: "sa" | "ae" | "eg";
  noonEnabled: boolean;
  pollIntervalMs: number;
  nodeEnv: string;
};

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function resolveDataDir(): string {
  const fromEnv =
    process.env.OUTPOST_DATA_DIR?.trim() || process.env.DATA_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(apiRoot, ".data");
}

export function loadEnv(): AppEnv {
  const country = (process.env.NOON_COUNTRY_CODE ?? "sa").toLowerCase();
  return {
    port: Number(process.env.PORT ?? 8787),
    dataDriver: (process.env.DATA_DRIVER as "json" | "postgres") ?? "json",
    databaseUrl: process.env.DATABASE_URL ?? "",
    dataDir: resolveDataDir(),
    noonMode: (process.env.NOON_MODE as AppEnv["noonMode"]) ?? "inherit",
    noonBaseUrl: process.env.NOON_BASE_URL ?? "https://api.noonpartners.dev",
    noonPartnerId: process.env.NOON_PARTNER_ID ?? "",
    noonApiKey: process.env.NOON_API_KEY ?? "",
    noonApiSecret: process.env.NOON_API_SECRET ?? "",
    noonWebhookSecret: process.env.NOON_WEBHOOK_SECRET ?? "",
    noonCountry: (["sa", "ae", "eg"].includes(country)
      ? country
      : "sa") as AppEnv["noonCountry"],
    noonEnabled: bool(process.env.NOON_ENABLED, true),
    pollIntervalMs: Number(process.env.NOON_POLL_INTERVAL_MS ?? 120_000),
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
}
