/**
 * 品牌名录（单文件 + 按品类软隔离）
 *
 * 编排：
 * 1) 先查 shared（跨品类大牌/中东常见）+ 当前品类索引
 * 2) 表里没有的才进 LLM 联网审「当地是否知名」
 * 3) 结果写回「该品类」索引 → 下次同品类命中表，不再调模型
 *
 * 文件：D:\outpost-data\market-imports\noon\sa\brand-registry.json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureMarketDirs, marketPaths } from "./paths.js";

export type BrandTier =
  | "avoid_compete"
  | "white_candidate"
  | "white_label"
  | "unknown";

export type LegacyBrandTier = BrandTier | "big_brand";

export type PendingBrandExample = {
  title: string;
  url?: string | null;
  imageUrl?: string | null;
  productKey?: string | null;
  tags?: string[];
};

export type PendingBrandRow = {
  token: string;
  hits: number;
  lastSeenAt: string;
  examples: string[];
  /** 样例商品详情（链接/图/标签），便于人工定性 */
  exampleRefs?: PendingBrandExample[];
};

export type CategoryBrandBucket = {
  avoidCompete: { custom: string[]; autoAvoid: string[] };
  confirmedWhite: string[];
  pendingReview: PendingBrandRow[];
  aiReviews?: Array<Record<string, unknown>>;
};

export type BrandRegistryFile = {
  version: number;
  market: string;
  notes?: string[];
  /** 跨品类共享层 */
  shared: {
    avoidCompete: {
      global: string[];
      menaKnown: string[];
      custom: string[];
      autoAvoid: string[];
    };
    confirmedWhite: string[];
  };
  /** 品类软隔离索引（逻辑分桶，物理仍同一 JSON） */
  categories: Record<string, CategoryBrandBucket>;
  updatedAt: string;

  /** @deprecated v1 兼容，load 时迁入 shared/categories */
  avoidCompete?: BrandRegistryFile["shared"]["avoidCompete"];
  confirmedWhite?: string[];
  pendingReview?: PendingBrandRow[];
  aiReviews?: Array<Record<string, unknown>>;
};

const DEFAULT_GLOBAL = [
  "apple", "iphone", "samsung", "galaxy", "sony", "lg", "huawei", "xiaomi",
  "hp", "dell", "lenovo", "asus", "microsoft", "google", "oppo", "vivo",
  "anker", "bose", "jbl", "canon", "nikon", "dyson", "philips",
  "fujifilm", "fuji", "instax", "whoop", "sportflex",
];

const DEFAULT_MENA = [
  "geepas", "nikai", "olsenmark", "sokany", "krypton", "porodo", "green lion",
  "baseus", "ugreen", "spigen", "homati", "joyroom", "hoco", "remax",
];

function nowIso() {
  return new Date().toISOString();
}

function registryPath() {
  return marketPaths("sa").brandRegistry;
}

export function normBrand(s: string) {
  return s.toLowerCase().replace(/[_+/.-]+/g, " ").replace(/\s+/g, " ").trim();
}

function emptyCategoryBucket(): CategoryBrandBucket {
  return {
    avoidCompete: { custom: [], autoAvoid: [] },
    confirmedWhite: [],
    pendingReview: [],
    aiReviews: [],
  };
}

function emptyRegistry(): BrandRegistryFile {
  return {
    version: 2,
    market: "sa",
    notes: [
      "单表 + 品类软隔离：shared=跨品类；categories[类目id]=该类目积累的 avoid/白牌/pending",
      "查表顺序：shared → 当前品类。未命中才 LLM；结果写回当前品类，越积调模型越少",
    ],
    shared: {
      avoidCompete: {
        global: [...DEFAULT_GLOBAL],
        menaKnown: [...DEFAULT_MENA],
        custom: [],
        autoAvoid: [],
      },
      confirmedWhite: [],
    },
    categories: {},
    updatedAt: nowIso(),
  };
}

