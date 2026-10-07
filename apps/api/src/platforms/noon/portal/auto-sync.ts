import type { AppState } from "../../../common/types.js";
import { saveState } from "../../../data/store.js";
import { pullDomain } from "../../../modules/sync/pipeline.js";
import { enrichCatalogImages } from "../../../modules/catalog/enrich-images.js";
import { runAutoIngest, type AutoIngestResult } from "./auto-ingest.js";

export type AutoSyncResult = {
  ingest: AutoIngestResult;
  catalogCount: number;
  imagesUpdated?: number;
  message: string;
};

/**
 * 全自动同步主入口：
 * - live：Partner API Impex（配额约 30 分钟 20 次）
 *   · 空 Catalog → 只拉 catalog
 *   · 已有 Catalog → 优先补齐 sales/fees（Catalog 可视化关键），最多 2 域
 *   · ads 无 Impex，靠影刀 → portal-imports
 * - portal/mock：仅扫描 portal-imports 入库（不再使用浏览器登录态 / SOP）
 */
export async function runAutoSync(
  state: AppState,
  opts?: { skipSop?: boolean; forceIngest?: boolean; skipProbe?: boolean },
): Promise<AutoSyncResult> {
  void opts?.skipSop;
  void opts?.skipProbe;

  if (state.noon.mode === "live") {
    const domains = pickLiveImpexDomains(state);
    const parts: string[] = [];
    for (const domain of domains) {
      try {
        await pullDomain(state, domain);
        parts.push(`${domain}:ok(${domainCount(state, domain)})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        parts.push(`${domain}:fail(${message.slice(0, 80)})`);
        if (/export limit|限额/i.test(message)) break;
      }
    }
    const catalogCount = state.catalog.length;
    let imagesUpdated = 0;
    try {
      const img = await enrichCatalogImages(state, { onlyMissing: true });
      imagesUpdated = img.updated;
    } catch {
      // 补图失败不阻断主同步
    }
    const message =
      `live Impex · ${parts.join(" · ") || "noop"} · Catalog:${catalogCount}` +
      ` · Stock:${state.stock.length} · Sales:${state.salesFacts.length}` +
      ` · Fees:${state.feeSnapshots.length} · Ads:${state.adsFacts.length}` +
      (imagesUpdated ? ` · 补图:${imagesUpdated}` : "");
    state.noon.portal.lastFetchAt = new Date().toISOString();
    state.noon.portal.lastImportSummary = message;
    saveState(state);
    return {
      ingest: {
        importDir: "",
        scanned: 0,
        imported: 0,
        skipped: 0,
        failed: [],
        details: [],
      },
      catalogCount,
      imagesUpdated,
      message,
    };
  }

  const ingest = await runAutoIngest(state, { force: opts?.forceIngest });
  const catalogCount = state.catalog.length;
  let imagesUpdated = 0;
  try {
    const img = await enrichCatalogImages(state, { onlyMissing: true });
    imagesUpdated = img.updated;
  } catch {
    // ignore
  }
  saveState(state);

  const message = [
    `入库:新${ingest.imported}/跳过${ingest.skipped}/失败${ingest.failed.length}`,
    `Catalog:${catalogCount}`,
    imagesUpdated ? `补图:${imagesUpdated}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  state.noon.portal.lastFetchAt = new Date().toISOString();
  state.noon.portal.lastImportSummary = message;
  saveState(state);

  return { ingest, catalogCount, imagesUpdated, message };
}

/** Impex 配额约 2 次/30min：优先填满 Catalog 可视化缺口 */
function pickLiveImpexDomains(
  state: AppState,
): Array<"catalog" | "orders" | "sales" | "fees"> {
  if (state.catalog.length === 0) return ["catalog"];
  const out: Array<"catalog" | "orders" | "sales" | "fees"> = [];
  if (state.salesFacts.length === 0) out.push("sales");
  if (state.feeSnapshots.length === 0 && out.length < 2) out.push("fees");
  if (out.length === 0) {
    // 都已有数据：轮换刷新 sales + fees（比反复 catalog 更利于经营视图）
    out.push("sales", "fees");
  } else if (out.length === 1 && state.orders.length === 0) {
    out.push("orders");
  }
  return out.slice(0, 2);
}

function domainCount(
  state: AppState,
  domain: "catalog" | "orders" | "sales" | "fees" | "stock",
): number {
  switch (domain) {
    case "catalog":
      return state.catalog.length;
    case "orders":
      return state.orders.length;
    case "sales":
      return state.salesFacts.length;
    case "fees":
      return state.feeSnapshots.length;
    case "stock":
      return state.stock.length;
  }
}
