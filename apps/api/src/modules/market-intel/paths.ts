import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { OUTPOST_ROOT } from "../../shops/registry.js";
import type { MarketCode } from "./types.js";

export function marketRoot(market: MarketCode = "sa") {
  return join(OUTPOST_ROOT, "market-imports", "noon", market);
}

export function marketPaths(market: MarketCode = "sa") {
  const root = marketRoot(market);
  return {
    root,
    config: join(root, "config.json"),
    watchlist: join(root, "watchlist.json"),
    discover: join(root, "discover"),
    products: join(root, "products"),
    sellers: join(root, "sellers"),
    reviews: join(root, "reviews"),
    brandRegistry: join(root, "brand-registry.json"),
    jobs: join(root, "jobs"),
    /** 影刀 / 外部投递热目录：放入 *.json 后可 ingest */
    inbox: join(root, "inbox"),
    alerts: join(root, "alerts"),
    reports: join(root, "reports"),
  };
}

export function ensureMarketDirs(market: MarketCode = "sa") {
  const p = marketPaths(market);
  for (const dir of [
    p.root,
    p.discover,
    p.products,
    p.sellers,
    p.reviews,
    p.jobs,
    p.inbox,
    join(p.inbox, "yingdao"),
    join(p.inbox, "extension"),
    p.alerts,
    p.reports,
  ]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return p;
}

export function dayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function stamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

export function resolveOutpostRoot() {
  return resolve(OUTPOST_ROOT);
}
