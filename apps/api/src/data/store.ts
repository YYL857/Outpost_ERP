import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppState,
  CatalogItem,
  FeeSnapshot,
  FulfillmentType,
  NoonConnection,
  ReplenishConfig,
  SalesFact,
  SkuDims,
  SkuLocalCost,
  StockItem,
  SyncDomain,
  SyncJob,
} from "../common/types.js";
import type { AppEnv } from "../config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const legacyDataDir = join(__dirname, "..", "..", ".data");
const legacyStatePath = join(legacyDataDir, "state.json");

function resolveDataDir(): string {
  const fromEnv =
    process.env.OUTPOST_DATA_DIR?.trim() || process.env.DATA_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return legacyDataDir;
}

function getPaths() {
  const dataDir = resolveDataDir();
  return { dataDir, statePath: join(dataDir, "state.json") };
}

/** 若新目录尚无 state，而旧 apps/api/.data 有，则复制一次，避免丢联调数据 */
function migrateLegacyStateIfNeeded(statePath: string, dataDir: string) {
  if (existsSync(statePath)) return;
  if (!existsSync(legacyStatePath)) return;
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  copyFileSync(legacyStatePath, statePath);
  console.log(
    `[outpost-data] migrated state.json → ${statePath} (from ${legacyStatePath})`,
  );
}

function nowIso() {
  return new Date().toISOString();
}

function defaultPortal() {
  return {
    portalUrl: "https://login.noon.partners/",
    cookie: "",
    ordersUrl: "",
    catalogUrl: "",
    stockUrl: "",
    lastFetchAt: null as string | null,
    lastImportAt: null as string | null,
    lastImportSummary: null as string | null,
  };
}

function defaultNoon(): NoonConnection {
  return {
    mode: "portal",
    partnerId: "",
    apiKey: "",
    apiSecret: "",
    webhookSecret: "",
    baseUrl: "https://login.noon.partners/",
    countryCode: "sa",
    enabled: true,
    lastValidatedAt: null,
    lastError: null,
    portal: defaultPortal(),
  };
}

function idleJob(domain: SyncDomain): SyncJob {
  return {
    id: `job-${domain}`,
    domain,
    status: "idle",
    lastSuccessAt: null,
    lastError: null,
    backlog: 0,
    latencyMinutes: 0,
  };
}

const JOB_DOMAINS: SyncDomain[] = [
  "orders",
  "catalog",
  "stock",
  "sales",
  "fees",
  "reconcile",
];

function mergeSyncJobs(raw: SyncJob[] | undefined): SyncJob[] {
  const map = new Map<SyncDomain, SyncJob>();
  for (const d of JOB_DOMAINS) map.set(d, idleJob(d));
  for (const j of raw ?? []) {
    if (map.has(j.domain)) map.set(j.domain, { ...map.get(j.domain)!, ...j });
  }
  return JOB_DOMAINS.map((d) => map.get(d)!);
}

function normalizeCatalog(raw: Partial<CatalogItem> & { partnerSku?: string }): CatalogItem | null {
  const partnerSku = String(raw.partnerSku ?? "").trim();
  if (!partnerSku) return null;
  return {
    partnerSku,
    title: String(raw.title ?? partnerSku),
    isActive: raw.isActive !== false,
    noonSku: String(raw.noonSku ?? ""),
    imageUrl: String(raw.imageUrl ?? ""),
    price: Number(raw.price ?? 0) || 0,
    currency: String(raw.currency ?? "SAR") || "SAR",
    listingType: String(raw.listingType ?? ""),
    source: "NOON",
    updatedAt: String(raw.updatedAt ?? nowIso()),
  };
}

function normalizeStock(raw: Partial<StockItem> & { partnerSku?: string }): StockItem | null {
  const partnerSku = String(raw.partnerSku ?? "").trim();
  if (!partnerSku) return null;
  const fulfillment = (["fbn", "fbp", "unknown"].includes(String(raw.fulfillment))
    ? raw.fulfillment
    : "unknown") as FulfillmentType;
  return {
    partnerSku,
    warehouseCode: String(raw.warehouseCode ?? "DEFAULT"),
    fulfillment,
    qty: Math.max(0, Math.floor(Number(raw.qty ?? 0) || 0)),
    inTransitQty: Math.max(0, Math.floor(Number(raw.inTransitQty ?? 0) || 0)),
    updatedAt: String(raw.updatedAt ?? nowIso()),
  };
}

/** 空库种子：不含演示订单/SKU；费用参数待真实配置后再填 */
export function seed(): AppState {
  const ts = nowIso();
  return {
    store: {
      id: "",
      name: "",
      account: "",
      site: "saudi",
      platform: "NOON",
      expiresAt: null,
      listingUsed: 0,
      listingQuota: 0,
    },
    noon: defaultNoon(),
    cursors: {
      ordersSince: null,
      catalogSince: null,
      stockSince: null,
      salesSince: null,
      feesSince: null,
    },
    shipping: {
      airFreightAedPerKg: 0,
      airLeadDays: 10,
      seaFreightAedPerCbm: 0,
      seaLeadDays: 60,
      buybackRate: 0,
      volumetricDivisor: 6000,
      updatedAt: ts,
    },
    review: {
      commissionRmb: 0,
      exchangeRate: 0,
      expressFeeRmb: 0,
      balanceRmb: 0,
      updatedAt: ts,
    },
    syncJobs: mergeSyncJobs(undefined),
    syncAlerts: [],
    inbox: [],
    orders: [],
    catalog: [],
    stock: [],
    salesFacts: [],
    feeSnapshots: [],
    skuLocalCosts: [],
    skuDims: [],
    replenishConfigs: [],
    listings: [],
    favorites: [],
    portalCache: {
      orders: [],
      catalog: [],
      stock: [],
      sales: [],
      fees: [],
      updatedAt: null,
    },
  };
}

