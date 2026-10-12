import { Router } from "express";
import type { AdsFact, AppState } from "../../common/types.js";
import { requireAdmin } from "../../auth/middleware.js";
import {
  buildCatalogDisplayMap,
  catalogDisplayOf,
} from "../../common/catalog-display.js";
import { assessAdsFreshness } from "./ads-freshness.js";
import {
  getAdsPwExportStatus,
  mapAdsPwRunToRequestStatus,
  startAdsPwExport,
} from "./ads-pw-cli.js";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function roas(spend: number, revenue: number) {
  return spend > 0 ? round2(revenue / spend) : null;
}

function parseExportBody(body: Record<string, unknown>) {
  let shopIds: string[] = [];
  if (Array.isArray(body.shopIds)) {
    shopIds = body.shopIds.map((x) => String(x || "").trim()).filter(Boolean);
  } else if (typeof body.shopId === "string" && body.shopId.trim()) {
    shopIds = [body.shopId.trim()];
  }
  const rangeRaw = String(body.range || "yesterday").toLowerCase();
  const range = rangeRaw === "days" ? ("days" as const) : ("yesterday" as const);
  const daysNum = Number(body.days);
  const days = Number.isFinite(daysNum)
    ? daysNum
    : range === "yesterday"
      ? 1
      : 7;
  return { shopIds, range, days };
}

/**
 * 广告管理：主存 adsFacts（Noon Ads Campaign Overview SKU CSV）。
 */
