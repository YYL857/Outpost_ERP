import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdsFact,
  AppState,
  CashLedgerEntry,
  CatalogItem,
  FeeEstimate,
  FeeSnapshot,
  FeishuOpsSnapshot,
  FulfillmentType,
  GpMonthClose,
  InvoiceDoc,
  NoonConnection,
  PurchaseArrivalReceipt,
  PurchaseLine,
  ReplenishConfig,
  SalesFact,
  SettlementMonth,
  ShippingConfig,
  SkuDims,
  SkuLocalCost,
  StockItem,
  SyncDomain,
  SyncJob,
} from "../common/types.js";
import type { AppEnv } from "../config/env.js";
import { getContextShopId } from "../auth/context.js";
import { loadRegistry } from "../shops/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const legacyDataDir = join(__dirname, "..", "..", ".data");
const legacyStatePath = join(legacyDataDir, "state.json");

function resolveDataDir(explicit?: string): string {
  if (explicit?.trim()) return resolve(explicit.trim());
  const shopId = getContextShopId();
  if (shopId) {
    const shop = loadRegistry().shops.find((s) => s.id === shopId);
    if (shop) return resolve(join(shop.rootDir, "json"));
  }
  const fromEnv =
    process.env.OUTPOST_DATA_DIR?.trim() || process.env.DATA_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return legacyDataDir;
}

