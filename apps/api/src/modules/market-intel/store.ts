import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { dayStamp, ensureMarketDirs, marketPaths, stamp } from "./paths.js";
import type {
  DiscoveredProduct,
  JobLog,
  ProductSnapshot,
  ReviewItem,
  SellerIntel,
  WatchlistFile,
  WatchlistItem,
} from "./types.js";
import { classifyBrandTier, guessBrandToken, notePendingBrand, normalizeLegacyTier } from "./white-label.js";

function nowIso() {
  return new Date().toISOString();
}

export function loadWatchlist(): WatchlistFile {
  const paths = ensureMarketDirs("sa");
  if (!existsSync(paths.watchlist)) {
    const empty: WatchlistFile = {
      version: 1,
      market: "sa",
      updatedAt: nowIso(),
      items: [],
    };
    writeFileSync(paths.watchlist, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
  return JSON.parse(readFileSync(paths.watchlist, "utf8")) as WatchlistFile;
}

export function saveWatchlist(file: WatchlistFile) {
  const paths = marketPaths("sa");
  ensureMarketDirs("sa");
  const next = { ...file, updatedAt: nowIso() };
  writeFileSync(paths.watchlist, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** 清除开发试跑产生的 mock 监控项，正式使用前建议执行 */
export function purgeMockWatchlist() {
  const wl = loadWatchlist();
  const kept = wl.items.filter((i) => i.sourceChannel !== "mock");
  const removed = wl.items.length - kept.length;
  const next = saveWatchlist({
    version: 1,
    market: "sa",
    updatedAt: nowIso(),
    items: kept,
  });
  return { removed, remaining: next.items.length, watchlist: next };
}

export function upsertWatchlistFromDiscover(
  products: DiscoveredProduct[],
  channel: WatchlistItem["sourceChannel"],
) {
  const wl = loadWatchlist();
  const byKey = new Map(wl.items.map((i) => [i.productKey, i]));
  const now = nowIso();
  let added = 0;
  let updated = 0;

  for (const p of products) {
    const tier = normalizeLegacyTier(
      p.brandTier ??
        classifyBrandTier(`${p.title} ${p.seller?.sellerName ?? ""}`, undefined, p.categoryId),
    );
    const token =
      guessBrandToken(p.brand) ||
      guessBrandToken(p.title) ||
      guessBrandToken(p.seller?.sellerName);
    if (token && (tier === "white_candidate" || tier === "unknown")) {
      const tags: string[] = [...(p.cardTags ?? [])];
      if (p.soldRecentlyText && !tags.some((t) => /sold\s+recently/i.test(t))) {
        tags.unshift(p.soldRecentlyText);
      }
      if (p.isBestSeller && !tags.some((t) => /best\s*seller/i.test(t))) {
        tags.unshift("Best Seller");
      }
      if (p.isAd && !tags.includes("Ad")) tags.unshift("Ad");
      notePendingBrand({
        token,
        exampleTitle: p.title,
        productKey: p.productKey,
        categoryId: p.categoryId,
        url: p.url,
        imageUrl: p.imageUrl ?? undefined,
        tags,
      });
    }
    const seller = normalizeSeller(p.seller);
    const reviewCountSample = Array.isArray(p.reviews) ? p.reviews.length : 0;
    const prev = byKey.get(p.productKey);
    if (!prev) {
      byKey.set(p.productKey, {
        productKey: p.productKey,
        url: p.url,
        title: p.title,
        categoryId: p.categoryId,
        price: p.price,
        currency: p.currency,
        rating: p.rating,
        reviewCount: p.reviewCount,
        imageUrl: p.imageUrl,
        brandTier: tier === "big_brand" ? "avoid_compete" : tier,
        soldRecently: p.soldRecently ?? null,
        soldRecentlyText: p.soldRecentlyText ?? null,
        isBestSeller: Boolean(p.isBestSeller),
        isAd: Boolean(p.isAd),
        titleZh: null,
        seller,
        reviewSampleCount: reviewCountSample,
        discoveredAt: now,
        lastSeenAt: now,
        lastSnapshotAt: null,
        status: "watching",
        sourceChannel: channel,
        rawRefs: [],
      });
      added += 1;
    } else {
      prev.title = p.title || prev.title;
      if (p.title && prev.titleZh && p.title !== prev.title) {
        prev.titleZh = null;
      }
      prev.url = p.url || prev.url;
      prev.categoryId = p.categoryId || prev.categoryId;
      prev.price = p.price ?? prev.price;
      prev.rating = p.rating ?? prev.rating;
      prev.reviewCount = p.reviewCount ?? prev.reviewCount;
      prev.imageUrl = p.imageUrl ?? prev.imageUrl;
      if (p.soldRecently != null) {
        prev.soldRecently = p.soldRecently;
        prev.soldRecentlyText = p.soldRecentlyText ?? prev.soldRecentlyText ?? null;
      } else if (prev.soldRecently == null) {
        prev.soldRecently = null;
        prev.soldRecentlyText = prev.soldRecentlyText ?? null;
      }
      if (p.isBestSeller) prev.isBestSeller = true;
      else if (prev.isBestSeller == null) prev.isBestSeller = false;
      if (p.isAd) prev.isAd = true;
      else if (prev.isAd == null) prev.isAd = false;
      const nextTier = tier === "big_brand" ? "avoid_compete" : tier;
      prev.brandTier =
        nextTier !== "unknown"
          ? nextTier
          : normalizeLegacyTier(prev.brandTier ?? "unknown");
      if (!prev.seller) prev.seller = null;
      if (prev.reviewSampleCount == null) prev.reviewSampleCount = 0;
      prev.seller = mergeSeller(prev.seller, seller);
      if (reviewCountSample > 0) prev.reviewSampleCount = reviewCountSample;
      prev.lastSeenAt = now;
      prev.sourceChannel = channel;
      updated += 1;
    }
  }

  const next = saveWatchlist({
    version: 1,
    market: "sa",
    updatedAt: now,
    items: [...byKey.values()],
  });
  return { watchlist: next, added, updated };
}

function normalizeSeller(s: SellerIntel | null | undefined): SellerIntel | null {
  if (!s || typeof s !== "object") return null;
  return {
    sellerId: s.sellerId ?? null,
    sellerName: s.sellerName ?? null,
    sellerUrl: s.sellerUrl ?? null,
    sellerRating: s.sellerRating ?? null,
    sellerRatingCount: s.sellerRatingCount ?? null,
    sellerPositivePct: s.sellerPositivePct ?? null,
    sellerCustomers90d: s.sellerCustomers90d ?? null,
    productAsDescribedPct: s.productAsDescribedPct ?? null,
    sellerSince: s.sellerSince ?? null,
  };
}

function mergeSeller(
  prev: SellerIntel | null | undefined,
  next: SellerIntel | null,
): SellerIntel | null {
  if (!next) return prev ?? null;
  if (!prev) return next;
  return {
    sellerId: next.sellerId ?? prev.sellerId,
    sellerName: next.sellerName ?? prev.sellerName,
    sellerUrl: next.sellerUrl ?? prev.sellerUrl,
    sellerRating: next.sellerRating ?? prev.sellerRating,
    sellerRatingCount: next.sellerRatingCount ?? prev.sellerRatingCount,
    sellerPositivePct: next.sellerPositivePct ?? prev.sellerPositivePct,
    sellerCustomers90d: next.sellerCustomers90d ?? prev.sellerCustomers90d,
    productAsDescribedPct: next.productAsDescribedPct ?? prev.productAsDescribedPct,
    sellerSince: next.sellerSince ?? prev.sellerSince,
  };
}

/** 落盘白牌卖家摘要 + 评论 raw（供 L3 周报） */
export function persistSellerIntel(products: DiscoveredProduct[], channel: string) {
  const paths = ensureMarketDirs("sa");
  let sellers = 0;
  let reviews = 0;
  for (const p of products) {
    const seller = normalizeSeller(p.seller);
    if (!seller?.sellerId && !seller?.sellerName) continue;
    const sellerKey = String(seller.sellerId || seller.sellerName || "unknown")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 80);
    const sdir = join(paths.sellers, sellerKey);
    if (!existsSync(sdir)) mkdirSync(sdir, { recursive: true });
    const sfile = join(sdir, `${stamp()}.json`);
    writeFileSync(
      sfile,
      JSON.stringify(
        {
          platform: "noon",
          market: "sa",
          channel,
          productKey: p.productKey,
          categoryId: p.categoryId,
          brandTier: p.brandTier ?? classifyBrandTier(p.title),
          capturedAt: nowIso(),
          seller,
          product: {
            productKey: p.productKey,
            title: p.title,
            url: p.url,
            price: p.price,
            rating: p.rating,
            reviewCount: p.reviewCount,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    sellers += 1;

    const revs = Array.isArray(p.reviews) ? (p.reviews as ReviewItem[]) : [];
    if (revs.length) {
      const rdir = join(paths.reviews, sellerKey);
      if (!existsSync(rdir)) mkdirSync(rdir, { recursive: true });
      const rfile = join(rdir, `${stamp()}.json`);
      writeFileSync(
        rfile,
        JSON.stringify(
          {
            platform: "noon",
            market: "sa",
            channel,
            sellerKey,
            productKey: p.productKey,
            capturedAt: nowIso(),
            count: revs.length,
            reviews: revs,
          },
          null,
          2,
        ),
        "utf8",
      );
      reviews += revs.length;
    }
  }
  return { sellers, reviews };
}

export function writeDiscoverRaw(
  categoryId: string,
  payload: unknown,
  channel: string,
) {
  const paths = ensureMarketDirs("sa");
  const dir = join(paths.discover, dayStamp());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${categoryId}_${channel}_${stamp()}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        platform: "noon",
        market: "sa",
        categoryId,
        channel,
        capturedAt: nowIso(),
        payload,
      },
      null,
      2,
    ),
    "utf8",
  );
  return file;
}

export function writeSnapshot(snapshot: ProductSnapshot) {
  const paths = ensureMarketDirs("sa");
  const dir = join(paths.products, snapshot.productKey, "snapshots");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${stamp()}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        platform: "noon",
        market: "sa",
        ...snapshot,
      },
      null,
      2,
    ),
    "utf8",
  );

  const wl = loadWatchlist();
  const item = wl.items.find((i) => i.productKey === snapshot.productKey);
  if (item) {
    item.lastSnapshotAt = snapshot.capturedAt;
    item.price = snapshot.price ?? item.price;
    item.title = snapshot.title || item.title;
    item.rating = snapshot.rating ?? item.rating;
    item.reviewCount = snapshot.reviewCount ?? item.reviewCount;
    item.rawRefs = [...item.rawRefs.slice(-19), file];
    saveWatchlist(wl);
  }
  return file;
}

export function writeJobLog(job: JobLog) {
  const paths = ensureMarketDirs("sa");
  const dir = join(paths.jobs, dayStamp());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${job.kind}_${job.id}.json`);
  writeFileSync(file, JSON.stringify(job, null, 2), "utf8");
  return file;
}

export function listRecentJobs(limit = 20): JobLog[] {
  const paths = ensureMarketDirs("sa");
  if (!existsSync(paths.jobs)) return [];
  const days = readdirSync(paths.jobs)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();
  const out: JobLog[] = [];
  for (const day of days) {
    const dir = join(paths.jobs, day);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    for (const f of files) {
      try {
        out.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as JobLog);
      } catch {
        /* skip */
      }
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function listInboxFiles() {
  const paths = ensureMarketDirs("sa");
  if (!existsSync(paths.inbox)) return [];
  return readdirSync(paths.inbox)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(paths.inbox, f));
}
