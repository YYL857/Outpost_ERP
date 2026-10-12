import { join } from "node:path";
import type { AppState } from "../common/types.js";
import { applyEnvToNoon, loadState, saveState } from "../data/store.js";
import { loadEnv } from "../config/env.js";
import {
  applyShopEnv,
  getActiveShop,
  loadRegistry,
  saveRegistry,
} from "./registry.js";
import type { ShopRecord } from "./types.js";
import {
  getContextShopId,
  runWithContext,
  SYSTEM_SYNC_USER,
} from "../auth/context.js";
import { clearNoonApiGatewayCache } from "../platforms/noon/http.js";

const cache = new Map<string, AppState>();

function shopDataDir(shop: ShopRecord) {
  return join(shop.rootDir, "json");
}

function findShop(shopId: string): ShopRecord {
  const reg = loadRegistry();
  const shop = reg.shops.find((s) => s.id === shopId);
  if (!shop) throw new Error(`未知店铺: ${shopId}`);
  return shop;
}

function applyShopMeta(shop: ShopRecord, state: AppState) {
  state.store.id = shop.id;
  state.store.name = shop.name;
  state.store.account = shop.projectCode;
  state.store.platform = "NOON";
  state.noon.partnerId = shop.projectCode;
  if (shop.noonMode !== "mock") {
    state.noon.mode = shop.noonMode;
  }
}

export function loadShopStateFromDisk(shop: ShopRecord): AppState {
  const env = loadEnv();
  const loaded = applyEnvToNoon(loadState(shopDataDir(shop)), {
    ...env,
    noonPartnerId: shop.projectCode || env.noonPartnerId,
    noonCountry: shop.countryCode || env.noonCountry,
    noonMode: shop.noonMode === "mock" ? env.noonMode : shop.noonMode,
  });
  applyShopMeta(shop, loaded);
  return loaded;
}

export function getShopState(shopId: string): AppState {
  let state = cache.get(shopId);
  if (!state) {
    const shop = findShop(shopId);
    state = loadShopStateFromDisk(shop);
    cache.set(shopId, state);
  }
  return state;
}

export function setShopState(shopId: string, state: AppState) {
  cache.set(shopId, state);
}

export function saveShopState(shopId: string, state?: AppState) {
  const shop = findShop(shopId);
  const s = state ?? cache.get(shopId);
  if (!s) return;
  cache.set(shopId, s);
  saveState(s, shopDataDir(shop));
}

export function reloadShopState(shopId: string): AppState {
  const shop = findShop(shopId);
  const loaded = loadShopStateFromDisk(shop);
  cache.set(shopId, loaded);
  return loaded;
}

/** 当前请求店铺，或系统默认同步店 */
export function resolveCurrentShopId(): string {
  return getContextShopId() ?? getActiveShop().id;
}

export function getCurrentShopState(): AppState {
  return getShopState(resolveCurrentShopId());
}

export function saveCurrentShopState(state?: AppState) {
  saveShopState(resolveCurrentShopId(), state);
}

/**
 * 将 registry 默认同步店切到指定店（后台轮询 / 超管）。
 * 同时刷新进程 env 与该店网关缓存。
 */
export function setSystemActiveShop(shop: ShopRecord, persistCurrent = true) {
  const reg = loadRegistry();
  const prevId = reg.activeShopId;
  if (persistCurrent && prevId && cache.has(prevId)) {
    saveShopState(prevId);
  }
  reg.activeShopId = shop.id;
  saveRegistry(reg);
  applyShopEnv(shop);
  clearNoonApiGatewayCache(shop.id);
  const loaded = loadShopStateFromDisk(shop);
  cache.set(shop.id, loaded);
  saveState(loaded, shopDataDir(shop));
  return loaded;
}

export function invalidateShopCache(shopId?: string) {
  if (shopId) cache.delete(shopId);
  else cache.clear();
}

export function warmDefaultShopCache() {
  const shop = getActiveShop();
  getShopState(shop.id);
}

/**
 * 在指定店铺 ALS 上下文中执行（不改 activeShopId / process.env）。
 * saveState / Noon 凭证 / portal-imports 均按 shopId 解析。
 */
export function runAsShop<T>(shopId: string, fn: () => T): T {
  findShop(shopId);
  return runWithContext({ shopId, user: SYSTEM_SYNC_USER }, fn);
}

export async function runAsShopAsync<T>(
  shopId: string,
  fn: () => Promise<T>,
): Promise<T> {
  findShop(shopId);
  return runWithContext({ shopId, user: SYSTEM_SYNC_USER }, () => fn());
}
