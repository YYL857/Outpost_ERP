import type { AppState } from "../../common/types.js";
import { isImpexCoolingDown } from "../../platforms/noon/impex-client.js";
import { runAutoIngest } from "../../platforms/noon/portal/auto-ingest.js";
import {
  getShopState,
  runAsShopAsync,
  saveShopState,
} from "../../shops/state-cache.js";
import { pickLivePollDomain } from "./live-impex-domains.js";
import { refreshCatalogLivePrices } from "./live-prices.js";
import {
  listEligibleSyncShops,
  pickNextLiveShopRoundRobin,
} from "./multi-shop-sync.js";
import { notifyStockOrCatalogSynced } from "../replenish/after-stock-sync.js";
import { pullDomain } from "./pipeline.js";

/**
 * 全自动调度：
 * - live：多店错峰，每 tick 最多 1 家 Impex（约 30 分钟 20 次/账号）
 *   空 Catalog → catalog；Catalog/库存过期（默认 12h）→ 插队 catalog；
 *   否则轮转 sales → fees → orders。ads 不走 Impex（影刀 portal-imports）。
 * - portal：无 live 可跑时，轮转扫各店 portal-imports
 */
let timer: ReturnType<typeof setInterval> | null = null;
let getStateFn: (() => AppState) | null = null;
let intervalMs = 120_000;
let liveTicks = 0;
let liveRotate = 0;
let shopRotateIndex = 0;
let portalRotateIndex = 0;
let enabled = true;
let running = false;
let lastRunAt: string | null = null;
let lastMessage: string | null = null;

function liveEveryN(): number {
  return Math.max(1, Number(process.env.OUTPOST_LIVE_POLL_EVERY_N_TICKS ?? 15));
}

export function getNoonPollerStatus() {
  return {
    enabled,
    timerActive: Boolean(timer),
    everyMs: intervalMs,
    running,
    lastRunAt,
    lastMessage,
    liveEveryN: liveEveryN(),
    shopRotateIndex,
  };
}

export function stopNoonPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * @param opts.enabled 覆盖运行时启用态（默认保持当前；首次默认 true）
 * @param opts.skipInitial 为 true 时跳过启动时的 portal 初始 ingest
 */
