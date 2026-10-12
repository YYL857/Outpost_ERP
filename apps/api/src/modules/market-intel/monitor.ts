/**
 * 竞品盯价：观测落盘 + 置信打分 + 双次同向确认告警。
 * 与选品 watchlist 分离；扩展为主通道。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ensureMarketDirs, marketPaths, stamp } from "./paths.js";
import { isPlausiblePrice, looksPromoTitle } from "./signal-quality.js";
import type {
  ConfidenceTier,
  MonitorPoolFile,
  MonitorTarget,
  ObservationSource,
  ParseMethod,
  PendingPriceChange,
  PriceAlert,
  PriceObservation,
} from "./types.js";

const MIN_CHANGE_PCT = 0.03;
const MIN_CHANGE_ABS = 5;
/** 二次确认：价相对首次变化后的目标价容差 */
const CONFIRM_TOLERANCE = 0.015;
/** 仅 mid/high 可参与告警链路 */
const ALERT_CONF_FLOOR = 0.55;

function nowIso() {
  return new Date().toISOString();
}

function tierOf(confidence: number): ConfidenceTier {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.55) return "mid";
  return "low";
}

export function scorePriceObservation(input: {
  price: number | null;
  title: string;
  source: ObservationSource;
  parseMethod: ParseMethod;
  promoText?: string | null;
}): { confidence: number; tier: ConfidenceTier; flags: string[] } {
  const flags: string[] = [];
  let conf = 0.5;

  if (input.source === "extension") conf += 0.2;
  else if (input.source === "manual") conf += 0.25;
  else if (input.source === "yingdao") conf += 0.1;

  if (input.parseMethod === "json_ld" || input.parseMethod === "dom") conf += 0.15;
  else if (input.parseMethod === "manual") conf += 0.2;
  else if (input.parseMethod === "regex") {
    conf -= 0.1;
    flags.push("parse_regex");
  } else if (input.parseMethod === "llm") {
    conf -= 0.2;
    flags.push("parse_llm");
  }

  if (looksPromoTitle(input.title)) {
    conf -= 0.25;
    flags.push("promo_title");
  }
  if (input.promoText?.trim()) flags.push("has_promo");

  if (input.price == null || !(input.price > 0)) {
    conf = Math.min(conf, 0.2);
    flags.push("missing_price");
  } else if (!isPlausiblePrice(input.price, input.title)) {
    conf = Math.min(conf, 0.35);
    flags.push("implausible_price");
  }

  conf = Math.max(0, Math.min(1, conf));
  return { confidence: conf, tier: tierOf(conf), flags };
}

function emptyPool(): MonitorPoolFile {
  return {
    version: 1,
    market: "sa",
    updatedAt: nowIso(),
    items: [],
    pendingChanges: [],
  };
}

