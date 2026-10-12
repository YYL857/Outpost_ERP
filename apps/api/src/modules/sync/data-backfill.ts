/**
 * 启动/手动数据补洞：
 * - 审计各店 sales/orders/ads/catalog/stock/fees
 * - Noon：每一类缺口一次 Impex（调整 from～to 口径）→ 入库清洗
 * - 飞书：无配额限制，缺则直接 pull+normalize+ingest
 * - 广告：缺 ads 时触发 Playwright（python main.py ads ui），不写影刀 pending
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppState } from "../../common/types.js";
import {
  isImpexCoolingDown,
  isImpexLimitMessage,
} from "../../platforms/noon/impex-client.js";
import {
  loadFeishuDocsConfig,
  normalizeDailyBriefRun,
  normalizeFeishuRun,
  pullFeishuRaw,
} from "../../platforms/feishu/index.js";
import { ingestFeishuLocalIntoState } from "../../platforms/feishu/ingest/local.js";
import { ingestFeishuOpsIntoState } from "../../platforms/feishu/ingest/ops.js";
import { formatFeishuError, isFeishuError } from "../../platforms/feishu/errors.js";
import {
  getAdsPwExportStatus,
  startAdsPwExport,
} from "../ads/ads-pw-cli.js";
import { getPwSessionStatus } from "../pw-rpa/session-status.js";
import { ingestLatestAdsFile, runAutoIngest } from "../../platforms/noon/portal/auto-ingest.js";
import {
  getShopState,
  runAsShopAsync,
  saveShopState,
} from "../../shops/state-cache.js";
import { getHealthGateShopIds } from "../../shops/registry.js";
import { listLiveImpexShops, listEligibleSyncShops } from "./multi-shop-sync.js";
import { pullDomain } from "./pipeline.js";
import { pushAlert } from "./alerts.js";
import {
  auditShopGaps,
  domainsNeedingFill,
  type DomainGap,
  type GapDomain,
  type ShopGapReport,
} from "./gap-audit.js";
import { clearCatalogAssembleCache } from "../catalog/query.js";

export type BackfillAction = {
  shopId: string;
  domain: GapDomain | "feishu" | "yingdao-ads";
  ok: boolean;
  skipped?: boolean;
  message: string;
  fillFrom?: string | null;
  fillTo?: string | null;
  channel?: string;
  detail?: unknown;
};

export type DataBackfillResult = {
  ok: boolean;
  runId: string;
  triggeredBy: "boot" | "manual" | "schedule";
  startedAt: string;
  finishedAt: string;
  message: string;
  audits: ShopGapReport[];
  actions: BackfillAction[];
};

export type DataBackfillOptions = {
  triggeredBy?: "boot" | "manual" | "schedule";
  /** 只处理这些店；默认健康门禁店（前两家老店） */
  shopIds?: string[];
  /** 跳过 Noon Impex */
  skipNoon?: boolean;
  /** 跳过飞书 */
  skipFeishu?: boolean;
  /** 跳过广告 RPA（Playwright）；字段名保留 skipYingdao 兼容旧客户端 */
  skipYingdao?: boolean;
  /** 每店最多打几次 Impex（默认 2，贴近「半小时两次」保守节奏） */
  maxImpexPerShop?: number;
  /** 全进程本次最多 Impex 次数（默认 4） */
  maxImpexTotal?: number;
  lookbackDays?: number;
};

let running = false;
let lastResult: DataBackfillResult | null = null;
let chain: Promise<unknown> = Promise.resolve();

export function isDataBackfillRunning(): boolean {
  return running;
}

export function getLastDataBackfill(): DataBackfillResult | null {
  return lastResult;
}

function statusDir(): string {
  const root =
    process.env.OUTPOST_ROOT?.trim() ||
    process.env.OUTPOST_DATA_DIR?.trim() ||
    "D:\\outpost-data";
  const base = resolve(root);
  if (base.replace(/\\/g, "/").endsWith("/json")) {
    return resolve(base, "..", "data-backfill");
  }
  return resolve(base, "data-backfill");
}

function persistLast(result: DataBackfillResult) {
  lastResult = result;
  try {
    const dir = statusDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "last-data-backfill.json"),
      JSON.stringify(result, null, 2) + "\n",
      "utf8",
    );
  } catch (e) {
    console.error("[data-backfill] persist failed", e);
  }
}

/** Impex 域优先级：先销售（看板主口径），再订单/费用/价库/库存 */
const IMPEX_ORDER: GapDomain[] = [
  "sales",
  "orders",
  "fees",
  "catalog",
  "stock",
];