export function startNoonPoller(
  getState: () => AppState,
  nextIntervalMs = 120_000,
  opts?: { enabled?: boolean; skipInitial?: boolean },
) {
  getStateFn = getState;
  intervalMs = Math.max(5_000, nextIntervalMs);
  if (opts?.enabled !== undefined) enabled = opts.enabled;

  stopNoonPoller();
  if (!enabled) {
    console.log("[noon-poller] disabled");
    return getNoonPollerStatus();
  }

  const state0 = getState();
  if (state0.noon.mode === "live" && state0.catalog.length > 0) {
    void refreshCatalogLivePrices(state0)
      .then((r) => {
        console.log(`[noon-poller] live prices ${r.updated}/${r.checked}`);
      })
      .catch((err) => console.error("[noon-poller] live prices", err));
  }
  if (!opts?.skipInitial) {
    if (state0.noon.mode === "live") {
      console.log(
        `[noon-poller] live: skip initial Impex (catalog=${state0.catalog.length})`,
      );
    } else {
      void runAutoIngest(getState()).catch((err) =>
        console.error("[noon-poller] initial ingest", err),
      );
    }
  }

  timer = setInterval(() => {
    void runNoonPollerTick({ force: false }).catch((err) =>
      console.error("[noon-poller] tick", err),
    );
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  console.log(
    `[noon-poller] every ${intervalMs}ms multi-shop (liveEveryN=${liveEveryN()})`,
  );
  return getNoonPollerStatus();
}

export function setNoonPollerEnabled(next: boolean) {
  enabled = next;
  if (!getStateFn) return getNoonPollerStatus();
  if (next) {
    return startNoonPoller(getStateFn, intervalMs, {
      enabled: true,
      skipInitial: true,
    });
  }
  stopNoonPoller();
  console.log("[noon-poller] stopped");
  return getNoonPollerStatus();
}

async function tickLiveShop(shopId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  return runAsShopAsync(shopId, async () => {
    const state = getShopState(shopId);
    if (!state.noon.enabled) {
      return { ok: false, message: `${shopId}: noon disabled` };
    }

    let priceNote = "";
    try {
      const prices = await refreshCatalogLivePrices(state);
      if (prices.updated > 0) {
        priceNote = ` prices ${prices.updated}/${prices.checked}`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      priceNote = ` prices failed: ${msg.slice(0, 120)}`;
      console.error(`[noon-poller] ${shopId} live prices`, err);
    }

    let ingestNote = "";
    try {
      const ingest = await runAutoIngest(state, { force: false });
      if (ingest.imported > 0) {
        ingestNote = ` portal+${ingest.imported}`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ingestNote = ` portal ingest fail: ${msg.slice(0, 80)}`;
      console.error(`[noon-poller] ${shopId} portal ingest`, err);
    }

    if (isImpexCoolingDown(shopId)) {
      saveShopState(shopId, state);
      return {
        ok: ingestNote.includes("portal+"),
        message: `${shopId}: impex cooling down${ingestNote}${priceNote}`,
      };
    }

    const domain = pickLivePollDomain(state, liveRotate);
    liveRotate += 1;
    await pullDomain(state, domain);
    saveShopState(shopId, state);
    // stock/catalog 成功 → debounce 重算补货表（与日更/按钮共用 after-stock-sync）
    notifyStockOrCatalogSynced(shopId, domain);
    return {
      ok: true,
      message: `${shopId}: live pull ${domain}${ingestNote}${priceNote}`,
    };
  });
}

async function tickPortalShop(shopId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  return runAsShopAsync(shopId, async () => {
    const state = getShopState(shopId);
    if (!state.noon.enabled) {
      return { ok: false, message: `${shopId}: noon disabled` };
    }
    await runAutoIngest(state);
    saveShopState(shopId, state);
    return { ok: true, message: `${shopId}: auto-ingest` };
  });
}

/**
 * 执行一次轮询。force=true 时绕过 live 的 N-tick 节流（手动「立即执行」）。
 * 每 tick 最多 1 家店：优先 live Impex 轮转；无可跑 live 时扫一家 portal。
 */
export async function runNoonPollerTick(opts?: {
  force?: boolean;
}): Promise<{ ok: boolean; message: string }> {
  if (!getStateFn) {
    return { ok: false, message: "poller not initialized" };
  }
  if (running) {
    return { ok: false, message: "already running" };
  }

  running = true;
  lastRunAt = new Date().toISOString();
  try {
    if (!opts?.force) {
      liveTicks += 1;
      if (liveTicks % liveEveryN() !== 0) {
        lastMessage = `skip tick ${liveTicks}/${liveEveryN()}`;
        return { ok: true, message: lastMessage };
      }
    }

    const picked = pickNextLiveShopRoundRobin(shopRotateIndex);
    if (picked) {
      shopRotateIndex = picked.nextIndex;
      const result = await tickLiveShop(picked.shop.id);
      lastMessage = result.message;
      return result;
    }

    const portalShops = listEligibleSyncShops().filter((s) => {
      if (s.noonMode === "live") return false;
      return getShopState(s.id).noon.enabled !== false;
    });
    if (portalShops.length === 0) {
      lastMessage = "no eligible shop (all live cooling or disabled)";
      return { ok: false, message: lastMessage };
    }
    const idx =
      ((portalRotateIndex % portalShops.length) + portalShops.length) %
      portalShops.length;
    const shop = portalShops[idx]!;
    portalRotateIndex = (idx + 1) % portalShops.length;
    const result = await tickPortalShop(shop.id);
    lastMessage = result.message;
    return result;
  } catch (err) {
    lastMessage = err instanceof Error ? err.message : String(err);
    console.error("[noon-poller]", err);
    return { ok: false, message: lastMessage };
  } finally {
    running = false;
  }
}

/** 测试用：重置轮转下标 */
export function resetNoonPollerRotateForTests(): void {
  shopRotateIndex = 0;
  portalRotateIndex = 0;
  liveRotate = 0;
  liveTicks = 0;
}
