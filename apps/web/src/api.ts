const BASE = "/api";

type ApiError = Error & { code?: string };

let sessionReplacedHandler: ((message: string) => void) | null = null;
let sessionReplacedNotified = false;

/** 旧设备被挤下线时回调一次（用于弹提示并回到登录页） */
export function onSessionReplaced(handler: (message: string) => void) {
  sessionReplacedHandler = handler;
  return () => {
    if (sessionReplacedHandler === handler) sessionReplacedHandler = null;
  };
}

export function resetSessionReplacedNotice() {
  sessionReplacedNotified = false;
}

function notifySessionReplaced(message: string) {
  if (sessionReplacedNotified) return;
  sessionReplacedNotified = true;
  sessionReplacedHandler?.(message);
}

async function request<T>(
  path: string,
  init?: RequestInit,
  sessionRetry = false,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: unknown; code?: string }));
    if (res.status === 401 && body.code === "SESSION_REPLACED") {
      // 同一浏览器其他标签刚登录时，Cookie 已换成新会话；用新 Cookie 再确认一次，避免误踢当前页
      if (!sessionRetry && path !== "/auth/me") {
        const probe = await fetch(`${BASE}/auth/me`, { credentials: "include" });
        if (probe.ok) return request(path, init, true);
      }
      const message =
        typeof body.error === "string"
          ? body.error
          : "账号已在其他设备登录，当前设备已退出";
      notifySessionReplaced(message);
      const err = new Error(message) as ApiError;
      err.code = "SESSION_REPLACED";
      throw err;
    }
    if (res.status === 401 && body.code === "UNAUTHORIZED") {
      const err = new Error(
        typeof body.error === "string" ? body.error : "未登录",
      ) as ApiError;
      err.code = "UNAUTHORIZED";
      throw err;
    }
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
    const hint = typeof (body as { hint?: unknown }).hint === "string"
      ? String((body as { hint: string }).hint)
      : "";
    throw new Error(hint ? `${errText}（${hint}）` : errText);
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
  isSyncDefault?: boolean;
};

export type ShopsPayload = {
  activeShopId: string;
  syncDefaultShopId?: string;
  shops: ShopInfo[];
  userId?: string | null;
};

export type PwJobName = "ads" | "sales" | "keepalive";

export type PwJobStatus = {
  job: string;
  status: "idle" | "starting" | "running" | "ok" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  pid: number | null;
  exitCode: number | null;
  message: string | null;
  runId: string | null;
  taskId?: string | null;
  opts?: {
    shopIds?: string[];
    range?: string;
    days?: number;
    fromDate?: string;
    toDate?: string;
    cmd?: string;
    trigger?: string;
  } | null;
};

export type PwRunLogSummary = {
  runId: string;
  job: "ads" | "sales";
  jobLabel: string;
  trigger: "manual" | "schedule";
  status: "starting" | "running" | "ok" | "failed";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  口径: {
    range: string;
    rangeLabel: string;
    fromDate?: string;
    toDate?: string;
    days?: number;
  };
  filters: { shopIds: string[]; cmd: string };
  message: string | null;
  exitCode: number | null;
};

export type PwRunLogDetail = PwRunLogSummary & { stdout: string };

export type PwExportSchedule = {
  job: "ads" | "sales";
  enabled: boolean;
  everyMs: number;
  range: string;
  shopIds: string[];
  fromDate?: string;
  toDate?: string;
  lastRunAt: string | null;
  lastMessage: string | null;
  lastOk: boolean | null;
  timerActive?: boolean;
};

export type UserRole = "admin" | "ops_lead" | "ops" | "purchase";

export type AuthUserPublic = {
  id: string;
  username: string;
  role: UserRole;
  disabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** 近 5 分钟内有鉴权请求 */
  online?: boolean;
  lastSeenAt?: string | null;
};

export type AuditEventRow = {
  id: string;
  at: string;
  day: string;
  actor: { id: string; username: string; role: string };
  shopId: string | null;
  module: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  result: "ok" | "denied" | "error";
  summary: string;
  entityType?: string;
  entityId?: string;
  body?: Record<string, unknown>;
  detail?: Record<string, unknown>;
};

export type AuditDailySummary = {
  day: string;
  generatedAt: string;
  totalEvents: number;
  ok: number;
  denied: number;
  error: number;
  byModule: Record<string, number>;
  byAction: Record<string, number>;
  byActor: Record<string, number>;
  byShop: Record<string, number>;
};

export type TaskPriority = "normal" | "high" | "urgent";
export type TaskStatus =
  | "open"
  | "in_progress"
  | "submitted"
  | "done"
  | "rejected"
  | "cancelled";

export type TaskPerson = {
  id: string;
  username: string;
  role: UserRole;
};

export type TaskAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  relativePath: string;
  sizeBytes: number;
  createdAt: string;
  kind: "publish" | "submit";
};

export type TaskEvent = {
  id: string;
  type: string;
  at: string;
  by: TaskPerson;
  message?: string;
};

export type TaskRecord = {
  id: string;
  title: string;
  body: string;
  priority: TaskPriority;
  dueAt: string | null;
  status: TaskStatus;
  createdBy: TaskPerson;
  assignee: TaskPerson;
  attachments: TaskAttachment[];
  draftSubmitAttachments: TaskAttachment[];
  submission: {
    body: string;
    attachments: TaskAttachment[];
    submittedAt: string;
    submittedBy: TaskPerson;
  } | null;
  review: {
    decision: "approve" | "reject";
    comment: string;
    reviewedAt: string;
    reviewedBy: TaskPerson;
  } | null;
  events: TaskEvent[];
  createdAt: string;
  updatedAt: string;
  ackedAt: string | null;
  rejectNotifiedAt: string | null;
};

export type TaskAssigneeOption = TaskPerson & { disabled: boolean };

export type TaskInboxItem = {
  id: string;
  taskId: string;
  type: "new_assignment" | "pending_review" | "rejected";
  title: string;
  summary: string;
  createdAt: string;
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
  atc?: number;
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
  /** Catalog Export 列 active_price；无活动价时不返回或为 null */
  activePrice?: number | null;
  /** Catalog Export 列 price 底价 */
  listPrice?: number | null;
  stockQty: number;
  inventory: {
    fbn: number;
    fbp: number;
    supermall: number;
    inTransit: number;
    total: number;
  };
  sales: {
    d3: SalesWindow;
    d7: SalesWindow;
    d14: SalesWindow;
    d30: SalesWindow;
    d90: SalesWindow;
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
    shipQty?: { air: number; sea: number; single: number } | null;
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

export type ListingCompetitorInput = {
  id: string;
  url: string;
  pastedTitle: string;
  pastedPrice: string;
  pastedBullets: string;
  pastedDescription: string;
};

export type ListingOursNoonContent = {
  titleEn: string;
  titleAr: string;
  fulltype: string;
  brandEn: string;
  brandAr: string;
  longDescriptionEn: string;
  longDescriptionAr: string;
  numberOfPieces: string;
  sizeUnit: string;
  featureBulletsEn: string[];
  featureBulletsAr: string[];
  gtin: string;
};

export type ListingAnalysisEdge = {
  id: string;
  angle: string;
  claim: string;
  evidence: string;
  source: string;
  selected: boolean;
};

export type ListingDraft = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  notes: string;
  ourPrice: string;
  brandEn: string;
  brandAr: string;
  gtin: string;
  numberOfPieces: string;
  sizeUnit: string;
  fulltypeHint: string;
  competitors: ListingCompetitorInput[];
  competitorNormalized: Record<
    string,
    {
      title: string;
      price: string;
      brand: string;
      bullets: string[];
      descriptionSummary: string;
      strengths: string[];
    }
  >;
  ours: {
    images: Array<{
      id: string;
      filename: string;
      mimeType: string;
      relativePath: string;
      sizeBytes: number;
      createdAt: string;
    }>;
    visionNotes: {
      appearance: string[];
      features: string[];
      packaging: string[];
      visibleText: string[];
      caveats: string[];
      model: string;
      builtAt: string;
    } | null;
    brandSuggestion: { en: string; ar: string } | null;
    content: ListingOursNoonContent | null;
  };
  analysis: {
    competitorPoints: Array<{
      competitorId: string;
      points: string[];
      strengths: string[];
    }>;
    ourEdges: ListingAnalysisEdge[];
    attackAngles: Array<{ angle: string; summary: string; edgeIds: string[] }>;
    risks: string[];
    model: string;
    builtAt: string;
  } | null;
  guardrails: { ok: boolean; warnings: string[]; blockers: string[] } | null;
  reviewNote: string;
  lastError: string | null;
  promo?: ListingPromoState;
};

export type ListingPromoSkuLock = {
  colorOnly: string;
  forbidColors: string;
  specOnly: string;
  forbidSpecs: string;
  sizeFit: string;
  effectNumber: string;
};

export type ListingPromoBrief = {
  platform: string;
  language: string;
  frameCount: number;
  aspectRatio: string;
  productName: string;
  sellingPoints: string[];
  skuLock: ListingPromoSkuLock;
  extraNotes: string;
};

export type ListingPromoImage = {
  filename: string;
  relativePath: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  aspectOk?: boolean;
  updatedAt: string;
};

export type ListingPromoJob = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  brief: ListingPromoBrief;
  agentId?: string;
  runId?: string;
  driverMode?: "folder" | "sdk" | "manual";
  images: ListingPromoImage[];
  userFeedback: Array<{ at: string; note: string; frameIndexes?: string[] }>;
  error?: string | null;
  outDirAbs?: string;
  inboxDirAbs?: string;
};

export type ListingPromoState = {
  brief: ListingPromoBrief;
  activeJobId: string | null;
  jobs: ListingPromoJob[];
};

export type ListingDraftSummary = {
  id: string;
  status: string;
  updatedAt: string;
  titleHint: string;
  competitorCount: number;
  imageCount: number;
};

export type ListingOptimizeCurrent = {
  title: string;
  price: string;
  brand: string;
  bullets: string;
  description: string;
};

export type ListingPerfAdsWindow = {
  days: number;
  views: number;
  clicks: number;
  orders: number;
  atc?: number;
  spend: number;
  revenue: number;
  ctr: number | null;
  cvr: number | null;
  atcRate?: number | null;
  orderFromAtc?: number | null;
  roas: number | null;
  acos: number | null;
  hasData: boolean;
  fromDate?: string | null;
  toDate?: string | null;
};

export type ListingPerfBundle = {
  partnerSku: string;
  noonSku: string;
  catalogTitle: string;
  price: number | null;
  currency: string;
  isActive: boolean | null;
  asOf: string;
  ads: {
    d7: ListingPerfAdsWindow;
    d14: ListingPerfAdsWindow;
    d30: ListingPerfAdsWindow;
    latest: ListingPerfAdsWindow;
  };
  sales: {
    d7: { days: number; units: number; amount: number; dailyAvg: number };
    d14: { days: number; units: number; amount: number; dailyAvg: number };
    d30: { days: number; units: number; amount: number; dailyAvg: number };
  };
  baseline?: {
    shopCtrP50: number | null;
    shopCvrP50: number | null;
    shopAtcRateP50: number | null;
    skuCtrVsP50: number | null;
    skuCvrVsP50: number | null;
    skuAtcRateVsP50: number | null;
    sampleSkuCount: number;
  };
  funnel?: {
    primaryWindow: string;
    stage: string;
    dropOff: string;
  };
  signals: Array<{
    code: string;
    severity: "info" | "warn" | "danger";
    message: string;
  }>;
  dataGaps: string[];
  sourceNote: string;
};

export type ListingOptimizeDiagnosis = {
  summary: string;
  ctrIssues: string[];
  cvrIssues: string[];
  otherIssues: string[];
  priorities: string[];
  suggestedFocus: string[];
  model: string;
  builtAt: string;
};

export type ListingOptimizeJob = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  listingUrl: string;
  partnerSku: string;
  noonSku: string;
  notes: string;
  current: ListingOptimizeCurrent;
  metrics: ListingPerfBundle | null;
  diagnosis: ListingOptimizeDiagnosis | null;
  optimized: ListingOursNoonContent | null;
  lastError: string | null;
};