function isImpexDomain(
  d: GapDomain,
): d is "sales" | "orders" | "fees" | "catalog" | "stock" {
  return (
    d === "sales" ||
    d === "orders" ||
    d === "fees" ||
    d === "catalog" ||
    d === "stock"
  );
}

/**
 * 把游标拨到 fillFrom，让 live-client 的 orderDateRange 一次覆盖缺口～今天。
 */
async function pullDomainCoveringGap(
  state: AppState,
  domain: "sales" | "orders" | "fees" | "catalog" | "stock",
  fillFrom: string | null,
): Promise<void> {
  if (domain === "sales" && fillFrom) {
    state.cursors.salesSince = `${fillFrom}T00:00:00.000Z`;
  } else if (domain === "orders" && fillFrom) {
    state.cursors.ordersSince = `${fillFrom}T00:00:00.000Z`;
  } else if (domain === "fees" && fillFrom) {
    state.cursors.feesSince = `${fillFrom}T00:00:00.000Z`;
  } else if (domain === "catalog") {
    // 全量快照，不依赖 since
    state.cursors.catalogSince = null;
  } else if (domain === "stock") {
    state.cursors.stockSince = null;
  }
  await pullDomain(state, domain);
}

/**
 * @param shopIds 指定店；`undefined` 时默认健康门禁店（前两家）；`"all"` 审计全部 live 店
 */
function auditEligibleShops(
  shopIds: string[] | undefined | "all",
  lookbackDays?: number,
): ShopGapReport[] {
  const gate = new Set(getHealthGateShopIds());
  let shops = listLiveImpexShops();
  if (shopIds === "all") {
    // keep all live Impex shops
  } else if (shopIds?.length) {
    shops = shops.filter((s) => shopIds.includes(s.id));
  } else {
    shops = shops.filter((s) => gate.has(s.id));
  }
  return shops.map((s) => ({
    ...auditShopGaps(s.id, s.name, getShopState(s.id), { lookbackDays }),
    countsTowardHealth: gate.has(s.id),
  }));
}

async function backfillFeishu(actions: BackfillAction[]): Promise<void> {
  const shops = listEligibleSyncShops();
  try {
    const cfg = loadFeishuDocsConfig({ requireCredentials: true });
    const pull = await pullFeishuRaw(cfg, {
      docIds: ["product", "packing", "accounts"],
    });
    const fail = pull.results.filter((r) => !r.ok).length;
    const pullOk = fail === 0 && pull.results.some((r) => r.ok);
    if (!pullOk) {
      actions.push({
        shopId: "*",
        domain: "feishu",
        ok: false,
        message: `飞书 raw 失败 fail=${fail}`,
        channel: "feishu",
        detail: pull.results,
      });
      return;
    }
    const norm = normalizeFeishuRun({
      rawRunId: pull.runId,
      docIds: ["product", "packing", "accounts"],
    });
    const normFail = norm.results.filter((r) => !r.ok).length;
    if (normFail > 0) {
      actions.push({
        shopId: "*",
        domain: "feishu",
        ok: false,
        message: `飞书 normalize 失败 fail=${normFail}`,
        channel: "feishu",
        detail: norm.results,
      });
      return;
    }
    for (const shop of shops) {
      await runAsShopAsync(shop.id, async () => {
        const st = getShopState(shop.id);
        const report = ingestFeishuLocalIntoState(st);
        saveShopState(shop.id, st);
        actions.push({
          shopId: shop.id,
          domain: "feishu",
          ok: true,
          message: `飞书入库 成本+${report.cost.upserted} 尺寸+${report.dims.upserted} 采购+${report.purchase.upserted}`,
          channel: "feishu",
          detail: { normalizeRunId: norm.runId },
        });
      });
    }

    // 日报：能拉就拉；sheet 仍停在旧日期时写明口径
    try {
      const dailyPull = await pullFeishuRaw(cfg, { docIds: ["daily"] });
      const dailyOk = dailyPull.results.some((r) => r.ok && r.docId === "daily");
      if (dailyOk) {
        normalizeDailyBriefRun({ rawRunId: dailyPull.runId });
        for (const shop of shops) {
          await runAsShopAsync(shop.id, async () => {
            const st = getShopState(shop.id);
            const ops = ingestFeishuOpsIntoState(st);
            saveShopState(shop.id, st);
            actions.push({
              shopId: shop.id,
              domain: "feishu",
              ok: true,
              message: `飞书日报运营 +${ops.upserted} · sheet=${ops.sheetTitle ?? "?"}`,
              channel: "feishu-daily",
              detail: { sheetTitle: ops.sheetTitle },
            });
          });
        }
      }
    } catch (e) {
      actions.push({
        shopId: "*",
        domain: "feishu",
        ok: false,
        message:
          e instanceof Error
            ? `飞书日报：${e.message}`
            : `飞书日报：${String(e)}`,
        channel: "feishu-daily",
      });
    }
  } catch (e) {
    const msg = isFeishuError(e)
      ? formatFeishuError(e)
      : e instanceof Error
        ? e.message
        : String(e);
    actions.push({
      shopId: "*",
      domain: "feishu",
      ok: false,
      message: `飞书补拉失败：${msg}`,
      channel: "feishu",
    });
  }
}

