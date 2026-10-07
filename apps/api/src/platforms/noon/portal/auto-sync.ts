import type { AppState } from "../../../common/types.js";
import { pushAlert } from "../../../modules/sync/alerts.js";
import { saveState } from "../../../data/store.js";
import { pullDomain } from "../../../modules/sync/pipeline.js";
import { enrichCatalogImages } from "../../../modules/catalog/enrich-images.js";
import { runAutoIngest, type AutoIngestResult } from "./auto-ingest.js";
import { runSopExport, type SopRunResult } from "./sop-runner.js";
import {
  probeSessionUsability,
  type SessionProbeResult,
} from "./session-probe.js";

export type AutoSyncResult = {
  sop: SopRunResult;
  ingest: AutoIngestResult;
  catalogCount: number;
  imagesUpdated?: number;
  message: string;
  probe?: SessionProbeResult;
};

/**
 * 全自动同步主入口：
 * - live：Partner API Impex 拉 catalog/orders/stock
 * - portal：探针 → SOP → portal-imports 入库
 */
export async function runAutoSync(
  state: AppState,
  opts?: { skipSop?: boolean; forceIngest?: boolean; skipProbe?: boolean },
): Promise<AutoSyncResult> {
  if (state.noon.mode === "live") {
    // Impex 常见限额 30 分钟 2 次：
    // - 空 Catalog：只拉 catalog（1 次配额），orders 留给下次
    // - 已有 Catalog：catalog + orders（最多 2 次）
    // stock 由 catalog 内嵌 hints 覆盖，避免再烧 FBN export。
    const domains =
      state.catalog.length === 0
        ? (["catalog"] as const)
        : (["catalog", "orders"] as const);
    const parts: string[] = [];
    for (const domain of domains) {
      try {
        await pullDomain(state, domain);
        parts.push(`${domain}:ok`);
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
      `live Impex · ${parts.join(" · ")} · Catalog:${catalogCount} · Stock:${state.stock.length}` +
      (imagesUpdated ? ` · 补图:${imagesUpdated}` : "");
    state.noon.portal.lastFetchAt = new Date().toISOString();
    state.noon.portal.lastImportSummary = message;
    saveState(state);
    return {
      sop: {
        ok: true,
        skipped: true,
        message: "live 模式使用 Partner API Impex，已跳过门户 SOP",
        downloadDir: "",
        downloads: [],
        reportResults: [],
      },
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

  let sop: SopRunResult = {
    ok: false,
    skipped: true,
    message: "已跳过 SOP 导出",
    downloadDir: "",
    downloads: [],
    reportResults: [],
  };
  let probe: SessionProbeResult | undefined;

  if (!opts?.skipSop) {
    if (!opts?.skipProbe) {
      try {
        probe = await probeSessionUsability();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        probe = {
          usable: "unknown",
          probedAt: new Date().toISOString(),
          finalUrl: "",
          httpStatus: null,
          verdict: "PROBE_ERROR",
          message: `探针异常：${message}`,
          hasIdentityCookies: false,
          probeUrl: "",
        };
      }

      if (probe.usable !== "ok") {
        sop = {
          ok: false,
          skipped: true,
          message: `已跳过 SOP：登录态不可用（${probe.usable}）。${probe.message}`,
          downloadDir: "",
          downloads: [],
          reportResults: [],
        };
        pushAlert(state, {
          level: probe.usable === "blocked" ? "danger" : "warning",
          title: "登录态探针未通过，已跳过自动导出",
          detail: probe.message,
        });
        saveState(state);

        const ingest = await runAutoIngest(state, { force: opts?.forceIngest });
        const catalogCount = state.catalog.length;
        const message = [
          `SOP:跳过(探针${probe.usable})`,
          `入库:新${ingest.imported}/跳过${ingest.skipped}/失败${ingest.failed.length}`,
          `Catalog:${catalogCount}`,
        ].join(" · ");
        state.noon.portal.lastFetchAt = new Date().toISOString();
        state.noon.portal.lastImportSummary = message;
        saveState(state);
        return { sop, ingest, catalogCount, message, probe };
      }
    }

    try {
      sop = await runSopExport();
      if (!sop.ok && !sop.skipped) {
        pushAlert(state, {
          level: "warning",
          title: "SOP 自动导出未完成",
          detail: sop.message,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sop = {
        ok: false,
        skipped: false,
        message,
        downloadDir: "",
        downloads: [],
        reportResults: [],
      };
      pushAlert(state, {
        level: "danger",
        title: "SOP 自动导出失败",
        detail: message,
      });
    }
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
    sop.skipped ? "SOP:跳过" : sop.ok ? `SOP:下载${sop.downloads.length}` : "SOP:失败",
    `入库:新${ingest.imported}/跳过${ingest.skipped}/失败${ingest.failed.length}`,
    `Catalog:${catalogCount}`,
    imagesUpdated ? `补图:${imagesUpdated}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  state.noon.portal.lastFetchAt = new Date().toISOString();
  state.noon.portal.lastImportSummary = message;
  saveState(state);

  return { sop, ingest, catalogCount, imagesUpdated, message, probe };
}
