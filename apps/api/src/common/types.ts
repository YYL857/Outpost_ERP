/** 海运货物类型：插电 / 内置电 / 普货 */
export type CargoType = "plug" | "builtin" | "general";

export type ShippingConfig = {
  /** @deprecated 财务页遗留；Catalog 头程用 airFreightRmbPerKg */
  airFreightAedPerKg: number;
  airLeadDays: number;
  /** @deprecated 财务页遗留；Catalog 海运用 seaFreightRmbPerCbm* */
  seaFreightAedPerCbm: number;
  seaLeadDays: number;
  /** 空运头程 RMB/kg；计费重 = MAX(实重, 体积重) */
  airFreightRmbPerKg: number;
  /** 海运插电 RMB/cbm */
  seaFreightRmbPerCbmPlug: number;
  /** 海运内置电 RMB/cbm */
  seaFreightRmbPerCbmBuiltin: number;
  /** 海运普货 RMB/cbm */
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

export type StoreInfo = {
  id: string;
  name: string;
  account: string;
  site: string;
  platform: "NOON";
  expiresAt: string | null;
  listingUsed: number;
  listingQuota: number;
};

export type NoonConnection = {
  /** mock=模拟；live=官方API(若有)；portal=网页/导出采集（当前主路径） */
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
  /** 卖家后台门户采集配置 */
  portal: PortalConfig;
};

/** 无官方 API 时：从网页会话或导出文件取数 */
export type PortalConfig = {
  portalUrl: string;
  /** 浏览器登录脚本写入的 Cookie（也可手工维护） */
  cookie: string;
  /** 可选：后台里抓到的订单/商品/库存接口或页面 URL */
  ordersUrl: string;
  catalogUrl: string;
  stockUrl: string;
  /** 最近一次门户采集时间 */
  lastFetchAt: string | null;
  lastImportAt: string | null;
  lastImportSummary: string | null;
};

/** 门户采集缓冲：导入或抓取后暂存，供 PortalNoonClient 读取 */
export type PortalCache = {
  orders: Array<{
    order_nr: string;
    status: string;
    currency: string;
    total_amount: number;
    item_count: number;
    placed_at: string;
    updated_at: string;
  }>;
  catalog: Array<{
    partner_sku: string;
    title: string;
    is_active: boolean;
    noon_sku?: string;
    image_url?: string;
    price?: number;
    currency?: string;
    listing_type?: string;
    updated_at: string;
  }>;
  stock: Array<{
    partner_sku: string;
    warehouse_code: string;
    qty: number;
    fulfillment?: "fbn" | "fbp" | "unknown";
    in_transit_qty?: number;
    updated_at: string;
  }>;
  sales: Array<{
    partner_sku: string;
    date: string;
    units: number;
    amount: number;
    updated_at: string;
  }>;
  fees: Array<{
    partner_sku: string;
    commission_rate: number;
    outbound_fee: number;
    tax_amount: number;
    updated_at: string;
  }>;
  /** Noon Ads Campaign Overview SKU 页 */
  ads: Array<{
    partner_sku: string;
    campaign: string;
    from_date: string;
    to_date: string;
    spend: number;
    revenue: number;
    orders: number;
    views: number;
    clicks: number;
    updated_at: string;
  }>;
  updatedAt: string | null;
};

export type SyncCursor = {
  ordersSince: string | null;
  catalogSince: string | null;
  stockSince: string | null;
  salesSince: string | null;
  feesSince: string | null;
  adsSince: string | null;
};

export type SyncJobStatus = "idle" | "running" | "success" | "warning" | "failed";

export type SyncDomain =
  | "orders"
  | "catalog"
  | "stock"
  | "sales"
  | "fees"
  | "ads"
  | "pricing"
  | "store"
  | "reconcile";

export type SyncJob = {
  id: string;
  domain: SyncDomain;
  status: SyncJobStatus;
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

export type InboxSource = "webhook" | "poll" | "reconcile" | "manual";
export type InboxStatus = "pending" | "processed" | "failed" | "duplicate";

export type InboxEvent = {
  id: string;
  eventId: string;
  source: InboxSource;
  domain: SyncDomain;
  entityKey: string;
  payload: unknown;
  status: InboxStatus;
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
  partnerSku?: string;
  placedAt: string;
  updatedAt: string;
  rawVersion: string;
};

/** 本地 Catalog（由 NOON 同步写入）— SOP 在线/不在线商品 */
export type CatalogItem = {
  partnerSku: string;
  title: string;
  isActive: boolean;
  noonSku: string;
  imageUrl: string;
  price: number;
  currency: string;
  /** 自建 / 目录等 */
  listingType: string;
  source: "NOON";
  updatedAt: string;
};

export type FulfillmentType = "fbn" | "fbp" | "unknown";

export type StockItem = {
  partnerSku: string;
  warehouseCode: string;
  fulfillment: FulfillmentType;
  qty: number;
  inTransitQty: number;
  updatedAt: string;
};

/** SOP Sales：按 SKU+日 的销量事实 */
export type SalesFact = {
  partnerSku: string;
  /** YYYY-MM-DD */
  date: string;
  units: number;
  amount: number;
  updatedAt: string;
};

/** SOP Transaction：佣金/出库费等平台侧费用快照 */
export type FeeSnapshot = {
  partnerSku: string;
  /** 0–1，如 0.15 = 15% */
  commissionRate: number;
  outboundFee: number;
  taxAmount: number;
  updatedAt: string;
};

/**
 * My Catalog Estimated Fees（FBN/FBP）估费补缺。
 * 仅供 Catalog assemble 在 feeSnapshots 缺数时使用；财务报表不读此表。
 */
export type FeeEstimate = {
  partnerSku: string;
  /** 0–1；仅总额时可为 0 */
  commissionRate: number;
  outboundFee: number;
  /** 估费合计（FBN 优先）；无法拆分时写入此项 */
  estimatedFeeTotal: number;
  fulfillment: "fbn" | "fbp" | "unknown";
  updatedAt: string;
  source?: string;
};

/**
 * Noon Ads Campaign Overview（SKU sheet）事实。
 * 主键：partnerSku + campaign + fromDate + toDate（幂等 upsert，跨活动汇总时再 Σ）。
 */
export type AdsFact = {
  partnerSku: string;
  /** 活动名；空表示未拆活动 */
  campaign: string;
  /** YYYY-MM-DD 报表区间起 */
  fromDate: string;
  /** YYYY-MM-DD 报表区间止 */
  toDate: string;
  spend: number;
  revenue: number;
  orders: number;
  views: number;
  clicks: number;
  updatedAt: string;
};

/** 本地费用配置（头程/采购等，对应竞品「费用配置」） */
export type SkuLocalCost = {
  partnerSku: string;
  /** 飞书 landed−采购差；Catalog 毛利改用费率表头程，此字段仅追溯 */
  headhaul: number;
  purchaseCost: number;
  preferAir: boolean;
  /** 海运分档；缺省 general */
  cargoType?: CargoType;
  updatedAt: string;
  /** 来源追溯，如 feishu:product_daily+landed */
  source?: string;
  /** 规范化 runId，便于对回 feishu-normalized */
  normalizeRunId?: string;
};

/** 本地尺寸重量（对应竞品「导入尺寸重量」） */
export type SkuDims = {
  partnerSku: string;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  updatedAt: string;
  source?: string;
  normalizeRunId?: string;
};

/** 补货参数 */
export type ReplenishConfig = {
  partnerSku: string;
  safetyDays: number;
  urgentDays: number;
  skip: boolean;
  updatedAt: string;
};

/** 上架任务（本地业务，额度扣减） */
export type ListingTask = {
  id: string;
  partnerSku: string;
  title: string;
  status: "draft" | "queued" | "success" | "failed";
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type FavoriteItem = {
  id: string;
  partnerSku: string;
  note: string;
  createdAt: string;
};

export type AppState = {
  store: StoreInfo;
  noon: NoonConnection;
  cursors: SyncCursor;
  shipping: ShippingConfig;
  review: ReviewConfig;
  syncJobs: SyncJob[];
  syncAlerts: SyncAlert[];
  inbox: InboxEvent[];
  orders: NoonOrder[];
  catalog: CatalogItem[];
  stock: StockItem[];
  salesFacts: SalesFact[];
  feeSnapshots: FeeSnapshot[];
  /** Catalog 估费补缺；不参与财务汇总 */
  feeEstimates: FeeEstimate[];
  adsFacts: AdsFact[];
  skuLocalCosts: SkuLocalCost[];
  skuDims: SkuDims[];
  replenishConfigs: ReplenishConfig[];
  listings: ListingTask[];
  favorites: FavoriteItem[];
  /** 网页/导出采集缓冲 */
  portalCache: PortalCache;
};