export function loadMonitorPool(): MonitorPoolFile {
  ensureMarketDirs("sa");
  const path = marketPaths("sa").monitorPool;
  if (!existsSync(path)) {
    const empty = emptyPool();
    writeFileSync(path, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as MonitorPoolFile;
  if (!Array.isArray(raw.pendingChanges)) raw.pendingChanges = [];
  if (!Array.isArray(raw.items)) raw.items = [];
  return raw;
}

export function saveMonitorPool(file: MonitorPoolFile): MonitorPoolFile {
  ensureMarketDirs("sa");
  const next = { ...file, updatedAt: nowIso() };
  writeFileSync(
    marketPaths("sa").monitorPool,
    JSON.stringify(next, null, 2),
    "utf8",
  );
  return next;
}

export function listMonitorTargets(opts?: { activeOnly?: boolean }): MonitorTarget[] {
  const items = loadMonitorPool().items;
  if (opts?.activeOnly) return items.filter((i) => i.status === "active");
  return items;
}

export function upsertMonitorTarget(input: {
  productKey: string;
  url: string;
  title?: string;
  note?: string;
  addedFrom?: MonitorTarget["addedFrom"];
  status?: MonitorTarget["status"];
}): MonitorTarget {
  const pool = loadMonitorPool();
  const key = input.productKey.trim();
  if (!key) throw new Error("productKey required");
  const idx = pool.items.findIndex((i) => i.productKey === key);
  const now = nowIso();
  if (idx >= 0) {
    const prev = pool.items[idx]!;
    const next: MonitorTarget = {
      ...prev,
      url: input.url.trim() || prev.url,
      title: (input.title ?? prev.title).trim() || prev.title,
      note: input.note ?? prev.note,
      status: input.status ?? prev.status,
    };
    pool.items[idx] = next;
    saveMonitorPool(pool);
    return next;
  }
  const created: MonitorTarget = {
    productKey: key,
    url: input.url.trim(),
    title: (input.title ?? key).trim() || key,
    note: input.note,
    addedAt: now,
    addedFrom: input.addedFrom ?? "manual",
    status: input.status ?? "active",
    lastPrice: null,
    lastConfidence: null,
    lastCapturedAt: null,
    lastTier: null,
  };
  pool.items.push(created);
  saveMonitorPool(pool);
  return created;
}

export function removeMonitorTarget(productKey: string): boolean {
  const pool = loadMonitorPool();
  const before = pool.items.length;
  pool.items = pool.items.filter((i) => i.productKey !== productKey);
  pool.pendingChanges = pool.pendingChanges.filter(
    (p) => p.productKey !== productKey,
  );
  if (pool.items.length === before) return false;
  saveMonitorPool(pool);
  return true;
}

function obsDir(productKey: string) {
  const safe = productKey.replace(/[^\w.-]+/g, "_").slice(0, 80);
  const dir = join(marketPaths("sa").observations, safe);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function appendObservation(obs: PriceObservation) {
  const dir = obsDir(obs.productKey);
  const file = join(dir, `${stamp()}_${obs.id}.json`);
  writeFileSync(file, JSON.stringify(obs, null, 2), "utf8");
}

export function listObservations(
  productKey: string,
  limit = 40,
): PriceObservation[] {
  const dir = join(
    marketPaths("sa").observations,
    productKey.replace(/[^\w.-]+/g, "_").slice(0, 80),
  );
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);
  const out: PriceObservation[] = [];
  for (const f of files) {
    try {
      out.push(
        JSON.parse(readFileSync(join(dir, f), "utf8")) as PriceObservation,
      );
    } catch {
      /* skip */
    }
  }
  return out;
}

function materialChange(
  from: number,
  to: number,
): { direction: "down" | "up"; changePct: number } | null {
  const delta = to - from;
  const changePct = from > 0 ? delta / from : 0;
  if (Math.abs(delta) < MIN_CHANGE_ABS && Math.abs(changePct) < MIN_CHANGE_PCT) {
    return null;
  }
  return { direction: delta < 0 ? "down" : "up", changePct };
}

function sameDirectionConfirm(
  pending: PendingPriceChange,
  newPrice: number,
): boolean {
  if (pending.direction === "down") {
    return newPrice <= pending.toPrice * (1 + CONFIRM_TOLERANCE);
  }
  return newPrice >= pending.toPrice * (1 - CONFIRM_TOLERANCE);
}

function writeAlert(alert: PriceAlert) {
  ensureMarketDirs("sa");
  const file = join(marketPaths("sa").alerts, `${stamp()}_${alert.id}.json`);
  writeFileSync(file, JSON.stringify(alert, null, 2), "utf8");
}

export function listPriceAlerts(opts?: {
  limit?: number;
  status?: PriceAlert["status"];
}): PriceAlert[] {
  ensureMarketDirs("sa");
  const dir = marketPaths("sa").alerts;
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, opts?.limit ?? 50);
  const out: PriceAlert[] = [];
  for (const f of files) {
    try {
      const a = JSON.parse(readFileSync(join(dir, f), "utf8")) as PriceAlert;
      if (opts?.status && a.status !== opts.status) continue;
      out.push(a);
    } catch {
      /* skip */
    }
  }
  return out;
}

export function ackPriceAlert(alertId: string): PriceAlert | null {
  ensureMarketDirs("sa");
  const dir = marketPaths("sa").alerts;
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const path = join(dir, f);
    try {
      const a = JSON.parse(readFileSync(path, "utf8")) as PriceAlert;
      if (a.id !== alertId) continue;
      a.status = "acked";
      writeFileSync(path, JSON.stringify(a, null, 2), "utf8");
      return a;
    } catch {
      /* skip */
    }
  }
  return null;
}

export type IngestPriceInput = {
  productKey: string;
  url: string;
  title?: string;
  price: number | null;
  currency?: string;
  promoText?: string | null;
  inStock?: boolean | null;
  source?: ObservationSource;
  parseMethod?: ParseMethod;
  /** 采价时自动 upsert 进监控池 */
  ensureTarget?: boolean;
};

export type IngestPriceResult = {
  observation: PriceObservation;
  alert: PriceAlert | null;
  pending: PendingPriceChange | null;
  skippedAlertReason: string | null;
};

/**
 * 入库一条价观测；仅 high/mid + 双次同向才出告警。
 * 纯函数核心见 evaluatePriceAlertTransition（可测）。
 */