function migrate(raw: Partial<AppState>): AppState {
  const base = seed();
  const catalog = (raw.catalog ?? [])
    .map((c) => normalizeCatalog(c as CatalogItem))
    .filter((c): c is CatalogItem => Boolean(c));
  const stock = (raw.stock ?? [])
    .map((s) => normalizeStock(s as StockItem))
    .filter((s): s is StockItem => Boolean(s));

  return {
    ...base,
    ...raw,
    store: { ...base.store, ...(raw.store ?? {}) },
    noon: {
      ...base.noon,
      ...(raw.noon ?? {}),
      portal: {
        ...base.noon.portal,
        ...((raw.noon as AppState["noon"] | undefined)?.portal ?? {}),
      },
    },
    cursors: { ...base.cursors, ...(raw.cursors ?? {}) },
    shipping: { ...base.shipping, ...(raw.shipping ?? {}) },
    review: { ...base.review, ...(raw.review ?? {}) },
    syncJobs: mergeSyncJobs(raw.syncJobs),
    syncAlerts: raw.syncAlerts ?? [],
    inbox: raw.inbox ?? [],
    orders: raw.orders ?? [],
    catalog,
    stock,
    salesFacts: (raw.salesFacts as SalesFact[] | undefined) ?? [],
    feeSnapshots: (raw.feeSnapshots as FeeSnapshot[] | undefined) ?? [],
    skuLocalCosts: (raw.skuLocalCosts as SkuLocalCost[] | undefined) ?? [],
    skuDims: (raw.skuDims as SkuDims[] | undefined) ?? [],
    replenishConfigs: (raw.replenishConfigs as ReplenishConfig[] | undefined) ?? [],
    listings: raw.listings ?? [],
    favorites: raw.favorites ?? [],
    portalCache: {
      orders: raw.portalCache?.orders ?? [],
      catalog: raw.portalCache?.catalog ?? [],
      stock: raw.portalCache?.stock ?? [],
      sales: raw.portalCache?.sales ?? [],
      fees: raw.portalCache?.fees ?? [],
      updatedAt: raw.portalCache?.updatedAt ?? null,
    },
  };
}

/** 用环境变量覆盖 noon 连接（上线填 .env 即可） */
export function applyEnvToNoon(state: AppState, env: AppEnv): AppState {
  if (env.noonMode !== "inherit") {
    state.noon.mode = env.noonMode;
  }
  if (env.noonPartnerId) state.noon.partnerId = env.noonPartnerId;
  if (env.noonApiKey) state.noon.apiKey = env.noonApiKey;
  if (env.noonApiSecret) state.noon.apiSecret = env.noonApiSecret;
  if (env.noonWebhookSecret) state.noon.webhookSecret = env.noonWebhookSecret;
  if (env.noonBaseUrl) state.noon.baseUrl = env.noonBaseUrl;
  state.noon.countryCode = env.noonCountry;
  state.noon.enabled = env.noonEnabled;
  return state;
}

export function loadState(): AppState {
  const { dataDir, statePath } = getPaths();
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  migrateLegacyStateIfNeeded(statePath, dataDir);
  if (!existsSync(statePath)) {
    const initial = seed();
    writeFileSync(statePath, JSON.stringify(initial, null, 2), "utf8");
    return structuredClone(initial);
  }
  const raw = readFileSync(statePath, "utf8").trim();
  if (!raw) {
    const initial = seed();
    writeFileSync(statePath, JSON.stringify(initial, null, 2), "utf8");
    console.warn(`[outpost-data] empty state.json repaired → ${statePath}`);
    return structuredClone(initial);
  }
  let parsed: Partial<AppState>;
  try {
    parsed = JSON.parse(raw) as Partial<AppState>;
  } catch (err) {
    const bak = `${statePath}.corrupt.${Date.now()}.bak`;
    writeFileSync(bak, raw, "utf8");
    const initial = seed();
    writeFileSync(statePath, JSON.stringify(initial, null, 2), "utf8");
    console.warn(
      `[outpost-data] corrupt state.json backed up to ${bak} and reset`,
      err,
    );
    return structuredClone(initial);
  }
  const migrated = migrate(parsed);
  writeFileSync(statePath, JSON.stringify(migrated, null, 2), "utf8");
  return migrated;
}

/** 原子写盘，避免 tsx watch / 进程被杀时截断 state.json 导致 API 起不来 */
export function saveState(state: AppState) {
  const { dataDir, statePath } = getPaths();
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const tmpPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  try {
    renameSync(tmpPath, statePath);
  } catch {
    // Windows：目标存在时 rename 不能覆盖
    try {
      unlinkSync(statePath);
    } catch {
      /* ignore */
    }
    renameSync(tmpPath, statePath);
  }
}

export function getDataDir(): string {
  return getPaths().dataDir;
}
