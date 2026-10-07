import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCollect } from "./collect.js";
import { loadConfig } from "./config.js";
import {
  extractProductsFromPayload,
  normalizeFlatProducts,
} from "./parse-products.js";
import { ensureMarketDirs, stamp } from "./paths.js";
import {
  upsertWatchlistFromDiscover,
  writeDiscoverRaw,
  writeJobLog,
  persistSellerIntel,
} from "./store.js";
import type { CollectChannel, JobLog } from "./types.js";

/** 插件/影刀 HTTP 投递 → 监控池；上线时可自动采集 */
export async function ingestExtensionPayload(body: {
  categoryId?: string;
  source?: "extension" | "yingdao";
  products?: unknown[];
  payload?: unknown;
}): Promise<{ ingest: JobLog; collect: JobLog | null }> {
  const startedAt = new Date().toISOString();
  const id = randomUUID().slice(0, 8);
  const cfg = loadConfig();
  const channel: CollectChannel =
    body.source === "yingdao" ? "yingdao" : "extension";
  const categoryId = body.categoryId ?? "extension-capture";
  const paths = ensureMarketDirs("sa");
  const dir = join(paths.inbox, channel === "yingdao" ? "yingdao" : "extension");
  mkdirSync(dir, { recursive: true });

  const file = join(dir, `${categoryId}_${stamp()}.json`);
  const envelope = {
    platform: "noon",
    market: "sa",
    source: channel,
    categoryId,
    capturedAt: startedAt,
    products: body.products,
    payload: body.payload,
  };
  writeFileSync(file, JSON.stringify(envelope, null, 2), "utf8");
  writeDiscoverRaw(categoryId, envelope, channel);

  let products = body.products?.length
    ? normalizeFlatProducts(body.products, {
        categoryId,
        currency: cfg.currency,
        baseUrl: cfg.baseUrl,
        topN: cfg.topN,
      })
    : [];
  if (products.length === 0 && body.payload != null) {
    products = extractProductsFromPayload(body.payload, {
      categoryId,
      currency: cfg.currency,
      baseUrl: cfg.baseUrl,
      topN: cfg.topN,
    });
  }
  if (products.length === 0 && body.products?.length) {
    products = extractProductsFromPayload(body.products, {
      categoryId,
      currency: cfg.currency,
      baseUrl: cfg.baseUrl,
      topN: cfg.topN,
    });
  }

  const up =
    products.length > 0
      ? upsertWatchlistFromDiscover(products, channel)
      : { added: 0, updated: 0 };
  const sellerStats =
    products.length > 0 ? persistSellerIntel(products, channel) : { sellers: 0, reviews: 0 };

  const ingest: JobLog = {
    id,
    kind: "ingest",
    market: "sa",
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: products.length > 0,
    channel,
    message:
      products.length > 0
        ? `ingest ${channel}: ${products.length} products (added=${up.added} updated=${up.updated} sellers=${sellerStats.sellers} reviews=${sellerStats.reviews})`
        : `ingest ${channel}: 0 products parsed from payload`,
    stats: {
      listed: products.length,
      added: up.added,
      updated: up.updated,
      sellers: sellerStats.sellers,
      reviews: sellerStats.reviews,
    },
    errors: products.length ? [] : ["no products parsed"],
  };
  writeJobLog(ingest);

  let collect: JobLog | null = null;
  if (ingest.ok && cfg.autoCollectAfterIngest) {
    collect = await runCollect({
      limit: Math.max(products.length, cfg.topN),
    });
  }
  return { ingest, collect };
}
