import type { AppState } from "../../../common/types.js";
import { saveState } from "../../../data/store.js";
import { pickLiveImpexDomains } from "../../../modules/sync/live-impex-domains.js";
import { pullDomain } from "../../../modules/sync/pipeline.js";
import { enrichCatalogImages } from "../../../modules/catalog/enrich-images.js";
import {
  ingestLatestSalesFile,
  runAutoIngest,
  type AutoIngestResult,
} from "./auto-ingest.js";

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
 *   · 已有 Catalog → 优先补齐 stock（FBN/Supermall）/ sales/fees；价库过期则定期重拉 catalog
 *   · 每次最多 2 域；ads/sales 门户表走 Playwright → portal-imports
 * - portal/mock：仅扫描 portal-imports 入库（不再使用浏览器登录态 / SOP）
 */
export async function runAutoSync(
  state: AppState,
  opts?: { skipSop?: boolean; forceIngest?: boolean; skipProbe?: boolean },
): Promise<AutoSyncResult> {
  void opts?.skipSop;
  void opts?.skipProbe;

  if (state.noon.mode === "live") {
    // Playwright/门户 CSV 与 Impex 并行：live 以前只拉 Impex，导表会躺在 portal-imports。
    // 不 force 全目录，避免把旧 FBN 影刀表盖掉 Impex 分仓。
    const ingest = await runAutoIngest(state, { force: false });
    if (opts?.forceIngest) {
      const sales = await ingestLatestSalesFile(state);
      if (!sales.skipped && sales.fileName) {
        ingest.imported += 1;
        ingest.details.push({
          file: sales.fileName,
          domain: "sales",
          count: sales.count ?? 0,
        });
      }
    }

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
      `portal 入库新${ingest.imported}/跳过${ingest.skipped}` +
      ` · live Impex · ${parts.join(" · ") || "noop"} · Catalog:${catalogCount}` +
      ` · Stock:${state.stock.length} · Sales:${state.salesFacts.length}` +
      ` · Fees:${state.feeSnapshots.length} · Ads:${state.adsFacts.length}` +
      (imagesUpdated ? ` · 补图:${imagesUpdated}` : "");
    state.noon.portal.lastFetchAt = new Date().toISOString();
    state.noon.portal.lastImportSummary = message;
    saveState(state);
    return {
      ingest,
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