export function createAdsRouter(getState: () => AppState) {
  const router = Router();

  router.get("/summary", (_req, res) => {
    const facts = getState().adsFacts;
    let spend = 0;
    let revenue = 0;
    let orders = 0;
    let clicks = 0;
    let views = 0;
    let atc = 0;
    const skus = new Set<string>();
    const campaigns = new Set<string>();
    let fromDate = "";
    let toDate = "";
    for (const f of facts) {
      spend += f.spend;
      revenue += f.revenue;
      orders += f.orders;
      clicks += f.clicks;
      views += f.views;
      atc += f.atc ?? 0;
      skus.add(f.partnerSku);
      if (f.campaign) campaigns.add(f.campaign);
      if (!fromDate || f.fromDate < fromDate) fromDate = f.fromDate;
      if (!toDate || f.toDate > toDate) toDate = f.toDate;
    }
    res.json({
      data: {
        source: "NOON adsFacts (Playwright CSV)",
        factCount: facts.length,
        skuCount: skus.size,
        campaignCount: campaigns.size,
        spend: round2(spend),
        revenue: round2(revenue),
        orders,
        clicks,
        views,
        atc,
        roas: roas(spend, revenue),
        reportFrom: fromDate || null,
        reportTo: toDate || null,
      },
    });
  });

  router.get("/facts", (_req, res) => {
    const state = getState();
    const display = buildCatalogDisplayMap(state);
    const facts = [...state.adsFacts]
      .map((f) => serializeFact(f, display))
      .sort((a, b) => {
        const ai = a.imageUrl ? 0 : 1;
        const bi = b.imageUrl ? 0 : 1;
        if (ai !== bi) return ai - bi;
        if (a.toDate !== b.toDate) return b.toDate.localeCompare(a.toDate);
        if (a.partnerSku !== b.partnerSku) {
          return a.partnerSku.localeCompare(b.partnerSku);
        }
        return a.campaign.localeCompare(b.campaign);
      });
    res.json({
      data: facts.slice(0, 500),
      meta: { source: "NOON adsFacts", total: facts.length },
    });
  });

  router.get("/by-sku", (_req, res) => {
    const state = getState();
    const display = buildCatalogDisplayMap(state);
    const map = new Map<
      string,
      {
        partnerSku: string;
        spend: number;
        revenue: number;
        orders: number;
        clicks: number;
        views: number;
        atc: number;
        campaigns: Set<string>;
        fromDate: string;
        toDate: string;
      }
    >();
    for (const f of state.adsFacts) {
      const row = map.get(f.partnerSku) ?? {
        partnerSku: f.partnerSku,
        spend: 0,
        revenue: 0,
        orders: 0,
        clicks: 0,
        views: 0,
        atc: 0,
        campaigns: new Set<string>(),
        fromDate: f.fromDate,
        toDate: f.toDate,
      };
      row.spend += f.spend;
      row.revenue += f.revenue;
      row.orders += f.orders;
      row.clicks += f.clicks;
      row.views += f.views;
      row.atc += f.atc ?? 0;
      if (f.campaign) row.campaigns.add(f.campaign);
      if (f.fromDate < row.fromDate) row.fromDate = f.fromDate;
      if (f.toDate > row.toDate) row.toDate = f.toDate;
      map.set(f.partnerSku, row);
    }
    const rows = [...map.values()]
      .map((r) => {
        const d = catalogDisplayOf(display, r.partnerSku);
        return {
          partnerSku: r.partnerSku,
          catalogPartnerSku: d.partnerSku || null,
          title: d.title,
          imageUrl: d.imageUrl,
          spend: round2(r.spend),
          revenue: round2(r.revenue),
          orders: r.orders,
          clicks: r.clicks,
          views: r.views,
          atc: r.atc,
          campaignCount: r.campaigns.size,
          roas: roas(r.spend, r.revenue),
          fromDate: r.fromDate,
          toDate: r.toDate,
        };
      })
      .sort((a, b) => {
        const ai = a.imageUrl ? 0 : 1;
        const bi = b.imageUrl ? 0 : 1;
        if (ai !== bi) return ai - bi;
        return b.spend - a.spend;
      });
    res.json({
      data: rows.slice(0, 200),
      meta: { source: "NOON adsFacts", total: rows.length },
    });
  });

  /** 当前店 adsFacts 是否已覆盖本地「昨天」（Listing 优先复用凌晨导出） */
  router.get("/freshness", (_req, res) => {
    const freshness = assessAdsFreshness(getState());
    res.json({
      data: freshness,
      meta: {
        hint: freshness.hasYesterday
          ? "已有昨日广告 facts，Listing 可直接「绑定并清洗指标」"
          : "无昨日广告 facts：可在广告页「导出广告表」，或先汇总同步",
      },
    });
  });

  /**
   * Listing 按需：有昨日则复用；缺昨日或 force 才启动 Playwright 导出（不写 pending）。
   * body: { shopIds?: string[]; force?: boolean; range?: "yesterday"|"days"; days?: number }
   */
  router.post("/ensure-export", (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const force = Boolean(body.force);
      const freshness = assessAdsFreshness(getState());
      if (!force && freshness.hasYesterday) {
        res.json({
          data: {
            action: "reuse" as const,
            freshness,
            request: null,
          },
          meta: {
            hint: `已复用昨日数据（${freshness.yesterday}，${freshness.yesterdaySkuCount} SKU）。可直接绑定指标；强制重拉请传 force=true`,
          },
        });
        return;
      }
      const { shopIds, range, days } = parseExportBody(body);
      const run = startAdsPwExport({ shopIds, range, days });
      res.json({
        data: {
          action: "requested" as const,
          freshness,
          request: {
            type: "ads_export_pw",
            requestId: run.runId,
            shopIds: run.opts?.shopIds ?? shopIds,
            range: run.opts?.range ?? range,
            days: run.opts?.days ?? days,
            requestedAt: run.startedAt,
          },
        },
        meta: {
          hint: force
            ? "已强制启动 Playwright 广告导出；完成后请汇总同步再绑定"
            : "无昨日数据，已启动 Playwright 广告导出；完成后请汇总同步再绑定",
        },
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "按需导出失败",
      });
    }
  });

  /**
   * 无条件启动 Playwright 导出（不写 pending）。Listing 日常请用 /ensure-export。
   */
  router.post("/request-export", (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const { shopIds, range, days } = parseExportBody(body);
      const run = startAdsPwExport({ shopIds, range, days });
      res.json({
        data: {
          type: "ads_export_pw",
          requestId: run.runId,
          shopIds: run.opts?.shopIds ?? shopIds,
          range: run.opts?.range ?? range,
          days: run.opts?.days ?? days,
          requestedAt: run.startedAt,
          status: run.status,
          message: run.message,
        },
        meta: {
          hint: "已启动 Playwright 广告导出；完成后点「同步广告」入库",
        },
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "创建导出请求失败",
      });
    }
  });

  router.get("/request-export/:requestId", (req, res) => {
    const status = mapAdsPwRunToRequestStatus(String(req.params.requestId));
    res.json({ data: status });
  });

  /**
   * 一键启动 Playwright 广告导出（真正 spawn python main.py ui）。
   * 路径保持 /yingdao-export/* 兼容旧前端；需管理员；异步返回。
   */
  router.post("/yingdao-export/run", requireAdmin, (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const { shopIds, range, days } = parseExportBody(body);
    const data = startAdsPwExport({ shopIds, range, days });
    res.json({
      data: {
        status: data.status,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        pid: data.pid,
        exitCode: data.exitCode,
        message: data.message,
        runId: data.runId,
        taskId: data.runId,
      },
      meta: {
        hint:
          data.status === "running" || data.status === "starting"
            ? "Playwright 已启动，请等导出落到 portal-imports 后再点「同步广告」"
            : data.message,
      },
    });
  });

  router.get("/yingdao-export/status", (_req, res) => {
    const data = getAdsPwExportStatus();
    res.json({
      data: {
        status: data.status,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        pid: data.pid,
        exitCode: data.exitCode,
        message: data.message,
        runId: data.runId,
        taskId: data.runId,
      },
    });
  });

  return router;
}

function serializeFact(f: AdsFact, display: Map<string, { title: string; imageUrl: string; partnerSku?: string }>) {
  const d = catalogDisplayOf(display, f.partnerSku);
  return {
    ...f,
    catalogPartnerSku: d.partnerSku || null,
    title: d.title,
    imageUrl: d.imageUrl,
    roas: roas(f.spend, f.revenue),
  };
}
