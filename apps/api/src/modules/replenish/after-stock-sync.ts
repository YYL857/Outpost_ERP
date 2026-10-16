/**
 * 库存/价库 Impex 入库后：清 Catalog 装配缓存 → 重算写本地补货表。
 * live 轮询偶发 stock/catalog 成功时走 debounce，避免每 tick 打爆磁盘。
 */
import { clearCatalogAssembleCache } from "../catalog/query.js";
import { loadShopPrefixMap } from "../warehouse-booking/pack-ticket.js";
import { loadRegistry } from "../../shops/registry.js";
import { rebuildWorkbooks } from "./workbook/service.js";

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 默认 3min；可用 OUTPOST_REPLENISH_REBUILD_DEBOUNCE_MS 覆盖（下限 30s） */
export function replenishRebuildDebounceMs(): number {
  const raw = Number(process.env.OUTPOST_REPLENISH_REBUILD_DEBOUNCE_MS ?? 180_000);
  if (!Number.isFinite(raw) || raw <= 0) return 180_000;
  return Math.max(30_000, Math.floor(raw));
}

export function prefixesForShopId(shopId: string): string[] {
  const reg = loadRegistry();
  const shop = reg.shops.find((s) => s.id === shopId);
  if (!shop) return [];
  const map = loadShopPrefixMap();
  const out: string[] = [];
  for (const [prefix, projectCode] of Object.entries(map)) {
    if (projectCode.toUpperCase() === shop.projectCode.toUpperCase()) {
      out.push(prefix);
    }
  }
  return out;
}

/** 按店重算补货本地 xlsx；无前缀则跳过 */
export function rebuildReplenishAfterStockSync(shopId: string): {
  ok: boolean;
  prefixes: string[];
  message: string;
} {
  clearCatalogAssembleCache();
  const prefixes = prefixesForShopId(shopId);
  if (!prefixes.length) {
    return {
      ok: true,
      prefixes: [],
      message: `${shopId}: 无 N 前缀映射，跳过补货表重算`,
    };
  }
  try {
    const result = rebuildWorkbooks({ prefixes });
    const docs = result.docs
      .map((d) => `${d.meta.shopPrefix}:${d.meta.rowCount}行`)
      .join(",");
    return {
      ok: true,
      prefixes,
      message: `${shopId}: 补货表已重算 ${docs || prefixes.join(",")}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      prefixes,
      message: `${shopId}: 补货表重算失败 ${msg.slice(0, 160)}`,
    };
  }
}

/**
 * live / 手动单域拉取 stock|catalog 成功后调用：合并窗口内多次成功为一次重算。
 * 日更与「重加载库存/销量」仍应立即调用 rebuildReplenishAfterStockSync（并 cancelDebounced 避免重复）。
 */
export function scheduleReplenishRebuildDebounced(shopId: string): void {
  if (!shopId) return;
  const prev = debounceTimers.get(shopId);
  if (prev) clearTimeout(prev);
  const ms = replenishRebuildDebounceMs();
  const t = setTimeout(() => {
    debounceTimers.delete(shopId);
    const r = rebuildReplenishAfterStockSync(shopId);
    console.log(`[replenish-rebuild] debounced ${r.message}`);
  }, ms);
  if (typeof t.unref === "function") t.unref();
  debounceTimers.set(shopId, t);
}

/** stock|catalog 写入成功后通知（其它域忽略） */
export function notifyStockOrCatalogSynced(
  shopId: string,
  domain: string,
): void {
  if (domain === "stock" || domain === "catalog") {
    scheduleReplenishRebuildDebounced(shopId);
  }
}

/** 立即重算前取消挂起的 debounce，避免紧跟着再写一次 */
export function cancelDebouncedReplenishRebuild(shopId: string): void {
  const prev = debounceTimers.get(shopId);
  if (prev) clearTimeout(prev);
  debounceTimers.delete(shopId);
}

/** 测试用：清空全部 debounce 定时器 */
export function clearReplenishRebuildDebounceForTests(): void {
  for (const t of debounceTimers.values()) clearTimeout(t);
  debounceTimers.clear();
}
