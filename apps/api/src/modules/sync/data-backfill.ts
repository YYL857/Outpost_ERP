/**
 * 数据对齐 · 一键补齐：
 * - 只扫本地已有数据（portal-imports / 店内 state / 已落盘飞书）尝试补缺口
 * - 不再自动跑 Impex、Playwright 广告导出、飞书远端拉取
 * - 仍缺则给出明确指引：去哪个功能、取什么时段/口径
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ingestFeishuLocalIntoState } from "../../platforms/feishu/ingest/local.js";
import { ingestFeishuOpsIntoState } from "../../platforms/feishu/ingest/ops.js";
import {
  ingestLatestAdsFile,
  ingestLatestSalesFile,
  runAutoIngest,
} from "../../platforms/noon/portal/auto-ingest.js";
import {
  getShopState,
  runAsShopAsync,
  saveShopState,
} from "../../shops/state-cache.js";
import { getHealthGateShopIds } from "../../shops/registry.js";
import { listLiveImpexShops, listEligibleSyncShops } from "./multi-shop-sync.js";
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
  /** @deprecated 一键补齐不再拉远程；保留字段以免旧客户端报错 */
  skipNoon?: boolean;
  /** @deprecated 同上 */
  skipFeishu?: boolean;
  /** @deprecated 同上（旧名 skipYingdao） */
  skipYingdao?: boolean;
  maxImpexPerShop?: number;
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

const DOMAIN_ZH: Record<string, string> = {
  sales: "销量",
  orders: "订单",
  ads: "广告",
  catalog: "商品目录",
  stock: "库存",
  fees: "平台费用",
};

/** 缺口仍在：告诉人去哪取、取什么时段（不自动开爬虫） */
function guidanceForGap(shopId: string, gap: DomainGap): BackfillAction {
  const range =
    gap.fillFrom && gap.fillTo
      ? `${gap.fillFrom}～${gap.fillTo}`
      : gap.expectedEnd
        ? `覆盖至 ${gap.expectedEnd}`
        : "按页面期望截止日";
  const zh = DOMAIN_ZH[gap.domain] ?? gap.domain;

  let message: string;
  let channel: string = gap.channel;
  let domain: BackfillAction["domain"] = gap.domain;

  switch (gap.domain) {
    case "ads":
      domain = "yingdao-ads";
      channel = "guide-ads-pw";
      message =
        `还缺 ${zh}（${range}）。` +
        `请到「爬虫工作台 → 广告导出」选店 ${shopId}，时间覆盖 ${range}（只要一天就把起止都设成同一天），导出完成后再回本页点一键补齐。`;
      break;
    case "sales":
      channel = "guide-sales";
      message =
        `还缺 ${zh}（${range}）。` +
        `请到「爬虫工作台 → 销量导出」导出覆盖 ${range}，或到「NOON 接入 / 汇总同步」拉销售；完成后再回本页点一键补齐。`;
      break;
    case "orders":
      channel = "guide-impex";
      message =
        `还缺订单（${range}）。` +
        `请到「NOON 接入」或「汇总同步」拉该店订单，覆盖 ${range}，完成后再点一键补齐。`;
      break;
    case "catalog":
      channel = "guide-impex";
      message =
        `商品目录未更新到 ${gap.expectedEnd}。` +
        `请到「NOON 接入」或「汇总同步」拉该店商品目录，完成后再点一键补齐。`;
      break;
    case "stock":
      channel = "guide-impex";
      message =
        `库存未更新到 ${gap.expectedEnd}。` +
        `请到「NOON 接入」或「汇总同步」拉该店库存，完成后再点一键补齐。`;
      break;
    case "fees":
      channel = "guide-impex";
      message =
        `平台费用未更新到 ${gap.expectedEnd}。` +
        `请到「NOON 接入」或「汇总同步」拉该店费用，完成后再点一键补齐。`;
      break;
    default:
      message = `还缺 ${zh}（${range}）。请到对应功能取数后再点一键补齐。`;
  }

  return {
    shopId,
    domain,
    ok: false,
    skipped: true,
    message,
    fillFrom: gap.fillFrom,
    fillTo: gap.fillTo,
    channel,
  };
}

