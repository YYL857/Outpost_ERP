/**
 * 汇总同步编排（Noon 平台域 + 影刀广告落盘 + 飞书本地域）
 * 边界：只串联已有模块，不重复实现 pull/normalize/ingest。
 *
 * 多店策略：
 * - ads / feishu ingest：一次调度遍历全部店铺
 * - feishu pull/normalize / wiki：全局一次
 * - Noon Impex：每周期最多 1 家（手动优先当前 UI 店；调度挑最饿）
 *
 * 触发：手动 API / 定时调度；互斥锁防并发。
 */
import type { AppState } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { pushAlert } from "./alerts.js";
import { runAutoSync, type AutoSyncResult } from "../../platforms/noon/portal/auto-sync.js";
import { runAutoIngest, ingestLatestAdsFile } from "../../platforms/noon/portal/auto-ingest.js";
import {
  loadFeishuDocsConfig,
  normalizeDailyBriefRun,
  pullFeishuRaw,
} from "../../platforms/feishu/index.js";
import { normalizeFeishuRun } from "../../platforms/feishu/normalize/index.js";
import {
  ingestFeishuLocalIntoState,
  type LocalAlignReport,
} from "../../platforms/feishu/ingest/local.js";
import { ingestFeishuOpsIntoState } from "../../platforms/feishu/ingest/ops.js";
import { formatFeishuError, isFeishuError } from "../../platforms/feishu/errors.js";
import type { FeishuPullRunManifest } from "../../platforms/feishu/types.js";
import type { NormalizeRunManifest } from "../../platforms/feishu/normalize/types.js";
import {
  buildAdsProvenance,
  type DomainProvenance,
} from "../catalog/provenance.js";
import { clearCatalogAssembleCache } from "../catalog/query.js";
import { rebuildWikiGraph } from "../wiki-graph/build.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getShopState,
  resolveCurrentShopId,
  runAsShopAsync,
  saveShopState,
} from "../../shops/state-cache.js";
import {
  listEligibleSyncShops,
  pickNoonImpexShopId,
} from "./multi-shop-sync.js";
import { runOpsDailyAllShops } from "../ops-daily/index.js";

export type AssemblyTrigger = "manual" | "schedule";

export type AssemblyStageName =
  | "noon"
  | "ads_ingest"
  | "feishu_pull"
  | "feishu_normalize"
  | "feishu_ingest"
  | "feishu_daily_ops"
  | "wiki_graph"
  | "ops_daily";

export type AssemblyStageResult = {
  name: AssemblyStageName;
  ok: boolean;
  skipped?: boolean;
  startedAt: string;
  finishedAt: string;
  message: string;
  detail?: unknown;
  error?: unknown;
};

export type AssemblySyncResult = {
  ok: boolean;
  runId: string;
  triggeredBy: AssemblyTrigger;
  startedAt: string;
  finishedAt: string;
  stages: AssemblyStageResult[];
  message: string;
  catalogCount: number;
  localAlign?: {
    matchedCost: number;
    catalogCount: number;
    catalogMissingCost: number;
  };
  adsFacts?: number;
  /** 广告域溯源（影刀落盘 + facts） */
  adsProvenance?: DomainProvenance;
};

export type AssemblySyncOptions = {
  triggeredBy?: AssemblyTrigger;
  /** 跳过 Noon（仅飞书） */
  skipNoon?: boolean;
  /** 跳过影刀广告 portal-imports 入库 */
  skipAds?: boolean;
  /** 跳过飞书三段 */
  skipFeishu?: boolean;
  /** 跳过 wiki-graph 重建（默认飞书成功后会重建） */
  skipWikiGraph?: boolean;
  /** 跳过 ops_daily Phase1 面板导出（默认跑） */
  skipOpsDaily?: boolean;
  forceIngest?: boolean;
  /** 飞书只拉这些 doc；默认 product + packing（成本/尺寸 + 装箱尺寸补缺） */
  feishuDocIds?: string[];
  /** 手动时 Noon 优先店；默认当前 UI / ALS 店 */
  preferNoonShopId?: string | null;
};

let chainLock: Promise<void> = Promise.resolve();
let running = false;
let lastResult: AssemblySyncResult | null = null;

export function getLastAssemblySync(): AssemblySyncResult | null {
  return lastResult;
}

export function isAssemblySyncRunning(): boolean {
  return running;
}

