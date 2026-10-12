/**
 * 品类适销粗算：需求热度 × 客单甜区 × 白牌竞争可控。
 * 不做真实货源成本；缺 Sold Recently / 脏价过多 → 观望，不瞎给「建议跟」。
 */
import { loadConfig, resolveFitnessThresholds } from "./config.js";
import { isPlausiblePrice, looksPromoTitle } from "./signal-quality.js";
import { loadWatchlist } from "./store.js";
import type {
  BrandTier,
  CategoryFitnessReport,
  CategoryFitnessShortItem,
  CategoryFitnessThresholds,
  CategoryFitnessVerdict,
  WatchlistItem,
} from "./types.js";

function isWhiteish(tier: BrandTier | undefined): boolean {
  return tier === "white_label" || tier === "white_candidate";
}

function isAvoid(tier: BrandTier | undefined): boolean {
  return tier === "avoid_compete" || tier === "big_brand";
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

export { isPlausiblePrice, looksPromoTitle } from "./signal-quality.js";

function cleanPrice(i: WatchlistItem): number | null {
  return isPlausiblePrice(i.price, i.title || "") ? i.price : null;
}

function sellerKey(i: WatchlistItem): string | null {
  const s = i.seller;
  if (!s) return null;
  const id = s.sellerId?.trim();
  if (id) return `id:${id}`;
  const name = s.sellerName?.trim();
  if (name) return `name:${name.toLowerCase()}`;
  return null;
}

/** 白牌里同一卖家占比；过高 → 观望 */
function topSellerShare(items: WatchlistItem[]): {
  share: number | null;
  label: string | null;
  withSeller: number;
} {
  const counts = new Map<string, { n: number; label: string }>();
  let withSeller = 0;
  for (const i of items) {
    const key = sellerKey(i);
    if (!key) continue;
    withSeller += 1;
    const label = i.seller?.sellerName?.trim() || i.seller?.sellerId || key;
    const prev = counts.get(key);
    if (prev) prev.n += 1;
    else counts.set(key, { n: 1, label });
  }
  if (withSeller < 3 || !counts.size) {
    return { share: null, label: null, withSeller };
  }
  let top: { n: number; label: string } | null = null;
  for (const v of counts.values()) {
    if (!top || v.n > top.n) top = v;
  }
  return {
    share: top ? top.n / withSeller : null,
    label: top?.label ?? null,
    withSeller,
  };
}

function normalizeItem(i: WatchlistItem): WatchlistItem {
  return {
    ...i,
    soldRecently: i.soldRecently ?? null,
    soldRecentlyText: i.soldRecentlyText ?? null,
    isBestSeller: Boolean(i.isBestSeller),
    isAd: Boolean(i.isAd),
  };
}

function scoreShortlist(a: WatchlistItem, b: WatchlistItem): number {
  const tierRank = (t?: BrandTier) =>
    t === "white_label" ? 0 : t === "white_candidate" ? 1 : 2;
  const soldDiff = (b.soldRecently ?? -1) - (a.soldRecently ?? -1);
  if (soldDiff !== 0) return soldDiff;
  const tierDiff = tierRank(a.brandTier) - tierRank(b.brandTier);
  if (tierDiff !== 0) return tierDiff;
  return Number(a.isAd) - Number(b.isAd);
}

function buildShortlist(
  items: WatchlistItem[],
  limit: number,
): CategoryFitnessShortItem[] {
  return [...items]
    .filter((i) => isWhiteish(i.brandTier) && !isAvoid(i.brandTier))
    .filter((i) => !looksPromoTitle(i.title || ""))
    .filter((i) => {
      // 无有效价仍可进短名单（展示 —），但促销标题已滤；有价则必须合理
      if (i.price == null) return true;
      return isPlausiblePrice(i.price, i.title || "");
    })
    .sort(scoreShortlist)
    .slice(0, limit)
    .map((i) => ({
      productKey: i.productKey,
      title: i.title,
      titleZh: i.titleZh?.trim() ? i.titleZh : null,
      url: i.url,
      price: cleanPrice(i),
      currency: i.currency,
      soldRecently: i.soldRecently ?? null,
      soldRecentlyText: i.soldRecentlyText ?? null,
      rating: i.rating,
      reviewCount: i.reviewCount,
      brandTier: i.brandTier,
      isBestSeller: Boolean(i.isBestSeller),
      isAd: Boolean(i.isAd),
      sellerId: i.seller?.sellerId ?? null,
      sellerName: i.seller?.sellerName ?? null,
    }));
}

function decideVerdict(input: {
  sampleSize: number;
  soldCoverage: number;
  soldMedian: number | null;
  whiteShare: number | null;
  avoidShare: number | null;
  aspInSweet: number | null;
  priceCleanShare: number | null;
  whitePriceCount: number;
  sellerTopShare: number | null;
  thr: CategoryFitnessThresholds;
}): { verdict: CategoryFitnessVerdict; reasons: string[] } {
  const reasons: string[] = [];
  const {
    sampleSize,
    soldCoverage,
    soldMedian,
    whiteShare,
    avoidShare,
    aspInSweet,
    priceCleanShare,
    whitePriceCount,
    sellerTopShare,
    thr,
  } = input;

  if (sampleSize < 5) {
    return {
      verdict: "watch",
      reasons: ["样本太少，先跑一轮影刀类目采集再看"],
    };
  }

  if (soldCoverage < 0.15 || soldMedian == null) {
    return {
      verdict: "watch",
      reasons: [
        "缺少「Sold Recently」热度信号，无法判断是否热销",
        sampleSize > 0 ? `当前有 ${sampleSize} 个商品样本` : "监控池为空",
      ].slice(0, 3),
    };
  }

  // 有价样本但大半是脏价 → 不给建议跟
  if (
    whitePriceCount >= 3 &&
    priceCleanShare != null &&
    priceCleanShare < 0.4
  ) {
    return {
      verdict: "watch",
      reasons: [
        `白牌价格可信度偏低（仅约 ${Math.round(priceCleanShare * 100)}% 像真实客单）`,
        "请重跑影刀或人工看短名单，暂不建议跟",
      ],
    };
  }

  const hotOk = soldMedian >= thr.soldRecentlyFloor;
  const aspOk = aspInSweet != null && aspInSweet >= 0.4;
  const aspBad = aspInSweet != null && aspInSweet < 0.2;
  const share = whiteShare ?? 0;
  const competitionOk =
    share >= thr.whiteShareSweetMin && share <= thr.whiteShareSweetMax;
  const tooCrowded = share > thr.whiteShareSweetMax;
  const tooBranded =
    (avoidShare ?? 0) >= 0.75 || share < thr.whiteShareSweetMin;
  const sellerCrowded = sellerTopShare != null && sellerTopShare >= 0.5;

  if (!hotOk && aspBad) {
    reasons.push(
      `近期销量中位 ${Math.round(soldMedian)}，未达热度门槛 ${thr.soldRecentlyFloor}`,
    );
    reasons.push("白牌客单大多偏离可做区间，利润空间难做");
    return { verdict: "skip", reasons: reasons.slice(0, 3) };
  }

  if (tooBranded && !hotOk) {
    reasons.push("热销位几乎都是大牌/不竞争品牌，白牌难切入");
    reasons.push(`近期销量中位 ${Math.round(soldMedian)}，热度也不够`);
    return { verdict: "skip", reasons: reasons.slice(0, 3) };
  }

  if (tooCrowded && hotOk && soldMedian >= thr.soldRecentlyFloor * 2) {
    reasons.push(
      `白牌占比 ${Math.round(share * 100)}%，竞争偏卷（建议带 ${Math.round(thr.whiteShareSweetMin * 100)}–${Math.round(thr.whiteShareSweetMax * 100)}%）`,
    );
    reasons.push(`近期销量中位 ${Math.round(soldMedian)}，需求确实在`);
    reasons.push("适合观望或挑确认白板里差异化款，不宜盲目铺货");
    return { verdict: "watch", reasons: reasons.slice(0, 3) };
  }

  if (hotOk && aspOk && competitionOk) {
    if (sellerCrowded) {
      return {
        verdict: "watch",
        reasons: [
          `白牌近期销量中位 ${Math.round(soldMedian)}，有量`,
          `同一卖家约占白牌深采的 ${Math.round((sellerTopShare ?? 0) * 100)}%，供给偏集中`,
          "热度在，但不宜盲目跟风，先看短名单差异化",
        ],
      };
    }
    reasons.push(`白牌近期销量中位 ${Math.round(soldMedian)}，有量`);
    reasons.push(
      `约 ${Math.round((aspInSweet ?? 0) * 100)}% 白牌客单落在 ${thr.aspMin}–${thr.aspMax} SAR`,
    );
    reasons.push(`白牌占比 ${Math.round(share * 100)}%，竞争可控`);
    return { verdict: "go", reasons: reasons.slice(0, 3) };
  }

  if (tooBranded) {
    reasons.push("热销位大牌占比过高，白牌空间有限");
  }
  if (tooCrowded) {
    reasons.push(`白牌占比 ${Math.round(share * 100)}%，偏卷`);
  }
  if (sellerCrowded) {
    reasons.push(
      `白牌卖家集中度高（头部约 ${Math.round((sellerTopShare ?? 0) * 100)}%）`,
    );
  }
  if (!hotOk) {
    reasons.push(
      `近期销量中位 ${Math.round(soldMedian)}，未达热度门槛 ${thr.soldRecentlyFloor}`,
    );
  } else {
    reasons.push(`近期销量中位 ${Math.round(soldMedian)}，热度尚可`);
  }
  if (aspBad) {
    reasons.push(
      `白牌客单落在 ${thr.aspMin}–${thr.aspMax} SAR 的比例偏低`,
    );
  } else if (aspOk) {
    reasons.push("客单大致在可做区间");
  } else if (aspInSweet != null) {
    reasons.push(
      `约 ${Math.round(aspInSweet * 100)}% 白牌客单在甜区，仍需甄别`,
    );
  }

  if (!reasons.length) reasons.push("信号互相打架，建议人工再看短名单");
  return { verdict: "watch", reasons: reasons.slice(0, 3) };
}

const VERDICT_LABEL: Record<CategoryFitnessVerdict, string> = {
  go: "建议跟",
  watch: "观望",
  skip: "不建议",
};

export function computeCategoryFitness(
  categoryId: string,
  thrOverride?: Partial<CategoryFitnessThresholds>,
): CategoryFitnessReport {
  const cfg = loadConfig();
  const thr = { ...resolveFitnessThresholds(cfg), ...thrOverride };
  const cat = cfg.categories.find((c) => c.id === categoryId);
  const title = cat?.title ?? categoryId;
  const wl = loadWatchlist();
  const items = wl.items
    .filter((i) => i.categoryId === categoryId && i.sourceChannel !== "mock")
    .map(normalizeItem)
    .filter((i) => !looksPromoTitle(i.title));

  const sampleSize = items.length;
  const white = items.filter((i) => isWhiteish(i.brandTier));
  const avoid = items.filter((i) => isAvoid(i.brandTier));
  const withSold = items.filter((i) => i.soldRecently != null);
  const whiteSold = white
    .map((i) => i.soldRecently)
    .filter((n): n is number => n != null);

  const whiteRawPrices = white.filter(
    (i) => i.price != null && i.price > 0,
  );
  const whiteCleanPrices = white
    .map((i) => cleanPrice(i))
    .filter((n): n is number => n != null);
  const priceCleanShare = whiteRawPrices.length
    ? whiteCleanPrices.length / whiteRawPrices.length
    : null;

  const whiteShare = sampleSize ? white.length / sampleSize : null;
  const avoidShare = sampleSize ? avoid.length / sampleSize : null;
  const adShare = sampleSize
    ? items.filter((i) => i.isAd).length / sampleSize
    : null;
  const soldRecentlyMedian = median(
    whiteSold.length ? whiteSold : withSold.map((i) => i.soldRecently!),
  );
  const soldRecentlyCoverage = sampleSize ? withSold.length / sampleSize : 0;
  const priceMedianWhite = median(whiteCleanPrices);
  const aspInSweetShare = whiteCleanPrices.length
    ? whiteCleanPrices.filter((p) => p >= thr.aspMin && p <= thr.aspMax)
        .length / whiteCleanPrices.length
    : null;

  const seller = topSellerShare(white);
  const { verdict, reasons } = decideVerdict({
    sampleSize,
    soldCoverage: soldRecentlyCoverage,
    soldMedian: soldRecentlyMedian,
    whiteShare,
    avoidShare,
    aspInSweet: aspInSweetShare,
    priceCleanShare,
    whitePriceCount: whiteRawPrices.length,
    sellerTopShare: seller.share,
    thr,
  });

  const latest = items.reduce<string | null>((acc, i) => {
    if (!acc || i.lastSeenAt > acc) return i.lastSeenAt;
    return acc;
  }, null);

  return {
    categoryId,
    categoryTitle: title,
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
    reasons,
    sampleSize,
    metrics: {
      whiteShare,
      avoidShare,
      adShare,
      whiteCount: white.length,
      avoidCount: avoid.length,
      soldRecentlyMedian,
      soldRecentlyCoverage,
      priceMedianWhite,
      aspInSweetShare,
      priceCleanShare,
      bestSellerCount: items.filter((i) => i.isBestSeller).length,
      sellerTopShare: seller.share,
      sellerTopLabel: seller.label,
      sellerCoverage: white.length ? seller.withSeller / white.length : null,
    },
    thresholds: thr,
    shortlist: buildShortlist(items, thr.shortlistLimit),
    updatedAt: latest,
  };
}

export function computeAllCategoryFitness(): {
  categories: CategoryFitnessReport[];
  thresholds: CategoryFitnessThresholds;
} {
  const cfg = loadConfig();
  const thr = resolveFitnessThresholds(cfg);
  const enabled = cfg.categories.filter((c) => c.enabled);
  const ids = enabled.length
    ? enabled.map((c) => c.id)
    : [...new Set(loadWatchlist().items.map((i) => i.categoryId))];
  return {
    thresholds: thr,
    categories: ids.map((id) => computeCategoryFitness(id)),
  };
}
