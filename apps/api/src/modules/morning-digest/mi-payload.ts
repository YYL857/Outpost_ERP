/**
 * 市场情报晨报：从 watchlist 压载荷（只读）。
 */
import { loadWatchlist } from "../market-intel/store.js";
import type { WatchlistItem } from "../market-intel/types.js";
import type { MiReadiness } from "./readiness.js";
import { shanghaiParts } from "./clock.js";

export type MiDigestItem = {
  productKey: string;
  title: string;
  titleZh: string | null;
  categoryId: string;
  price: number | null;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  soldRecently: number | null;
  isBestSeller: boolean;
  isAd: boolean;
  brandTier: string;
  sellerName: string | null;
  lastSeenAt: string;
  discoveredAt: string;
};

export type MiDigestPayload = {
  kind: "market-intel";
  market: string;
  asOf: string;
  today: string;
  softNotes: string[];
  overview: {
    watchlistTotal: number;
    freshItemCount: number;
    bestSellerFresh: number;
  };
  freshTop: MiDigestItem[];
  bestSellers: MiDigestItem[];
};

function compact(item: WatchlistItem): MiDigestItem {
  return {
    productKey: item.productKey,
    title: (item.title || item.productKey).slice(0, 100),
    titleZh: item.titleZh?.trim() || null,
    categoryId: item.categoryId,
    price: item.price,
    currency: item.currency,
    rating: item.rating,
    reviewCount: item.reviewCount,
    soldRecently: item.soldRecently,
    isBestSeller: item.isBestSeller,
    isAd: item.isAd,
    brandTier: item.brandTier,
    sellerName: item.seller?.sellerName ?? null,
    lastSeenAt: item.lastSeenAt,
    discoveredAt: item.discoveredAt,
  };
}

function isFresh(item: WatchlistItem, today: string): boolean {
  const days = [
    shanghaiParts(new Date(item.lastSeenAt)).day,
    shanghaiParts(new Date(item.discoveredAt)).day,
    item.lastSnapshotAt
      ? shanghaiParts(new Date(item.lastSnapshotAt)).day
      : null,
  ];
  return days.some((d) => d === today);
}

export function buildMiDigestPayload(
  readiness: MiReadiness,
  opts?: { topN?: number },
): MiDigestPayload {
  const topN = opts?.topN ?? 15;
  const wl = loadWatchlist();
  const fresh = wl.items.filter((i) => isFresh(i, readiness.today));

  const freshTop = [...fresh]
    .sort(
      (a, b) =>
        (b.soldRecently ?? 0) - (a.soldRecently ?? 0) ||
        (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
    )
    .slice(0, topN)
    .map(compact);

  const bestSellers = [...fresh]
    .filter((i) => i.isBestSeller)
    .sort((a, b) => (b.soldRecently ?? 0) - (a.soldRecently ?? 0))
    .slice(0, Math.min(10, topN))
    .map(compact);

  return {
    kind: "market-intel",
    market: wl.market,
    asOf: new Date().toISOString(),
    today: readiness.today,
    softNotes: readiness.softNotes,
    overview: {
      watchlistTotal: wl.items.length,
      freshItemCount: fresh.length,
      bestSellerFresh: bestSellers.length,
    },
    freshTop,
    bestSellers,
  };
}
