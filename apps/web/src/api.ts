const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    if (res.status === 502 || res.status === 504) {
      throw new Error(
        body.error ??
          `请求失败 ${res.status}：后端 API 可能已断开或超时。请确认 http://127.0.0.1:8787/api/ready 可访问后重试。`,
      );
    }
    throw new Error(body.error ?? `请求失败 ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type ShopInfo = {
  id: string;
  name: string;
  projectCode: string;
  credentialsFile: string;
  rootDir: string;
  countryCode: string;
  noonMode: string;
  isActive: boolean;
};

export type ShopsPayload = {
  activeShopId: string;
  shops: ShopInfo[];
};

export type StoreInfo = {
  id: string;
  name: string;
  account: string;
  site: string;
  platform: string;
  expiresAt: string | null;
  listingUsed: number;
  listingQuota: number;
};

export type ShippingConfig = {
  airFreightAedPerKg: number;
  airLeadDays: number;
  seaFreightAedPerCbm: number;
  seaLeadDays: number;
  buybackRate: number;
  volumetricDivisor: number;
  updatedAt: string;
};

export type ReviewConfig = {
  commissionRmb: number;
  exchangeRate: number;
  expressFeeRmb: number;
  balanceRmb: number;
  updatedAt: string;
};

export type SyncJob = {
  id: string;
  domain: string;
  status: "idle" | "running" | "success" | "warning" | "failed";
  lastSuccessAt: string | null;
  lastError: string | null;
  backlog: number;
  latencyMinutes: number;
};

export type SyncAlert = {
  id: string;
  level: "info" | "warning" | "danger";
  title: string;
  detail: string;
  createdAt: string;
  acknowledged: boolean;
};

export type SyncHealth = {
  overall: SyncJob["status"];
  platform: string;
  noonMode: "mock" | "live" | "portal";
  noonEnabled: boolean;
  cursors: {
    ordersSince: string | null;
    catalogSince: string | null;
    stockSince: string | null;
  };
  inboxPending: number;
  inboxFailed: number;
  orderCount: number;
  domains?: Record<
    string,
    { count: number; lastSuccessAt: string | null; primaryPage: string }
  >;
  jobs: SyncJob[];
  alerts: SyncAlert[];
  openAlertCount: number;
  lastImportSummary?: string | null;
};

export type NoonConnection = {
  mode: "mock" | "live" | "portal";
  partnerId: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
  baseUrl: string;
  countryCode: "sa" | "ae" | "eg";
  enabled: boolean;
  lastValidatedAt: string | null;
  lastError: string | null;
  partnerApi?: {
    credentialsFilePath: string;
    credentialsPresent: boolean;
    projectCode: string | null;
    keyIdSuffix: string | null;
  };
  portal?: {
    portalUrl: string;
    ordersUrl: string;
    catalogUrl: string;
    stockUrl: string;
    lastFetchAt: string | null;
    lastImportAt: string | null;
    lastImportSummary: string | null;
    hasSession?: boolean;
    sessionCookieCount?: number;
    sessionFilePath?: string;
    sessionMetaPath?: string;
    sessionSavedAt?: string | null;
    sessionExpiresAt?: string | null;
    sessionExpiresSource?: "cookie" | "estimated" | "unknown" | null;
    sessionRemainingMs?: number | null;
    sessionHealth?: "missing" | "ok" | "warning" | "expired";
    sessionWarnBeforeMs?: number;
    sessionUsable?: "ok" | "blocked" | "expired" | "missing" | "unknown";
    sessionProbeAt?: string | null;
    sessionProbeMessage?: string | null;
    sessionProbeVerdict?: string | null;
  };
  platform?: string;
  integrationSlots?: Record<string, string>;
  acquisition?: { primary: string; note: string };
  portalCache?: {
    orders: number;
    catalog: number;
    stock: number;
    updatedAt: string | null;
  };
};

export type InboxEvent = {
  id: string;
  eventId: string;
  source: string;
  domain: string;
  entityKey: string;
  status: string;
  receivedAt: string;
  processedAt: string | null;
  error: string | null;
  attempts: number;
};

export type NoonOrder = {
  orderNr: string;
  status: string;
  currency: string;
  totalAmount: number;
  itemCount: number;
  placedAt: string;
  updatedAt: string;
};

export type SalesWindow = {
  days: number;
  units: number;
  dailyAvg: number;
};

/** 确定性拼装后的 Catalog 行（对齐竞品列组） */
export type CatalogRow = {
  partnerSku: string;
  noonSku: string;
  title: string;
  imageUrl: string;
  price: number;
  currency: string;
  isActive: boolean;
  listingType: string;
  source: string;
  updatedAt: string;
  stockQty: number;
  inventory: {
    fbn: number;
    fbp: number;
    inTransit: number;
    total: number;
  };
  sales: {
    d3: SalesWindow;
    d7: SalesWindow;
    d14: SalesWindow;
    d30: SalesWindow;
  };
  replenish: {
    status: string;
    availableDays: number | null;
    safetyDays: number;
    dailyAvg: number;
    airLeadDays: number;
    seaLeadDays: number;
  };
  fees: {
    headhaul: number;
    freightEst: number;
    freightMode?: "air" | "sea";
    commissionRate: number;
    commissionAmount: number;
    taxAmount: number;
    outboundFee: number;
    total: number;
  };
  profit: {
    margin: number | null;
    sar: number;
    rmb: number | null;
  };
  specs: {
    weightKg: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    volumetricWeightKg: number;
    chargeableWeightKg: number;
    purchaseCost?: number;
    volumeCm3?: number;
  };
};

export type ListingTask = {
  id: string;
  partnerSku: string;
  title: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type SalesSummary = {
  source: string;
  primary?: string;
  salesFactCount?: number;
  salesSkuCount?: number;
  salesUnits?: number;
  salesAmount?: number;
  orderCount: number;
  orderGmv?: number;
  orderUnits?: number;
  gmv: number;
  units: number;
  currency: string;
  byStatus: Record<string, number>;
};

export type SalesFactRow = {
  partnerSku: string;
  date: string;
  units: number;
  amount: number;
  updatedAt: string;
};

export type BestSellRow = {
  partnerSku: string;
  title: string;
  units: number;
  gmv: number;
};

export type FinanceOverview = {
  source: string;
  orderCount: number;
  units: number;
  revenueSar: number;
  revenueCny: number;
  airCostCny: number;
  reviewCostCny: number;
  profitCny: number;
  platformFees?: {
    feeSkuCount: number;
    avgCommissionRate: number;
    commissionSar: number;
    outboundFeeSar: number;
    taxSar: number;
    totalSar: number;
    totalCny: number;
  };
  snapshot: Record<string, number | string>;
};

export type DomainMapRow = {
  domain: string;
  noonSource: string;
  count: number;
  primaryPage: string;
  refs: string[];
  mapped: boolean;
  wave: number;
};

export type NoonSessionStatus = {
  cookieFilePath: string;
  storageStatePath: string;
  userDataDir: string;
  metaFilePath: string;
  hasSession: boolean;
  cookieCount: number;
  savedAt: string | null;
  expiresAt: string | null;
  expiresSource: "cookie" | "estimated" | "unknown" | null;
  remainingMs: number | null;
  health: "missing" | "ok" | "warning" | "expired";
  warnBeforeMs: number;
  sessionUsable?: "ok" | "blocked" | "expired" | "missing" | "unknown";
  sessionProbeAt?: string | null;
  sessionProbeMessage?: string | null;
  sessionProbeVerdict?: string | null;
};

export type NoonSessionProbe = {
  usable: "ok" | "blocked" | "expired" | "missing" | "unknown";
  probedAt: string;
  finalUrl: string;
  httpStatus: number | null;
  verdict: string;
  message: string;
  hasIdentityCookies: boolean;
  probeUrl: string;
};

export const api = {
  getShops: () => request<{ data: ShopsPayload }>("/shops"),
  setActiveShop: (shopId: string) =>
    request<{
      data: {
        activeShopId: string;
        switched: boolean;
        catalogCount?: number;
        credentialsFile?: string;
        dataDir?: string;
      };
      message?: string;
    }>("/shops/active", {
      method: "POST",
      body: JSON.stringify({ shopId }),
    }),
  getStore: () => request<{ data: StoreInfo }>("/store"),
  getShipping: () => request<{ data: ShippingConfig }>("/config/shipping"),
  putShipping: (body: Omit<ShippingConfig, "updatedAt">) =>
    request<{ data: ShippingConfig }>("/config/shipping", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  getReview: () => request<{ data: ReviewConfig }>("/config/review"),
  putReview: (body: Omit<ReviewConfig, "updatedAt">) =>
    request<{ data: ReviewConfig }>("/config/review", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  getSyncHealth: () => request<{ data: SyncHealth }>("/sync/health"),
  getSyncAlerts: () => request<{ data: SyncAlert[] }>("/sync/alerts"),
  getInbox: () => request<{ data: InboxEvent[] }>("/sync/inbox"),
  ackAlert: (id: string) =>
    request<{ data: SyncAlert }>(`/sync/alerts/${id}/ack`, { method: "POST" }),
  runSync: (domain: string) =>
    request<{ data: SyncJob; message?: string }>(`/sync/run/${domain}`, {
      method: "POST",
    }),
  demoFail: () =>
    request<{ data: SyncAlert }>("/sync/alerts/demo-fail", { method: "POST" }),
  getNoonConnection: () => request<{ data: NoonConnection }>("/noon/connection"),
  putNoonConnection: (
    body: {
      mode: NoonConnection["mode"];
      partnerId: string;
      apiKey: string;
      apiSecret: string;
      webhookSecret: string;
      baseUrl: string;
      countryCode: NoonConnection["countryCode"];
      enabled: boolean;
      portal?: {
        portalUrl: string;
        ordersUrl: string;
        catalogUrl: string;
        stockUrl: string;
      };
    },
  ) =>
    request<{ data: NoonConnection }>("/noon/connection", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  validateNoon: () =>
    request<{ data: { ok: boolean; message: string } }>("/noon/connection/validate", {
      method: "POST",
    }),
  getNoonOrders: () => request<{ data: NoonOrder[] }>("/noon/orders"),
  importPortal: (body: {
    domain: "orders" | "catalog" | "stock" | "sales" | "fees";
    content: string;
    format?: "csv" | "json" | "auto";
    filename?: string;
  }) =>
    request<{ data: { domain: string; count: number; summary: string }; message?: string }>(
      "/noon/portal/import",
      { method: "POST", body: JSON.stringify(body) },
    ),
  fetchPortalSession: () =>
    request<{
      data: {
        orders: number;
        catalog: number;
        stock: number;
        warnings: string[];
        summary: string;
      };
    }>("/noon/portal/fetch", { method: "POST" }),
  autoIngest: (body?: { force?: boolean }) =>
    request<{
      data: {
        importDir: string;
        scanned: number;
        imported: number;
        skipped: number;
        failed: Array<{ file: string; error: string }>;
        details: Array<{ file: string; domain: string; count: number }>;
      };
      message?: string;
    }>("/noon/portal/auto-ingest", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  autoSync: (body?: { skipSop?: boolean; forceIngest?: boolean }) =>
    request<{
      data: {
        message: string;
        catalogCount: number;
        sop: { ok: boolean; skipped: boolean; message: string; downloads: string[] };
        ingest: { imported: number; skipped: number; failed: unknown[] };
      };
      message?: string;
    }>("/noon/portal/auto-sync", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(20 * 60 * 1000),
    }),
  // body.skipProbe 可跳过探针（仅调试）；默认会先探针
  browserLogin: () =>
    request<{
      data: {
        cookieCount: number;
        finalUrl: string;
        userDataDir: string;
        storageStatePath: string;
        cookieFilePath: string;
        reusedExistingSession: boolean;
      };
      message?: string;
    }>("/noon/portal/browser-login", {
      method: "POST",
      signal: AbortSignal.timeout(16 * 60 * 1000),
    }),
  clearBrowserSession: () =>
    request<{ data: NoonSessionStatus; message?: string }>(
      "/noon/portal/browser-logout",
      { method: "POST" },
    ),
  probePortalSession: () =>
    request<{
      data: { probe: NoonSessionProbe; session: NoonSessionStatus };
      message?: string;
    }>("/noon/portal/session-probe", {
      method: "POST",
      signal: AbortSignal.timeout(3 * 60 * 1000),
    }),
  getPortalSessionStatus: () =>
    request<{ data: NoonSessionStatus }>("/noon/portal/session-status"),
  getPortalCache: () =>
    request<{
      data: {
        counts: {
          orders: number;
          catalog: number;
          stock: number;
          sales?: number;
          fees?: number;
        };
        updatedAt: string | null;
        lastImportAt: string | null;
        lastFetchAt: string | null;
        lastImportSummary: string | null;
      };
    }>("/noon/portal/cache"),
  getCatalog: () =>
    request<{ data: CatalogRow[]; meta?: { withImage?: number } }>("/catalog"),
  enrichCatalogImages: (body?: { limit?: number; onlyMissing?: boolean }) =>
    request<{
      data: {
        ok: boolean;
        attempted: number;
        updated: number;
        failed: number;
        skipped: number;
        message: string;
      };
      message?: string;
    }>("/catalog/enrich-images", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    }),
  getListingQuota: () =>
    request<{ data: { used: number; quota: number; remaining: number } }>(
      "/listing/quota",
    ),
  getListingTasks: () => request<{ data: ListingTask[] }>("/listing/tasks"),
  createListingTask: (body: { partnerSku: string; title: string }) =>
    request<{ data: ListingTask }>("/listing/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getSalesSummary: () => request<{ data: SalesSummary }>("/sales/summary"),
  getSalesOrders: () => request<{ data: NoonOrder[] }>("/sales/orders"),
  getSalesFacts: () =>
    request<{ data: SalesFactRow[]; meta: { total: number } }>("/sales/facts"),
  getBestSell: () => request<{ data: BestSellRow[] }>("/analytics/best-sell"),
  getFinanceOverview: () => request<{ data: FinanceOverview }>("/finance/overview"),
  getNoonDomainMap: () =>
    request<{ data: DomainMapRow[]; meta: { doc: string } }>("/noon/domain-map"),
};
