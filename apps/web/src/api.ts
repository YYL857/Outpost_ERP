const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: unknown }));
    const rawErr = body.error;
    const errText =
      typeof rawErr === "string"
        ? rawErr
        : rawErr != null
          ? JSON.stringify(rawErr)
          : `请求失败 ${res.status}`;
    if (res.status === 502 || res.status === 504) {
      throw new Error(
        errText ||
          `请求失败 ${res.status}：后端 API 可能已断开或超时。请确认 http://127.0.0.1:8787/api/ready 可访问后重试。`,
      );
    }
    throw new Error(errText);
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
  airFreightRmbPerKg: number;
  seaFreightRmbPerCbmPlug: number;
  seaFreightRmbPerCbmBuiltin: number;
  seaFreightRmbPerCbmGeneral: number;
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
  amount: number;
  dailyAvg: number;
};

export type AdsWindow = {
  days: number;
  spend: number;
  revenue: number;
  orders: number;
  views: number;
  clicks: number;
  roas: number | null;
  acos: number | null;
  hasData: boolean;
  fromDate?: string | null;
  toDate?: string | null;
};

export type DomainProvenance = {
  source: string;
  label: string;
  note?: string;
  reportFrom?: string | null;
  reportTo?: string | null;
  syncedAt?: string | null;
  fileName?: string | null;
  filePath?: string | null;
  fileMtime?: string | null;
  factsCount?: number;
  stale?: boolean;
};

export type ProvenanceSlice = {
  key: string;
  column: string;
  source: string;
  dataNode: string;
  syncedAt: string | null;
  syncedToday: boolean;
  count: number;
  stale?: boolean;
  note?: string;
};