/** v1 扁平结构 → v2 shared + categories._migrated */
function migrateToV2(raw: BrandRegistryFile): BrandRegistryFile {
  if (raw.version >= 2 && raw.shared && raw.categories) {
    if (!raw.shared.avoidCompete.autoAvoid) raw.shared.avoidCompete.autoAvoid = [];
    return raw;
  }
  const next = emptyRegistry();
  const a = raw.avoidCompete || next.shared.avoidCompete;
  next.shared.avoidCompete = {
    global: [...(a.global?.length ? a.global : DEFAULT_GLOBAL)],
    menaKnown: [...(a.menaKnown?.length ? a.menaKnown : DEFAULT_MENA)],
    custom: [...(a.custom || [])],
    autoAvoid: [...(a.autoAvoid || [])],
  };
  next.shared.confirmedWhite = [...(raw.confirmedWhite || [])];
  const bucket = emptyCategoryBucket();
  bucket.pendingReview = [...(raw.pendingReview || [])];
  bucket.aiReviews = [...(raw.aiReviews || [])];
  // 旧 custom/autoAvoid 已进 shared；品类桶留给后续积累
  next.categories = { _migrated: bucket };
  next.version = 2;
  next.updatedAt = nowIso();
  return next;
}

export function loadBrandRegistry(): BrandRegistryFile {
  ensureMarketDirs("sa");
  const file = registryPath();
  if (!existsSync(file)) {
    const fresh = emptyRegistry();
    writeFileSync(file, JSON.stringify(fresh, null, 2), "utf8");
    return fresh;
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as BrandRegistryFile;
    const migrated = migrateToV2(raw);
    if (migrated.version !== raw.version || !raw.shared) {
      writeFileSync(file, JSON.stringify(migrated, null, 2), "utf8");
    }
    return migrated;
  } catch {
    return emptyRegistry();
  }
}