export type ListingOptimizeSummary = {
  id: string;
  status: string;
  updatedAt: string;
  titleHint: string;
  partnerSku: string;
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
  title?: string;
  imageUrl?: string;
};

export type BestSellRow = {
  partnerSku: string;
  title: string;
  units: number;
  gmv: number;
};

export type InfoCheckTableMeta = {
  docId: string;
  label: string;
  pulledAt: string | null;
  headerCount: number;
  headers: string[];
  rowCount: number;
  hasSnapshot: boolean;
};

export type InfoCheckMeta = {
  product: InfoCheckTableMeta;
  monthlyDeals: InfoCheckTableMeta;
  infoCheck: InfoCheckTableMeta;
  commonFields: string[];
};

export type InfoCheckCompareCell = {
  field: string;
  product: string;
  monthlyDeals: string;
  infoCheck: string;
  mismatch: boolean;
  sources?: {
    product: string | null;
    monthlyDeals: string | null;
    infoCheck: string | null;
  };
};

export type InfoCheckQueryRow = {
  psku: string;
  sources: {
    product: Record<string, string> | null;
    monthlyDeals: Record<string, string> | null;
    infoCheck: Record<string, string> | null;
  };
  compare?: InfoCheckCompareCell[];
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
  sellerId?: string | null;
  sellerName?: string | null;
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
    priceCleanShare?: number | null;
    bestSellerCount: number;
    sellerTopShare?: number | null;
    sellerTopLabel?: string | null;
    sellerCoverage?: number | null;
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
    monitorPriceApi?: string;
  };
  monitor?: {
    targets: number;
    active: number;
    pendingChanges: number;
    openAlerts: number;
  };
  sources?: {
    total: number;
    active: number;
    trial: number;
    watch: number;
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

export type MiConfidenceTier = "high" | "mid" | "low";

export type MiMonitorTarget = {
  productKey: string;
  url: string;
  title: string;
  note?: string;
  addedAt: string;
  addedFrom: "watchlist" | "manual" | "extension";
  status: "active" | "paused";
  lastPrice: number | null;
  lastConfidence: number | null;
  lastCapturedAt: string | null;
  lastTier: MiConfidenceTier | null;
};

export type MiPendingPriceChange = {
  productKey: string;
  fromPrice: number;
  toPrice: number;
  direction: "down" | "up";
  firstObsId: string;
  firstCapturedAt: string;
};

export type MiPriceAlert = {
  id: string;
  productKey: string;
  url: string;
  title: string;
  fromPrice: number;
  toPrice: number;
  changePct: number;
  direction: "down" | "up";
  confirmedAt: string;
  observationIds: [string, string];
  status: "open" | "acked";
  tier: MiConfidenceTier;
};

export type MiPriceObservation = {
  id: string;
  productKey: string;
  url: string;
  title: string;
  price: number | null;
  currency: string;
  promoText: string | null;
  inStock: boolean | null;
  confidence: number;
  tier: MiConfidenceTier;
  source: string;
  parseMethod: string;
  flags: string[];
  capturedAt: string;
};

export type MiIntelSource = {
  sourceId: string;
  title: string;
  type: string;
  locale: string;
  howWeGet: string;
  topics: string[];
  score: number;
  status: "active" | "trial" | "watch" | "retired";
  note?: string;
  updatedAt: string;
};

export type MiSourceSnippet = {
  id: string;
  sourceId: string;
  title: string | null;
  text: string;
  url: string | null;
  topics: string[];
  confidence: number;
  tier: MiConfidenceTier;
  capturedAt: string;
  flags: string[];
};

export type FinanceOverview = {
  source: string;
  primaryRevenue?: string;
  orderCount: number;
  units: number;
  salesRevenueSar?: number;
  orderRevenueSar?: number;
  revenueSar: number;
  revenueCny: number;
  airCostCny: number;
  reviewCostCny: number;
  profitCny: number;
  caveats?: string[];
  platformFees?: {
    feeSkuCount: number;
    avgCommissionRate: number;
    commissionSar: number;
    outboundFeeSar: number;
    taxSar: number;
    totalSar: number;
    totalCny: number;
  };
  invoices?: {
    count: number;
    amountSar: number;
    gap: string | null;
  };
  snapshot: Record<string, number | string>;
};

export type FinanceSettlementMonth = {
  month: string;
  netProceedsSar: number;
  vatSar: number;
  platformFeesSar: number;
  feeBreakdown: {
    advertising: number;
    referral: number;
    fbnOutbound: number;
    returnAdmin: number;
  };
  otherFeesSar: number;
  minDate: string;
  maxDate: string;
  rowCount: number;
  sourceFile: string;
  importedAt: string;
  netProceedsCny: number;
  platformFeesCny: number;
  vatCny: number;
  platformFeePct: number | null;
  netAfterFeesSar: number;
  netAfterFeesCny: number;
  costs: {
    purchaseCny: number;
    headhaulCny: number;
    packagingCny: number;
    units: number;
    missingUnits?: number;
    missingUnitPct?: number;
    skuWithCost: number;
    skuMissingCost: number;
    missingSkus?: string[];
  };
  pureProfitCny: number;
  coverageComplete: boolean;
  lastDayOfMonth: string;
  closeStatus?: "open" | "incomplete" | "closed";
  closedAt?: string | null;
};

export type FinanceCloseGate = {
  month: string;
  ok: boolean;
  fx: number;
  fxCaveat: string | null;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
  coverageComplete: boolean;
};

export type FinanceMonthClose = {
  month: string;
  status: "closed" | "superseded";
  closedAt: string;
  closedBy: "schedule" | "manual";
  fx: number;
  sourceFile: string;
  netProceedsSar: number;
  platformFeesSar: number;
  vatSar: number;
  purchaseCny: number;
  headhaulCny: number;
  packagingCny: number;
  pureProfitCny: number;
};

export type FinanceSettlement = {
  basis: "noon_statement";
  fx: number;
  months: FinanceSettlementMonth[];
  totals: {
    netProceedsSar: number;
    platformFeesSar: number;
    vatSar: number;
    netProceedsCny: number;
    platformFeesCny: number;
    vatCny: number;
    purchaseCny: number;
    headhaulCny: number;
    packagingCny: number;
    pureProfitCny: number;
  };
  caveats: string[];
  costBasis: string;
  targetMonth?: string;
};

export type DashboardOverview = {
  asOf: string;
  shop: { id: string; name: string; projectCode: string };
  currency: string;
  confidence: "high" | "medium" | "low";
  caveats: string[];
  definitions: Array<{
    id: string;
    label: string;
    source: string;
    grain: string;
    note: string;
  }>;
  sales: {
    totalAmount: number;
    totalUnits: number;
    skuCount: number;
    factCount: number;
    latestDate: string | null;
    latest: { date: string; amount: number; units: number };
    previous: { date: string; amount: number; units: number };
    vsPreviousPct: { amount: number | null; units: number | null };
    series: Array<{ date: string; units: number; amount: number }>;
  };
  ads: {
    /** 上海日历昨天 */
    date?: string;
    /** exact-day=单日事实；covering=区间覆盖昨天；none=无昨日广告 */
    scope?: "exact-day" | "covering" | "none";
    spend: number;
    revenue: number;
    orders: number;
    roas: number | null;
    contributionPct: number | null;
    reportFrom: string | null;
    reportTo: string | null;
    factCount: number;
    allFactCount?: number;
  };
  catalog: {
    stockSkuCount: number;
    salesSkuCount: number;
    onHandQty: number;
    inTransitQty: number;
    inTransitSkuCount?: number;
    inTransitBoxCount?: number;
    inTransitTicketCount?: number;
    inTransitSource?: string;
    storePrefixes?: string[];
  };
  orders: {
    count: number;
    gmv: number;
    units: number;
    byStatus: Record<string, number>;
    pendingApprox: number;
    /** 上海日历昨天成交单（placedAt，去重，排除取消类）；GMV 来自 salesFacts */
    yesterday?: {
      date: string;
      count: number;
      gmv?: number;
      units?: number;
      gmvDate?: string;
      gmvFallback?: boolean;
    };
    dayBefore?: { date: string; count: number; gmv?: number; units?: number };
    vsPreviousDayPct?: number | null;
    vsPreviousDayGmvPct?: number | null;
    /** 自然单 / 自然 GMV = 总 − 广告归因 */
    organic?: {
      date: string;
      orders: number;
      gmv: number;
      totalGmv?: number;
      totalGmvDate?: string;
      gmvFallback?: boolean;
      adOrders: number;
      adGmv: number;
    };
  };
  fees: { outboundFeeSar: number; feeSkuCount: number };
  topSkus: Array<{
    partnerSku: string;
    title: string;
    imageUrl: string;
    units: number;
    amount: number;
    spark: number[];
  }>;
};

export type InvoiceDocRow = {
  id: string;
  invoiceNr: string;
  invoiceType: string;
  status: string;
  currency: string;
  amount: number;
  issuedAt: string | null;
  dueAt: string | null;
  partnerSku: string;
  title?: string;
  imageUrl?: string;
  updatedAt: string;
};

export type AdsSummary = {
  source: string;
  factCount: number;
  skuCount: number;
  campaignCount: number;
  spend: number;
  revenue: number;
  orders: number;
  clicks: number;
  views: number;
  atc?: number;
  roas: number | null;
  reportFrom: string | null;
  reportTo: string | null;
};

export type AdsBySkuRow = {
  partnerSku: string;
  catalogPartnerSku?: string | null;
  title?: string;
  imageUrl?: string;
  spend: number;
  revenue: number;
  orders: number;
  clicks: number;
  views: number;
  atc?: number;
  campaignCount: number;
  roas: number | null;
  fromDate: string;
  toDate: string;
};

export type AdsFactRow = {
  partnerSku: string;
  catalogPartnerSku?: string | null;
  title?: string;
  imageUrl?: string;
  campaign: string;
  fromDate: string;
  toDate: string;
  spend: number;
  revenue: number;
  orders: number;
  views: number;
  clicks: number;
  atc?: number;
  updatedAt: string;
  roas: number | null;
};

export type PurchaseSummary = {
  source: string;
  rowCount: number;
  withPurchaseCost: number;
  sumPurchaseCostRmb: number;
  purchaseLineCount?: number;
  purchaseLineAmount?: number;
  cashIncome?: number;
  cashExpense?: number;
  arrivingTodayCount?: number;
  alibaba1688HasSession?: boolean;
  coverageNote: string;
};

export type PurchaseCostRow = {
  partnerSku: string;
  title: string;
  imageUrl?: string;
  purchaseCost: number;
  headhaul: number;
  preferAir: boolean;
  cargoType: string;
  source: string | null;
  updatedAt: string;
};

export type PurchaseLineRow = {
  id: string;
  partnerSku: string;
  productName: string;
  title?: string;
  imageUrl?: string;
  qty: number;
  unitCost: number;
  amount: number;
  supplier: string;
  purchasedAt: string | null;
  status: string;
  remark: string;
  sheetTitle: string;
  updatedAt: string;
  source: string;
  orderId?: string;
  trackingNo?: string;
  transitStatus?: string;
  etaDate?: string | null;
  logisticsUpdatedAt?: string | null;
};

export type PurchaseArrivingTodayRow = {
  id: string;
  partnerSku: string;
  productName: string;
  title?: string;
  imageUrl?: string;
  noonSku?: string;
  qty: number;
  receivedQty?: number;
  remainingQty?: number;
  receiptKey?: string;
  orderId: string;
  trackingNo: string;
  transitStatus: string;
  etaDate: string | null;
  orderStatusHint: string;
  supplier?: string;
  purchasedAt?: string | null;
  remark?: string;
};

export type CashLedgerRow = {
  id: string;
  kind: "income" | "expense" | "other";
  amount: number;
  category: string;
  occurredAt: string | null;
  remark: string;
  sheetTitle: string;
  updatedAt: string;
  source: string;
};

export type PurchaseLedgerSheetKey =
  | "product_purchase"
  | "packaging_purchase"
  | "expense_misc";

export type PurchaseLedgerFieldMeta = {
  key: string;
  label: string;
  type: "text" | "number" | "date";
  required: boolean;
};

export type PurchaseLedgerSheetMeta = {
  key: PurchaseLedgerSheetKey;
  title: string;
  kind: "purchase" | "expense";
  fields: PurchaseLedgerFieldMeta[];
};

export type PurchaseLedgerRow = {
  sheetRow: number;
  fields: Record<string, string | number | null>;
  preview: string;
};

export type ReplenishPlanRow = {
  partnerSku: string;
  noonSku?: string;
  title: string;
  imageUrl?: string;
  isActive: boolean;
  listingType?: string;
  offlineCatalog?: boolean;
  offlineHint?: string | null;
  shopId?: string;
  shopName?: string;
  projectCode?: string;
  inventory: {
    fbn: number;
    fbp: number;
    supermall: number;
    inTransit: number;
    total: number;
  };
  dailyAvg: number;
  availableDays: number | null;
  safetyDays: number;
  status: string;
  airLeadDays: number;
  seaLeadDays: number;
  salesD7: number;
  salesD30: number;
  salesD90: number;
  shipQty?: { air: number; sea: number; single: number } | null;
  specs?: {
    dimsLabel: string | null;
    weightLabel: string | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
    weightKg: number | null;
    purchaseCost: number | null;
  };
  /** @deprecated 已取消系统建议补货件数 */
  suggestQty?: number;
  suggestHint?: string;
  feishu: {
    productName?: string;
    airReplenishPlan: number;
    seaReplenishPlan: number;
    airInTransit: number;
    seaInTransit: number;
    purchasedQty: number;
    sheetTitle: string;
    reportDate: string | null;
  } | null;
};

export type ReplenishPlanResponse = {
  rows: ReplenishPlanRow[];
  summary: {
    skuCount: number;
    byStatus: Record<string, number>;
    source: string;
    gap: string | null;
    feishuOpsCount?: number;
    withFeishuPlan?: number;
    offlineCatalogCount?: number;
    shopId?: string;
    shopName?: string;
    projectCode?: string;
    dataNote?: string;
  };
  freshness?: {
    today: string;
    asOf: string;
    slices: ProvenanceSlice[];
  };
};

/** 本地动态补货表（月均×3+15 + ASN 在途） */
export type ReplenishWorkbookRow = {
  partnerSku: string;
  title: string;
  salesD90: number;
  monthlyAvg: number;
  salesRank: number | null;
  salesWeight: number;
  demandQty: number;
  /** 可售 = FBN仓 + supermall */
  fbn: number;
  /** 分仓 FBN 合计 */
  fbnWh: number;
  supermall: number;
  inTransit: number;
  inTransitAir: number;
  inTransitSea: number;
  shipModesLabel: string;
  suggestQty: number;
  needReplenish: boolean;
  needReplenishLabel: string;
  manualTag: string;
  note: string;
  imageUrl: string;
  noonSku: string;
};

export type ReplenishWorkbookMeta = {
  shopPrefix: string;
  shopId: string;
  shopName: string;
  projectCode: string;
  filePath: string;
  sheetTitle: string;
  generatedAt: string;
  rowCount: number;
  needCount: number;
  formulaNote: string;
};

export type ReplenishWorkbookResponse = {
  meta: ReplenishWorkbookMeta;
  rows: ReplenishWorkbookRow[];
  summary: {
    rowCount: number;
    filteredCount: number;
    needCount: number;
    onlyNeed: boolean;
    topPct: number | null;
    coverMonths?: number;
    formulaNote: string;
    dir: string;
    manualTagOptions?: Array<{ value: string; label: string }>;
  };
};

export type ForwarderBoardRanking = {
  rank: number;
  forwarder: string;
  score: number;
  reasons: string[];
  quoteAirMid?: number | null;
  quoteSeaMid?: number | null;
};

/** 发货渠道历史参考（装箱明细已发货行） */
export type ChannelHistoryModeBucket = {
  boxes: number;
  pcs: number;
  distinctSku: number;
  lastShipAt: string | null;
};

export type ChannelHistoryForwarder = {
  forwarder: string;
  boxes: number;
  pcs: number;
  distinctSku: number;
  lastShipAt: string | null;
  byMode: Record<string, ChannelHistoryModeBucket>;
};

export type CargoKindOption = { value: string; label: string };

export type ForwarderCargoHint = {
  forwarder: string;
  partnerSku: string;
  cargoKind: string;
  updatedAt: string;
};

export type ChannelHistoryPayload = {
  source: {
    lineCount: number;
    shippedLineCount: number;
    missingShipAtCount: number;
    shippedPcs: number;
    channelCount: number;
    forwarderCount: number;
  };
  channels: Array<{
    forwarder: string;
    mode: string;
    boxes: number;
    pcs: number;
    distinctSku: number;
    lastShipAt: string | null;
    deliveredPcs: number;
  }>;
  forwarders: ChannelHistoryForwarder[];
  cargoHints: ForwarderCargoHint[];
};

export type SkuChannelHistory = {
  partnerSku: string;
  name: string;
  totalPcs: number;
  channels: Array<{
    forwarder: string;
    mode: string;
    pcs: number;
    boxCount: number;
    firstShipAt: string | null;
    lastShipAt: string | null;
    share: number;
    cargoKind: string | null;
  }>;
  preferred: { forwarder: string; mode: string; pcs: number } | null;
  recentSamples: Array<{
    boxNo: string;
    ticketNo: string;
    shipAt: string | null;
    forwarder: string;
    mode: string;
    qty: number;
  }>;
};

export type SkuChannelHistorySearch = {
  q: string;
  cargoHints: ForwarderCargoHint[];
  skus: SkuChannelHistory[];
};

export type ForwarderAggRow = {
  forwarder: string;
  boxes: number;
  tickets: number;
  pcs: number;
  weightKg: number;
  cbm: number;
  boxFreightSum: number;
  ticketFreightSum: number;
  domesticFreightSum: number;
  inTransitBoxes: number;
  deliveredBoxes: number;
  withTransit: number;
  avgTransitDays: number | null;
  rmbPerKg: number | null;
  rmbPerCbm: number | null;
  byMode: Record<
    string,
    {
      boxes: number;
      pcs: number;
      weightKg: number;
      cbm: number;
      boxFreight: number;
      ticketFreight: number;
    }
  >;
};

export type LabelCropResult = {
  filename: string;
  mimeType: string;
  base64: string;
  pageCount: number;
  widthPt: number;
  heightPt: number;
};

export type ShippingOpsOverview = {
  summary: {
    stockSkuCount: number;
    inTransitSkuCount: number;
    totalInTransitQty: number;
    feishuTransitSkuCount?: number;
    packingInTransitBoxes?: number;
    packingInTransitPcs?: number;
    packingInTransitTickets?: number;
    forwarderCount?: number;
    quoteForwarderCount?: number;
    orderCount: number;
    ordersByStatus: Record<string, number>;
    source: string;
    gap: string;
  };
  inTransit: Array<{
    partnerSku: string;
    title: string;
    imageUrl?: string;
    onHand: number;
    inTransit: number;
    warehouseCount: number;
  }>;
  feishuTransit?: Array<{
    partnerSku: string;
    title: string;
    imageUrl?: string;
    airInTransit: number;
    seaInTransit: number;
    purchasedQty: number;
    sheetTitle: string;
    reportDate: string | null;
  }>;
  packingInTransit?: Array<{
    boxNo: string;
    ticketNo: string;
    forwarder: string;
    modeRaw: string;
    pcs: number;
    shipAt: string | null;
    asn: string;
    logisticsNo: string;
  }>;
  /** 本店装箱在途：票 → 箱 → 货 */
  packingInTransitDetail?: {
    storePrefixes: string[];
    qty: number;
    skuCount: number;
    boxCount: number;
    ticketCount: number;
    tickets: Array<{
      ticketKey: string;
      ticketNo: string;
      logisticsNo: string;
      forwarder: string;
      modeRaw: string;
      shipAt: string | null;
      boxCount: number;
      pcs: number;
      boxes: Array<{
        boxNo: string;
        pcs: number;
        skuCount: number;
        modeRaw: string;
        forwarder: string;
        logisticsNo: string;
        ticketNo: string;
        items: Array<{ partnerSku: string; title: string; qty: number }>;
      }>;
    }>;
  } | null;
  packingDelivered?: Array<{
    boxNo: string;
    forwarder: string;
    modeRaw: string;
    pcs: number;
    shipAt: string | null;
    arriveAt: string | null;
    transitDays: number | null;
    boxCrossFreight: number | null;
  }>;
  forwarderBoard?: {
    source: {
      snapshotPath: string | null;
      pulledAt: string | null;
      sheetTitle: string;
      boxRows: number;
      forwarderCount: number;
    };
    freightRates?: {
      snapshotPath: string | null;
      pulledAt: string | null;
      rowCount: number;
      forwarderCount: number;
    };
    ranking: ForwarderBoardRanking[];
    forwarders: ForwarderAggRow[];
    quotes?: Array<{
      forwarder: string;
      generalAirMid: number | null;
      generalSeaMid: number | null;
      batteryAirMid: number | null;
      batterySeaMid?: number | null;
      sensitiveAirMid: number | null;
      sensitiveSeaMid?: number | null;
      sensitiveBatteryAirMid?: number | null;
      sensitiveBatterySeaMid?: number | null;
      lampAirMid: number | null;
      lampSeaMid?: number | null;
      extra: string;
    }>;
  };
  stockSample: Array<{
    partnerSku: string;
    title: string;
    imageUrl?: string;
    onHand: number;
    inTransit: number;
    warehouseCount: number;
  }>;
};

export type BoxHeadhaulLine = {
  boxNo: string;
  partnerSku: string;
  name: string;
  qty: number;
  cargoKind: string;
  cargoLabel: string;
  mode: string;
  forwarder: string;
  share: number;
  rateRmb: number | null;
  rateSource: string;
  quoteRmb: number;
  actualRmb: number | null;
  unitQuoteRmb: number;
  unitActualRmb: number | null;
  unitHeadhaulRmb: number;
  confidence: string;
  reasons: string[];
};

export type BoxHeadhaulResult = {
  boxNo: string;
  forwarder: string;
  mode: string;
  weightKg: number | null;
  chargeableKg: number | null;
  cbm: number | null;
  quoteTotalRmb: number;
  actualTotalRmb: number | null;
  domesticTotalRmb: number;
  lines: BoxHeadhaulLine[];
};

export type SkuHeadhaulSummary = {
  partnerSku: string;
  unitHeadhaulRmb: number;
  unitQuoteRmb: number | null;
  unitActualRmb: number | null;
  sampleQty: number;
  boxCount: number;
  confidence: string;
  basis: "actual" | "quote" | "fallback";
  lastBoxNo: string | null;
  lastForwarder: string | null;
  cargoKind: string | null;
};

export type CargoLedgerMeta = {
  builtAt: string;
  sources: Record<string, { path: string | null; pulledAt: string | null }>;
  side: {
    purchaseLots: number;
    purchasePskus: number;
    cashEntries: number;
    packagingRows: number;
    productMaster: number;
    dailyLatestSheet: string | null;
    dailyPskus: number;
  };
  shops: Array<{
    shopCode: string;
    tickets: number;
    boxes: number;
    pcs: number;
    skuCount: number;
    inTransitTickets: number;
  }>;
  ticketCount: number;
  boxCount: number;
  skuLineCount: number;
  issueCount: number;
  issuesPreview: Array<{
    code: string;
    severity: string;
    message: string;
    ticketKey?: string;
    boxNo?: string;
    partnerSku?: string;
  }>;
};

export type CargoLedgerTicketSummary = {
  ticketKey: string;
  ticketNo: string;
  logisticsNo: string;
  shopCode: string;
  forwarder: string;
  mode: string;
  modeRaw: string;
  shipAt: string | null;
  arriveAt: string | null;
  inTransit: boolean;
  settled: string;
  boxCount: number;
  skuCount: number;
  pcs: number;
  weightKg: number;
  crossFreight: number | null;
  freightBasis: "ticket" | "box_sum" | "missing";
  domesticFreight: number | null;
};

export type CargoLedgerTicketDetail = CargoLedgerTicketSummary & {
  boxes: Array<{
    boxNo: string;
    shopCode: string;
    pcs: number;
    weightKg: number | null;
    boxCrossFreight: number | null;
    warehouseStatus: string;
    arriveAt: string | null;
  }>;
  skuLines: Array<{
    partnerSku: string;
    name: string;
    qty: number;
    weightKg: number;
    boxNos: string[];
    allocatedCrossFreight: number | null;
    purchaseUnitHint: number | null;
    purchaseLotCount: number;
    inProductMaster: boolean;
    shopMismatch: boolean;
  }>;
};


export type ForwarderBoardAnalyze = {
  board: NonNullable<ShippingOpsOverview["forwarderBoard"]>;
  llm: {
    model: string;
    judgment: {
      headline: string;
      topPick: string | null;
      rankingNotes: Array<{ forwarder: string; note: string }>;
      caveats: string[];
      confidence: "high" | "medium" | "low";
    };
  };
};

export type YibangTrackEvent = {
  name: string;
  nameEn?: string;
  desc?: string | null;
  at?: string;
  reasonInfo?: string | null;
};

export type YibangTrackResult = {
  at: string;
  portalId: "yibang";
  adapter: "yundaomen";
  queryField: "物流编号";
  packingSource: string | null;
  packing: {
    logisticsNo: string;
    ticketNo: string;
    boxNo: string;
    warehouseStatus: string;
    forwarder: string;
  } | null;
  track: {
    ok: boolean;
    logisticsNo: string;
    stage: string;
    statusText?: string;
    detailLines?: string[];
    events?: YibangTrackEvent[];
    finalUrl?: string;
    screenshotPath?: string;
    message: string;
    durationMs: number;
  };
  reportPath: string;
};

export type FeitanTrackResult = {
  at: string;
  portalId: "feitan";
  adapter: "fleetan";
  queryField: "票号";
  packingSource: string | null;
  packing: {
    ticketNo: string;
    logisticsNo: string;
    boxNo: string;
    modeRaw: string;
    warehouseStatus: string;
    forwarder: string;
  } | null;
  track: {
    ok: boolean;
    ticketNo: string;
    modeTried: string;
    modeHit?: "sea" | "air";
    stage: string;
    statusText?: string;
    detailLines?: string[];
    events?: Array<{ name: string; at?: string; desc?: string | null }>;
    finalUrl?: string;
    screenshotPath?: string;
    message: string;
    durationMs: number;
  };
  reportPath: string;
};

export type HanshaTrackResult = {
  at: string;
  portalId: "hansha";
  adapter: "nextsls";
  queryField: "票号";
  packingSource: string | null;
  packing: {
    ticketNo: string;
    logisticsNo: string;
    boxNo: string;
    modeRaw: string;
    warehouseStatus: string;
    forwarder: string;
  } | null;
  track: {
    ok: boolean;
    ticketNo: string;
    stage: string;
    statusText?: string;
    serviceText?: string;
    detailLines?: string[];
    events?: Array<{ name: string; at?: string; desc?: string | null }>;
    finalUrl?: string;
    screenshotPath?: string;
    message: string;
    durationMs: number;
  };
  reportPath: string;
};

export type YayouhuiTrackResult = {
  at: string;
  portalId: "yayouhui";
  adapter: "nextsls";
  queryField: "票号";
  packingSource: string | null;
  packing: {
    ticketNo: string;
    logisticsNo: string;
    boxNo: string;
    modeRaw: string;
    warehouseStatus: string;
    forwarder: string;
  } | null;
  track: {
    ok: boolean;
    ticketNo: string;
    stage: string;
    statusText?: string;
    serviceText?: string;
    detailLines?: string[];
    events?: Array<{ name: string; at?: string; desc?: string | null }>;
    finalUrl?: string;
    screenshotPath?: string;
    message: string;
    durationMs: number;
  };
  reportPath: string;
};

export type YiteTrackResult = {
  at: string;
  portalId: "yite";
  adapter: "nextsls";
  queryField: "物流编号";
  logisticsNo: string;
  waybillNo: string;
  packingSource: string | null;
  packing: {
    logisticsNo: string;
    waybillNo: string;
    ticketNo: string;
    boxNo: string;
    modeRaw: string;
    warehouseStatus: string;
    forwarder: string;
  } | null;
  track: {
    ok: boolean;
    ticketNo: string;
    stage: string;
    statusText?: string;
    serviceText?: string;
    detailLines?: string[];
    events?: Array<{ name: string; at?: string; desc?: string | null }>;
    finalUrl?: string;
    screenshotPath?: string;
    message: string;
    durationMs: number;
  };
  reportPath: string;
};

export type AnshidaTrackResult = {
  at: string;
  portalId: "anshida";
  adapter: "ontask";
  queryField: "票号";
  packingSource: string | null;
  packing: {
    ticketNo: string;
    logisticsNo: string;
    boxNo: string;
    modeRaw: string;
    warehouseStatus: string;
    forwarder: string;
  } | null;
  track: {
    ok: boolean;
    ticketNo: string;
    stage: string;
    statusText?: string;
    detailLines?: string[];
    events?: Array<{ name: string; at?: string; desc?: string | null }>;
    finalUrl?: string;
    screenshotPath?: string;
    message: string;
    durationMs: number;
  };
  reportPath: string;
};

export type QikeTrackResult = {
  at: string;
  portalId: "qike";
  adapter: "chicexpress";
  queryField: "物流编号";
  packingSource: string | null;
  packing: {
    logisticsNo: string;
    ticketNo: string;
    boxNo: string;
    modeRaw: string;
    warehouseStatus: string;
    forwarder: string;
  } | null;
  track: {
    ok: boolean;
    logisticsNo: string;
    stage: string;
    statusText?: string;
    transportMode?: string;
    detailLines?: string[];
    events?: Array<{ name: string; at?: string; desc?: string | null }>;
    finalUrl?: string;
    screenshotPath?: string;
    message: string;
    durationMs: number;
  };
  reportPath: string;
};

/** 物流管理查件回填统一行 */
export type ForwarderTrackHit = (
  | YibangTrackResult
  | FeitanTrackResult
  | HanshaTrackResult
  | YayouhuiTrackResult
  | YiteTrackResult
  | AnshidaTrackResult
  | QikeTrackResult
) & {
  id: string;
  portalName: string;
  /** 发起查询的本地时间（ISO）；旧 localStorage 记录可能缺失 */
  queriedAt?: string;
};

export type CampaignsOverview = {
  rows: Array<{
    campaign: string;
    spend: number;
    revenue: number;
    orders: number;
    clicks: number;
    skuCount: number;
    roas: number | null;
    fromDate: string;
    toDate: string;
  }>;
  summary: {
    campaignCount: number;
    source: string;
    caveat: string;
    gap: string;
  };
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
  | "pw-keepalive"
  | "mi-discover"
  | "mi-collect"
  | "inbox-watcher"
  | "store-morning-digest"
  | "mi-morning-digest"
  | "gp-month-close";

export type SchedulerItem = {
  id: SchedulerId;
  label: string;
  group: "sync" | "market-intel" | "digest";
  enabled: boolean;
  timerActive: boolean;
  everyMs: number;
  running: boolean;
  lastRunAt: string | null;
  lastMessage: string | null;
  note?: string;
};

export type OpsSurface = "sales" | "replenish" | "finance";

export type OpsJudgment = {
  headline: string;
  highlights: Array<{ id: string; name: string; point: string; evidence: string }>;
  risks: Array<{ id: string; name: string; point: string; evidence: string }>;
  actions: Array<{
    id: string;
    name: string;
    priority: "P0" | "P1" | "P2";
    action: string;
    why: string;
  }>;
  caveats: string[];
  confidence: "high" | "medium" | "low";
};

export type OpsInterpretResult = {
  surface: OpsSurface;
  asOf: string;
  model: string | null;
  skippedLlm: boolean;
  judgment: OpsJudgment;
};

export type BomLineCategory = "purchase" | "first_mile" | "warehouse";

export type BomQuote = {
  profile: "general_15" | "fashion_25";
  sellPriceSar: number;
  breakdown: {
    sellPriceSar: number;
    purchaseCostSar: number | null;
    inboundListingSar: number;
    inboundPickSar: number;
    inboundHandleSar: number;
    firstMileSar: number;
    outboundFeeSar: number;
    referralFeeSar: number;
    vatPayableSar: number;
    storageSar: number;
    adCostSar: number;
    profitSar: number;
    marginPct: number | null;
    multiple: number | null;
    profitComplete: boolean;
    missing: string[];
  };
  usedDefaults: string[];
  materials: Array<{
    name: string;
    category: BomLineCategory;
    extendedSar: number;
  }>;
  explanation?: {
    summary: string;
    priceNote: string;
    caveats: string[];
    model: string;
  };
};

export type ArVerifyResult = {
  guardrails: { ok: boolean; warnings: string[]; blockers: string[] };
  issues: Array<{
    severity: "blocker" | "warning";
    field: string;
    point: string;
    suggestion: string;
  }>;
  model: string | null;
  checkedAt: string;
};

export type DocsKind = "weekly" | "competitor" | "product";

export type DocsAssistResult = {
  kind: DocsKind;
  asOf: string;
  model: string | null;
  judgment: OpsJudgment | null;
  competitor: {
    title: string;
    brand: string;
    price: string;
    strengths: string[];
    points: string[];
    risks: string[];
  } | null;
  productFields: {
    titleHints: string[];
    featureBullets: string[];
    specs: string[];
    brandHint: string;
    notes: string[];
  } | null;
};

export type AgentHubAskResult = {
  ok: boolean;
  model: string;
  answer: {
    verdict: string;
    confidence: "high" | "medium" | "low" | "none";
    evidence: Array<{
      toolId: string;
      source: string;
      key?: string;
      excerpt: string;
    }>;
    openQuestions: string[];
    toolsUsed: string[];
    inferences?: string[];
    notFound?: string[];
  };
  validation: { ok: boolean; violations: string[] };
  toolsInvoked: Array<{
    toolId: string;
    ok: boolean;
    unavailable: boolean;
    status: number;
    ms: number;
    error?: string;
  }>;
  unavailableTools: string[];
  rounds: number;
  timings: { totalMs: number; llmMs: number; toolMs: number };
  conversation?: {
    acceptedTurns: number;
    recentTurns: number;
    compressedTurns: number;
    keys: string[];
    compressed: boolean;
  };
  tenant?: { userId: string; shopId: string };
  error?: string;
};

export type AgentHubConversation = {
  version: 1;
  userId: string;
  shopId: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    keys?: string[];
    createdAt: string;
    toolsUsed?: string[];
    confidence?: string;
  }>;
};

export const api = {
  login: async (username: string, password: string) => {
    const res = await request<{
      data: {
        user: AuthUserPublic;
        selectedShopId: string;
        token: string;
      };
      message?: string;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    resetSessionReplacedNotice();
    return res;
  },
  logout: () =>
    request<{ data: { ok: boolean } }>("/auth/logout", { method: "POST" }),
  me: () =>
    request<{
      data: { user: AuthUserPublic; selectedShopId: string };
    }>("/auth/me"),
  listUsers: () => request<{ data: AuthUserPublic[] }>("/auth/users"),
  getAuditDaily: (day?: string) => {
    const q = new URLSearchParams();
    if (day) q.set("day", day);
    const qs = q.toString();
    return request<{
      data: AuditDailySummary;
      meta: { auditRoot?: string };
    }>(`/audit/daily${qs ? `?${qs}` : ""}`);
  },
  getAuditEvents: (opts?: {
    day?: string;
    module?: string;
    actor?: string;
    shopId?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (opts?.day) q.set("day", opts.day);
    if (opts?.module) q.set("module", opts.module);
    if (opts?.actor) q.set("actor", opts.actor);
    if (opts?.shopId) q.set("shopId", opts.shopId);
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    if (opts?.offset != null) q.set("offset", String(opts.offset));
    const qs = q.toString();
    return request<{
      data: AuditEventRow[];
      meta: { day: string; total: number; auditRoot?: string };
    }>(`/audit/events${qs ? `?${qs}` : ""}`);
  },
  createUser: (body: {
    username: string;
    password: string;
    role?: UserRole;
  }) =>
    request<{ data: AuthUserPublic; message?: string }>("/auth/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateUser: (
    id: string,
    body: { role?: UserRole; disabled?: boolean },
  ) =>
    request<{ data: AuthUserPublic; message?: string }>(
      `/auth/users/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),
  deleteUser: (id: string) =>
    request<{ data: AuthUserPublic; message?: string }>(
      `/auth/users/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  resetUserPassword: (id: string, password: string) =>
    request<{ data: AuthUserPublic; message?: string }>(
      `/auth/users/${encodeURIComponent(id)}/reset-password`,
      {
        method: "POST",
        body: JSON.stringify({ password }),
      },
    ),
  listTasks: () => request<{ data: TaskRecord[] }>("/tasks"),
  listTaskAssignees: (showAll = false) =>
    request<{ data: TaskAssigneeOption[] }>(
      `/tasks/assignees?showAll=${showAll ? "1" : "0"}`,
    ),
  getTaskInbox: () =>
    request<{ data: { items: TaskInboxItem[]; count: number } }>(
      "/tasks/inbox",
    ),
  getTask: (id: string) =>
    request<{ data: TaskRecord }>(`/tasks/${encodeURIComponent(id)}`),
  createTask: (body: {
    title: string;
    body?: string;
    assigneeId: string;
    priority?: TaskPriority;
    dueAt?: string | null;
  }) =>
    request<{ data: TaskRecord; message?: string }>("/tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uploadTaskAttachment: (
    id: string,
    body: {
      filename: string;
      mimeType: string;
      base64: string;
      kind: "publish" | "submit";
    },
  ) =>
    request<{ data: TaskRecord; attachment: TaskAttachment }>(
      `/tasks/${encodeURIComponent(id)}/attachments`,
      {
        method: "POST",
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      },
    ),
  taskAttachmentUrl: (taskId: string, attachmentId: string) =>
    `${BASE}/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}/file`,
  ackTask: (id: string) =>
    request<{ data: TaskRecord; message?: string }>(
      `/tasks/${encodeURIComponent(id)}/ack`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  submitTask: (id: string, body: string) =>
    request<{ data: TaskRecord; message?: string }>(
      `/tasks/${encodeURIComponent(id)}/submit`,
      { method: "POST", body: JSON.stringify({ body }) },
    ),
  reviewTask: (
    id: string,
    body: { decision: "approve" | "reject"; comment?: string },
  ) =>
    request<{ data: TaskRecord; message?: string }>(
      `/tasks/${encodeURIComponent(id)}/review`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  cancelTask: (id: string) =>
    request<{ data: TaskRecord; message?: string }>(
      `/tasks/${encodeURIComponent(id)}/cancel`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  dismissTaskReject: (id: string) =>
    request<{ data: TaskRecord }>(
      `/tasks/${encodeURIComponent(id)}/dismiss-reject`,
      { method: "POST", body: JSON.stringify({}) },
    ),
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
  /** Noon + 广告入库 + 飞书汇总同步（同一条链） */
  assemblySync: (body?: {
    skipNoon?: boolean;
    skipAds?: boolean;
    skipFeishu?: boolean;
    /** 跳过末段 ops_daily 面板导出（默认 false=会跑） */
    skipOpsDaily?: boolean;
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
  /** 各店销售/订单/广告等缺口审计（不打外部接口） */
  getDataGaps: (lookbackDays?: number) => {
    const q =
      lookbackDays != null && Number.isFinite(lookbackDays)
        ? `?lookbackDays=${Math.floor(lookbackDays)}`
        : "";
    return request<{
      data: {
        /** 健康门禁店齐全才为 true */
        complete: boolean;
        healthGateShopIds?: string[];
        shops: Array<{
          shopId: string;
          shopName: string;
          expectedEnd: string;
          complete: boolean;
          countsTowardHealth?: boolean;
          domains: Array<{
            domain: string;
            ok: boolean;
            maxDate: string | null;
            expectedEnd: string;
            missingDates: string[];
            fillFrom: string | null;
            fillTo: string | null;
            message: string;
            channel: string;
          }>;
        }>;
      };
    }>(`/sync/data-gaps${q}`);
  },
  /** 一键补洞：Noon 按域一次覆盖缺口；飞书直拉；缺 ads 触发 Playwright */
  runDataBackfill: (body?: {
    shopIds?: string[];
    skipNoon?: boolean;
    skipFeishu?: boolean;
    skipYingdao?: boolean;
    maxImpexPerShop?: number;
    maxImpexTotal?: number;
    lookbackDays?: number;
  }) =>
    request<{
      data: {
        ok: boolean;
        runId: string;
        message: string;
        startedAt: string;
        finishedAt: string;
        actions: Array<{
          shopId: string;
          domain: string;
          ok: boolean;
          skipped?: boolean;
          message: string;
          fillFrom?: string | null;
          fillTo?: string | null;
          channel?: string;
        }>;
        audits: Array<{
          shopId: string;
          complete: boolean;
          expectedEnd: string;
        }>;
      };
      message?: string;
    }>("/sync/data-backfill", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30 * 60 * 1000),
    }),
  getDataBackfillLast: () =>
    request<{
      data: {
        running: boolean;
        last: {
          ok?: boolean;
          runId?: string;
          message?: string;
          finishedAt?: string;
          startedAt?: string;
          actions?: Array<{
            shopId: string;
            domain: string;
            ok: boolean;
            skipped?: boolean;
            message: string;
          }>;
        } | null;
      };
    }>("/sync/data-backfill/last"),
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
  getCatalog: (opts?: {
    page?: number;
    pageSize?: number;
    q?: string;
    onlyFbn?: boolean;
    onlyAds?: boolean;
    onlyMissingLocal?: boolean;
    all?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (opts?.all) q.set("all", "1");
    else {
      q.set("page", String(opts?.page ?? 1));
      q.set("pageSize", String(opts?.pageSize ?? 50));
    }
    if (opts?.q) q.set("q", opts.q);
    if (opts?.onlyFbn) q.set("onlyFbn", "1");
    if (opts?.onlyAds) q.set("onlyAds", "1");
    if (opts?.onlyMissingLocal) q.set("onlyMissingLocal", "1");
    const qs = q.toString();
    return request<{
      data: CatalogRow[];
      meta?: {
        count?: number;
        total?: number;
        matched?: number;
        page?: number;
        pageSize?: number;
        pageCount?: number;
        withImage?: number;
        withAds?: number;
        hiddenNoDisplay?: number;
        orphanInMatched?: number;
        asOf?: string;
        joinKey?: string;
        cached?: boolean;
        localAlign?: {
          matched: number;
          partial: number;
          missing: number;
          costRows: number;
          dimsRows: number;
        };
        provenance?: CatalogProvenance;
        officialCatalogCount?: number;
        orphanCount?: number;
      };
    }>(`/catalog${qs ? `?${qs}` : ""}`);
  },
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
  listListingDrafts: () =>
    request<{ data: ListingDraftSummary[] }>("/listing/drafts"),
  getListingDraft: (id: string) =>
    request<{ data: ListingDraft }>(`/listing/drafts/${id}`),
  createListingDraft: (body?: Partial<ListingDraft>) =>
    request<{ data: ListingDraft }>("/listing/drafts", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  deleteListingDraft: (id: string) =>
    request<{ data: { id: string; deleted: boolean } }>(`/listing/drafts/${id}`, {
      method: "DELETE",
    }),
  patchListingDraft: (id: string, body: Record<string, unknown>) =>
    request<{ data: ListingDraft }>(`/listing/drafts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  getLatestCompetitorCapture: () =>
    request<{
      data: {
        url: string;
        pastedTitle: string;
        pastedPrice: string;
        pastedBullets: string;
        pastedDescription: string;
        brand?: string;
        capturedAt: string;
      };
    }>("/listing/competitor-capture/latest"),
  importCompetitorCapture: (id: string) =>
    request<{ data: ListingDraft; message?: string }>(
      `/listing/drafts/${id}/import-competitor-capture`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  normalizeCompetitorPaste: (
    id: string,
    body: { competitorId?: string; rawText?: string },
  ) =>
    request<{ data: ListingDraft; meta?: { brand?: string } }>(
      `/listing/drafts/${id}/normalize-competitor-paste`,
      {
        method: "POST",
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      },
    ),
  uploadListingDraftImage: (
    id: string,
    body: { filename: string; mimeType: string; base64: string },
  ) =>
    request<{ data: ListingDraft }>(`/listing/drafts/${id}/images`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    }),
  deleteListingDraftImage: (id: string, imageId: string) =>
    request<{ data: ListingDraft }>(`/listing/drafts/${id}/images/${imageId}`, {
      method: "DELETE",
    }),
  listingDraftImageUrl: (id: string, imageId: string) =>
    `${BASE}/listing/drafts/${id}/images/${imageId}/file`,
  runListingVision: (id: string) =>
    request<{ data: ListingDraft }>(`/listing/drafts/${id}/vision`, {
      method: "POST",
      signal: AbortSignal.timeout(180_000),
    }),
  runListingAnalyze: (id: string) =>
    request<{ data: ListingDraft }>(`/listing/drafts/${id}/analyze`, {
      method: "POST",
      signal: AbortSignal.timeout(180_000),
    }),
  runListingGenerate: (
    id: string,
    selectedEdgeIds?: string[],
    mode?: "ours_only" | "from_edges",
  ) =>
    request<{ data: ListingDraft; meta?: { model?: string; mode?: string } }>(
      `/listing/drafts/${id}/generate`,
      {
        method: "POST",
        body: JSON.stringify({ selectedEdgeIds, mode }),
        signal: AbortSignal.timeout(180_000),
      },
    ),
  patchListingDraftContent: (id: string, content: ListingOursNoonContent) =>
    request<{ data: ListingDraft }>(`/listing/drafts/${id}/content`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  setListingEdges: (id: string, selectedEdgeIds: string[]) =>
    request<{ data: ListingDraft }>(`/listing/drafts/${id}/edges`, {
      method: "POST",
      body: JSON.stringify({ selectedEdgeIds }),
    }),
  approveListingDraft: (id: string, reviewNote?: string) =>
    request<{ data: ListingDraft }>(`/listing/drafts/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ reviewNote }),
    }),
  rejectListingDraft: (id: string, reviewNote?: string) =>
    request<{ data: ListingDraft }>(`/listing/drafts/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reviewNote }),
    }),
  patchListingPromoBrief: (id: string, body: Partial<ListingPromoBrief>) =>
    request<{ data: ListingDraft }>(`/listing/drafts/${id}/promo/brief`, {
      method: "PATCH",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }),
  startListingPromoJob: (id: string) =>
    request<{ data: ListingDraft; meta?: { jobId?: string } }>(
      `/listing/drafts/${id}/promo/jobs`,
      { method: "POST", signal: AbortSignal.timeout(60_000) },
    ),
  getListingPromoJob: (id: string, jobId: string) =>
    request<{ data: ListingPromoJob }>(
      `/listing/drafts/${id}/promo/jobs/${jobId}`,
      { signal: AbortSignal.timeout(30_000) },
    ),
  ingestListingPromoJob: (id: string, jobId: string) =>
    request<{ data: ListingDraft }>(
      `/listing/drafts/${id}/promo/jobs/${jobId}/ingest`,
      { method: "POST", signal: AbortSignal.timeout(60_000) },
    ),
  reviseListingPromoJob: (
    id: string,
    jobId: string,
    body: { note: string; frameIndexes?: string[] },
  ) =>
    request<{ data: ListingDraft }>(
      `/listing/drafts/${id}/promo/jobs/${jobId}/revise`,
      {
        method: "POST",
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      },
    ),
  approveListingPromoJob: (id: string, jobId: string) =>
    request<{ data: ListingDraft }>(
      `/listing/drafts/${id}/promo/jobs/${jobId}/approve`,
      { method: "POST", signal: AbortSignal.timeout(30_000) },
    ),
  listingPromoImageUrl: (id: string, jobId: string, filename: string) =>
    `${BASE}/listing/drafts/${id}/promo/jobs/${jobId}/images/${encodeURIComponent(filename)}`,
  listingPromoPromptUrl: (id: string, jobId: string) =>
    `${BASE}/listing/drafts/${id}/promo/jobs/${jobId}/prompt`,
  getSalesSummary: () => request<{ data: SalesSummary }>("/sales/summary"),
  getSalesOrders: (opts?: { page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    q.set("page", String(opts?.page ?? 1));
    q.set("pageSize", String(opts?.pageSize ?? 100));
    return request<{
      data: NoonOrder[];
      meta?: { total?: number; page?: number; pageSize?: number; pageCount?: number };
    }>(`/sales/orders?${q.toString()}`);
  },
  getSalesFacts: (opts?: { page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    q.set("page", String(opts?.page ?? 1));
    q.set("pageSize", String(opts?.pageSize ?? 100));
    return request<{
      data: SalesFactRow[];
      meta: {
        total: number;
        page?: number;
        pageSize?: number;
        pageCount?: number;
      };
    }>(`/sales/facts?${q.toString()}`);
  },
  getBestSell: () => request<{ data: BestSellRow[] }>("/analytics/best-sell"),
  getInfoCheckMeta: () => request<{ data: InfoCheckMeta }>("/info-check/meta"),
  getInfoCheckQuery: (opts: {
    q?: string;
    mode?: "exact" | "fuzzy";
    fields?: string[];
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (opts.q?.trim()) q.set("q", opts.q.trim());
    q.set("mode", opts.mode ?? "fuzzy");
    if (opts.fields?.length) q.set("fields", opts.fields.join(","));
    if (opts.limit != null) q.set("limit", String(opts.limit));
    return request<{
      data: InfoCheckQueryRow[];
      meta: {
        totalMatched: number;
        truncated: boolean;
        mode: string;
        fields: string[];
        commonFields: string[];
      };
    }>(`/info-check/query?${q.toString()}`);
  },
  refreshInfoCheck: () =>
    request<{
      data: {
        runId: string;
        results: Array<{
          docId: string;
          ok: boolean;
          error?: { message?: string; code?: string };
        }>;
        tables: InfoCheckMeta;
      };
    }>("/info-check/refresh", { method: "POST" }),
  getMarketIntelStatus: () =>
    request<{ data: MarketIntelStatus }>("/market-intel/status"),
  getMarketIntelCategoryFitness: (categoryId?: string) =>
    request<{ data: CategoryFitnessResponse | CategoryFitnessReport }>(
      categoryId
        ? `/market-intel/category-fitness?categoryId=${encodeURIComponent(categoryId)}`
        : "/market-intel/category-fitness",
    ),
  /** 短名单 CSV：FBN 单件毛利估算参数（对齐成本利润表） */
  marketIntelShortlistCsvUrl: (opts: {
    categoryId: string;
    profile?: "general_15" | "fashion_25";
    purchaseCostSar?: number | null;
    firstMileSar?: number;
    outboundFeeSar?: number;
    storageSar?: number;
    cpcSar?: number;
    assumedClicks?: number;
    /** @deprecated 兼容旧粗毛利；等同 purchaseCostSar */
    costSar?: number;
    /** @deprecated 兼容旧粗毛利；等同 outboundFeeSar */
    shipSar?: number;
  }) => {
    const q = new URLSearchParams({ categoryId: opts.categoryId });
    if (opts.profile) q.set("profile", opts.profile);
    const purchase = opts.purchaseCostSar ?? opts.costSar;
    if (purchase != null && Number.isFinite(purchase)) {
      q.set("purchaseCostSar", String(purchase));
    }
    if (opts.firstMileSar != null && Number.isFinite(opts.firstMileSar)) {
      q.set("firstMileSar", String(opts.firstMileSar));
    }
    const outbound = opts.outboundFeeSar ?? opts.shipSar;
    if (outbound != null && Number.isFinite(outbound)) {
      q.set("outboundFeeSar", String(outbound));
    }
    if (opts.storageSar != null && Number.isFinite(opts.storageSar)) {
      q.set("storageSar", String(opts.storageSar));
    }
    if (opts.cpcSar != null && Number.isFinite(opts.cpcSar)) {
      q.set("cpcSar", String(opts.cpcSar));
    }
    if (opts.assumedClicks != null && Number.isFinite(opts.assumedClicks)) {
      q.set("assumedClicks", String(opts.assumedClicks));
    }
    return `/api/market-intel/export/shortlist.csv?${q.toString()}`;
  },
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
  discardMarketIntelBrand: (token: string, categoryId?: string) =>
    request<{ data: unknown; message?: string }>("/market-intel/brands/discard", {
      method: "POST",
      body: JSON.stringify({ token, categoryId }),
    }),
  pruneMarketIntelBrandNoise: (categoryId?: string) =>
    request<{ data: { removed: number; summary: unknown }; message?: string }>(
      "/market-intel/brands/prune-noise",
      {
        method: "POST",
        body: JSON.stringify({ categoryId }),
      },
    ),
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

  getMarketIntelMonitor: (activeOnly?: boolean) =>
    request<{
      data: {
        items: MiMonitorTarget[];
        pendingChanges: MiPendingPriceChange[];
        summary: NonNullable<MarketIntelStatus["monitor"]>;
        alerts: MiPriceAlert[];
      };
    }>(
      activeOnly
        ? "/market-intel/monitor?activeOnly=1"
        : "/market-intel/monitor",
    ),
  addMarketIntelMonitorTarget: (body: {
    productKey: string;
    url: string;
    title?: string;
    note?: string;
    addedFrom?: "watchlist" | "manual" | "extension";
    status?: "active" | "paused";
  }) =>
    request<{ data: MiMonitorTarget; message?: string }>(
      "/market-intel/monitor/targets",
      { method: "POST", body: JSON.stringify(body) },
    ),
  removeMarketIntelMonitorTarget: (productKey: string) =>
    request<{ data: { removed: boolean }; message?: string }>(
      `/market-intel/monitor/targets/${encodeURIComponent(productKey)}`,
      { method: "DELETE" },
    ),
  ingestMarketIntelMonitorPrice: (body: {
    productKey: string;
    url: string;
    title?: string;
    price: number | null;
    currency?: string;
    promoText?: string | null;
    inStock?: boolean | null;
    source?: "extension" | "yingdao" | "manual";
    parseMethod?: "dom" | "json_ld" | "regex" | "llm" | "manual";
    ensureTarget?: boolean;
  }) =>
    request<{
      data: {
        observation: MiPriceObservation;
        alert: MiPriceAlert | null;
        pending: MiPendingPriceChange | null;
        skippedAlertReason: string | null;
      };
      message?: string;
    }>("/market-intel/monitor/price", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ackMarketIntelPriceAlert: (alertId: string) =>
    request<{ data: MiPriceAlert; message?: string }>(
      `/market-intel/monitor/alerts/${encodeURIComponent(alertId)}/ack`,
      { method: "POST", body: "{}" },
    ),
  getMarketIntelSources: () =>
    request<{
      data: {
        summary: NonNullable<MarketIntelStatus["sources"]>;
        sources: MiIntelSource[];
        snippets: MiSourceSnippet[];
      };
    }>("/market-intel/sources"),
  pasteMarketIntelSource: (body: {
    sourceId: string;
    text: string;
    title?: string;
    url?: string;
    topics?: string[];
  }) =>
    request<{ data: MiSourceSnippet; message?: string }>(
      "/market-intel/sources/paste",
      { method: "POST", body: JSON.stringify(body) },
    ),
  setMarketIntelSourceStatus: (
    sourceId: string,
    status: MiIntelSource["status"],
  ) =>
    request<{ data: MiIntelSource; message?: string }>(
      `/market-intel/sources/${encodeURIComponent(sourceId)}/status`,
      { method: "POST", body: JSON.stringify({ status }) },
    ),

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
  getFinanceSettlement: (params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return request<{
      data: FinanceSettlement;
      meta: { source: string; monthCount: number; targetMonth?: string };
    }>(`/finance/settlement${qs ? `?${qs}` : ""}`);
  },
  getFinanceCloseGate: (month?: string) => {
    const q = month ? `?month=${encodeURIComponent(month)}` : "";
    return request<{ data: FinanceCloseGate }>(`/finance/close-gate${q}`);
  },
  closeFinanceMonth: (body?: { month?: string; replace?: boolean }) =>
    request<{ data: FinanceMonthClose; message?: string }>("/finance/close", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  getDashboardOverview: () =>
    request<{ data: DashboardOverview }>("/dashboard/overview"),
  interpretOps: (surface: OpsSurface) =>
    request<{ data: OpsInterpretResult }>("/ops-assist/interpret", {
      method: "POST",
      body: JSON.stringify({ surface }),
    }),
  quoteBom: (body: {
    sellPriceSar: number;
    profile: "general_15" | "fashion_25";
    lines: Array<{
      name: string;
      category: BomLineCategory;
      unitCostSar: number;
      qty: number;
    }>;
  }) =>
    request<{ data: BomQuote }>("/ops-assist/bom", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  explainBom: (body: {
    sellPriceSar: number;
    profile: "general_15" | "fashion_25";
    lines: Array<{
      name: string;
      category: BomLineCategory;
      unitCostSar: number;
      qty: number;
    }>;
  }) =>
    request<{ data: BomQuote }>("/ops-assist/bom/explain", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  verifyListingArabic: (
    id: string,
    body: { sourceText: string; content: ListingOursNoonContent },
  ) =>
    request<{ data: ArVerifyResult }>(`/listing/drafts/${id}/verify-ar`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listListingOptimizeJobs: () =>
    request<{ data: ListingOptimizeSummary[] }>("/listing/optimize/jobs"),
  getListingOptimizeJob: (id: string) =>
    request<{ data: ListingOptimizeJob }>(`/listing/optimize/jobs/${id}`),
  createListingOptimizeJob: (body?: Partial<ListingOptimizeJob>) =>
    request<{ data: ListingOptimizeJob }>("/listing/optimize/jobs", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  patchListingOptimizeJob: (id: string, body: Record<string, unknown>) =>
    request<{ data: ListingOptimizeJob }>(`/listing/optimize/jobs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteListingOptimizeJob: (id: string) =>
    request<{ data: { id: string; deleted: boolean } }>(
      `/listing/optimize/jobs/${id}`,
      { method: "DELETE" },
    ),
  bindListingOptimizeMetrics: (
    id: string,
    body?: { metricsCsv?: string } & Record<string, unknown>,
  ) =>
    request<{ data: ListingOptimizeJob }>(
      `/listing/optimize/jobs/${id}/bind-metrics`,
      { method: "POST", body: JSON.stringify(body ?? {}) },
    ),
  analyzeListingOptimize: (id: string) =>
    request<{ data: ListingOptimizeJob }>(
      `/listing/optimize/jobs/${id}/analyze`,
      {
        method: "POST",
        body: "{}",
        signal: AbortSignal.timeout(3 * 60 * 1000),
      },
    ),
  rewriteListingOptimize: (id: string) =>
    request<{
      data: ListingOptimizeJob;
      meta?: { guardrails: { ok: boolean; warnings: string[]; blockers: string[] } };
    }>(`/listing/optimize/jobs/${id}/rewrite`, {
      method: "POST",
      body: "{}",
      signal: AbortSignal.timeout(3 * 60 * 1000),
    }),
  assistDocs: (body: { kind: DocsKind; text: string }) =>
    request<{ data: DocsAssistResult }>("/ops-assist/docs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getFinanceInvoices: () =>
    request<{ data: InvoiceDocRow[]; meta: { total: number } }>(
      "/finance/invoices",
    ),
  syncFinanceInvoices: () =>
    request<{ data: { imported: number; total: number }; message?: string }>(
      "/finance/sync-invoices",
      { method: "POST", body: "{}", signal: AbortSignal.timeout(5 * 60 * 1000) },
    ),
  getAdsSummary: () => request<{ data: AdsSummary }>("/ads/summary"),
  getAdsFreshness: () =>
    request<{
      data: {
        yesterday: string;
        hasYesterday: boolean;
        yesterdayFactCount: number;
        factCount: number;
        yesterdaySkuCount: number;
        latestFromDate: string | null;
        latestToDate: string | null;
      };
      meta?: { hint?: string };
    }>("/ads/freshness"),
  /** Listing 按需：有昨日复用；缺昨日或 force 才启动 Playwright 导出 */
  ensureAdsExport: (body?: {
    shopIds?: string[];
    shopId?: string;
    force?: boolean;
    range?: "yesterday" | "days";
    days?: number;
  }) =>
    request<{
      data: {
        action: "reuse" | "requested";
        freshness: {
          yesterday: string;
          hasYesterday: boolean;
          yesterdayFactCount: number;
          factCount: number;
          yesterdaySkuCount: number;
          latestFromDate: string | null;
          latestToDate: string | null;
        };
        request: {
          type: string;
          requestId: string | null;
          shopIds: string[];
          range: string;
          days: number;
          requestedAt: string | null;
        } | null;
      };
      meta?: { hint?: string };
    }>("/ads/ensure-export", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  requestAdsExport: (body?: {
    shopIds?: string[];
    shopId?: string;
    range?: "yesterday" | "days";
    days?: number;
  }) =>
    request<{
      data: {
        type: string;
        requestId: string | null;
        shopIds: string[];
        range: string;
        days: number;
        requestedAt: string | null;
      };
      meta?: { hint: string };
    }>("/ads/request-export", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  getAdsExportRequest: (requestId: string) =>
    request<{
      data: {
        requestId: string;
        status: "pending" | "done" | "failed" | "unknown";
        path: string | null;
        detail: string | null;
        finishedAt: string | null;
      };
    }>(`/ads/request-export/${encodeURIComponent(requestId)}`),
  /** 一键启动 Playwright 广告导出（需 admin；异步；路径兼容旧 /yingdao-export） */
  runAdsPwExport: () =>
    request<{
      data: {
        status: "idle" | "starting" | "running" | "ok" | "failed";
        startedAt: string | null;
        finishedAt: string | null;
        pid: number | null;
        exitCode: number | null;
        message: string | null;
        runId: string | null;
        taskId: string | null;
      };
      meta?: { hint?: string };
    }>("/ads/yingdao-export/run", { method: "POST", body: "{}" }),
  runPwJob: (
    job: "ads" | "sales" | "keepalive",
    body?: {
      shopIds?: string[];
      shopId?: string;
      cmd?: "ui" | "login" | "probe";
      range?:
        | "today"
        | "yesterday"
        | "last7"
        | "last30"
        | "last90"
        | "ytd"
        | "all"
        | "custom"
        | "days";
      days?: number;
      fromDate?: string;
      toDate?: string;
      targets?: Array<"ads" | "seller">;
    },
  ) =>
    request<{
      data: PwJobStatus;
      meta?: { hint?: string };
    }>(`/pw-rpa/${job}/run`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  getPwJobStatus: (job: "ads" | "sales" | "keepalive") =>
    request<{ data: PwJobStatus }>(`/pw-rpa/${job}/status`),
  listPwJobs: () =>
    request<{
      data: PwJobStatus[];
      meta?: { hint?: string; adsRanges?: string[] };
    }>("/pw-rpa/jobs"),
  listPwRunLogs: (q?: {
    job?: "ads" | "sales";
    from?: string;
    to?: string;
    limit?: number;
  }) => {
    const p = new URLSearchParams();
    if (q?.job) p.set("job", q.job);
    if (q?.from) p.set("from", q.from);
    if (q?.to) p.set("to", q.to);
    if (q?.limit) p.set("limit", String(q.limit));
    const qs = p.toString();
    return request<{
      data: {
        items: PwRunLogSummary[];
        total: number;
      };
    }>(`/pw-rpa/logs${qs ? `?${qs}` : ""}`);
  },
  getPwRunLog: (runId: string) =>
    request<{ data: PwRunLogDetail }>(
      `/pw-rpa/logs/${encodeURIComponent(runId)}`,
    ),
  listPwSchedules: () =>
    request<{ data: PwExportSchedule[] }>("/pw-rpa/schedules"),
  savePwSchedule: (
    job: "ads" | "sales",
    body: {
      enabled: boolean;
      everyHours: number;
      range: string;
      shopIds?: string[];
      fromDate?: string;
      toDate?: string;
    },
  ) =>
    request<{ data: PwExportSchedule }>(`/pw-rpa/schedules/${job}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  /** @deprecated 使用 runAdsPwExport */
  runYingdaoAdsExport: () =>
    request<{
      data: {
        status: "idle" | "starting" | "running" | "ok" | "failed";
        startedAt: string | null;
        finishedAt: string | null;
        pid: number | null;
        exitCode: number | null;
        message: string | null;
        runId: string | null;
        taskId: string | null;
      };
      meta?: { hint?: string };
    }>("/ads/yingdao-export/run", { method: "POST", body: "{}" }),
  getAdsPwExportStatus: () =>
    request<{
      data: {
        status: "idle" | "starting" | "running" | "ok" | "failed";
        startedAt: string | null;
        finishedAt: string | null;
        pid: number | null;
        exitCode: number | null;
        message: string | null;
        runId: string | null;
        taskId: string | null;
      };
    }>("/ads/yingdao-export/status"),
  /** @deprecated 使用 getAdsPwExportStatus */
  getYingdaoAdsExportStatus: () =>
    request<{
      data: {
        status: "idle" | "starting" | "running" | "ok" | "failed";
        startedAt: string | null;
        finishedAt: string | null;
        pid: number | null;
        exitCode: number | null;
        message: string | null;
        runId: string | null;
        taskId: string | null;
      };
    }>("/ads/yingdao-export/status"),
  getAdsBySku: () =>
    request<{ data: AdsBySkuRow[]; meta: { total: number } }>("/ads/by-sku"),
  getAdsFacts: () =>
    request<{ data: AdsFactRow[]; meta: { total: number } }>("/ads/facts"),
  getPurchaseSummary: () =>
    request<{ data: PurchaseSummary }>("/purchase/summary"),
  getPurchaseCosts: (opts?: { page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    q.set("page", String(opts?.page ?? 1));
    q.set("pageSize", String(opts?.pageSize ?? 50));
    return request<{
      data: PurchaseCostRow[];
      meta?: { total?: number; page?: number; pageSize?: number; pageCount?: number };
    }>(`/purchase/costs?${q.toString()}`);
  },
  getPurchaseLines: (opts?: { page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    q.set("page", String(opts?.page ?? 1));
    q.set("pageSize", String(opts?.pageSize ?? 100));
    return request<{
      data: PurchaseLineRow[];
      meta: {
        total: number;
        page?: number;
        pageSize?: number;
        pageCount?: number;
      };
    }>(`/purchase/lines?${q.toString()}`);
  },
  getPurchaseCash: (opts?: { page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    q.set("page", String(opts?.page ?? 1));
    q.set("pageSize", String(opts?.pageSize ?? 100));
    return request<{
      data: CashLedgerRow[];
      meta: {
        total: number;
        page?: number;
        pageSize?: number;
        pageCount?: number;
      };
    }>(`/purchase/cash?${q.toString()}`);
  },
  getPurchaseArrivingToday: () =>
    request<{
      data: PurchaseArrivingTodayRow[];
      meta: { today: string; total: number };
    }>("/purchase/arriving-today"),
  confirmPurchaseArrival: (body: {
    receiptKey?: string;
    id?: string;
    partnerSku?: string;
    orderId?: string;
    addQty?: number;
    markComplete?: boolean;
  }) =>
    request<{
      data: {
        receipt: {
          key: string;
          partnerSku: string;
          orderId: string;
          lineId: string;
          qtyOrdered: number;
          receivedQty: number;
          updatedAt: string;
          updatedBy: string;
        };
        cleared: boolean;
        arrivingToday: PurchaseArrivingTodayRow[];
        arrivingTodayCount: number;
      };
      message?: string;
    }>("/purchase/arrival-confirm", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getPurchase1688Session: () =>
    request<{
      data: {
        hasSession: boolean;
        storageStatePath: string;
        cookieHits: string[];
        savedAt: string | null;
        fileBytes: number;
      };
    }>("/purchase/1688-session"),
  capturePurchase1688Login: (body?: { loginWaitMs?: number }) =>
    request<{
      data: {
        ok: boolean;
        message: string;
        storageStatePath: string;
        durationMs: number;
        cookieHits?: string[];
        orderListVerified?: boolean;
      };
      message?: string;
    }>("/purchase/1688-login", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    }),
  syncPurchaseAccounts: () =>
    request<{ data: unknown; message?: string }>("/purchase/sync-accounts", {
      method: "POST",
      body: "{}",
      signal: AbortSignal.timeout(10 * 60 * 1000),
    }),
  getPurchaseLedgerSheets: () =>
    request<{
      data: {
        spreadsheetToken?: string;
        url?: string | null;
        sheets: PurchaseLedgerSheetMeta[];
      };
    }>("/purchase/ledger/sheets"),
  getPurchaseLedgerRows: (opts: {
    sheet: PurchaseLedgerSheetKey;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    q.set("sheet", opts.sheet);
    if (opts.limit != null) q.set("limit", String(opts.limit));
    return request<{
      data: {
        sheetKey: PurchaseLedgerSheetKey;
        title: string;
        sheetId: string;
        headers: string[];
        rows: PurchaseLedgerRow[];
        totalDataRows: number;
      };
    }>(`/purchase/ledger/rows?${q.toString()}`);
  },
  appendPurchaseLedgerRow: (body: {
    sheet: PurchaseLedgerSheetKey;
    fields: Record<string, string | number | null>;
    syncLocal?: boolean;
  }) =>
    request<{ data: unknown; message?: string }>("/purchase/ledger/rows", {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    }),
  updatePurchaseLedgerRow: (body: {
    sheet: PurchaseLedgerSheetKey;
    sheetRow: number;
    fields: Record<string, string | number | null>;
    syncLocal?: boolean;
  }) =>
    request<{ data: unknown; message?: string }>("/purchase/ledger/rows", {
      method: "PUT",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    }),
  syncPurchase1688Logistics: (body?: {
    orderIds?: string[];
    headed?: boolean;
    limit?: number;
    onlyOpen?: boolean;
    chunkSize?: number;
    recentDays?: number;
    includeUndated?: boolean;
  }) =>
    request<{
      data: {
        orderIdCount: number;
        chunkSize?: number;
        arrivingTodayCount: number;
        arrivingToday: PurchaseArrivingTodayRow[];
        applied: { matchedLines: number; updatedOrderIds: string[] };
        batch: { ok: boolean; message: string; durationMs: number };
        progress?: {
          status: string;
          batchIndex: number;
          batchTotal: number;
          orderDone: number;
          orderTotal: number;
          matchedLines: number;
          message: string;
        };
        collected?: {
          orderIds: string[];
          totalWithOrderId: number;
          selected: number;
        };
      };
      message?: string;
    }>("/purchase/sync-1688-logistics", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(40 * 60 * 1000),
    }),
  getPurchase1688LogisticsProgress: () =>
    request<{
      data: {
        status: string;
        running: boolean;
        batchIndex: number;
        batchTotal: number;
        orderDone: number;
        orderTotal: number;
        matchedLines: number;
        okOrders: number;
        message: string;
        error?: string;
        updatedAt: string;
      };
    }>("/purchase/1688-logistics-progress"),
  getReplenishPlan: (opts?: {
    page?: number;
    pageSize?: number;
    q?: string;
    status?: string;
  }) => {
    const q = new URLSearchParams();
    q.set("page", String(opts?.page ?? 1));
    q.set("pageSize", String(opts?.pageSize ?? 50));
    if (opts?.q) q.set("q", opts.q);
    if (opts?.status && opts.status !== "all") q.set("status", opts.status);
    return request<{
      data: ReplenishPlanResponse;
      meta?: {
        asOf?: string;
        total?: number;
        page?: number;
        pageSize?: number;
        pageCount?: number;
        status?: string;
      };
    }>(`/replenish/plan?${q.toString()}`);
  },
  getReplenishWorkbook: (opts?: {
    prefix?: string;
    page?: number;
    pageSize?: number;
    q?: string;
    onlyNeed?: boolean;
    topPct?: number;
    coverMonths?: number;
  }) => {
    const q = new URLSearchParams();
    if (opts?.prefix?.trim()) q.set("prefix", opts.prefix.trim().toUpperCase());
    q.set("page", String(opts?.page ?? 1));
    q.set("pageSize", String(opts?.pageSize ?? 50));
    if (opts?.q) q.set("q", opts.q);
    if (opts?.onlyNeed) q.set("onlyNeed", "1");
    if (opts?.topPct != null && opts.topPct > 0) {
      q.set("topPct", String(opts.topPct));
    }
    if (opts?.coverMonths != null && opts.coverMonths > 0) {
      q.set("coverMonths", String(opts.coverMonths));
    }
    return request<{
      data: ReplenishWorkbookResponse;
      meta?: {
        total?: number;
        page?: number;
        pageSize?: number;
        pageCount?: number;
        prefix?: string;
        coverMonths?: number;
      };
    }>(`/replenish/workbook?${q.toString()}`);
  },
  rebuildReplenishWorkbook: (opts?: {
    prefixes?: string[];
    coverMonths?: number;
  }) =>
    request<{
      data: {
        generatedAt: string;
        dir: string;
        shops: Array<{
          shopPrefix: string;
          shopName: string;
          filePath: string;
          rowCount: number;
          needCount: number;
        }>;
      };
      message?: string;
    }>("/replenish/workbook/rebuild", {
      method: "POST",
      body: JSON.stringify({
        prefixes: opts?.prefixes,
        coverMonths: opts?.coverMonths,
      }),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    }),
  patchReplenishWorkbookManual: (body: {
    prefix: string;
    partnerSku: string;
    manualTag?: string;
    note?: string;
    coverMonths?: number;
  }) =>
    request<{
      data: {
        meta: ReplenishWorkbookMeta;
        row: ReplenishWorkbookRow | null;
      };
      message?: string;
    }>("/replenish/workbook/manual", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  syncReplenishFeishuDaily: () =>
    request<{ data: unknown; message?: string }>(
      "/replenish/sync-feishu-daily",
      {
        method: "POST",
        body: "{}",
        signal: AbortSignal.timeout(10 * 60 * 1000),
      },
    ),
  getShippingOpsOverview: () =>
    request<{ data: ShippingOpsOverview }>("/shipping-ops/overview"),
  getCargoLedgerMeta: () =>
    request<{ data: CargoLedgerMeta }>("/cargo-ledger/meta"),
  rebuildCargoLedger: () =>
    request<{ data: CargoLedgerMeta; message?: string }>(
      "/cargo-ledger/rebuild",
      { method: "POST", body: "{}" },
    ),
  getCargoLedgerTickets: (opts?: {
    shop?: string;
    q?: string;
    transit?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const q = new URLSearchParams();
    if (opts?.shop) q.set("shop", opts.shop);
    if (opts?.q) q.set("q", opts.q);
    if (opts?.transit) q.set("transit", opts.transit);
    q.set("page", String(opts?.page ?? 1));
    q.set("pageSize", String(opts?.pageSize ?? 50));
    return request<{
      data: CargoLedgerTicketSummary[];
      meta: { total: number; page: number; pageSize: number; pageCount: number };
    }>(`/cargo-ledger/tickets?${q.toString()}`);
  },
  getCargoLedgerTicket: (key: string) =>
    request<{ data: CargoLedgerTicketDetail }>(
      `/cargo-ledger/ticket?key=${encodeURIComponent(key)}`,
    ),
  syncShippingFeishuDaily: () =>
    request<{ data: unknown; message?: string }>(
      "/shipping-ops/sync-feishu-daily",
      {
        method: "POST",
        body: "{}",
        signal: AbortSignal.timeout(10 * 60 * 1000),
      },
    ),
  syncShippingPacking: () =>
    request<{ data: unknown; message?: string }>(
      "/shipping-ops/sync-packing",
      {
        method: "POST",
        body: "{}",
        signal: AbortSignal.timeout(10 * 60 * 1000),
      },
    ),
  syncShippingFreightRates: () =>
    request<{ data: unknown; message?: string }>(
      "/shipping-ops/sync-freight-rates",
      {
        method: "POST",
        body: "{}",
        signal: AbortSignal.timeout(10 * 60 * 1000),
      },
    ),
  getShippingHeadhaulBox: (boxNo: string) =>
    request<{ data: BoxHeadhaulResult }>(
      `/shipping-ops/headhaul?boxNo=${encodeURIComponent(boxNo)}`,
    ),
  getShippingHeadhaulSku: (partnerSku: string) =>
    request<{ data: SkuHeadhaulSummary }>(
      `/shipping-ops/headhaul/sku?partnerSku=${encodeURIComponent(partnerSku)}`,
    ),
  analyzeForwarderBoard: () =>
    request<{ data: ForwarderBoardAnalyze }>(
      "/shipping-ops/forwarder-board/analyze",
      {
        method: "POST",
        body: "{}",
        signal: AbortSignal.timeout(2 * 60 * 1000),
      },
    ),
  getChannelHistory: () =>
    request<{ data: ChannelHistoryPayload }>("/shipping-ops/channel-history"),
  searchChannelHistorySku: (q: string) =>
    request<{ data: SkuChannelHistorySearch }>(
      `/shipping-ops/channel-history/sku?q=${encodeURIComponent(q)}`,
    ),
  getCargoHints: () =>
    request<{
      data: { options: CargoKindOption[]; hints: ForwarderCargoHint[] };
    }>("/shipping-ops/cargo-hints"),
  upsertCargoHint: (body: {
    partnerSku: string;
    forwarder: string;
    cargoKind: string;
  }) =>
    request<{
      data: { hint: ForwarderCargoHint | null; options: CargoKindOption[] };
      message?: string;
    }>("/shipping-ops/cargo-hints", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  cropShippingLabels: (body: { filename: string; base64: string }) =>
    request<{ data: LabelCropResult; message?: string }>(
      "/shipping-ops/labels/crop",
      {
        method: "POST",
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      },
    ),
  trackYibang: (logisticsNo: string) =>
    request<{ data: YibangTrackResult; message?: string }>(
      "/shipping-ops/track/yibang",
      {
        method: "POST",
        body: JSON.stringify({ logisticsNo }),
        signal: AbortSignal.timeout(2 * 60 * 1000),
      },
    ),
  trackFeitan: (ticketNo: string, mode?: "sea" | "air" | "auto") =>
    request<{ data: FeitanTrackResult; message?: string }>(
      "/shipping-ops/track/feitan",
      {
        method: "POST",
        body: JSON.stringify({ ticketNo, mode: mode ?? "auto" }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      },
    ),
  trackHansha: (ticketNo: string) =>
    request<{ data: HanshaTrackResult; message?: string }>(
      "/shipping-ops/track/hansha",
      {
        method: "POST",
        body: JSON.stringify({ ticketNo }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      },
    ),
  trackYayouhui: (ticketNo: string) =>
    request<{ data: YayouhuiTrackResult; message?: string }>(
      "/shipping-ops/track/yayouhui",
      {
        method: "POST",
        body: JSON.stringify({ ticketNo }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      },
    ),
  trackYite: (logisticsNo: string) =>
    request<{ data: YiteTrackResult; message?: string }>(
      "/shipping-ops/track/yite",
      {
        method: "POST",
        body: JSON.stringify({ logisticsNo }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      },
    ),
  trackAnshida: (ticketNo: string) =>
    request<{ data: AnshidaTrackResult; message?: string }>(
      "/shipping-ops/track/anshida",
      {
        method: "POST",
        body: JSON.stringify({ ticketNo }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      },
    ),
  trackQike: (logisticsNo: string) =>
    request<{ data: QikeTrackResult; message?: string }>(
      "/shipping-ops/track/qike",
      {
        method: "POST",
        body: JSON.stringify({ logisticsNo }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      },
    ),
  getCampaignsOverview: () =>
    request<{ data: CampaignsOverview }>("/campaigns/overview"),
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

  /** 中枢 Agent：DeepSeek 选工具 → HubAnswer（历史由服务端按用户×店铺加载） */
  agentHubAsk: (body: {
    question: string;
    allowMutate?: boolean;
    allowNavigate?: boolean;
  }) =>
    request<{ ok: boolean; data: AgentHubAskResult }>("/agent-hub/ask", {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    }),

  /** 当前登录用户 × 当前店铺的小慧会话 */
  agentHubConversation: () =>
    request<{ ok: boolean; data: AgentHubConversation }>(
      "/agent-hub/conversation",
    ),

  agentHubClearConversation: () =>
    request<{ ok: boolean; data: { cleared: boolean } }>(
      "/agent-hub/conversation",
      { method: "DELETE" },
    ),

  /** ops-daily：运营面板旁路（Prep→Outpost Phase1–4） */
  getOpsDailyStatus: (shopId?: string) => {
    const q = shopId?.trim()
      ? `?shopId=${encodeURIComponent(shopId.trim())}`
      : "";
    return request<{
      ok: boolean;
      shopId: string;
      todayShanghai: string;
      settings: {
        phase: number;
        timezone: string;
        ads_coverage?: string;
        feishu_product_writeback: boolean;
        output_file_prefix: string;
      };
      dir: string;
      artifacts: Array<{
        name: string;
        kind: "panel" | "weekly" | "landed" | "other";
        sizeBytes: number;
        mtimeIso: string;
      }>;
    }>(`/ops-daily/status${q}`);
  },

  getOpsDailyColumns: () =>
    request<{
      header: string[];
      columns: Array<{ name: string; phase: string | number; source: string }>;
      phase4: {
        weeklyHeader: readonly string[];
        landedHeader: readonly string[];
        files: string[];
        feishuProductWriteback: boolean;
      };
      settings: Record<string, unknown>;
    }>("/ops-daily/columns"),

  getOpsDailyPanel: (opts?: {
    shopId?: string;
    asOf?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (opts?.shopId?.trim()) q.set("shopId", opts.shopId.trim());
    if (opts?.asOf?.trim()) q.set("asOf", opts.asOf.trim());
    if (opts?.limit != null && Number.isFinite(opts.limit)) {
      q.set("limit", String(opts.limit));
    }
    const qs = q.toString();
    return request<{
      ok: boolean;
      shopId: string;
      phase: number;
      asOf: string;
      meta: OpsDailyRunMeta;
      header: string[];
      rowCount: number;
      previewLimit: number | null;
      rows: Array<Record<string, string | number>>;
    }>(`/ops-daily/panel${qs ? `?${qs}` : ""}`);
  },

  runOpsDaily: (body?: { shopId?: string; asOf?: string; all?: boolean }) =>
    request<OpsDailyRunResult>("/ops-daily/run", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    }),

  opsDailyDownloadUrl: (opts: {
    kind: "panel" | "weekly" | "landed";
    shopId?: string;
    asOf?: string;
  }) => {
    const q = new URLSearchParams();
    q.set("kind", opts.kind);
    if (opts.shopId?.trim()) q.set("shopId", opts.shopId.trim());
    if (opts.asOf?.trim()) q.set("asOf", opts.asOf.trim());
    return `/api/ops-daily/download?${q.toString()}`;
  },
};

export type OpsDailyRunMeta = {
  catalogCount?: number;
  stockSkuCount?: number;
  salesExportFile?: string | null;
  salesExportLines?: number;
  stockFile?: string | null;
  trafficFiles?: string[];
  trafficLines?: number;
  adsDaysPresent?: string[];
  adsDaysMissing?: string[];
  adsCoverage?: "partial" | "full";
  agingFiles?: string[];
  agingMoves?: number;
  transitSkuCount?: number;
  weeklyFeeRows?: number;
  landedCostRows?: number;
  packingPath?: string | null;
  feishuProductWriteback?: boolean;
};

export type OpsDailyRunResult = {
  ok: boolean;
  shopId: string;
  asOf: string;
  phase: number;
  rowCount: number;
  outPath: string;
  weeklyFeePath?: string;
  landedCostPath?: string;
  meta: OpsDailyRunMeta;
  message: string;
  results?: OpsDailyRunResult[];
};