function getPaths(explicitDataDir?: string) {
  const dataDir = resolveDataDir(explicitDataDir);
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

function positiveCatalogActivePrice(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
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
  "ads",
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

/** 旧店铺缺 RMB 分档时写入业务默认；不把 AED 字段误当 RMB */
function normalizeShipping(raw: Partial<ShippingConfig>): ShippingConfig {
  return {
    airFreightAedPerKg: Number(raw.airFreightAedPerKg) || 0,
    airLeadDays: Math.max(1, Math.floor(Number(raw.airLeadDays) || 10)),
    seaFreightAedPerCbm: Number(raw.seaFreightAedPerCbm) || 0,
    seaLeadDays: Math.max(1, Math.floor(Number(raw.seaLeadDays) || 60)),
    airFreightRmbPerKg:
      raw.airFreightRmbPerKg != null && Number(raw.airFreightRmbPerKg) >= 0
        ? Number(raw.airFreightRmbPerKg)
        : 65,
    seaFreightRmbPerCbmPlug:
      raw.seaFreightRmbPerCbmPlug != null && Number(raw.seaFreightRmbPerCbmPlug) >= 0
        ? Number(raw.seaFreightRmbPerCbmPlug)
        : 2200,
    seaFreightRmbPerCbmBuiltin:
      raw.seaFreightRmbPerCbmBuiltin != null &&
      Number(raw.seaFreightRmbPerCbmBuiltin) >= 0
        ? Number(raw.seaFreightRmbPerCbmBuiltin)
        : 2400,
    seaFreightRmbPerCbmGeneral:
      raw.seaFreightRmbPerCbmGeneral != null &&
      Number(raw.seaFreightRmbPerCbmGeneral) >= 0
        ? Number(raw.seaFreightRmbPerCbmGeneral)
        : 1830,
    buybackRate: Number(raw.buybackRate) || 0,
    volumetricDivisor: Math.max(1, Number(raw.volumetricDivisor) || 6000),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
  };
}

function normalizeCatalog(raw: Partial<CatalogItem> & { partnerSku?: string }): CatalogItem | null {
  const partnerSku = String(raw.partnerSku ?? "").trim();
  if (!partnerSku) return null;
  const nowMs = Date.now();
  let updatedAt = String(raw.updatedAt ?? nowIso());
  const t = new Date(updatedAt).getTime();
  // 加载时钳制促销结束日等未来时间，避免售价永久锁死
  if (Number.isNaN(t) || t > nowMs + 24 * 60 * 60 * 1000) {
    updatedAt = new Date(nowMs).toISOString();
  }
  const stockFbnRaw = (raw as { stockFbnNet?: unknown }).stockFbnNet;
  let stockFbnNet: number | null = null;
  if (stockFbnRaw != null && stockFbnRaw !== "") {
    const n = Math.floor(Number(stockFbnRaw));
    if (Number.isFinite(n) && n >= 0) stockFbnNet = n;
  }
  return {
    partnerSku,
    title: String(raw.title ?? partnerSku),
    isActive: raw.isActive !== false,
    noonSku: String(raw.noonSku ?? ""),
    imageUrl: String(raw.imageUrl ?? ""),
    price: Number(raw.price ?? 0) || 0,
    activePrice: positiveCatalogActivePrice(raw.activePrice),
    listPrice: positiveCatalogActivePrice(raw.listPrice),
    currency: String(raw.currency ?? "SAR") || "SAR",
    listingType: String(raw.listingType ?? ""),
    source: "NOON",
    updatedAt,
    stockFbnNet,
  };
}

function normalizeStock(raw: Partial<StockItem> & { partnerSku?: string }): StockItem | null {
  const partnerSku = String(raw.partnerSku ?? "").trim();
  if (!partnerSku) return null;
  const fulfillment = ([
    "fbn",
    "fbp",
    "supermall",
    "transit",
    "unknown",
  ].includes(String(raw.fulfillment))
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
      adsSince: null,
    },
    shipping: {
      airFreightAedPerKg: 0,
      airLeadDays: 10,
      seaFreightAedPerCbm: 0,
      seaLeadDays: 60,
      airFreightRmbPerKg: 65,
      seaFreightRmbPerCbmPlug: 2200,
      seaFreightRmbPerCbmBuiltin: 2400,
      seaFreightRmbPerCbmGeneral: 1830,
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
    feeEstimates: [],
    adsFacts: [],
    skuLocalCosts: [],
    skuDims: [],
    replenishConfigs: [],
    feishuOpsSnapshots: [],
    purchaseLines: [],
    purchaseArrivalReceipts: [],
    cashLedger: [],
    invoiceDocs: [],
    settlementMonths: [],
    gpMonthCloses: [],
    listings: [],
    favorites: [],
    portalCache: {
      orders: [],
      catalog: [],
      stock: [],
      sales: [],
      fees: [],
      ads: [],
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
    shipping: normalizeShipping({
      ...base.shipping,
      ...(raw.shipping ?? {}),
    }),
    review: { ...base.review, ...(raw.review ?? {}) },
    syncJobs: mergeSyncJobs(raw.syncJobs),
    syncAlerts: raw.syncAlerts ?? [],
    inbox: raw.inbox ?? [],
    orders: raw.orders ?? [],
    catalog,
    stock,
    salesFacts: (raw.salesFacts as SalesFact[] | undefined) ?? [],
    feeSnapshots: (raw.feeSnapshots as FeeSnapshot[] | undefined) ?? [],
    feeEstimates: (raw.feeEstimates as FeeEstimate[] | undefined) ?? [],
    adsFacts: ((raw.adsFacts as AdsFact[] | undefined) ?? []).map((f) => ({
      ...f,
      atc: typeof f.atc === "number" && Number.isFinite(f.atc) ? f.atc : 0,
    })),
    skuLocalCosts: (raw.skuLocalCosts as SkuLocalCost[] | undefined) ?? [],
    skuDims: (raw.skuDims as SkuDims[] | undefined) ?? [],
    replenishConfigs: (raw.replenishConfigs as ReplenishConfig[] | undefined) ?? [],
    feishuOpsSnapshots:
      (raw.feishuOpsSnapshots as FeishuOpsSnapshot[] | undefined) ?? [],
    purchaseLines: (raw.purchaseLines as PurchaseLine[] | undefined) ?? [],
    purchaseArrivalReceipts:
      (raw.purchaseArrivalReceipts as PurchaseArrivalReceipt[] | undefined) ??
      [],
    cashLedger: (raw.cashLedger as CashLedgerEntry[] | undefined) ?? [],
    invoiceDocs: (raw.invoiceDocs as InvoiceDoc[] | undefined) ?? [],
    settlementMonths:
      (raw.settlementMonths as SettlementMonth[] | undefined) ?? [],
    gpMonthCloses: (raw.gpMonthCloses as GpMonthClose[] | undefined) ?? [],
    listings: raw.listings ?? [],
    favorites: raw.favorites ?? [],
    portalCache: {
      orders: raw.portalCache?.orders ?? [],
      catalog: raw.portalCache?.catalog ?? [],
      stock: raw.portalCache?.stock ?? [],
      sales: raw.portalCache?.sales ?? [],
      fees: raw.portalCache?.fees ?? [],
      ads: raw.portalCache?.ads ?? [],
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

export function loadState(dataDir?: string): AppState {
  const { dataDir: dir, statePath } = getPaths(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  migrateLegacyStateIfNeeded(statePath, dir);
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

/**
 * 原子写盘，避免 tsx watch / 进程被杀时截断 state.json 导致 API 起不来。
 *
 * 约定：`state` 必须是进程内单例（如 shops/state-cache 里的那份），
 * 不得传入 `loadState()` / `structuredClone` 得到的新副本再并发 save——
 * 否则后写覆盖先写，字段更新会丢。类型约束不了这条，靠调用方遵守。
 */
export function saveState(state: AppState, dataDir?: string) {
  const { dataDir: dir, statePath } = getPaths(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // 同进程并发 save 时 pid 相同；必须带随机后缀，否则互踩同一 tmp
  const tmpPath = `${statePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  try {
    renameSync(tmpPath, statePath);
  } catch {
    // Windows：目标存在时 rename 不能覆盖。仅当本端 tmp 仍在时才删目标，
    // 避免「先删 state.json、再 rename 失败」把盘上唯一副本弄丢。
    if (!existsSync(tmpPath)) {
      throw new Error(
        `saveState: tmp missing before replace (${tmpPath}); state.json left untouched`,
      );
    }
    try {
      unlinkSync(statePath);
    } catch {
      /* ignore */
    }
    renameSync(tmpPath, statePath);
  }
}

export function getDataDir(dataDir?: string): string {
  return getPaths(dataDir).dataDir;
}
