import { Router } from "express";
import { z } from "zod";
import type { AppState } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { requireAdmin } from "../../auth/middleware.js";
import { createNoonClient } from "../../platforms/noon/index.js";
import type { NoonWebhookEnvelope } from "../../platforms/noon/types.js";
import { importPortalContent } from "../../platforms/noon/portal/import-service.js";
import { runAutoIngest } from "../../platforms/noon/portal/auto-ingest.js";
import { runAutoSync } from "../../platforms/noon/portal/auto-sync.js";
import {
  getNoonCredentialsPath,
  readNoonCredentialsFile,
} from "../../platforms/noon/http.js";
import { enqueueInbox } from "../sync/inbox.js";
import { processPendingInbox } from "../sync/pipeline.js";
import { pushAlert } from "../sync/alerts.js";

const portalSchema = z.object({
  portalUrl: z.string(),
  cookie: z.string().optional(),
  ordersUrl: z.string(),
  catalogUrl: z.string(),
  stockUrl: z.string(),
});

const connectionSchema = z.object({
  mode: z.enum(["mock", "live", "portal"]),
  partnerId: z.string(),
  apiKey: z.string(),
  apiSecret: z.string(),
  webhookSecret: z.string(),
  baseUrl: z.string().min(1),
  countryCode: z.enum(["sa", "ae", "eg"]),
  enabled: z.boolean(),
  portal: portalSchema.optional(),
});

const importSchema = z.object({
  domain: z.enum(["orders", "catalog", "stock", "sales", "fees", "ads"]),
  content: z.string().min(1),
  format: z.enum(["csv", "json", "auto"]).optional(),
  filename: z.string().optional(),
});