function assemblyStatusDir(): string {
  const root =
    process.env.OUTPOST_ROOT?.trim() ||
    process.env.OUTPOST_DATA_DIR?.trim() ||
    "D:\\outpost-data";
  const base = resolve(root);
  if (base.replace(/\\/g, "/").endsWith("/json")) {
    return resolve(base, "..", "assembly-sync");
  }
  return resolve(base, "assembly-sync");
}

function persistLast(result: AssemblySyncResult) {
  lastResult = result;
  try {
    const dir = assemblyStatusDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "last-assembly-sync.json"),
      JSON.stringify(result, null, 2) + "\n",
      "utf8",
    );
  } catch (e) {
    console.error("[assembly-sync] persist last failed", e);
  }
}

function stageError(e: unknown): unknown {
  if (isFeishuError(e)) return e.toJSON();
  if (e instanceof Error) return { name: e.name, message: e.message };
  return { message: String(e) };
}

function resolveFocusState(fallback: AppState): AppState {
  try {
    return getShopState(resolveCurrentShopId());
  } catch {
    return fallback;
  }
}

/**
 * 跑完整汇总链。并发调用会排队（锁），不会并行打 Impex/飞书。
 * @param state 当前 UI/调用方店铺态（汇总结果与告警写回此店）
 */
