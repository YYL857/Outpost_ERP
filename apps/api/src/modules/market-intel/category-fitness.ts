/**
 * 品类适销粗算：需求热度 × 客单甜区 × 白牌竞争可控。
 * 不做真实货源成本；缺 Sold Recently → 观望，不瞎给「建议跟」。
 */
import { loadConfig, resolveFitnessThresholds } from "./config.js";
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
  // 广告位降权
  return Number(a.isAd) - Number(b.isAd);
}

function buildShortlist(
  items: WatchlistItem[],
  limit: number,
): CategoryFitnessShortItem[] {
  return [...items]
    .filter((i) => isWhiteish(i.brandTier) && !isAvoid(i.brandTier))
    .sort(scoreShortlist)
    .slice(0, limit)
    .map((i) => ({
      productKey: i.productKey,
      title: i.title,
      titleZh: i.titleZh?.trim() ? i.titleZh : null,
      url: i.url,
      price: i.price,
      currency: i.currency,
      soldRecently: i.soldRecently ?? null,
      soldRecentlyText: i.soldRecentlyText ?? null,
      rating: i.rating,
      reviewCount: i.reviewCount,
      brandTier: i.brandTier,
      isBestSeller: Boolean(i.isBestSeller),
      isAd: Boolean(i.isAd),
    }));
}

function decideVerdict(input: {
  sampleSize: number;
  soldCoverage: number;
  soldMedian: number | null;
  whiteShare: number | null;
  avoidShare: number | null;
  aspInSweet: number | null;
  thr: CategoryFitnessThresholds;
}): { verdict: CategoryFitnessVerdict; reasons: string[] } {
  const reasons: string[] = [];
  const { sampleSize, soldCoverage, soldMedian, whiteShare, avoidShare, aspInSweet, thr } =
    input;

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

  const hotOk = soldMedian >= thr.soldRecentlyFloor;
  const aspOk =
    aspInSweet != null && aspInSweet >= 0.4; /* 白牌里至少四成落在甜区 */
  const aspBad = aspInSweet != null && aspInSweet < 0.2;
  const share = whiteShare ?? 0;
  const competitionOk =
    share >= thr.whiteShareSweetMin && share <= thr.whiteShareSweetMax;
  const tooCrowded = share > thr.whiteShareSweetMax;
  const tooBranded = (avoidShare ?? 0) >= 0.75 || share < thr.whiteShareSweetMin;

  if (!hotOk && aspBad) {
    reasons.push(`近期销量中位 ${Math.round(soldMedian)}，未达热度门槛 ${thr.soldRecentlyFloor}`);
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
    reasons.push(`白牌近期销量中位 ${Math.round(soldMedian)}，有量`);
    reasons.push(
      `约 ${Math.round((aspInSweet ?? 0) * 100)}% 白牌客单落在 ${thr.aspMin}–${thr.aspMax} SAR`,
    );
    reasons.push(
      `白牌占比 ${Math.round(share * 100)}%，竞争可控`,
    );
    return { verdict: "go", reasons: reasons.slice(0, 3) };
  }

  if (tooBranded) {
    reasons.push("热销位大牌占比过高，白牌空间有限");
  }
  if (tooCrowded) {
    reasons.push(`白牌占比 ${Math.round(share * 100)}%，偏卷`);
  }
  if (!hotOk) {
    reasons.push(`近期销量中位 ${Math.round(soldMedian)}，未达热度门槛 ${thr.soldRecentlyFloor}`);
  } else {
    reasons.push(`近期销量中位 ${Math.round(soldMedian)}，热度尚可`);
  }
  if (aspBad) {
    reasons.push(`白牌客单落在 ${thr.aspMin}–${thr.aspMax} SAR 的比例偏低`);
  } else if (aspOk) {
    reasons.push("客单大致在可做区间");
  } else if (aspInSweet != null) {
    reasons.push(`约 ${Math.round(aspInSweet * 100)}% 白牌客单在甜区，仍需甄别`);
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
    .map(normalizeItem);

  const sampleSize = items.length;
  const white = items.filter((i) => isWhiteish(i.brandTier));
  const avoid = items.filter((i) => isAvoid(i.brandTier));
  const withSold = items.filter((i) => i.soldRecently != null);
  const whiteSold = white
    .map((i) => i.soldRecently)
    .filter((n): n is number => n != null);
  const whitePrices = white
    .map((i) => i.price)
    .filter((n): n is number => n != null && n > 0);

  const whiteShare = sampleSize ? white.length / sampleSize : null;
  const avoidShare = sampleSize ? avoid.length / sampleSize : null;
  const adShare = sampleSize
    ? items.filter((i) => i.isAd).length / sampleSize
    : null;
  const soldRecentlyMedian = median(whiteSold.length ? whiteSold : withSold.map((i) => i.soldRecently!));
  const soldRecentlyCoverage = sampleSize ? withSold.length / sampleSize : 0;
  const priceMedianWhite = median(whitePrices);
  const aspInSweetShare = whitePrices.length
    ? whitePrices.filter((p) => p >= thr.aspMin && p <= thr.aspMax).length /
      whitePrices.length
    : null;

  const { verdict, reasons } = decideVerdict({
    sampleSize,
    soldCoverage: soldRecentlyCoverage,
    soldMedian: soldRecentlyMedian,
    whiteShare,
    avoidShare,
    aspInSweet: aspInSweetShare,
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
      bestSellerCount: items.filter((i) => i.isBestSeller).length,
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
