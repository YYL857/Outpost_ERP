import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureMarketDirs, marketPaths } from "./paths.js";
import type {
  CategoryFitnessThresholds,
  CollectChannel,
  MarketIntelConfig,
} from "./types.js";
import { DEFAULT_FITNESS_THRESHOLDS } from "./types.js";

function nowIso() {
  return new Date().toISOString();
}

function envAllowMock(): boolean | undefined {
  const v = process.env.MARKET_INTEL_ALLOW_MOCK?.trim().toLowerCase();
  if (!v) return undefined;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}

export function resolveAllowMock(fileValue?: boolean): boolean {
  const fromEnv = envAllowMock();
  if (fromEnv !== undefined) return fromEnv;
  if (typeof fileValue === "boolean") return fileValue;
  return false;
}

export function resolveFitnessThresholds(
  cfg?: Pick<MarketIntelConfig, "fitness"> | null,
): CategoryFitnessThresholds {
  return {
    ...DEFAULT_FITNESS_THRESHOLDS,
    ...(cfg?.fitness ?? {}),
  };
}

const LIVE_CHANNELS: CollectChannel[] = ["yingdao", "extension", "inbox"];

function sanitizeChannel(
  ch: string | undefined,
  fallback: CollectChannel,
): CollectChannel {
  if (ch === "http") return fallback; // 剔除已证实 403 的直连
  if (ch === "yingdao" || ch === "extension" || ch === "inbox" || ch === "mock") {
    return ch;
  }
  return fallback;
}

export function defaultConfig(): MarketIntelConfig {
  const base = "https://www.noon.com/saudi-en";
  const cats = [
    {
      id: "electronics-and-mobiles",
      path: "electronics-and-mobiles",
      title: "Electronics & Mobiles",
      priority: 1,
    },
    {
      id: "beauty-and-health",
      path: "beauty-and-health",
      title: "Beauty & Health",
      priority: 2,
    },
    {
      id: "home-and-kitchen",
      path: "home-and-kitchen",
      title: "Home & Kitchen",
      priority: 3,
    },
    {
      id: "fashion-men",
      path: "fashion-men",
      title: "Fashion Men",
      priority: 4,
    },
    {
      id: "baby",
      path: "baby",
      title: "Baby",
      priority: 5,
    },
  ];

  return {
    version: 1,
    opsVersion: 2,
    market: "sa",
    locale: "saudi-en",
    currency: "SAR",
    baseUrl: base,
    topN: 50,
    categories: cats.map((c) => ({
      ...c,
      url: `${base}/${c.path}/`,
      enabled: true,
    })),
    primaryChannel: "yingdao",
    fallbackChannel: "extension",
    allowMock: false,
    autoCollectAfterDiscover: true,
    autoCollectAfterIngest: true,
    inboxWatchEnabled: true,
    inboxWatchEveryMs: 30_000,
    scheduler: {
      enabled: true,
      discoverEveryMs: 6 * 60 * 60 * 1000,
      collectEveryMs: 6 * 60 * 60 * 1000,
    },
    fitness: { ...DEFAULT_FITNESS_THRESHOLDS },
    updatedAt: nowIso(),
  };
}

export function loadConfig(): MarketIntelConfig {
  const paths = ensureMarketDirs("sa");
  if (!existsSync(paths.config)) {
    const cfg = defaultConfig();
    cfg.allowMock = resolveAllowMock(cfg.allowMock);
    writeFileSync(paths.config, JSON.stringify(cfg, null, 2), "utf8");
    return cfg;
  }
  const raw = JSON.parse(readFileSync(paths.config, "utf8")) as MarketIntelConfig;
  const merged: MarketIntelConfig = {
    ...defaultConfig(),
    ...raw,
    categories: raw.categories?.length
      ? raw.categories
      : defaultConfig().categories,
    fitness: resolveFitnessThresholds(raw),
  };
  merged.primaryChannel = sanitizeChannel(merged.primaryChannel, "yingdao");
  merged.fallbackChannel = sanitizeChannel(merged.fallbackChannel, "extension");
  merged.allowMock = resolveAllowMock(merged.allowMock);
  return merged;
}

export function migrateConfigToLiveDefaults() {
  const paths = ensureMarketDirs("sa");
  if (!existsSync(paths.config)) {
    return loadConfig();
  }
  const raw = JSON.parse(readFileSync(paths.config, "utf8")) as MarketIntelConfig;
  const fromEnv = envAllowMock();
  if (fromEnv !== undefined) raw.allowMock = fromEnv;
  else if (raw.allowMock === true && raw.primaryChannel !== "mock") {
    raw.allowMock = false;
  }
  raw.primaryChannel = sanitizeChannel(raw.primaryChannel as string, "yingdao");
  raw.fallbackChannel = sanitizeChannel(raw.fallbackChannel as string, "extension");
  if (raw.primaryChannel === "mock" || raw.primaryChannel === "inbox") {
    raw.primaryChannel = "yingdao";
  }
  if (raw.fallbackChannel === "mock" || raw.fallbackChannel === "inbox") {
    raw.fallbackChannel = "extension";
  }
  if (!LIVE_CHANNELS.includes(raw.primaryChannel) && raw.primaryChannel !== "mock") {
    raw.primaryChannel = "yingdao";
  }
  const ops = raw.opsVersion ?? 1;
  if (ops < 2) {
    raw.autoCollectAfterDiscover = true;
    raw.autoCollectAfterIngest = true;
    raw.inboxWatchEnabled = true;
    raw.inboxWatchEveryMs = raw.inboxWatchEveryMs ?? 30_000;
    raw.scheduler = {
      enabled: true,
      discoverEveryMs: raw.scheduler?.discoverEveryMs ?? 6 * 60 * 60 * 1000,
      collectEveryMs: raw.scheduler?.collectEveryMs ?? 6 * 60 * 60 * 1000,
    };
    raw.opsVersion = 2;
  }
  if (raw.autoCollectAfterDiscover == null) raw.autoCollectAfterDiscover = true;
  if (raw.autoCollectAfterIngest == null) raw.autoCollectAfterIngest = true;
  if (raw.inboxWatchEnabled == null) raw.inboxWatchEnabled = true;
  if (raw.inboxWatchEveryMs == null) raw.inboxWatchEveryMs = 30_000;
  raw.updatedAt = nowIso();
  writeFileSync(paths.config, JSON.stringify(raw, null, 2), "utf8");
  return loadConfig();
}

export function saveConfig(cfg: MarketIntelConfig) {
  const paths = marketPaths("sa");
  ensureMarketDirs("sa");
  const next = {
    ...cfg,
    primaryChannel: sanitizeChannel(cfg.primaryChannel, "yingdao"),
    fallbackChannel: sanitizeChannel(cfg.fallbackChannel, "extension"),
    allowMock: resolveAllowMock(cfg.allowMock),
    updatedAt: nowIso(),
  };
  writeFileSync(paths.config, JSON.stringify(next, null, 2), "utf8");
  return next;
}