export async function runAssemblySync(
  state: AppState,
  opts: AssemblySyncOptions = {},
): Promise<AssemblySyncResult> {
  const run = async (): Promise<AssemblySyncResult> => {
    if (running) {
      throw new Error("汇总同步正在进行中，请稍候");
    }
    running = true;
    const triggeredBy = opts.triggeredBy ?? "manual";
    const startedAt = new Date().toISOString();
    const runId = `asm_${startedAt.replace(/[:.]/g, "-")}`;
    const stages: AssemblyStageResult[] = [];
    const feishuDocs = opts.feishuDocIds?.length
      ? opts.feishuDocIds
      : ["product", "packing", "accounts"];

    const shops = listEligibleSyncShops();
    const preferNoon =
      opts.preferNoonShopId?.trim() ||
      (triggeredBy === "manual" ? resolveCurrentShopId() : null);

    try {
      // ---- Ads：全店 portal-imports（无 Impex）----
      if (!opts.skipAds) {
        const s0 = new Date().toISOString();
        const perShop: Array<Record<string, unknown>> = [];
        let anyOk = true;
        try {
          for (const shop of shops) {
            const row = await runAsShopAsync(shop.id, async () => {
              const st = getShopState(shop.id);
              const latestAds = await ingestLatestAdsFile(st);
              const ingest = await runAutoIngest(st, {
                force: opts.forceIngest,
              });
              saveShopState(shop.id, st);
              const adsN = st.adsFacts?.length ?? 0;
              const latestLabel = latestAds.skipped
                ? latestAds.reason ?? "无最新广告文件"
                : `权威源 ${latestAds.fileName} · 行${latestAds.count}`;
              return {
                shopId: shop.id,
                ok: latestAds.ok,
                message: `${latestLabel} · 新${ingest.imported}/跳过${ingest.skipped} · adsFacts=${adsN}`,
                adsFacts: adsN,
                importDir: latestAds.importDir || ingest.importDir,
                provenance: buildAdsProvenance(st),
              };
            });
            perShop.push(row);
            if (!row.ok) anyOk = false;
          }
          stages.push({
            name: "ads_ingest",
            ok: anyOk,
            startedAt: s0,
            finishedAt: new Date().toISOString(),
            message: `全店广告 ${perShop.map((p) => `${p.shopId}:${p.ok ? "ok" : "fail"}`).join(" · ")}`,
            detail: { shops: perShop },
          });
        } catch (e) {
          stages.push({
            name: "ads_ingest",
            ok: false,
            startedAt: s0,
            finishedAt: new Date().toISOString(),
            message: e instanceof Error ? e.message : String(e),
            error: stageError(e),
          });
        }
      } else {
        const t = new Date().toISOString();
        stages.push({
          name: "ads_ingest",
          ok: true,
          skipped: true,
          startedAt: t,
          finishedAt: t,
          message: "跳过广告入库",
        });
      }

      // ---- Feishu：pull/normalize 一次；ingest 全店 ----
      if (!opts.skipFeishu) {
        let pullOk = false;
        let normOk = false;
        let pullManifest: FeishuPullRunManifest | null = null;
        let normManifest: NormalizeRunManifest | null = null;
        let feishuCfg: ReturnType<typeof loadFeishuDocsConfig> | null = null;

        {
          const s0 = new Date().toISOString();
          try {
            feishuCfg = loadFeishuDocsConfig({ requireCredentials: true });
            pullManifest = await pullFeishuRaw(feishuCfg, { docIds: feishuDocs });
            const fail = pullManifest.results.filter((r) => !r.ok).length;
            pullOk = fail === 0 && pullManifest.results.some((r) => r.ok);
            stages.push({
              name: "feishu_pull",
              ok: pullOk,
              startedAt: s0,
              finishedAt: new Date().toISOString(),
              message: pullOk
                ? `raw ok runId=${pullManifest.runId}`
                : `raw 部分/全部失败 fail=${fail}`,
              detail: {
                runId: pullManifest.runId,
                results: pullManifest.results,
              },
              error: pullOk
                ? undefined
                : pullManifest.results.filter((r) => !r.ok).map((r) => r.error),
            });
          } catch (e) {
            stages.push({
              name: "feishu_pull",
              ok: false,
              startedAt: s0,
              finishedAt: new Date().toISOString(),
              message: isFeishuError(e)
                ? e.message
                : e instanceof Error
                  ? e.message
                  : String(e),
              error: stageError(e),
            });
          }
        }

        {
          const s0 = new Date().toISOString();
          if (!pullOk) {
            stages.push({
              name: "feishu_normalize",
              ok: false,
              skipped: true,
              startedAt: s0,
              finishedAt: new Date().toISOString(),
              message: "因 pull 失败跳过 normalize",
            });
          } else {
            try {
              normManifest = normalizeFeishuRun({
                rawRunId: "last",
                docIds: feishuDocs,
              });
              const fail = normManifest.results.filter((r) => !r.ok).length;
              normOk = fail === 0 && normManifest.results.some((r) => r.ok);
              stages.push({
                name: "feishu_normalize",
                ok: normOk,
                startedAt: s0,
                finishedAt: new Date().toISOString(),
                message: normOk
                  ? `normalized runId=${normManifest.runId}`
                  : `normalize 失败 fail=${fail}`,
                detail: {
                  runId: normManifest.runId,
                  files: normManifest.files,
                  results: normManifest.results,
                  guards: normManifest.guards,
                },
                error: normOk
                  ? undefined
                  : normManifest.results.filter((r) => !r.ok).map((r) => r.error),
              });
            } catch (e) {
              stages.push({
                name: "feishu_normalize",
                ok: false,
                startedAt: s0,
                finishedAt: new Date().toISOString(),
                message: e instanceof Error ? e.message : String(e),
                error: stageError(e),
              });
            }
          }
        }

        {
          const s0 = new Date().toISOString();
          if (!normOk) {
            stages.push({
              name: "feishu_ingest",
              ok: false,
              skipped: true,
              startedAt: s0,
              finishedAt: new Date().toISOString(),
              message: "因 normalize 失败跳过 ingest",
            });
          } else {
            const perShop: Array<Record<string, unknown>> = [];
            let allOk = true;
            try {
              for (const shop of shops) {
                const row = await runAsShopAsync(shop.id, async () => {
                  const st = getShopState(shop.id);
                  const report: LocalAlignReport = ingestFeishuLocalIntoState(st);
                  saveShopState(shop.id, st);
                  return {
                    shopId: shop.id,
                    ok: true,
                    message:
                      `成本+${report.cost.upserted} 尺寸+${report.dims.upserted}` +
                      ` 采购+${report.purchase.upserted} · Catalog ${report.cost.matchedCatalog}/${report.catalogCount}`,
                    report,
                  };
                });
                perShop.push(row);
              }
              stages.push({
                name: "feishu_ingest",
                ok: allOk,
                startedAt: s0,
                finishedAt: new Date().toISOString(),
                message: `全店飞书入库 ${perShop.map((p) => p.shopId).join(",")}`,
                detail: { shops: perShop },
              });
            } catch (e) {
              allOk = false;
              stages.push({
                name: "feishu_ingest",
                ok: false,
                startedAt: s0,
                finishedAt: new Date().toISOString(),
                message: e instanceof Error ? e.message : String(e),
                error: stageError(e),
                detail: { shops: perShop },
              });
            }
          }
        }

        {
          const s0 = new Date().toISOString();
          try {
            const cfg =
              feishuCfg ?? loadFeishuDocsConfig({ requireCredentials: true });
            const dailyPull = await pullFeishuRaw(cfg, { docIds: ["daily"] });
            const dailyOk = dailyPull.results.some(
              (r) => r.ok && r.docId === "daily",
            );
            if (!dailyOk) {
              stages.push({
                name: "feishu_daily_ops",
                ok: false,
                startedAt: s0,
                finishedAt: new Date().toISOString(),
                message: "日报拉取失败或未配置 daily",
                detail: dailyPull,
              });
            } else {
              normalizeDailyBriefRun({ rawRunId: dailyPull.runId });
              const perShop: Array<Record<string, unknown>> = [];
              for (const shop of shops) {
                const row = await runAsShopAsync(shop.id, async () => {
                  const st = getShopState(shop.id);
                  const ops = ingestFeishuOpsIntoState(st);
                  saveShopState(shop.id, st);
                  return {
                    shopId: shop.id,
                    upserted: ops.upserted,
                    sheetTitle: ops.sheetTitle,
                  };
                });
                perShop.push(row);
              }
              stages.push({
                name: "feishu_daily_ops",
                ok: true,
                startedAt: s0,
                finishedAt: new Date().toISOString(),
                message: `日报运营快照全店 ${perShop.map((p) => `${p.shopId}+${p.upserted}`).join(" · ")}`,
                detail: { shops: perShop, dailyPull },
              });
            }
          } catch (e) {
            stages.push({
              name: "feishu_daily_ops",
              ok: false,
              startedAt: s0,
              finishedAt: new Date().toISOString(),
              message: e instanceof Error ? e.message : String(e),
              error: stageError(e),
            });
          }
        }
      } else {
        const t = new Date().toISOString();
        for (const name of [
          "feishu_pull",
          "feishu_normalize",
          "feishu_ingest",
          "feishu_daily_ops",
        ] as const) {
          stages.push({
            name,
            ok: true,
            skipped: true,
            startedAt: t,
            finishedAt: t,
            message: "跳过飞书",
          });
        }
      }

      const adsStage = stages.find((s) => s.name === "ads_ingest");
      const feishuNeeded = !opts.skipFeishu;
      const feishuOk =
        !feishuNeeded ||
        (stages.find((s) => s.name === "feishu_pull")?.ok === true &&
          stages.find((s) => s.name === "feishu_normalize")?.ok === true &&
          stages.find((s) => s.name === "feishu_ingest")?.ok === true);
      const adsOk = opts.skipAds || adsStage?.ok === true;
      const feishuPipelineOk = feishuOk;

      if (!opts.skipWikiGraph && !opts.skipFeishu && feishuPipelineOk) {
        const s0 = new Date().toISOString();
        try {
          const wiki = await rebuildWikiGraph();
          stages.push({
            name: "wiki_graph",
            ok: wiki.ok,
            startedAt: s0,
            finishedAt: new Date().toISOString(),
            message: wiki.ok
              ? `wiki-graph nodes≈${wiki.nodesUpserted} edges≈${wiki.edgesUpserted} (${wiki.durationMs}ms)`
              : `wiki-graph 失败: ${wiki.error ?? "unknown"}`,
            detail: wiki,
          });
        } catch (e) {
          stages.push({
            name: "wiki_graph",
            ok: false,
            startedAt: s0,
            finishedAt: new Date().toISOString(),
            message: e instanceof Error ? e.message : String(e),
            error: stageError(e),
          });
        }
      } else {
        const t = new Date().toISOString();
        stages.push({
          name: "wiki_graph",
          ok: true,
          skipped: true,
          startedAt: t,
          finishedAt: t,
          message: opts.skipWikiGraph
            ? "跳过 wiki-graph"
            : opts.skipFeishu
              ? "跳过飞书，故跳过 wiki-graph"
              : "飞书未成功，跳过 wiki-graph",
        });
      }

      // ---- Noon Impex：每周期最多 1 店 ----
      if (!opts.skipNoon) {
        const s0 = new Date().toISOString();
        const noonShopId = pickNoonImpexShopId({
          preferShopId: preferNoon,
          skipCooling: true,
        });
        if (!noonShopId) {
          stages.push({
            name: "noon",
            ok: true,
            skipped: true,
            startedAt: s0,
            finishedAt: new Date().toISOString(),
            message: "无可用 live 店（冷却或未启用）",
          });
        } else {
          try {
            const noon: AutoSyncResult = await runAsShopAsync(
              noonShopId,
              async () => {
                const st = getShopState(noonShopId);
                const result = await runAutoSync(st, {
                  forceIngest: opts.forceIngest,
                });
                saveShopState(noonShopId, st);
                return result;
              },
            );
            stages.push({
              name: "noon",
              ok: true,
              startedAt: s0,
              finishedAt: new Date().toISOString(),
              message: `${noonShopId} · ${noon.message}`,
              detail: {
                shopId: noonShopId,
                catalogCount: noon.catalogCount,
                imagesUpdated: noon.imagesUpdated,
                ingest: noon.ingest,
              },
            });
          } catch (e) {
            stages.push({
              name: "noon",
              ok: false,
              startedAt: s0,
              finishedAt: new Date().toISOString(),
              message: `${noonShopId} · ${e instanceof Error ? e.message : String(e)}`,
              error: stageError(e),
              detail: { shopId: noonShopId },
            });
          }
        }
      } else {
        const t = new Date().toISOString();
        stages.push({
          name: "noon",
          ok: true,
          skipped: true,
          startedAt: t,
          finishedAt: t,
          message: "跳过 Noon",
        });
      }

      const noonStage = stages.find((s) => s.name === "noon");
      const noonOk = opts.skipNoon || noonStage?.ok === true || noonStage?.skipped === true;

      // ---- ops_daily Phase1：读 state + sales_export → 48 列 CSV ----
      if (!opts.skipOpsDaily) {
        const s0 = new Date().toISOString();
        try {
          const shopIds = listEligibleSyncShops().map((s) => s.id);
          const results = runOpsDailyAllShops({ shopIds });
          const okAll = results.every((r) => r.ok);
          stages.push({
            name: "ops_daily",
            ok: okAll,
            startedAt: s0,
            finishedAt: new Date().toISOString(),
            message: okAll
              ? `ops_daily Phase1 · ${results.map((r) => `${r.shopId}:${r.rowCount}`).join(", ")}`
              : `ops_daily 部分失败 · ${results
                  .filter((r) => !r.ok)
                  .map((r) => r.shopId)
                  .join(",")}`,
            detail: { results },
          });
        } catch (e) {
          stages.push({
            name: "ops_daily",
            ok: false,
            startedAt: s0,
            finishedAt: new Date().toISOString(),
            message: e instanceof Error ? e.message : String(e),
            error: stageError(e),
          });
        }
      } else {
        const t = new Date().toISOString();
        stages.push({
          name: "ops_daily",
          ok: true,
          skipped: true,
          startedAt: t,
          finishedAt: t,
          message: "跳过 ops_daily",
        });
      }

      const ok = noonOk && adsOk && feishuOk;

      const focus = resolveFocusState(state);
      const ingestDetail = stages.find((s) => s.name === "feishu_ingest")
        ?.detail as { shops?: Array<{ shopId: string; report?: LocalAlignReport }> } | undefined;
      const focusAlign = ingestDetail?.shops?.find(
        (s) => s.shopId === focus.store?.id || s.shopId === resolveCurrentShopId(),
      )?.report;

      const finishedAt = new Date().toISOString();
      const message = [
        ok ? "汇总同步成功" : "汇总同步部分失败",
        ...stages
          .filter((s) => !s.skipped)
          .map((s) => `${s.name}:${s.ok ? "ok" : "fail"}`),
      ].join(" · ");

      const result: AssemblySyncResult = {
        ok,
        runId,
        triggeredBy,
        startedAt,
        finishedAt,
        stages,
        message,
        catalogCount: focus.catalog.length,
        adsFacts: focus.adsFacts?.length ?? 0,
        adsProvenance: buildAdsProvenance(focus),
        localAlign: focusAlign
          ? {
              matchedCost: focusAlign.cost.matchedCatalog,
              catalogCount: focusAlign.catalogCount,
              catalogMissingCost: focusAlign.cost.catalogMissing,
            }
          : undefined,
      };

      focus.noon.portal.lastImportSummary = message;
      focus.noon.portal.lastFetchAt = finishedAt;
      if (!ok) {
        pushAlert(focus, {
          level: "warning",
          title: "汇总同步未完全成功",
          detail: message,
        });
      }
      try {
        saveShopState(focus.store.id || resolveCurrentShopId(), focus);
      } catch {
        saveState(focus);
      }
      // 若调用方传入的是同一引用外的旧对象，也写回摘要
      if (state !== focus) {
        state.noon.portal.lastImportSummary = message;
        state.noon.portal.lastFetchAt = finishedAt;
      }
      clearCatalogAssembleCache();
      persistLast(result);
      return result;
    } finally {
      running = false;
    }
  };

  const prev = chainLock;
  let release!: () => void;
  chainLock = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await run();
  } finally {
    release();
  }
}

/** 供错误日志：避免把 formatFeishuError 未使用告警 */
export function describeAssemblyError(e: unknown): string {
  return isFeishuError(e) ? JSON.stringify(e.toJSON()) : formatFeishuError(e);
}