export function ingestPriceObservation(
  input: IngestPriceInput,
): IngestPriceResult {
  ensureMarketDirs("sa");
  const productKey = input.productKey.trim();
  if (!productKey) throw new Error("productKey required");
  const url = (input.url || "").trim();
  if (!url) throw new Error("url required");
  const title = (input.title ?? productKey).trim() || productKey;
  const source = input.source ?? "extension";
  const parseMethod = input.parseMethod ?? "dom";
  const scored = scorePriceObservation({
    price: input.price,
    title,
    source,
    parseMethod,
    promoText: input.promoText,
  });

  const observation: PriceObservation = {
    id: `obs_${stamp()}`,
    productKey,
    url,
    title,
    price: input.price,
    currency: input.currency ?? "SAR",
    promoText: input.promoText?.trim() || null,
    inStock: input.inStock ?? null,
    confidence: scored.confidence,
    tier: scored.tier,
    source,
    parseMethod,
    flags: scored.flags,
    capturedAt: nowIso(),
  };
  appendObservation(observation);

  if (input.ensureTarget !== false) {
    upsertMonitorTarget({
      productKey,
      url,
      title,
      addedFrom: source === "extension" ? "extension" : "manual",
    });
  }

  const pool = loadMonitorPool();
  const idx = pool.items.findIndex((i) => i.productKey === productKey);
  const prevTarget = idx >= 0 ? pool.items[idx]! : null;
  const prevPrice = prevTarget?.lastPrice ?? null;
  const pendingPrev =
    pool.pendingChanges.find((p) => p.productKey === productKey) ?? null;

  const transition = evaluatePriceAlertTransition({
    prevPrice,
    pending: pendingPrev,
    observation,
  });

  let pendingChanges = pool.pendingChanges.filter(
    (p) => p.productKey !== productKey,
  );
  if (transition.pending) pendingChanges.push(transition.pending);

  if (idx >= 0) {
    pool.items[idx] = {
      ...pool.items[idx]!,
      title,
      url,
      lastPrice: observation.price,
      lastConfidence: observation.confidence,
      lastCapturedAt: observation.capturedAt,
      lastTier: observation.tier,
    };
  }
  pool.pendingChanges = pendingChanges;
  saveMonitorPool(pool);

  if (transition.alert) {
    writeAlert(transition.alert);
  }

  return {
    observation,
    alert: transition.alert,
    pending: transition.pending,
    skippedAlertReason: transition.skippedAlertReason,
  };
}

/** 可单测的告警状态机 */
export function evaluatePriceAlertTransition(args: {
  prevPrice: number | null;
  pending: PendingPriceChange | null;
  observation: PriceObservation;
}): {
  pending: PendingPriceChange | null;
  alert: PriceAlert | null;
  skippedAlertReason: string | null;
} {
  const { prevPrice, pending, observation } = args;
  const price = observation.price;

  if (price == null || !(price > 0)) {
    return {
      pending,
      alert: null,
      skippedAlertReason: "missing_price",
    };
  }
  if (
    observation.tier === "low" ||
    observation.confidence < ALERT_CONF_FLOOR ||
    observation.flags.includes("implausible_price") ||
    observation.flags.includes("promo_title")
  ) {
    return {
      pending: null,
      alert: null,
      skippedAlertReason: "low_confidence",
    };
  }

  // 已有 pending：二次确认
  if (pending) {
    if (sameDirectionConfirm(pending, price)) {
      const changePct =
        pending.fromPrice > 0
          ? (price - pending.fromPrice) / pending.fromPrice
          : 0;
      const alert: PriceAlert = {
        id: `alert_${stamp()}`,
        productKey: observation.productKey,
        url: observation.url,
        title: observation.title,
        fromPrice: pending.fromPrice,
        toPrice: price,
        changePct,
        direction: pending.direction,
        confirmedAt: observation.capturedAt,
        observationIds: [pending.firstObsId, observation.id],
        status: "open",
        tier: observation.tier,
      };
      return { pending: null, alert, skippedAlertReason: null };
    }
    // 反向或回弹 → 取消 pending，按新观测重新评估
    const vsPrev = materialChange(pending.fromPrice, price);
    if (!vsPrev) {
      return { pending: null, alert: null, skippedAlertReason: "reverted" };
    }
    return {
      pending: {
        productKey: observation.productKey,
        fromPrice: pending.fromPrice,
        toPrice: price,
        direction: vsPrev.direction,
        firstObsId: observation.id,
        firstCapturedAt: observation.capturedAt,
      },
      alert: null,
      skippedAlertReason: "direction_reset",
    };
  }

  if (prevPrice == null || !(prevPrice > 0)) {
    return {
      pending: null,
      alert: null,
      skippedAlertReason: "no_baseline",
    };
  }

  const change = materialChange(prevPrice, price);
  if (!change) {
    return {
      pending: null,
      alert: null,
      skippedAlertReason: "immaterial",
    };
  }

  return {
    pending: {
      productKey: observation.productKey,
      fromPrice: prevPrice,
      toPrice: price,
      direction: change.direction,
      firstObsId: observation.id,
      firstCapturedAt: observation.capturedAt,
    },
    alert: null,
    skippedAlertReason: "awaiting_confirm",
  };
}

export function monitorSummary() {
  const pool = loadMonitorPool();
  const alerts = listPriceAlerts({ limit: 100 });
  return {
    targets: pool.items.length,
    active: pool.items.filter((i) => i.status === "active").length,
    pendingChanges: pool.pendingChanges.length,
    openAlerts: alerts.filter((a) => a.status === "open").length,
  };
}
