/**
 * 汇总同步编排（Noon 平台域 + 影刀广告落盘 + 飞书本地域）
 * 边界：只串联已有模块，不重复实现 pull/normalize/ingest。
 *
 * 链路：noon(runAutoSync) → ads_ingest(portal-imports) → feishu pull → normalize → ingest
 * 前提：影刀须先把各店 ads_sku_*.csv 落到 shops/{shopId}/portal-imports（汇总不跑影刀点击）。
 * 触发：手动 API / 定时调度；互斥锁防并发。
 */
import type { AppState } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { pushAlert } from "./alerts.js";
import { runAutoSync, type AutoSyncResult } from "../../platforms/noon/portal/auto-sync.js";
import { runAutoIngest, ingestLatestAdsFile } from "../../platforms/noon/portal/auto-ingest.js";
import {
  loadFeishuDocsConfig,
  pullFeishuRaw,
} from "../../platforms/feishu/index.js";
import { normalizeFeishuRun } from "../../platforms/feishu/normalize/index.js";
import {
  ingestFeishuLocalIntoState,
  type LocalAlignReport,
} from "../../platforms/feishu/ingest/local.js";
import { formatFeishuError, isFeishuError } from "../../platforms/feishu/errors.js";
import type { FeishuPullRunManifest } from "../../platforms/feishu/types.js";
import type { NormalizeRunManifest } from "../../platforms/feishu/normalize/types.js";
import {
  buildAdsProvenance,
  type DomainProvenance,
} from "../catalog/provenance.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type AssemblyTrigger = "manual" | "schedule";

export type AssemblyStageName =
  | "noon"
  | "ads_ingest"
  | "feishu_pull"
  | "feishu_normalize"
  | "feishu_ingest";

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
  forceIngest?: boolean;
  /** 飞书只拉这些 doc；默认 product + packing（成本/尺寸 + 装箱尺寸补缺） */
  feishuDocIds?: string[];
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

/**
 * 跑完整汇总链。并发调用会排队（锁），不会并行打 Impex/飞书。
 */
export async function runAssemblySync(
  state: AppState,
  opts: AssemblySyncOptions = {},
): Promise<AssemblySyncResult> {
  const run = async (): Promise<AssemblySyncResult> => {
    if (running) {
      // 理论上锁已串行；双保险
      throw new Error("汇总同步正在进行中，请稍候");
    }
    running = true;
    const triggeredBy = opts.triggeredBy ?? "manual";
    const startedAt = new Date().toISOString();
    const runId = `asm_${startedAt.replace(/[:.]/g, "-")}`;
    const stages: AssemblyStageResult[] = [];
    const feishuDocs = opts.feishuDocIds?.length
      ? opts.feishuDocIds
      : ["product", "packing"];

    try {
      // ---- Noon ----
      if (!opts.skipNoon) {
        const s0 = new Date().toISOString();
        try {
          const noon: AutoSyncResult = await runAutoSync(state, {
            forceIngest: opts.forceIngest,
          });
          stages.push({
            name: "noon",
            ok: true,
            startedAt: s0,
            finishedAt: new Date().toISOString(),
            message: noon.message,
            detail: {
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
            message: e instanceof Error ? e.message : String(e),
            error: stageError(e),
          });
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

      // ---- Ads：强制吃最新 ads_sku（mtime）；再扫一次其它 portal 文件 ----
      if (!opts.skipAds) {
        const s0 = new Date().toISOString();
        try {
          const latestAds = await ingestLatestAdsFile(state);
          const ingest = await runAutoIngest(state, {
            force: opts.forceIngest,
          });
          saveState(state);
          const adsProv = buildAdsProvenance(state);
          const adsN = state.adsFacts?.length ?? 0;
          const latestLabel = latestAds.skipped
            ? latestAds.reason ?? "无最新广告文件"
            : `权威源 ${latestAds.fileName} · 报表${latestAds.reportFrom}→${latestAds.reportTo} · 行${latestAds.count}`;
          stages.push({
            name: "ads_ingest",
            ok: latestAds.ok,
            startedAt: s0,
            finishedAt: new Date().toISOString(),
            message:
              `${latestLabel} · 全目录新${ingest.imported}/跳过${ingest.skipped}` +
              `/失败${ingest.failed.length} · adsFacts=${adsN}`,
            detail: {
              latestAds,
              ingest,
              adsFacts: adsN,
              importDir: latestAds.importDir || ingest.importDir,
              provenance: adsProv,
            },
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

      // ---- Feishu ----
      if (!opts.skipFeishu) {
        let pullOk = false;
        let normOk = false;
        let pullManifest: FeishuPullRunManifest | null = null;
        let normManifest: NormalizeRunManifest | null = null;

        // pull
        {
          const s0 = new Date().toISOString();
          try {
            const cfg = loadFeishuDocsConfig({ requireCredentials: true });
            pullManifest = await pullFeishuRaw(cfg, { docIds: feishuDocs });
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

        // normalize（有成功 raw 才跑；用 last-run）
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

        // ingest
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
            try {
              const report: LocalAlignReport = ingestFeishuLocalIntoState(state);
              saveState(state);
              stages.push({
                name: "feishu_ingest",
                ok: true,
                startedAt: s0,
                finishedAt: new Date().toISOString(),
                message: `成本+${report.cost.upserted} 尺寸+${report.dims.upserted} · Catalog对齐成本 ${report.cost.matchedCatalog}/${report.catalogCount}`,
                detail: report,
              });
            } catch (e) {
              stages.push({
                name: "feishu_ingest",
                ok: false,
                startedAt: s0,
                finishedAt: new Date().toISOString(),
                message: e instanceof Error ? e.message : String(e),
                error: stageError(e),
              });
            }
          }
        }
      } else {
        const t = new Date().toISOString();
        for (const name of [
          "feishu_pull",
          "feishu_normalize",
          "feishu_ingest",
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

      const noonStage = stages.find((s) => s.name === "noon");
      const adsStage = stages.find((s) => s.name === "ads_ingest");
      const feishuNeeded = !opts.skipFeishu;
      const feishuOk =
        !feishuNeeded ||
        (stages.find((s) => s.name === "feishu_pull")?.ok === true &&
          stages.find((s) => s.name === "feishu_normalize")?.ok === true &&
          stages.find((s) => s.name === "feishu_ingest")?.ok === true);
      const noonOk = opts.skipNoon || noonStage?.ok === true;
      // 广告：无新文件也算 ok；仅当 ingest 抛错才 fail（不阻断整链成功判定可选）
      const adsOk = opts.skipAds || adsStage?.ok === true;
      const ok = noonOk && adsOk && feishuOk;

      const ingestStage = stages.find((s) => s.name === "feishu_ingest");
      const align = ingestStage?.detail as LocalAlignReport | undefined;

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
        catalogCount: state.catalog.length,
        adsFacts: state.adsFacts?.length ?? 0,
        adsProvenance: buildAdsProvenance(state),
        localAlign: align
          ? {
              matchedCost: align.cost.matchedCatalog,
              catalogCount: align.catalogCount,
              catalogMissingCost: align.cost.catalogMissing,
            }
          : undefined,
      };

      state.noon.portal.lastImportSummary = message;
      state.noon.portal.lastFetchAt = finishedAt;
      if (!ok) {
        pushAlert(state, {
          level: "warning",
          title: "汇总同步未完全成功",
          detail: message,
        });
      }
      saveState(state);
      persistLast(result);
      return result;
    } finally {
      running = false;
    }
  };

  // 串行队列
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