export type CatalogProvenance = {
  asOf: string;
  today?: string;
  joinKey: string;
  domains: {
    noon: DomainProvenance;
    ads: DomainProvenance;
    feishu: DomainProvenance;
  };
  slices?: ProvenanceSlice[];
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
  /** 官方 Catalog 售价时间戳 */
  priceUpdatedAt?: string;
  priceSource?: string;
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
  ads: {
    d7: AdsWindow;
    d14: AdsWindow;
    d30: AdsWindow;
    latest: AdsWindow;
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
    sar: number | null;
    rmb: number | null;
    afterPurchase?: number | null;
    adsNet7d?: number | null;
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
  /** 本地域对齐（partnerSku）；平台域仍为 Noon */
  local?: {
    hasCost: boolean;
    hasDims: boolean;
    costSource: string | null;
    dimsSource: string | null;
    costUpdatedAt: string | null;
    dimsUpdatedAt: string | null;
    normalizeRunId: string | null;
    align: "matched" | "partial" | "missing";
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

export type MarketWatchItem = {
  productKey: string;
  url: string;
  title: string;
  categoryId: string;
  price: number | null;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
  brandTier?: "avoid_compete" | "white_candidate" | "white_label" | "unknown" | "big_brand";
  brandToken?: string;
  titleZh?: string | null;
  soldRecently?: number | null;
  soldRecentlyText?: string | null;
  isBestSeller?: boolean;
  isAd?: boolean;
  seller?: {
    sellerId: string | null;
    sellerName: string | null;
    sellerUrl: string | null;
    sellerRating: number | null;
    sellerRatingCount: number | null;
    sellerPositivePct: number | null;
    sellerCustomers90d: string | null;
    productAsDescribedPct: number | null;
    sellerSince: string | null;
  } | null;
  reviewSampleCount?: number;
  discoveredAt: string;
  lastSeenAt: string;
  lastSnapshotAt: string | null;
  status: "watching" | "paused" | "error";
  sourceChannel: string;
};

export type CategoryFitnessVerdict = "go" | "watch" | "skip";

export type CategoryFitnessShortItem = {
  productKey: string;
  title: string;
  titleZh?: string | null;
  url: string;
  price: number | null;
  currency: string;
  soldRecently: number | null;
  soldRecentlyText: string | null;
  rating: number | null;
  reviewCount: number | null;
  brandTier: string;
  isBestSeller: boolean;
  isAd: boolean;
};

export type CategoryFitnessReport = {
  categoryId: string;
  categoryTitle: string;
  verdict: CategoryFitnessVerdict;
  verdictLabel: string;
  reasons: string[];
  sampleSize: number;
  metrics: {
    whiteShare: number | null;
    avoidShare: number | null;
    adShare: number | null;
    whiteCount: number;
    avoidCount: number;
    soldRecentlyMedian: number | null;
    soldRecentlyCoverage: number;
    priceMedianWhite: number | null;
    aspInSweetShare: number | null;
    bestSellerCount: number;
  };
  thresholds: {
    aspMin: number;
    aspMax: number;
    soldRecentlyFloor: number;
    whiteShareSweetMin: number;
    whiteShareSweetMax: number;
    shortlistLimit: number;
  };
  shortlist: CategoryFitnessShortItem[];
  updatedAt: string | null;
};

export type CategoryFitnessResponse = {
  categories: CategoryFitnessReport[];
  thresholds: CategoryFitnessReport["thresholds"];
};

export type MarketIntelJob = {
  id: string;
  kind: string;
  market: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  channel: string;
  message: string;
  stats: Record<string, number>;
  errors: string[];
};

export type MarketIntelStatus = {
  market: string;
  locale: string;
  currency: string;
  outpostRoot: string;
  paths: Record<string, string>;
  categoriesEnabled: number;
  categoriesTotal: number;
  watchlistCount: number;
  watchingCount: number;
  realWatchCount?: number;
  mockWatchCount?: number;
  primaryChannel: string;
  fallbackChannel: string;
  allowMock: boolean;
  autoCollectAfterDiscover?: boolean;
  autoCollectAfterIngest?: boolean;
  dataPolicy?: string;
  brandRegistry?: {
    avoidCount: number;
    autoAvoidCount?: number;
    confirmedWhiteCount: number;
    pendingCount: number;
    pendingTop: Array<{
      token: string;
      hits: number;
      lastSeenAt: string;
      examples: string[];
      exampleRefs?: Array<{
        title: string;
        url?: string | null;
        imageUrl?: string | null;
        productKey?: string | null;
        tags?: string[];
      }>;
      categoryId?: string;
      ai?: {
        action?: string;
        fameLevel?: string;
        confidence?: number;
        reason?: string;
        applied?: boolean;
        skippedLlm?: boolean;
        reviewedAt?: string;
      } | null;
    }>;
    categoryIds?: string[];
    path: string;
    updatedAt: string;
  };
  brandIntel?: {
    configured: boolean;
    model: string;
    autoApply: boolean;
    minConfidence: number;
    pendingCount: number;
    autoAvoidCount: number;
  };
  pendingInbox?: { yingdao: number; extension: number };
  ops?: {
    realCount: number;
    mockCount: number;
    withSnapshot: number;
    missingSnapshot: number;
    byChannel: { yingdao: number; extension: number; other: number };
  };
  inboxWatcher?: {
    enabled: boolean;
    everyMs: number;
    timerActive: boolean;
    running: boolean;
    pending: { yingdao: number; extension: number };
  };
  goLive?: {
    dropYingdao: string;
    extensionDir: string;
    ingestApi: string;
  };
  scheduler: {
    enabled: boolean;
    discoverEveryMs: number;
    collectEveryMs: number;
    discoverTimerActive: boolean;
    collectTimerActive: boolean;
    runningDiscover: boolean;
    runningCollect: boolean;
  };
  recentJobs: MarketIntelJob[];
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

export type DailyBriefRecipient = {
  id: string;
  remark: string;
  chatId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DailyBriefStatus = {
  defaultChatId: string;
  defaultRecipientId: string | null;
  pushFormat: "card";
  deepseekConfigured: boolean;
  deepseekModel: string;
  recipientsPath: string;
  recipients: DailyBriefRecipient[];
  last: {
    runId?: string;
    sourceRawRunId?: string;
    builtAt?: string;
    briefPath?: string;
    filteredPath?: string;
    currentSheet?: string;
    previousSheet?: string | null;
    currentAccepted?: number;
    previousAccepted?: number;
    watchlistKept?: number;
    deltaCounts?: Record<string, number>;
  } | null;
  summaryPath: string | null;
  judgmentPreview: {
    headline: string;
    confidence: string;
    highlights: number;
    risks: number;
    actions: number;
    caveats: number;
  } | null;
};

export type SchedulerId =
  | "noon-poller"
  | "assembly-sync"
  | "mi-discover"
  | "mi-collect"
  | "inbox-watcher";

export type SchedulerItem = {
  id: SchedulerId;
  label: string;
  group: "sync" | "market-intel";
  enabled: boolean;
  timerActive: boolean;
  everyMs: number;
  running: boolean;
  lastRunAt: string | null;
  lastMessage: string | null;
  note?: string;
};

export const api = {
  getShops: () => request<{ data: ShopsPayload }>("/shops"),
  registerShop: (body: {
    credentialsFile: string;
    name?: string;
    countryCode?: "sa" | "ae" | "eg";
    noonMode?: "live" | "portal" | "mock";
    /** 默认 true：录入后切为当前店 */
    setActive?: boolean;
  }) =>
    request<{
      data: {
        shop: ShopInfo;
        created: boolean;
        updated: boolean;
        switched: boolean;
        activeShopId: string;
      };
      message?: string;
    }>("/shops/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
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
  clearAlerts: () =>
    request<{ data: { cleared: number } }>("/sync/alerts/clear", {
      method: "POST",
    }),
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
  autoSync: (body?: { forceIngest?: boolean }) =>
    request<{
      data: {
        message: string;
        catalogCount: number;
        ingest: { imported: number; skipped: number; failed: unknown[] };
      };
      message?: string;
    }>("/noon/portal/auto-sync", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(20 * 60 * 1000),
    }),
  /** Noon + 影刀广告 + 飞书汇总同步（同一条链） */
  assemblySync: (body?: {
    skipNoon?: boolean;
    skipAds?: boolean;
    skipFeishu?: boolean;
    forceIngest?: boolean;
    feishuDocIds?: string[];
  }) =>
    request<{
      data: {
        ok: boolean;
        runId: string;
        message: string;
        catalogCount: number;
        adsFacts?: number;
        adsProvenance?: DomainProvenance;
        stages: Array<{
          name: string;
          ok: boolean;
          skipped?: boolean;
          message: string;
        }>;
        localAlign?: {
          matchedCost: number;
          catalogCount: number;
          catalogMissingCost: number;
        };
      };
      message?: string;
    }>("/sync/assembly-sync", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30 * 60 * 1000),
    }),
  getAssemblySyncLast: () =>
    request<{
      data: {
        running: boolean;
        last: {
          ok?: boolean;
          finishedAt?: string;
          message?: string;
          adsFacts?: number;
          adsProvenance?: DomainProvenance;
        } | null;
      };
    }>("/sync/assembly-sync/last"),
  getPortalCache: () =>
    request<{
      data: {
        counts: {
          orders: number;
          catalog: number;
          stock: number;
          sales?: number;
          fees?: number;
          ads?: number;
        };
        updatedAt: string | null;
        lastImportAt: string | null;
        lastFetchAt: string | null;
        lastImportSummary: string | null;
      };
    }>("/noon/portal/cache"),
  getCatalog: () =>
    request<{
      data: CatalogRow[];
      meta?: {
        withImage?: number;
        withAds?: number;
        asOf?: string;
        joinKey?: string;
        localAlign?: {
          matched: number;
          partial: number;
          missing: number;
          costRows: number;
          dimsRows: number;
        };
        provenance?: CatalogProvenance;
      };
    }>("/catalog"),
  ingestFeishuLocal: (body?: { dryRun?: boolean }) =>
    request<{ data: unknown; message?: string }>("/catalog/ingest-feishu-local", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
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
  getMarketIntelStatus: () =>
    request<{ data: MarketIntelStatus }>("/market-intel/status"),
  getMarketIntelCategoryFitness: (categoryId?: string) =>
    request<{ data: CategoryFitnessResponse | CategoryFitnessReport }>(
      categoryId
        ? `/market-intel/category-fitness?categoryId=${encodeURIComponent(categoryId)}`
        : "/market-intel/category-fitness",
    ),
  translateMarketIntelTitlesZh: (body: {
    categoryId?: string;
    productKeys?: string[];
    limit?: number;
    force?: boolean;
  }) =>
    request<{
      data: {
        translated: number;
        skipped: number;
        configured: boolean;
        rows: Array<{ productKey: string; title: string; titleZh: string | null }>;
      };
      message?: string;
    }>("/market-intel/titles/zh", {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2 * 60 * 1000),
    }),
  promoteMarketIntelBrand: (
    token: string,
    to: "avoidCompete" | "confirmedWhite",
    categoryId?: string,
  ) =>
    request<{ data: unknown; message?: string }>("/market-intel/brands/promote", {
      method: "POST",
      body: JSON.stringify({ token, to, categoryId }),
    }),
  reviewMarketIntelBrandsAi: (body?: {
    tokens?: string[];
    limit?: number;
    force?: boolean;
    dryRun?: boolean;
    autoApply?: boolean;
  }) =>
    request<{
      data: {
        reviewed: unknown[];
        appliedAvoid: string[];
        skipped: string[];
        errors: Array<{ token: string; error: string }>;
        llmCalls: number;
        searchCalls: number;
      };
      message?: string;
    }>("/market-intel/brands/ai-review", {
      method: "POST",
      body: JSON.stringify(body ?? { limit: 8 }),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    }),
  getMarketIntelWatchlist: () =>
    request<{ data: MarketWatchItem[]; meta: { count: number; updatedAt: string } }>(
      "/market-intel/watchlist",
    ),
  getMarketIntelJobs: (limit = 20) =>
    request<{ data: MarketIntelJob[] }>(`/market-intel/jobs?limit=${limit}`),
  runMarketIntelDiscover: (body?: {
    categoryIds?: string[];
    forceMock?: boolean;
    skipCollect?: boolean;
  }) =>
    request<{
      data:
        | MarketIntelJob
        | { discover: MarketIntelJob; collect: MarketIntelJob | null };
    }>("/market-intel/discover", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    }),
  purgeMarketIntelTest: () =>
    request<{
      data: { removed: number; remaining: number };
      message?: string;
    }>("/market-intel/watchlist/purge-test", {
      method: "POST",
      body: "{}",
    }),
  startMarketIntelWatcher: () =>
    request<{ data: NonNullable<MarketIntelStatus["inboxWatcher"]> }>(
      "/market-intel/watcher/start",
      { method: "POST", body: "{}" },
    ),
  stopMarketIntelWatcher: () =>
    request<{ data: NonNullable<MarketIntelStatus["inboxWatcher"]> }>(
      "/market-intel/watcher/stop",
      { method: "POST", body: "{}" },
    ),
  runMarketIntelCollect: (body?: { limit?: number; forceMock?: boolean }) =>
    request<{ data: MarketIntelJob }>("/market-intel/collect", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    }),
  startMarketIntelScheduler: () =>
    request<{ data: MarketIntelStatus["scheduler"] }>("/market-intel/scheduler/start", {
      method: "POST",
      body: "{}",
    }),
  stopMarketIntelScheduler: () =>
    request<{ data: MarketIntelStatus["scheduler"] }>("/market-intel/scheduler/stop", {
      method: "POST",
      body: "{}",
    }),
  purgeMarketIntelMock: () =>
    request<{
      data: { removed: number; remaining: number };
      message?: string;
    }>("/market-intel/watchlist/purge-mock", {
      method: "POST",
      body: "{}",
    }),
  ingestMarketIntel: (body: {
    categoryId?: string;
    source?: "extension" | "yingdao";
    products?: unknown[];
    payload?: unknown;
  }) =>
    request<{ data: MarketIntelJob }>("/market-intel/ingest", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  enableMarketIntelLiveMode: () =>
    request<{
      data: { config: { allowMock: boolean }; purged: { removed: number; remaining: number } };
      message?: string;
    }>("/market-intel/config/live-mode", {
      method: "POST",
      body: "{}",
    }),

  getDailyBriefStatus: () =>
    request<{ data: DailyBriefStatus }>("/daily-brief/status"),
  normalizeDailyBrief: (body?: { skipPull?: boolean; rawRunId?: string }) =>
    request<{
      data: {
        pulledRunId: string | null;
        runId: string;
        sourceRawRunId: string;
        briefPath: string;
        filteredPath: string;
        currentSheet: string;
        previousSheet: string | null;
        currentAccepted: number;
        watchlistKept: number;
        deltaCounts: Record<string, number>;
      };
      message?: string;
    }>("/daily-brief/normalize", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    }),
  summarizeDailyBrief: (body?: { filteredPath?: string }) =>
    request<{
      data: {
        model: string;
        filteredPath: string;
        judgmentPath: string;
        markdownPath: string;
        confidence: string;
        headline: string;
        highlights: number;
        risks: number;
        actions: number;
        clampNotes: string[];
      };
      message?: string;
    }>("/daily-brief/summarize", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    }),
  pushDailyBrief: (body?: {
    chatId?: string;
    recipientIds?: string[];
    filteredPath?: string;
  }) =>
    request<{
      data: {
        format: "card";
        results: Array<{
          remark: string;
          chatId: string;
          messageId: string;
          ok: boolean;
          error?: string;
        }>;
        header: string;
        headline: string;
      };
      message?: string;
    }>("/daily-brief/push", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(2 * 60 * 1000),
    }),
  runDailyBrief: (body?: {
    chatId?: string;
    recipientIds?: string[];
    skipPull?: boolean;
    skipPush?: boolean;
  }) =>
    request<{
      data: {
        steps: Array<{ step: string; ok: boolean; detail?: unknown }>;
        headline: string;
        filteredPath: string;
        judgmentPath: string;
        push: unknown;
      };
      message?: string;
    }>("/daily-brief/run", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15 * 60 * 1000),
    }),

  addDailyBriefRecipient: (body: {
    remark: string;
    chatId: string;
    enabled?: boolean;
  }) =>
    request<{ data: DailyBriefRecipient; message?: string }>(
      "/daily-brief/recipients",
      { method: "POST", body: JSON.stringify(body) },
    ),
  updateDailyBriefRecipient: (
    id: string,
    body: { remark: string; chatId: string; enabled?: boolean },
  ) =>
    request<{ data: DailyBriefRecipient; message?: string }>(
      `/daily-brief/recipients/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(body) },
    ),
  deleteDailyBriefRecipient: (id: string) =>
    request<{ data: { removed: boolean }; message?: string }>(
      `/daily-brief/recipients/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  getFinanceOverview: () => request<{ data: FinanceOverview }>("/finance/overview"),
  getNoonDomainMap: () =>
    request<{ data: DomainMapRow[]; meta: { doc: string } }>("/noon/domain-map"),

  listSchedulers: () => request<{ data: SchedulerItem[] }>("/schedulers"),
  startScheduler: (id: SchedulerId) =>
    request<{ data: SchedulerItem }>(`/schedulers/${id}/start`, {
      method: "POST",
      body: "{}",
    }),
  stopScheduler: (id: SchedulerId) =>
    request<{ data: SchedulerItem }>(`/schedulers/${id}/stop`, {
      method: "POST",
      body: "{}",
    }),
  runScheduler: (id: SchedulerId) =>
    request<{
      data: SchedulerItem;
      result: { ok: boolean; message: string; detail?: unknown };
    }>(`/schedulers/${id}/run`, {
      method: "POST",
      body: "{}",
      signal: AbortSignal.timeout(15 * 60 * 1000),
    }),
};
