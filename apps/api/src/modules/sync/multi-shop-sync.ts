/**
 * 多店同步选型：能批则批的阶段由 assembly 遍历；
 * Noon Impex 错峰，每轮只挑一家。
 */
import type { AppState } from "../../common/types.js";
import { isImpexCoolingDown } from "../../platforms/noon/impex-client.js";
import { loadRegistry } from "../../shops/registry.js";
import type { ShopRecord } from "../../shops/types.js";
import { getShopState } from "../../shops/state-cache.js";
import { needsCatalogImpexRefresh } from "./live-impex-domains.js";

/** 可参与后台同步的店（排除 mock） */
export function listEligibleSyncShops(): ShopRecord[] {
  return loadRegistry().shops.filter((s) => s.noonMode !== "mock");
}

/** 可打 Partner API Impex 的店 */
export function listLiveImpexShops(): ShopRecord[] {
  return listEligibleSyncShops().filter((s) => {
    if (s.noonMode !== "live") return false;
    const state = getShopState(s.id);
    return state.noon.enabled !== false;
  });
}

/**
 * 饥饿分：越高越优先补 Impex。
 * 空 catalog ≫ 缺 sales/fees ≫ catalog 过期 ≫ 距上次拉取越久
 */
export function shopNoonHungerScore(state: AppState, nowMs = Date.now()): number {
  let score = 0;
  if (state.catalog.length === 0) score += 1000;
  if (state.salesFacts.length === 0) score += 100;
  if (state.feeSnapshots.length === 0) score += 50;
  if (needsCatalogImpexRefresh(state, nowMs)) score += 30;
  const last =
    state.noon?.portal?.lastFetchAt ??
    state.syncJobs.find((j) => j.domain === "sales")?.lastSuccessAt ??
    null;
  if (!last) {
    score += 20;
  } else {
    const ms = Date.parse(last);
    if (!Number.isNaN(ms)) {
      score += Math.min(20, Math.floor((nowMs - ms) / (60 * 60 * 1000)));
    }
  }
  return score;
}

export type PickNoonImpexShopOpts = {
  /** 手动汇总：优先当前 UI 店 */
  preferShopId?: string | null;
  /** 跳过冷却中的店 */
  skipCooling?: boolean;
};

/**
 * 选出本周期唯一要打 Impex 的店。
 * 手动：prefer 存在且可跑 → 用 prefer；否则最饿。
 * 调度：最饿（冷却跳过）。
 */
export function pickNoonImpexShopId(
  opts: PickNoonImpexShopOpts = {},
): string | null {
  const shops = listLiveImpexShops();
  if (shops.length === 0) return null;

  const usable = opts.skipCooling
    ? shops.filter((s) => !isImpexCoolingDown(s.id))
    : shops;
  if (usable.length === 0) return null;

  const prefer = opts.preferShopId?.trim();
  if (prefer && usable.some((s) => s.id === prefer)) {
    return prefer;
  }

  let bestId = usable[0]!.id;
  let bestScore = -1;
  for (const s of usable) {
    const score = shopNoonHungerScore(getShopState(s.id));
    if (score > bestScore) {
      bestScore = score;
      bestId = s.id;
    }
  }
  return bestId;
}

/**
 * 从 startIndex 起环形找下一家可跑 Impex 的店（冷却则跳过）。
 * 返回选中店与下一轮起点下标。
 */
export function pickNextLiveShopRoundRobin(
  startIndex: number,
): { shop: ShopRecord; nextIndex: number } | null {
  const shops = listLiveImpexShops();
  if (shops.length === 0) return null;
  const n = shops.length;
  const start = ((startIndex % n) + n) % n;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    const shop = shops[idx]!;
    if (isImpexCoolingDown(shop.id)) continue;
    return { shop, nextIndex: (idx + 1) % n };
  }
  return null;
}
