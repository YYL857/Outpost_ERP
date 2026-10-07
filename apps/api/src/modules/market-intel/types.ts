export type MarketCode = "sa";

/** http 直连已废弃（403）。正式：yingdao / extension；开发：mock */
export type CollectChannel = "yingdao" | "extension" | "inbox" | "mock";

export type CategorySeed = {
  id: string;
  /** URL path after /saudi-en/ */
  path: string;
  url: string;
  title: string;
  enabled: boolean;
  priority: number;
  topN?: number;
};

export type MarketIntelConfig = {
  version: 1;
  /** 配置演进：>=2 表示已套用上线默认（监视/自动采集/定时） */
  opsVersion?: number;
  market: MarketCode;
  locale: "saudi-en";
  currency: "SAR";
  baseUrl: string;
  topN: number;
  categories: CategorySeed[];
  /** 正式：yingdao → extension；勿配 mock 为主通道 */
  primaryChannel: CollectChannel;
  fallbackChannel: CollectChannel;
  /**
   * 开发测试：主备失败后是否自动降级到 mock。
   * 正式必须为 false——只接受影刀/插件投递的真实数据。
   */
  allowMock: boolean;
  /** 发现成功后自动采集快照（上线建议 true） */
  autoCollectAfterDiscover: boolean;
  /** 插件 ingest 成功后立即采集（上线建议 true） */
  autoCollectAfterIngest: boolean;
  /** 监视 inbox 投递目录，有新文件自动发现+采集 */
  inboxWatchEnabled: boolean;
  inboxWatchEveryMs: number;
  scheduler: {
    enabled: boolean;
    discoverEveryMs: number;
    collectEveryMs: number;
  };
  /** 品类适销粗算阈值（可改，一键正式模式不覆盖） */
  fitness?: CategoryFitnessThresholds;
  updatedAt: string;
};

/** 品类适销阈值 — 客单甜区 / 热度 / 白牌竞争带 */
export type CategoryFitnessThresholds = {
  /** 客单下限 SAR */
  aspMin: number;
  /** 客单上限 SAR */
  aspMax: number;
  /** 白牌 Sold Recently 中位数达到此值算「有量」 */
  soldRecentlyFloor: number;
  /** 热销位白牌占比甜区下限（过低=难切入） */
  whiteShareSweetMin: number;
  /** 热销位白牌占比甜区上限（过高=内卷） */
  whiteShareSweetMax: number;
  /** 短名单条数 */
  shortlistLimit: number;
};

export const DEFAULT_FITNESS_THRESHOLDS: CategoryFitnessThresholds = {
  aspMin: 80,
  aspMax: 350,
  soldRecentlyFloor: 50,
  whiteShareSweetMin: 0.15,
  whiteShareSweetMax: 0.55,
  shortlistLimit: 20,
};

export type CategoryFitnessVerdict = "go" | "watch" | "skip";

export type CategoryFitnessShortItem = {
  productKey: string;
  title: string;
  /** 简体中文对照（运营阅读；可空） */
  titleZh: string | null;
  url: string;
  price: number | null;
  currency: string;
  soldRecently: number | null;
  soldRecentlyText: string | null;
  rating: number | null;
  reviewCount: number | null;
  brandTier: BrandTier;
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
  thresholds: CategoryFitnessThresholds;
  shortlist: CategoryFitnessShortItem[];
  updatedAt: string | null;
};

/** avoid_compete=不竞争；white_candidate=待确认白板；white_label=已确认白板 */
export type BrandTier =
  | "avoid_compete"
  | "white_candidate"
  | "white_label"
  | "unknown"
  | "big_brand"; // 旧数据兼容，视为 avoid_compete


export type SellerIntel = {
  sellerId: string | null;
  sellerName: string | null;
  sellerUrl: string | null;
  sellerRating: number | null;
  sellerRatingCount: number | null;
  sellerPositivePct: number | null;
  sellerCustomers90d: string | null;
  productAsDescribedPct: number | null;
  sellerSince: string | null;
};

export type ReviewItem = {
  author: string | null;
  date: string | null;
  rating: number | null;
  text: string | null;
  language: string | null;
  verified: boolean | null;
};

export type WatchlistItem = {
  productKey: string;
  url: string;
  title: string;
  categoryId: string;
  price: number | null;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
  brandTier: BrandTier;
  /** 列表页近期销量（如 80+ Sold Recently → 80） */
  soldRecently: number | null;
  soldRecentlyText: string | null;
  isBestSeller: boolean;
  isAd: boolean;
  /** 标题简体中文对照（缓存，标题变更后应清空重译） */
  titleZh?: string | null;
  seller: SellerIntel | null;
  reviewSampleCount: number;
  discoveredAt: string;
  lastSeenAt: string;
  lastSnapshotAt: string | null;
  status: "watching" | "paused" | "error";
  sourceChannel: CollectChannel;
  rawRefs: string[];
};

export type WatchlistFile = {
  version: 1;
  market: MarketCode;
  updatedAt: string;
  items: WatchlistItem[];
};

export type ProductSnapshot = {
  productKey: string;
  capturedAt: string;
  channel: CollectChannel;
  title: string;
  url: string;
  price: number | null;
  listPrice: number | null;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  bullets: string[];
  bundleText: string | null;
  fulfillment: string | null;
  availability: string | null;
  promoText: string | null;
  imageUrl: string | null;
  categoryId: string | null;
};

export type JobKind = "discover" | "collect" | "ingest";

export type JobLog = {
  id: string;
  kind: JobKind;
  market: MarketCode;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  channel: CollectChannel | "multi";
  message: string;
  stats: Record<string, number>;
  errors: string[];
};

export type DiscoveredProduct = {
  productKey: string;
  url: string;
  title: string;
  price: number | null;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
  /** 商详 JSON-LD / brand 节点，优先于标题首词 */
  brand?: string | null;
  categoryId: string;
  brandTier?: BrandTier;
  soldRecently?: number | null;
  soldRecentlyText?: string | null;
  isBestSeller?: boolean;
  isAd?: boolean;
  cardTags?: string[];
  seller?: SellerIntel | null;
  reviews?: ReviewItem[];
};