export function saveBrandRegistry(reg: BrandRegistryFile) {
  ensureMarketDirs("sa");
  const next = { ...reg, version: 2, updatedAt: nowIso() };
  // 不落盘 v1 废弃字段，避免双写
  delete (next as { avoidCompete?: unknown }).avoidCompete;
  delete (next as { confirmedWhite?: unknown }).confirmedWhite;
  delete (next as { pendingReview?: unknown }).pendingReview;
  delete (next as { aiReviews?: unknown }).aiReviews;
  writeFileSync(registryPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function ensureCategoryBucket(
  reg: BrandRegistryFile,
  categoryId: string,
): CategoryBrandBucket {
  const id = categoryId || "_uncategorized";
  if (!reg.categories) reg.categories = {};
  if (!reg.categories[id]) reg.categories[id] = emptyCategoryBucket();
  const b = reg.categories[id]!;
  if (!b.avoidCompete) b.avoidCompete = { custom: [], autoAvoid: [] };
  if (!b.avoidCompete.autoAvoid) b.avoidCompete.autoAvoid = [];
  if (!b.avoidCompete.custom) b.avoidCompete.custom = [];
  if (!b.confirmedWhite) b.confirmedWhite = [];
  if (!b.pendingReview) b.pendingReview = [];
  if (!b.aiReviews) b.aiReviews = [];
  return b;
}

/** shared + 指定品类（及可选 _migrated）的不竞争关键词 */
export function avoidKeywordsForCategory(
  reg: BrandRegistryFile,
  categoryId?: string | null,
): string[] {
  const out: string[] = [];
  const s = reg.shared?.avoidCompete;
  if (s) {
    out.push(
      ...(s.global || []),
      ...(s.menaKnown || []),
      ...(s.custom || []),
      ...(s.autoAvoid || []),
    );
  }
  if (categoryId) {
    const b = reg.categories?.[categoryId];
    if (b?.avoidCompete) {
      out.push(...(b.avoidCompete.custom || []), ...(b.avoidCompete.autoAvoid || []));
    }
  } else {
    for (const b of Object.values(reg.categories || {})) {
      out.push(
        ...(b.avoidCompete?.custom || []),
        ...(b.avoidCompete?.autoAvoid || []),
      );
    }
  }
  // 兼容迁移桶
  const mig = reg.categories?._migrated;
  if (mig?.avoidCompete && categoryId !== "_migrated") {
    out.push(
      ...(mig.avoidCompete.custom || []),
      ...(mig.avoidCompete.autoAvoid || []),
    );
  }
  return [...new Set(out.map(normBrand).filter(Boolean))];
}

export function confirmedKeywordsForCategory(
  reg: BrandRegistryFile,
  categoryId?: string | null,
): string[] {
  const out = [...(reg.shared?.confirmedWhite || [])];
  if (categoryId) {
    out.push(...(reg.categories?.[categoryId]?.confirmedWhite || []));
  } else {
    for (const b of Object.values(reg.categories || {})) {
      out.push(...(b.confirmedWhite || []));
    }
  }
  return [...new Set(out.map(normBrand).filter(Boolean))];
}

/** 表内是否已有该 token（命中则不必调模型） */
export function lookupBrandInRegistry(
  token: string,
  categoryId?: string | null,
  reg?: BrandRegistryFile,
): { tier: BrandTier; layer: "shared" | "category" | "none" } {
  const t = normBrand(token);
  if (!t) return { tier: "unknown", layer: "none" };
  const registry = reg ?? loadBrandRegistry();
  const confirmed = confirmedKeywordsForCategory(registry, categoryId);
  if (confirmed.includes(t)) {
    const inShared = (registry.shared?.confirmedWhite || [])
      .map(normBrand)
      .includes(t);
    return { tier: "white_label", layer: inShared ? "shared" : "category" };
  }
  const avoid = avoidKeywordsForCategory(registry, categoryId);
  if (avoid.includes(t) || avoid.some((kw) => kw && t.includes(kw))) {
    const sharedAvoid = avoidKeywordsForCategory(
      {
        ...registry,
        categories: {},
      },
      null,
    );
    // 粗分：shared 列表含则 shared
    const sharedSet = new Set(
      [
        ...(registry.shared?.avoidCompete?.global || []),
        ...(registry.shared?.avoidCompete?.menaKnown || []),
        ...(registry.shared?.avoidCompete?.custom || []),
        ...(registry.shared?.avoidCompete?.autoAvoid || []),
      ].map(normBrand),
    );
    return {
      tier: "avoid_compete",
      layer: sharedSet.has(t) || [...sharedSet].some((k) => t.includes(k))
        ? "shared"
        : "category",
    };
  }
  // 标题包含式：对 shared 关键词做 includes（apple in "Apple iPhone..."）
  const s = t;
  for (const kw of confirmedKeywordsForCategory(registry, categoryId)) {
    if (kw && s.includes(kw)) return { tier: "white_label", layer: "category" };
  }
  for (const kw of avoidKeywordsForCategory(registry, categoryId)) {
    if (kw && s.includes(kw)) return { tier: "avoid_compete", layer: "category" };
  }
  return { tier: "white_candidate", layer: "none" };
}

/** 与影刀 `_BRAND_TOKEN_SKIP` 对齐，避免入库再把促销词写成品牌 */
const BRAND_TOKEN_SKIP = new Set([
  "the", "new", "for", "with", "and", "pro", "max", "mini", "pack", "set",
  "saudi", "arabia", "original", "official", "wireless", "smart", "usb",
  "one", "two", "life", "peak", "compatible", "professional", "high", "speed",
  "desktop", "machine", "camera", "instant", "film", "membership", "month",
  "months", "year", "inch", "gb", "tb", "esim", "only", "silver", "black",
  "white", "blue", "pink", "purple", "lilac", "middle", "east", "version",
  "facetime", "activity", "tracker", "health", "fitness", "wearable",
  "sportflex", "ecg", "waterproof", "rapid", "fdm", "printer",
  "best", "mega", "faster", "deal", "sale", "offer", "offers", "mobile",
  "mobiles", "seller", "bestsellers", "bestseller", "capture", "enjoy",
  "better", "products", "all", "this", "by", "from", "your", "our", "no",
  "hd", "next", "gen", "tvs", "tv", "charging", "brand", "football",
  "projector", "projectors", "portable", "home", "kids", "lunch", "bag",
  "zoom", "love", "princess", "disney", "power", "living", "refined",
  "everyday", "chargers", "charger",
  "shop", "exclusive", "series", "qled", "plus", "mah", "recorder",
  // 店名/UI/开店时间误写入（历史脏 pending）
  "positive", "global", "every", "location", "december", "dream", "future",
  "m2", "customers", "customer", "arabic", "profile", "store", "official",
  "technology", "ict",
]);

const BRAND_SLOGAN_RE =
  /\b(brand|life|living|enjoy|your|next[- ]?gen|no\.?\s*1|number\s*one|world\s*cup|everyday|refined|series|exclusive|qled)\b/i;

/** 促销卡标题不当品牌 / 不当白牌样本 */
export function isPromoProductTitle(title: string | null | undefined): boolean {
  return /^(mega\s*deal|deal\b|live\s*check|\[yd-demo\])/i.test(
    String(title || "").trim(),
  );
}

function tokenFromParts(parts: string[]): string | null {
  for (const p of parts) {
    const t = normBrand(p);
    if (!t || t.length < 2 || BRAND_TOKEN_SKIP.has(t)) continue;
    if (/^[a-z]*\d{3,}/i.test(t) || /\d{3,}/.test(t)) continue;
    if (!/^[a-z][a-z0-9+]{1,24}$/.test(t)) continue;
    return t;
  }
  return null;
}

export function guessBrandToken(text: string | null | undefined): string | null {
  const raw = String(text || "").replace(/https?:\/\/\S+/g, "").trim();
  if (!raw || isPromoProductTitle(raw)) return null;

  // 「ZONBON: smart living」→ 只取冒号左侧品牌
  const colon = raw.match(
    /^([A-Za-z][A-Za-z0-9+ .&'-]{0,32}?)\s*[:：]\s*.+$/,
  );
  if (colon) {
    return tokenFromParts(colon[1]!.split(/[\s|/,_-]+/));
  }
  // 「Power,Refined」这类逗号 slogan
  if (/^[A-Za-z]{2,20},[A-Za-z]{2,20}$/.test(raw)) return null;

  if (BRAND_SLOGAN_RE.test(raw)) return null;
  const parts = raw
    .split(/[\s|/,_-]+/)
    .map((x) => x.trim())
    .filter((x) => /^[A-Za-z][A-Za-z0-9+]{1,24}$/.test(x));
  return tokenFromParts(parts);
}

export function classifyBrandTier(
  text: string | null | undefined,
  reg?: BrandRegistryFile,
  categoryId?: string | null,
): BrandTier {
  const s = normBrand(String(text || ""));
  if (!s) return "unknown";
  const registry = reg ?? loadBrandRegistry();
  for (const kw of confirmedKeywordsForCategory(registry, categoryId)) {
    if (kw && s.includes(kw)) return "white_label";
  }
  for (const kw of avoidKeywordsForCategory(registry, categoryId)) {
    if (kw && s.includes(kw)) return "avoid_compete";
  }
  return "white_candidate";
}

export function isDeepDiveTarget(tier: BrandTier): boolean {
  return tier === "white_candidate" || tier === "white_label";
}

export function normalizeLegacyTier(tier: string | null | undefined): BrandTier {
  if (tier === "big_brand") return "avoid_compete";
  if (
    tier === "avoid_compete" ||
    tier === "white_candidate" ||
    tier === "white_label" ||
    tier === "unknown"
  ) {
    return tier;
  }
  return "unknown";
}

export function notePendingBrand(opts: {
  token: string;
  exampleTitle?: string;
  productKey?: string;
  categoryId?: string;
  url?: string;
  imageUrl?: string;
  tags?: string[];
}) {
  const token = normBrand(opts.token);
  if (!token || token.length < 2) return;
  if (BRAND_TOKEN_SKIP.has(token) || /^[a-z]*\d{3,}/i.test(token)) return;
  if (isPromoProductTitle(opts.exampleTitle)) return;
  const reg = loadBrandRegistry();
  const cat = opts.categoryId || "_uncategorized";
  if (
    avoidKeywordsForCategory(reg, cat).includes(token) ||
    confirmedKeywordsForCategory(reg, cat).includes(token)
  ) {
    return;
  }
  const bucket = ensureCategoryBucket(reg, cat);
  const ex = (opts.exampleTitle || "").slice(0, 160);
  const tags = (opts.tags || [])
    .map((t) => String(t).trim())
    .filter((t) => t.length >= 2 && t.length <= 60)
    .slice(0, 10);
  const ref: PendingBrandExample | null =
    ex || opts.url || opts.imageUrl || opts.productKey || tags.length
      ? {
          title: ex,
          url: opts.url || null,
          imageUrl: opts.imageUrl || null,
          productKey: opts.productKey || null,
          tags,
        }
      : null;
  const row = bucket.pendingReview.find((p) => p.token === token);
  if (row) {
    row.hits += 1;
    row.lastSeenAt = nowIso();
    if (ex && !row.examples.includes(ex)) {
      row.examples = [...row.examples.slice(-4), ex];
    }
    if (ref && (ref.url || ref.title || ref.productKey)) {
      const refs = [...(row.exampleRefs || [])];
      const key = ref.productKey || ref.url || ref.title;
      const idx = refs.findIndex(
        (r) => (r.productKey || r.url || r.title) === key,
      );
      if (idx >= 0) {
        refs[idx] = { ...refs[idx], ...ref, tags: ref.tags?.length ? ref.tags : refs[idx]?.tags };
      } else {
        refs.push(ref);
      }
      row.exampleRefs = refs.slice(-5);
    }
  } else {
    bucket.pendingReview.push({
      token,
      hits: 1,
      lastSeenAt: nowIso(),
      examples: ex ? [ex] : [],
      exampleRefs: ref ? [ref] : [],
    });
  }
  bucket.pendingReview.sort((a, b) => b.hits - a.hits);
  bucket.pendingReview = bucket.pendingReview.slice(0, 500);
  saveBrandRegistry(reg);
}

/** 清掉历史促销词 / 型号 token / skip 表噪声 */
export function prunePendingBrandNoise(categoryId?: string): number {
  const reg = loadBrandRegistry();
  let removed = 0;
  const cats = reg.categories || {};
  for (const [cid, bucket] of Object.entries(cats)) {
    if (categoryId && cid !== categoryId) continue;
    if (!bucket?.pendingReview?.length) continue;
    const before = bucket.pendingReview.length;
    bucket.pendingReview = bucket.pendingReview.filter((p) => {
      const t = normBrand(p.token);
      if (!t || t.length < 2) return false;
      if (BRAND_TOKEN_SKIP.has(t)) return false;
      if (/^[a-z]*\d{3,}/i.test(t) || /\d{3,}/.test(t)) return false;
      // 短型号噪声：a1 / m2 / x9
      if (/^[a-z]\d{1,2}$/i.test(t)) return false;
      if (BRAND_SLOGAN_RE.test(t)) return false;
      return true;
    });
    removed += before - bucket.pendingReview.length;
  }
  if (removed > 0) saveBrandRegistry(reg);
  return removed;
}

/**
 * 从 pending 删除，不写入白板/避开。
 * 用于脏 token、信息不足、或「既不跟也不拉黑」的丢弃。
 */
export function discardPendingBrand(token: string, categoryId?: string) {
  const t = normBrand(token);
  const reg = loadBrandRegistry();
  const cats = categoryId
    ? [categoryId]
    : Object.keys(reg.categories || {});
  if (!cats.length) cats.push("_uncategorized");

  for (const cid of cats) {
    const b = ensureCategoryBucket(reg, cid);
    b.pendingReview = b.pendingReview.filter((p) => p.token !== t);
  }
  return saveBrandRegistry(reg);
}

export function promotePendingBrand(
  token: string,
  to: "avoidCompete" | "confirmedWhite",
  categoryId?: string,
) {
  const t = normBrand(token);
  const reg = loadBrandRegistry();
  const cats = categoryId
    ? [categoryId]
    : Object.keys(reg.categories || {});
  if (!cats.length) cats.push("_uncategorized");

  for (const cid of cats) {
    const b = ensureCategoryBucket(reg, cid);
    b.pendingReview = b.pendingReview.filter((p) => p.token !== t);
    if (to === "confirmedWhite") {
      if (!b.confirmedWhite.map(normBrand).includes(t)) b.confirmedWhite.push(t);
      b.avoidCompete.autoAvoid = b.avoidCompete.autoAvoid.filter((x) => normBrand(x) !== t);
      b.avoidCompete.custom = b.avoidCompete.custom.filter((x) => normBrand(x) !== t);
    } else {
      if (!b.avoidCompete.custom.map(normBrand).includes(t)) {
        b.avoidCompete.custom.push(t);
      }
      b.confirmedWhite = b.confirmedWhite.filter((x) => normBrand(x) !== t);
    }
  }
  // 若指定品类，只动该品类；未指定时上面已扫全部品类桶
  if (categoryId) {
    // also strip from other pending buckets same token? optional — keep soft isolation
  }
  return saveBrandRegistry(reg);
}

/** 写入品类 autoAvoid（AI 高置信） */
export function applyCategoryAutoAvoid(
  categoryId: string,
  tokens: string[],
): BrandRegistryFile {
  const reg = loadBrandRegistry();
  const b = ensureCategoryBucket(reg, categoryId);
  const bag = new Set(avoidKeywordsForCategory(reg, categoryId));
  for (const raw of tokens) {
    const t = normBrand(raw);
    if (!t || t.length < 2 || bag.has(t)) continue;
    b.avoidCompete.autoAvoid.push(t);
    bag.add(t);
  }
  b.pendingReview = b.pendingReview.filter((p) => !bag.has(normBrand(p.token)));
  b.confirmedWhite = b.confirmedWhite.filter((w) => !bag.has(normBrand(w)));
  return saveBrandRegistry(reg);
}

export function brandRegistrySummary(categoryId?: string) {
  const reg = loadBrandRegistry();
  const catIds = Object.keys(reg.categories || {}).filter((k) => k !== "_migrated");
  const focus = categoryId
    ? [categoryId]
    : catIds.length
      ? catIds
      : ["_uncategorized"];

  const pendingTop: Array<PendingBrandRow & { categoryId: string; ai?: unknown }> =
    [];
  let pendingCount = 0;
  let autoAvoidCount = (reg.shared?.avoidCompete?.autoAvoid || []).length;
  let confirmedWhiteCount = (reg.shared?.confirmedWhite || []).length;

  for (const cid of focus) {
    const b = ensureCategoryBucket(reg, cid);
    autoAvoidCount += (b.avoidCompete.autoAvoid || []).length;
    confirmedWhiteCount += (b.confirmedWhite || []).length;
    pendingCount += b.pendingReview.length;
    const aiByToken = new Map(
      (b.aiReviews || []).map((r) => [normBrand(String(r.token || "")), r]),
    );
    for (const p of b.pendingReview) {
      pendingTop.push({
        ...p,
        categoryId: cid,
        ai: aiByToken.get(normBrand(p.token)) || null,
      });
    }
  }
  // 迁移桶 pending
  const mig = reg.categories?._migrated;
  if (mig && !categoryId) {
    pendingCount += mig.pendingReview.length;
    for (const p of mig.pendingReview) {
      pendingTop.push({ ...p, categoryId: "_migrated", ai: null });
    }
  }
  pendingTop.sort((a, b) => b.hits - a.hits);

  return {
    version: reg.version,
    avoidCount: avoidKeywordsForCategory(reg, categoryId || null).length,
    autoAvoidCount,
    confirmedWhiteCount,
    pendingCount,
    pendingTop: pendingTop.slice(0, 40),
    categoryIds: catIds,
    path: registryPath(),
    updatedAt: reg.updatedAt,
  };
}