async function backfillAdsPw(
  audits: ShopGapReport[],
  actions: BackfillAction[],
): Promise<void> {
  const adsGaps = audits
    .map((a) => ({
      shopId: a.shopId,
      gap: a.domains.find((d) => d.domain === "ads" && !d.ok),
    }))
    .filter((x): x is { shopId: string; gap: DomainGap } => Boolean(x.gap));

  if (!adsGaps.length) return;

  // 先尝试扫已有 portal-imports（可能已落盘但未入库）
  for (const { shopId, gap } of adsGaps) {
    await runAsShopAsync(shopId, async () => {
      const st = getShopState(shopId);
      const latest = await ingestLatestAdsFile(st);
      await runAutoIngest(st, { force: false });
      saveShopState(shopId, st);
      if (latest.ok && !latest.skipped) {
        actions.push({
          shopId,
          domain: "yingdao-ads",
          ok: true,
          message: `已入库最新广告文件 ${latest.fileName}`,
          fillFrom: gap.fillFrom,
          fillTo: gap.fillTo,
          channel: "portal-imports",
        });
      }
    });
  }

  // 重审：仍缺则主动触发 Playwright（不写 pending、不 spawn 影刀）
  const stillMissing = adsGaps.filter(({ shopId, gap }) => {
    const report = auditShopGaps(
      shopId,
      shopId,
      getShopState(shopId),
      { expectedEnd: gap.expectedEnd },
    );
    return report.domains.some((d) => d.domain === "ads" && !d.ok);
  });
  if (!stillMissing.length) return;

  const shopIds = stillMissing.map((x) => x.shopId);
  const worst = stillMissing.reduce((a, b) =>
    (a.gap.missingDates?.length ?? 0) >= (b.gap.missingDates?.length ?? 0)
      ? a
      : b,
  );
  const missingDays = Math.min(
    30,
    Math.max(1, worst.gap.missingDates?.length ?? 7),
  );
  // 多日缺口用 days；单日用 yesterday（与交接一致）
  const range = missingDays > 1 ? ("days" as const) : ("yesterday" as const);
  const days = missingDays;
  const fillFrom = worst.gap.fillFrom;
  const fillTo = worst.gap.fillTo;

  // 广告 cookie 缺失/过期时不要硬开导出：会弹登录/OTP，且旧逻辑可能刷新冲掉验证码
  const adsSession = getPwSessionStatus().sites.find((s) => s.site === "ads");
  if (
    adsSession &&
    (adsSession.level === "missing" || adsSession.level === "expired")
  ) {
    actions.push({
      shopId: shopIds.join(","),
      domain: "yingdao-ads",
      ok: false,
      skipped: true,
      message: `广告登录态不可用（${adsSession.message}）。请先到「Playwright 工作室 → 登录态 → 打开登录窗口（一次两边）」完成邮箱验证码；同窗会覆盖广告+卖家并复测，通过后再点一键补齐。缺口约 ${fillFrom}～${fillTo}`,
      fillFrom,
      fillTo,
      channel: "ads-pw",
      detail: adsSession,
    });
    for (const { shopId, gap } of stillMissing) {
      const state = getShopState(shopId);
      pushAlert(state, {
        level: "warning",
        title: "广告缺数：需先登录 Ad Manager",
        detail: `店铺 ${shopId} 缺广告 ${gap.fillFrom}～${gap.fillTo}。请先完成 Playwright 广告后台登录，再补齐或手动导出。`,
      });
      saveShopState(shopId, state);
    }
    return;
  }

  try {
    const st = startAdsPwExport({ shopIds, range, days });
    const ok =
      st.status === "running" || st.status === "starting" || st.status === "ok";
    actions.push({
      shopId: shopIds.join(","),
      domain: "yingdao-ads",
      ok,
      message: ok
        ? `已触发 Playwright 广告导出 · shops=${shopIds.join(",")} · ${st.message ?? ""} · 口径 ${range}${range === "days" ? `/${days}` : ""}（约 ${fillFrom}～${fillTo}）。若某店 Ad Manager 无权限会自动跳过并继续其它店`
        : `Playwright 未能启动：${st.message ?? "unknown"}。请手动：cd apps/api/scripts/noon-pw-platform && python main.py ads ui；或把 ads_sku_*.csv 放入各店 portal-imports`,
      fillFrom,
      fillTo,
      channel: "ads-pw",
      detail: getAdsPwExportStatus(),
    });
    if (!ok) {
      for (const { shopId, gap } of stillMissing) {
        const state = getShopState(shopId);
        pushAlert(state, {
          level: "warning",
          title: "广告缺数：Playwright 导出未触发成功",
          detail: `店铺 ${shopId} 缺广告 ${gap.fillFrom}～${gap.fillTo}。请跑 python main.py ui 或把 ads_sku_*.csv 放入 portal-imports 后汇总同步。`,
        });
        saveShopState(shopId, state);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    actions.push({
      shopId: shopIds.join(","),
      domain: "yingdao-ads",
      ok: false,
      message: `Playwright 广告导出异常：${msg}。需补链路：python main.py ads ui；口径 ${fillFrom}～${fillTo} 的 ads_sku 日报`,
      fillFrom,
      fillTo,
      channel: "ads-pw",
    });
  }
}

/**
 * 跑一轮补洞。并发调用排队。
 */
export async function runDataBackfill(
  opts: DataBackfillOptions = {},
): Promise<DataBackfillResult> {
  const run = async (): Promise<DataBackfillResult> => {
    if (running) {
      throw new Error("数据补洞正在进行中，请稍候");
    }
    running = true;
    const triggeredBy = opts.triggeredBy ?? "manual";
    const startedAt = new Date().toISOString();
    const runId = `bf_${startedAt.replace(/[:.]/g, "-")}`;
    const actions: BackfillAction[] = [];
    const maxPerShop = Math.max(1, opts.maxImpexPerShop ?? 2);
    const maxTotal = Math.max(1, opts.maxImpexTotal ?? 4);
    let impexTotal = 0;

    try {
      const audits = auditEligibleShops(opts.shopIds, opts.lookbackDays);
      const anyGap = audits.some((a) => !a.complete);

      if (!opts.skipFeishu && anyGap) {
        await backfillFeishu(actions);
      } else if (opts.skipFeishu) {
        actions.push({
          shopId: "*",
          domain: "feishu",
          ok: true,
          skipped: true,
          message: "跳过飞书",
          channel: "feishu",
        });
      }

      if (!opts.skipYingdao) {
        await backfillAdsPw(audits, actions);
      } else {
        actions.push({
          shopId: "*",
          domain: "yingdao-ads",
          ok: true,
          skipped: true,
          message: "跳过广告 RPA（Playwright）",
          channel: "yingdao-ads",
        });
      }

      if (!opts.skipNoon) {
        for (const report of audits) {
          if (impexTotal >= maxTotal) break;
          const state0 = getShopState(report.shopId);
          // 空 Catalog 且无销售：跳过 Impex，避免抢配额（新店凭证未配齐时常见）
          if (
            (state0.catalog?.length ?? 0) === 0 &&
            (state0.salesFacts?.length ?? 0) === 0
          ) {
            actions.push({
              shopId: report.shopId,
              domain: "catalog",
              ok: false,
              skipped: true,
              message:
                "跳过 Impex：Catalog/Sales 皆空（请先配凭证或手动拉 catalog，避免抢老店配额）",
              channel: "noon-impex",
            });
            continue;
          }
          if (isImpexCoolingDown(report.shopId)) {
            actions.push({
              shopId: report.shopId,
              domain: "sales",
              ok: false,
              skipped: true,
              message: "Impex 冷却中，本轮跳过 Noon 补拉",
              channel: "noon-impex",
            });
            continue;
          }

          const need = domainsNeedingFill(report)
            .filter((d) => isImpexDomain(d.domain))
            .sort(
              (a, b) =>
                IMPEX_ORDER.indexOf(a.domain) - IMPEX_ORDER.indexOf(b.domain),
            );

          let perShop = 0;
          for (const gap of need) {
            if (perShop >= maxPerShop || impexTotal >= maxTotal) break;
            if (!isImpexDomain(gap.domain)) continue;
            if (isImpexCoolingDown(report.shopId)) {
              actions.push({
                shopId: report.shopId,
                domain: gap.domain,
                ok: false,
                skipped: true,
                message: "Impex 冷却，停止该店后续域",
                fillFrom: gap.fillFrom,
                fillTo: gap.fillTo,
                channel: "noon-impex",
              });
              break;
            }

            try {
              await runAsShopAsync(report.shopId, async () => {
                const st = getShopState(report.shopId);
                await pullDomainCoveringGap(
                  st,
                  gap.domain,
                  gap.fillFrom,
                );
                saveShopState(report.shopId, st);
              });
              perShop += 1;
              impexTotal += 1;
              actions.push({
                shopId: report.shopId,
                domain: gap.domain,
                ok: true,
                message: `Impex ${gap.domain} 一次覆盖 ${gap.fillFrom}～${gap.fillTo}（解析按日归类入库）`,
                fillFrom: gap.fillFrom,
                fillTo: gap.fillTo,
                channel: "noon-impex",
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              actions.push({
                shopId: report.shopId,
                domain: gap.domain,
                ok: false,
                message: `Impex ${gap.domain} 失败：${msg}`,
                fillFrom: gap.fillFrom,
                fillTo: gap.fillTo,
                channel: "noon-impex",
              });
              if (isImpexLimitMessage(msg)) break;
            }
          }
        }
      } else {
        actions.push({
          shopId: "*",
          domain: "sales",
          ok: true,
          skipped: true,
          message: "跳过 Noon",
          channel: "noon-impex",
        });
      }

      clearCatalogAssembleCache();

      // 补完再审计摘要
      const after = auditEligibleShops(opts.shopIds, opts.lookbackDays);
      const still = after.filter((a) => !a.complete);
      const finishedAt = new Date().toISOString();
      const result: DataBackfillResult = {
        ok: still.length === 0,
        runId,
        triggeredBy,
        startedAt,
        finishedAt,
        message:
          still.length === 0
            ? `补洞完成 · 审计店 ${after.length} 齐全`
            : `补洞部分完成 · 仍有 ${still.length} 店缺口（Impex 已用 ${impexTotal}/${maxTotal}；可稍后重跑）`,
        audits: after,
        actions,
      };
      persistLast(result);
      console.log(`[data-backfill] ${result.message}`);
      return result;
    } catch (e) {
      const finishedAt = new Date().toISOString();
      const result: DataBackfillResult = {
        ok: false,
        runId,
        triggeredBy,
        startedAt,
        finishedAt,
        message: e instanceof Error ? e.message : String(e),
        audits: [],
        actions,
      };
      persistLast(result);
      throw e;
    } finally {
      running = false;
    }
  };

  const next = chain.then(run, run);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * 启动后延迟检查；有缺口才跑补洞。
 * OUTPOST_DATA_BACKFILL_ON_BOOT=0 关闭；默认开。
 * OUTPOST_DATA_BACKFILL_BOOT_DELAY_MS 默认 45s（避撞其它 boot 任务）
 */
export function scheduleBootDataBackfill(): void {
  const raw = process.env.OUTPOST_DATA_BACKFILL_ON_BOOT?.trim();
  const enabled =
    raw === undefined || raw === ""
      ? true
      : ["1", "true", "yes", "on"].includes(raw.toLowerCase());
  if (!enabled) {
    console.log("[data-backfill] boot check disabled");
    return;
  }
  const delay = Math.max(
    5_000,
    Number(process.env.OUTPOST_DATA_BACKFILL_BOOT_DELAY_MS ?? 45_000),
  );
  const t = setTimeout(() => {
    try {
      const audits = auditEligibleShops(undefined);
      const need = audits.filter((a) => !a.complete);
      if (!need.length) {
        console.log("[data-backfill] boot: all shops complete, skip");
        return;
      }
      console.log(
        `[data-backfill] boot: ${need.length} shop(s) incomplete → start`,
      );
      void runDataBackfill({ triggeredBy: "boot" }).catch((err) => {
        console.error("[data-backfill] boot failed", err);
      });
    } catch (e) {
      console.error("[data-backfill] boot audit failed", e);
    }
  }, delay);
  if (typeof t.unref === "function") t.unref();
  console.log(`[data-backfill] boot check in ${delay}ms`);
}

/** 数据对齐页：审计全部 live 店；总览成败只看 countsTowardHealth */
export function auditAllShopGaps(lookbackDays?: number): ShopGapReport[] {
  return auditEligibleShops("all", lookbackDays);
}

export function healthGateComplete(audits: ShopGapReport[]): boolean {
  const gated = audits.filter((a) => a.countsTowardHealth);
  if (!gated.length) return audits.every((a) => a.complete);
  return gated.every((a) => a.complete);
}
