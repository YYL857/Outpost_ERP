import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { basename, join } from "node:path";
import { loadConfig } from "./config.js";
import {
  extractProductsFromPayload,
  normalizeFlatProducts,
} from "./parse-products.js";
import { dayStamp, ensureMarketDirs, marketPaths, stamp } from "./paths.js";
import { writeDiscoverRaw, persistSellerIntel } from "./store.js";
import type { CollectChannel, DiscoveredProduct } from "./types.js";

export type InboxKind = "yingdao" | "extension";

export function inboxDir(kind: InboxKind) {
  const paths = ensureMarketDirs("sa");
  const dir = join(paths.inbox, kind);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function listPendingInboxFiles(kind: InboxKind): string[] {
  const dir = inboxDir(kind);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f.toLowerCase() !== "readme.json")
    .map((f) => join(dir, f));
}

export function countPendingInbox() {
  return {
    yingdao: listPendingInboxFiles("yingdao").length,
    extension: listPendingInboxFiles("extension").length,
  };
}

function parseProductsFromFile(
  file: string,
  fallbackCategoryId: string,
): DiscoveredProduct[] {
  const cfg = loadConfig();
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const categoryId =
    (typeof rec.categoryId === "string" && rec.categoryId) ||
    fallbackCategoryId;

  const opts = {
    categoryId,
    currency: cfg.currency,
    baseUrl: cfg.baseUrl,
    // hotList 可能到 topN；深采 products 通常更少，合并时放宽上限
    topN: Math.max(cfg.topN, 80),
  };

  const byKey = new Map<string, DiscoveredProduct>();
  const mergeIn = (rows: DiscoveredProduct[]) => {
    for (const p of rows) {
      const prev = byKey.get(p.productKey);
      if (!prev) {
        byKey.set(p.productKey, p);
        continue;
      }
      byKey.set(p.productKey, {
        ...prev,
        ...Object.fromEntries(
          Object.entries(p).filter(([, v]) => v != null && v !== "" && v !== false),
        ),
        soldRecently: p.soldRecently ?? prev.soldRecently ?? null,
        soldRecentlyText: p.soldRecentlyText ?? prev.soldRecentlyText ?? null,
        isBestSeller: Boolean(p.isBestSeller || prev.isBestSeller),
        isAd: Boolean(p.isAd || prev.isAd),
        seller: p.seller ?? prev.seller,
        reviews: (p.reviews?.length ? p.reviews : prev.reviews) ?? [],
        brandTier: p.brandTier && p.brandTier !== "unknown" ? p.brandTier : prev.brandTier,
      });
    }
  };

  if (Array.isArray(rec.products)) {
    const flat = normalizeFlatProducts(rec.products, opts);
    mergeIn(flat.length ? flat : extractProductsFromPayload(rec.products, opts));
  }
  // 列表热度信号：品类适销依赖完整 hotList（含大牌位）
  const hot =
    (Array.isArray(rec.hotList) && rec.hotList) ||
    (Array.isArray(rec.hot_list) && rec.hot_list) ||
    null;
  if (hot) {
    mergeIn(normalizeFlatProducts(hot, opts));
  }
  if (byKey.size === 0 && rec.payload != null) {
    mergeIn(extractProductsFromPayload(rec.payload, opts));
  }
  if (byKey.size === 0) {
    mergeIn(extractProductsFromPayload(raw, opts));
  }
  return [...byKey.values()].slice(0, opts.topN);
}

function archiveInboxFile(kind: InboxKind, file: string) {
  const paths = marketPaths("sa");
  const processed = join(paths.inbox, kind, "processed", dayStamp());
  if (!existsSync(processed)) mkdirSync(processed, { recursive: true });
  try {
    renameSync(file, join(processed, `${stamp()}_${basename(file)}`));
  } catch {
    /* busy */
  }
}

export type DrainResult = {
  channel: CollectChannel;
  files: number;
  products: DiscoveredProduct[];
  errors: string[];
};

/** 清空某一投递目录下所有待处理 JSON（按文件内 categoryId 解析） */
export function drainInboxKind(kind: InboxKind): DrainResult {
  const channel: CollectChannel = kind;
  const files = listPendingInboxFiles(kind);
  const products: DiscoveredProduct[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const guessed =
        basename(file)
          .replace(/\.json$/i, "")
          .split("_")[0] || "unknown";
      const parsed = parseProductsFromFile(file, guessed);
      if (parsed.length === 0) {
        errors.push(`${basename(file)}: 0 products`);
      } else {
        products.push(...parsed);
        writeDiscoverRaw(
          parsed[0]!.categoryId,
          { file, kind, count: parsed.length },
          channel,
        );
        persistSellerIntel(parsed, channel);
      }
      archiveInboxFile(kind, file);
    } catch (e) {
      errors.push(
        `${basename(file)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { channel, files: files.length, products, errors };
}