/** 扫各店 portal-imports + 已落盘飞书，尝试入库补洞 */
async function alignFromLocalTables(
  audits: ShopGapReport[],
  actions: BackfillAction[],
): Promise<void> {
  const shopIds = [...new Set(audits.map((a) => a.shopId))];

  for (const shopId of shopIds) {
    const before = audits.find((a) => a.shopId === shopId);
    const needDomains = before ? domainsNeedingFill(before) : [];
    if (!needDomains.length && before?.complete) continue;

    await runAsShopAsync(shopId, async () => {
      const st = getShopState(shopId);
      const needAds = needDomains.some((d) => d.domain === "ads");
      const needSales = needDomains.some((d) => d.domain === "sales");

      const auto = await runAutoIngest(st, { force: false });
      actions.push({
        shopId,
        domain: "catalog",
        ok: true,
        message: `检查已导出文件：共 ${auto.scanned} 个 · 新对齐 ${auto.imported} · 无需重复 ${auto.skipped}${
          auto.failed.length ? ` · 失败 ${auto.failed.length}` : ""
        }`,
        channel: "portal-imports",
        detail: {
          imported: auto.details,
          failed: auto.failed.slice(0, 8),
        },
      });

      if (needAds || !before?.complete) {
        const ads = await ingestLatestAdsFile(st);
        if (ads.ok && !ads.skipped) {
          actions.push({
            shopId,
            domain: "yingdao-ads",
            ok: true,
            message: `已对齐广告导出 ${ads.reportFrom ?? "?"}～${ads.reportTo ?? "?"}（${ads.count ?? 0} 行）`,
            fillFrom: ads.reportFrom,
            fillTo: ads.reportTo,
            channel: "portal-imports",
          });
        } else if (needAds) {
          actions.push({
            shopId,
            domain: "yingdao-ads",
            ok: true,
            skipped: true,
            message: "暂无可用的广告导出可对齐",
            channel: "portal-imports",
          });
        }
      }

      if (needSales || !before?.complete) {
        const sales = await ingestLatestSalesFile(st);
        if (sales.ok && !sales.skipped) {
          actions.push({
            shopId,
            domain: "sales",
            ok: true,
            message: `已对齐销量导出 ${sales.reportFrom ?? "?"}～${sales.reportTo ?? "?"}（${sales.count ?? 0} 行）`,
            fillFrom: sales.reportFrom,
            fillTo: sales.reportTo,
            channel: "portal-imports",
          });
        } else if (needSales) {
          actions.push({
            shopId,
            domain: "sales",
            ok: true,
            skipped: true,
            message: "暂无可用的销量导出可对齐",
            channel: "portal-imports",
          });
        }
      }

      saveShopState(shopId, st);
    });
  }

  // 飞书：只吃本机已 normalize 的表，不远端 pull
  for (const shop of listEligibleSyncShops()) {
    if (shopIds.length && !shopIds.includes(shop.id)) continue;
    try {
      await runAsShopAsync(shop.id, async () => {
        const st = getShopState(shop.id);
        const report = ingestFeishuLocalIntoState(st);
        const ops = ingestFeishuOpsIntoState(st);
        saveShopState(shop.id, st);
        const touched =
          report.cost.upserted +
            report.dims.upserted +
            report.purchase.upserted +
            ops.upserted >
          0;
        if (touched) {
          actions.push({
            shopId: shop.id,
            domain: "feishu",
            ok: true,
            message: `已对齐飞书本地数据：成本+${report.cost.upserted} 尺寸+${report.dims.upserted} 采购+${report.purchase.upserted} 日报+${ops.upserted}`,
            channel: "feishu-local",
          });
        }
      });
    } catch {
      // 无飞书本地产物时静默跳过，不吓唬业务同事
    }
  }
}

function appendGuidanceForRemaining(
  after: ShopGapReport[],
  actions: BackfillAction[],
): void {
  for (const report of after) {
    if (report.complete) continue;
    for (const gap of domainsNeedingFill(report)) {
      actions.push(guidanceForGap(report.shopId, gap));
    }
  }
}

/**
 * 跑一轮「扫表补齐」。并发调用排队。
 * 不触发 Impex / Playwright / 飞书远端拉取。
 */
export async function runDataBackfill(
  opts: DataBackfillOptions = {},
): Promise<DataBackfillResult> {
  const run = async (): Promise<DataBackfillResult> => {
    if (running) {
      throw new Error("数据补齐正在进行中，请稍候");
    }
    running = true;
    const triggeredBy = opts.triggeredBy ?? "manual";
    const startedAt = new Date().toISOString();
    const runId = `bf_${startedAt.replace(/[:.]/g, "-")}`;
    const actions: BackfillAction[] = [];

    try {
      const audits = auditEligibleShops(opts.shopIds, opts.lookbackDays);
      const anyGap = audits.some((a) => !a.complete);

      if (!anyGap) {
        const finishedAt = new Date().toISOString();
        const result: DataBackfillResult = {
          ok: true,
          runId,
          triggeredBy,
          startedAt,
          finishedAt,
          message: `各店数据已齐，无需补齐（已查 ${audits.length} 店）`,
          audits,
          actions: [
            {
              shopId: "*",
              domain: "sales",
              ok: true,
              skipped: true,
              message: "无缺口",
              channel: "none",
            },
          ],
        };
        persistLast(result);
        console.log(`[data-backfill] ${result.message}`);
        return result;
      }

      await alignFromLocalTables(audits, actions);
      clearCatalogAssembleCache();

      const after = auditEligibleShops(opts.shopIds, opts.lookbackDays);
      appendGuidanceForRemaining(after, actions);

      const still = after.filter((a) => !a.complete);
      const filledHints = actions.filter(
        (a) => a.ok && !a.skipped && a.channel === "portal-imports",
      ).length;
      const guides = actions.filter((a) =>
        String(a.channel || "").startsWith("guide-"),
      ).length;
      const finishedAt = new Date().toISOString();
      const result: DataBackfillResult = {
        ok: still.length === 0,
        runId,
        triggeredBy,
        startedAt,
        finishedAt,
        message:
          still.length === 0
            ? `对齐完成 · ${after.length} 店数据已齐`
            : `对齐结束 · 仍有 ${still.length} 店缺口（${guides} 条取数提示）。请按明细说明取数后再点一键补齐。`,
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

/** 审计全部 live Impex 店（数据对齐页用） */
export function auditAllShopGaps(lookbackDays?: number): ShopGapReport[] {
  return auditEligibleShops("all", lookbackDays);
}

/** 仅门禁店齐全才算总览成功 */
export function healthGateComplete(audits: ShopGapReport[]): boolean {
  const gated = audits.filter((a) => a.countsTowardHealth);
  if (!gated.length) return audits.every((a) => a.complete);
  return gated.every((a) => a.complete);
}

/**
 * 启动后延迟扫表补齐（不拉远程）。
 * OUTPOST_DATA_BACKFILL_ON_BOOT=0 关闭；默认开。
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
      const need = auditEligibleShops(undefined).filter((a) => !a.complete);
      if (!need.length) {
        console.log("[data-backfill] boot: all shops complete, skip");
        return;
      }
      console.log(
        `[data-backfill] boot: ${need.length} shop(s) incomplete → scan local`,
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
