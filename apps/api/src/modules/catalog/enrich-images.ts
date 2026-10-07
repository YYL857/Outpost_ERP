import type { AppState, NoonConnection } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import {
  canFetchContentImages,
  deriveSkuParent,
  fetchProductPrimaryImage,
} from "../../platforms/noon/content-images.js";

export type EnrichImagesResult = {
  ok: boolean;
  attempted: number;
  updated: number;
  failed: number;
  skipped: number;
  message: string;
};

function gatewayConnection(state: AppState): NoonConnection {
  return {
    ...state.noon,
    mode: "live",
    baseUrl: "https://noon-api-gateway.noon.partners",
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * 用 Content GetContent 补全 catalog.imageUrl（按 sku_parent 去重请求）。
 */
export async function enrichCatalogImages(
  state: AppState,
  opts?: { limit?: number; concurrency?: number; onlyMissing?: boolean },
): Promise<EnrichImagesResult> {
  if (!canFetchContentImages()) {
    return {
      ok: false,
      attempted: 0,
      updated: 0,
      failed: 0,
      skipped: state.catalog.length,
      message:
        "缺少 Partner API 凭证（OUTPOST_NOON_CREDENTIALS_FILE），无法补图",
    };
  }

  const onlyMissing = opts?.onlyMissing !== false;
  const limit = opts?.limit ?? 500;
  const concurrency = opts?.concurrency ?? 6;
  const connection = gatewayConnection(state);

  type Job = { partnerSku: string; skuParent: string };
  const jobs: Job[] = [];
  for (const item of state.catalog) {
    if (onlyMissing && item.imageUrl?.trim()) continue;
    const skuParent = deriveSkuParent(item.noonSku);
    if (!skuParent) continue;
    jobs.push({ partnerSku: item.partnerSku, skuParent });
    if (jobs.length >= limit) break;
  }

  if (jobs.length === 0) {
    return {
      ok: true,
      attempted: 0,
      updated: 0,
      failed: 0,
      skipped: state.catalog.length,
      message: "无需补图（已有图或缺少 noonSku）",
    };
  }

  const parentCache = new Map<string, string | null>();
  const parents = [...new Set(jobs.map((j) => j.skuParent))];

  await mapPool(parents, concurrency, async (skuParent) => {
    try {
      const url = await fetchProductPrimaryImage(connection, skuParent);
      parentCache.set(skuParent, url || null);
    } catch {
      parentCache.set(skuParent, null);
    }
    return skuParent;
  });

  let updated = 0;
  let failed = 0;
  for (const job of jobs) {
    const url = parentCache.get(job.skuParent);
    if (!url) {
      failed += 1;
      continue;
    }
    const item = state.catalog.find((c) => c.partnerSku === job.partnerSku);
    if (!item) continue;
    if (item.imageUrl === url) continue;
    item.imageUrl = url;
    updated += 1;
  }

  if (updated > 0) saveState(state);

  return {
    ok: true,
    attempted: jobs.length,
    updated,
    failed,
    skipped: state.catalog.length - jobs.length,
    message: `补图完成：更新 ${updated} / 尝试 ${jobs.length}（失败 ${failed}，父 SKU ${parents.length}）`,
  };
}