function maskSecret(value: string) {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function publicNoon(state: AppState) {
  const noon = state.noon;
  const cred = readNoonCredentialsFile();
  const credentialsFilePath = getNoonCredentialsPath();
  return {
    ...noon,
    apiKey: maskSecret(noon.apiKey),
    apiSecret: maskSecret(noon.apiSecret),
    webhookSecret: maskSecret(noon.webhookSecret),
    partnerApi: {
      credentialsFilePath,
      credentialsPresent: Boolean(cred),
      projectCode: cred?.project_code ?? null,
      keyIdSuffix: cred?.key_id ? maskSecret(cred.key_id) : null,
    },
    portal: {
      portalUrl: noon.portal.portalUrl,
      ordersUrl: noon.portal.ordersUrl,
      catalogUrl: noon.portal.catalogUrl,
      stockUrl: noon.portal.stockUrl,
      lastFetchAt: noon.portal.lastFetchAt,
      lastImportAt: noon.portal.lastImportAt,
      lastImportSummary: noon.portal.lastImportSummary,
    },
    platform: "NOON",
    acquisition: {
      primary: noon.mode === "live" ? "partner-api" : "portal-imports",
      note:
        noon.mode === "live"
          ? "Partner API（Service Account JWT + Impex 导出）"
          : "portal-imports / 手工 CSV 入库；广告等无 Impex 域可用影刀投递",
    },
    integrationSlots: {
      portalParsers: "apps/api/src/platforms/noon/portal/parsers.ts",
      portalImport: "POST /api/noon/portal/import",
      portalAutoIngest: "POST /api/noon/portal/auto-ingest",
      portalAutoSync: "POST /api/noon/portal/auto-sync",
      liveClient: "apps/api/src/platforms/noon/live-client.ts",
      impexClient: "apps/api/src/platforms/noon/impex-client.ts",
      credentialsEnv: "OUTPOST_NOON_CREDENTIALS_FILE",
      inbox: "apps/api/src/modules/sync/inbox.ts",
    },
    portalCache: {
      orders: state.portalCache.orders.length,
      catalog: state.portalCache.catalog.length,
      stock: state.portalCache.stock.length,
      sales: state.portalCache.sales?.length ?? 0,
      fees: state.portalCache.fees?.length ?? 0,
      ads: state.portalCache.ads?.length ?? 0,
      updatedAt: state.portalCache.updatedAt,
    },
  };
}

export function createNoonRouter(getState: () => AppState) {
  const router = Router();

  router.get("/connection", (_req, res) => {
    res.json({ data: publicNoon(getState()) });
  });

  /** 分域映射状态：一源一域一主页（见 docs/NOON_OUTPOST_DATA_MAP.md） */
  router.get("/domain-map", (_req, res) => {
    const state = getState();
    const live = state.noon.mode === "live";
    const rows = [
      {
        domain: "catalog",
        noonSource: live
          ? "Impex noon_catalog_catalogexport"
          : "Catalog Exports live/notlive",
        count: state.catalog.length,
        primaryPage: "Catalog",
        refs: ["链接上架"],
        mapped: true,
        wave: 1,
      },
      {
        domain: "stock",
        noonSource: live
          ? "Impex FBN ledger + catalog stock hints"
          : "Inventory / FBN detailed",
        count: state.stock.length,
        primaryPage: "Catalog（库存列）",
        refs: ["补货计划", "物流管理"],
        mapped: true,
        wave: 1,
      },
      {
        domain: "orders",
        noonSource: live
          ? "Impex noon_noonoms_ordersexport"
          : "Orders CSV / portal-imports",
        count: state.orders.length,
        primaryPage: "销量统计 / 同步健康",
        refs: ["Best Sell", "财务报表"],
        mapped: true,
        wave: 1,
      },
      {
        domain: "sales",
        noonSource: live
          ? "Impex noon_catalog_reports_productviewsandsalesdata"
          : "Sales export / 影刀 inbox 兜底",
        count: state.salesFacts.length,
        primaryPage: "销量统计",
        refs: ["Catalog 7日销量"],
        mapped: true,
        wave: 1,
      },
      {
        domain: "fees",
        noonSource: live
          ? "Impex noon_financeweb_transactionviewreportonitemlevel"
          : "Transaction View / 影刀 inbox 兜底",
        count: state.feeSnapshots.length,
        primaryPage: "财务报表",
        refs: ["Catalog 毛利列"],
        mapped: true,
        wave: 1,
      },
      {
        domain: "ads",
        noonSource:
          "无官方 Impex · 影刀 Ad Manager Export all → portal-imports CSV",
        count: state.adsFacts.length,
        primaryPage: "广告管理",
        refs: ["Catalog 投产比"],
        mapped: true,
        wave: 2,
      },
      {
        domain: "campaigns",
        noonSource: "Campaigns（待探测确认）",
        count: 0,
        primaryPage: "活动管理",
        refs: [],
        mapped: false,
        wave: 2,
      },
    ];
    res.json({
      data: rows,
      meta: {
        doc: "docs/NOON_OUTPOST_DATA_MAP.md",
        lastImportSummary: state.noon.portal?.lastImportSummary ?? null,
      },
    });
  });

  router.put("/connection", (req, res) => {
    const parsed = connectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "NOON 接入参数无效", details: parsed.error.flatten() });
      return;
    }
    const state = getState();
    const prev = state.noon;
    const next = parsed.data;

    state.noon = {
      ...prev,
      ...next,
      apiKey: next.apiKey.includes("*") ? prev.apiKey : next.apiKey,
      apiSecret: next.apiSecret.includes("*") ? prev.apiSecret : next.apiSecret,
      webhookSecret: next.webhookSecret.includes("*")
        ? prev.webhookSecret
        : next.webhookSecret,
      portal: {
        ...prev.portal,
        portalUrl: next.portal?.portalUrl ?? prev.portal.portalUrl,
        ordersUrl: next.portal?.ordersUrl ?? prev.portal.ordersUrl,
        catalogUrl: next.portal?.catalogUrl ?? prev.portal.catalogUrl,
        stockUrl: next.portal?.stockUrl ?? prev.portal.stockUrl,
        // Cookie 字段已废弃，保持空字符串兼容旧 state
        cookie: "",
        lastFetchAt: prev.portal.lastFetchAt,
        lastImportAt: prev.portal.lastImportAt,
        lastImportSummary: prev.portal.lastImportSummary,
      },
      lastError: null,
    };
    saveState(state);
    res.json({ data: publicNoon(state) });
  });

  router.post("/connection/validate", async (_req, res) => {
    const state = getState();
    const client = createNoonClient(state);
    const result = await client.validateCredentials();
    state.noon.lastValidatedAt = new Date().toISOString();
    state.noon.lastError = result.ok ? null : result.message;
    if (!result.ok) {
      pushAlert(state, {
        level: "warning",
        title: "NOON 接入校验未通过",
        detail: result.message,
      });
    }
    saveState(state);
    res.status(result.ok ? 200 : 400).json({ data: result });
  });

  /** 兜底：手工导入 CSV/JSON（日常请用自动同步） */
  router.post("/portal/import", requireAdmin, async (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "导入参数无效", details: parsed.error.flatten() });
      return;
    }
    const state = getState();
    try {
      const result = importPortalContent(state, parsed.data);
      for (let i = 0; i < 50; i++) {
        const { processed } = await processPendingInbox(state, 200);
        if (!processed) break;
      }
      res.json({
        data: result,
        message: "已导入并写入 Inbox，业务库已更新",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushAlert(state, {
        level: "danger",
        title: "门户文件导入失败",
        detail: message,
      });
      res.status(400).json({ error: message });
    }
  });

  /** 扫描 portal-imports 自动入库 */
  router.post("/portal/auto-ingest", requireAdmin, async (req, res) => {
    const state = getState();
    try {
      const force = Boolean(req.body?.force);
      const result = await runAutoIngest(state, { force });
      res.json({
        data: result,
        message: state.noon.portal.lastImportSummary,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushAlert(state, {
        level: "danger",
        title: "自动入库失败",
        detail: message,
      });
      res.status(400).json({ error: message });
    }
  });

  /**
   * 全自动同步：live → Partner API Impex；portal → 扫描 portal-imports 入库
   * body.skipSop / skipProbe 已废弃，忽略
   */
  router.post("/portal/auto-sync", requireAdmin, async (req, res) => {
    const state = getState();
    try {
      const forceIngest = Boolean(req.body?.forceIngest);
      const result = await runAutoSync(state, { forceIngest });
      res.json({
        data: result,
        message: result.message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushAlert(state, {
        level: "danger",
        title: "自动同步失败",
        detail: message,
      });
      saveState(state);
      res.status(400).json({ error: message });
    }
  });

  router.get("/portal/cache", (_req, res) => {
    const state = getState();
    res.json({
      data: {
        counts: {
          orders: state.portalCache.orders.length,
          catalog: state.portalCache.catalog.length,
          stock: state.portalCache.stock.length,
          sales: state.portalCache.sales?.length ?? 0,
          fees: state.portalCache.fees?.length ?? 0,
          ads: state.portalCache.ads?.length ?? 0,
        },
        updatedAt: state.portalCache.updatedAt,
        lastImportAt: state.noon.portal.lastImportAt,
        lastFetchAt: state.noon.portal.lastFetchAt,
        lastImportSummary: state.noon.portal.lastImportSummary,
        sample: {
          orders: state.portalCache.orders.slice(0, 3),
          catalog: state.portalCache.catalog.slice(0, 3),
          stock: state.portalCache.stock.slice(0, 3),
          sales: (state.portalCache.sales ?? []).slice(0, 3),
          fees: (state.portalCache.fees ?? []).slice(0, 3),
          ads: (state.portalCache.ads ?? []).slice(0, 3),
        },
      },
    });
  });

  router.get("/portal/template/:domain", (req, res) => {
    const domain = req.params.domain;
    if (domain === "orders") {
      res.type("text/csv").send(
        "order_nr,status,currency,total_amount,item_count,placed_at,updated_at\nNR-DEMO-001,confirmed,SAR,120,2,2026-01-01T10:00:00Z,2026-01-02T10:00:00Z\n",
      );
      return;
    }
    if (domain === "catalog") {
      res.type("text/csv").send(
        "partner_sku,noon_sku,title,is_active,price,currency,listing_type,image_url,updated_at\nN1-SAMPLE,Z-SAMPLE,Sample Product,true,68.9,SAR,自建,,2026-01-02T10:00:00Z\n",
      );
      return;
    }
    if (domain === "stock") {
      res.type("text/csv").send(
        "partner_sku,warehouse_code,fulfillment,qty,in_transit_qty,updated_at\nN1-SAMPLE,WH-SA-01,fbn,4,0,2026-01-02T10:00:00Z\n",
      );
      return;
    }
    if (domain === "sales") {
      res.type("text/csv").send(
        "partner_sku,date,units,amount,updated_at\nN1-SAMPLE,2026-01-02,2,137.8,2026-01-02T10:00:00Z\n",
      );
      return;
    }
    if (domain === "fees") {
      res.type("text/csv").send(
        "partner_sku,commission_rate,outbound_fee,tax_amount,updated_at\nN1-SAMPLE,0.15,7,2.6,2026-01-02T10:00:00Z\n",
      );
      return;
    }
    if (domain === "ads") {
      res.type("text/csv").send(
        "sku,campaign_name,from_date,to_date,spend,revenue,orders,views,clicks,atc\nN1-SAMPLE,PLA Auto,2026-09-01,2026-09-07,50,200,4,1000,80,25\n",
      );
      return;
    }
    res.status(404).json({ error: "未知模板" });
  });

  router.post("/webhook", async (req, res) => {
    const state = getState();
    const secret = req.header("x-noon-webhook-secret") ?? "";
    if (state.noon.webhookSecret && secret !== state.noon.webhookSecret) {
      pushAlert(state, {
        level: "danger",
        title: "NOON Webhook 鉴权失败",
        detail: "请求密钥不匹配，事件未入库",
      });
      res.status(401).json({ error: "invalid webhook secret" });
      return;
    }

    const body = req.body as NoonWebhookEnvelope;
    const eventId =
      body?.event_id ?? `wh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const orderNr = body?.payload?.order_nr;

    if (!orderNr) {
      pushAlert(state, {
        level: "warning",
        title: "NOON Webhook 缺少 order_nr",
        detail: "已拒绝该事件",
      });
      res.status(400).json({ error: "payload.order_nr required" });
      return;
    }

    const { event, duplicate } = enqueueInbox(state, {
      eventId,
      source: "webhook",
      domain: "orders",
      entityKey: orderNr,
      payload: body.payload ?? { order_nr: orderNr },
    });

    res.status(200).json({ ok: true, duplicate, inboxId: event.id });
    void processPendingInbox(getState()).catch((err) => {
      console.error("[noon-webhook] process", err);
    });
  });

  router.get("/orders", (_req, res) => {
    res.json({ data: getState().orders });
  });

  return router;
}
