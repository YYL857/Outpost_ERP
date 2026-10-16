import cors from "cors";
import express from "express";
import { loadEnv } from "./config/env.js";
import { createRepository } from "./data/repo/index.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { createStoreRouter } from "./modules/store/store.routes.js";
import { createConfigRouter } from "./modules/config/config.routes.js";
import { createSyncRouter } from "./modules/sync/sync.routes.js";
import { createNoonRouter } from "./modules/noon/noon.routes.js";
import { createCatalogRouter } from "./modules/catalog/catalog.routes.js";
import { createListingRouter } from "./modules/listing/listing.routes.js";
import { createSalesRouter } from "./modules/sales/sales.routes.js";
import { createAnalyticsRouter } from "./modules/analytics/analytics.routes.js";
import { createFinanceRouter } from "./modules/finance/finance.routes.js";
import { createAdsRouter } from "./modules/ads/ads.routes.js";
import {
  createPwRpaRouter,
  startPwExportSchedulers,
  startAdsBudgetScheduler,
} from "./modules/pw-rpa/index.js";
import { createPurchaseRouter } from "./modules/purchase/purchase.routes.js";
import { createReplenishRouter } from "./modules/replenish/replenish.routes.js";
import { createShippingOpsRouter } from "./modules/shipping/shipping.routes.js";
import { createCampaignsRouter } from "./modules/campaigns/campaigns.routes.js";
import { createDailyBriefRouter } from "./modules/daily-brief/daily-brief.routes.js";
import {
  createMarketIntelRouter,
  ensureMarketDirs,
  startMarketIntelScheduler,
} from "./modules/market-intel/index.js";
import { migrateConfigToLiveDefaults } from "./modules/market-intel/config.js";
import { startInboxWatcher } from "./modules/market-intel/inbox-watcher.js";
import {
  createMorningDigestRouter,
  startMorningDigestScheduler,
} from "./modules/morning-digest/index.js";
import { createOpsAssistRouter } from "./modules/ops-assist/ops-assist.routes.js";
import { createWikiGraphRouter } from "./modules/wiki-graph/index.js";
import { createSystemMapRouter } from "./modules/system-map/index.js";
import { createAgentHubRouter } from "./modules/agent-hub/index.js";
import { createDashboardRouter } from "./modules/dashboard/index.js";
import { createShopsRouter } from "./shops/shops.routes.js";
import { bootstrapShops, getActiveShop } from "./shops/registry.js";
import {
  getCurrentShopState,
  warmDefaultShopCache,
} from "./shops/state-cache.js";
import { startNoonPoller } from "./modules/sync/poller.js";
import { startAssemblySyncScheduler } from "./modules/sync/assembly-scheduler.js";
import {
  envStockScheduleDefaultEnabled,
  startStockScheduler,
} from "./modules/sync/stock-scheduler.js";
import { scheduleBootDataBackfill } from "./modules/sync/data-backfill.js";
import {
  createSchedulersRouter,
  resolveBootEnabled,
} from "./modules/schedulers/index.js";
import { startGpCloseScheduler } from "./modules/finance/gp-close-scheduler.js";
import { createTaskPlanningRouter } from "./modules/task-planning/index.js";
import { createWarehouseBookingRouter } from "./modules/warehouse-booking/index.js";
import { createCargoLedgerRouter } from "./modules/cargo-ledger/index.js";
import { createOpsDailyRouter } from "./modules/ops-daily/index.js";
import { createExtensionsRouter } from "./modules/extensions/extensions.routes.js";
import {
  bootstrapAuth,
  createAuthMiddleware,
  createAuthRouter,
} from "./auth/index.js";
import {
  createAuditMiddleware,
  createAuditRouter,
} from "./modules/audit/index.js";
import { saveState } from "./data/store.js";

// 必须先于 loadEnv / loadState：写入按店 DATA_DIR 与凭证路径
const { active: bootShop } = bootstrapShops();
const adminUser = bootstrapAuth();

const env = loadEnv();
const repo = createRepository(env);
/** 请求级 / 后台：按 ALS shopId 或系统默认同步店取共享浏览态 */
const boundGetState = () => getCurrentShopState();

warmDefaultShopCache();

// 启动时把店铺元数据写入默认同步店 StoreInfo
{
  const s = boundGetState();
  s.store.id = bootShop.id;
  s.store.name = bootShop.name;
  s.store.account = bootShop.projectCode;
  s.store.platform = "NOON";
  if (!s.noon.partnerId) s.noon.partnerId = bootShop.projectCode;
  saveState(s);
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
/** Listing / 任务附件含 base64，需大于默认 2mb */
app.use(express.json({ limit: "25mb" }));

app.use("/api/health", createHealthRouter());
app.use(createAuthMiddleware());
/** 人工增删改审计：登录后写操作统一落盘 D:\outpost-data\audit */
app.use(createAuditMiddleware());
app.use("/api/auth", createAuthRouter());
app.use("/api/audit", createAuditRouter());

app.use("/api/shops", createShopsRouter(boundGetState, repo));
app.use("/api/store", createStoreRouter(boundGetState));
app.use("/api/config", createConfigRouter(boundGetState));
app.use("/api/sync", createSyncRouter(boundGetState));
app.use("/api/noon", createNoonRouter(boundGetState));
app.use("/api/catalog", createCatalogRouter(boundGetState));
app.use("/api/listing", createListingRouter(boundGetState));
app.use("/api/sales", createSalesRouter(boundGetState));
app.use("/api/analytics", createAnalyticsRouter(boundGetState));
app.use("/api/finance", createFinanceRouter(boundGetState));
app.use("/api/ads", createAdsRouter(boundGetState));
app.use("/api/pw-rpa", createPwRpaRouter());
app.use("/api/purchase", createPurchaseRouter(boundGetState));
app.use("/api/replenish", createReplenishRouter(boundGetState));
app.use("/api/shipping-ops", createShippingOpsRouter(boundGetState));
app.use("/api/campaigns", createCampaignsRouter(boundGetState));
app.use("/api/market-intel", createMarketIntelRouter());
app.use("/api/daily-brief", createDailyBriefRouter());
app.use("/api/morning-digest", createMorningDigestRouter(boundGetState));
app.use("/api/ops-assist", createOpsAssistRouter(boundGetState));
app.use("/api/dashboard", createDashboardRouter(boundGetState));
app.use("/api/wiki-graph", createWikiGraphRouter());
app.use("/api/system-map", createSystemMapRouter());
app.use("/api/agent-hub", createAgentHubRouter());
app.use("/api/schedulers", createSchedulersRouter(boundGetState));
app.use("/api/tasks", createTaskPlanningRouter());
app.use("/api/warehouse-booking", createWarehouseBookingRouter());
app.use("/api/cargo-ledger", createCargoLedgerRouter());
app.use("/api/ops-daily", createOpsDailyRouter());
app.use("/api/extensions", createExtensionsRouter());

app.get("/api/ready", (_req, res) => {
  const s = boundGetState();
  const shop = getActiveShop();
  res.json({
    ok: true,
    service: "outpost-api",
    dataDriver: repo.driver,
    dataDir: process.env.OUTPOST_DATA_DIR ?? env.dataDir,
    auth: { adminUsername: adminUser.username },
    shop: {
      id: shop.id,
      name: shop.name,
      projectCode: shop.projectCode,
      credentialsFile: shop.credentialsFile,
    },
    noon: {
      mode: s.noon.mode,
      enabled: s.noon.enabled,
      country: s.noon.countryCode,
      hasApiKey: Boolean(s.noon.apiKey),
      credentialsFile: process.env.OUTPOST_NOON_CREDENTIALS_FILE ?? null,
    },
    goLive: {
      checklist: "/GO_LIVE.md",
      switchToLive: "Set NOON_MODE=live and fill NOON_API_* in .env",
      liveClient: "apps/api/src/platforms/noon/live-client.ts",
      endpoints: "apps/api/src/platforms/noon/endpoints.ts",
    },
  });
});

app.get("/api/modules", (_req, res) => {
  res.json({
    data: [
      { key: "home", title: "我的主页", phase: "P0" },
      { key: "sync-health", title: "同步健康中心", phase: "P0" },
      { key: "schedulers", title: "定时任务", phase: "P0" },
      { key: "noon", title: "NOON 接入", phase: "P0" },
      { key: "catalog", title: "Catalog 产品库", phase: "P1" },
      { key: "listing", title: "Listing", phase: "P1" },
      { key: "best-sell", title: "Best Sell", phase: "P1" },
      { key: "sales", title: "销量统计", phase: "P1" },
      { key: "finance", title: "财务报表", phase: "P2" },
      { key: "selection", title: "市场情报", phase: "P1" },
    ],
  });
});

startNoonPoller(boundGetState, env.pollIntervalMs, {
  enabled: resolveBootEnabled("noon-poller"),
});
startAssemblySyncScheduler(boundGetState, {
  enabled: resolveBootEnabled("assembly-sync"),
  respectOnBoot: true,
});
startStockScheduler({
  enabled: envStockScheduleDefaultEnabled(),
});
startPwExportSchedulers();
startAdsBudgetScheduler();

startMorningDigestScheduler(boundGetState, {
  storeEnabled: resolveBootEnabled("store-morning-digest"),
  miEnabled: resolveBootEnabled("mi-morning-digest"),
});
startGpCloseScheduler({
  enabled: resolveBootEnabled("gp-month-close"),
});

ensureMarketDirs("sa");
migrateConfigToLiveDefaults();
startMarketIntelScheduler();
startInboxWatcher();

app.listen(env.port, env.host, () => {
  const shop = getActiveShop();
  console.log(`[outpost-api] http://${env.host}:${env.port} (LAN ok if host=0.0.0.0)`);
  console.log(
    `[outpost-api] driver=${repo.driver} noon.mode=${boundGetState().noon.mode} enabled=${boundGetState().noon.enabled}`,
  );
  console.log(
    `[outpost-api] shop=${shop.id} cred=${shop.credentialsFile} data=${process.env.OUTPOST_DATA_DIR}`,
  );
  console.log(`[outpost-api] auth: login POST /api/auth/login (default admin)`);
  console.log(`[outpost-api] NOON webhook: POST /api/noon/webhook`);
  console.log(`[outpost-api] market-intel: GET /api/market-intel/status (noon/sa)`);
  /** 启动后检查缺口并补洞（Noon 按域一次覆盖；飞书直拉；缺 ads 触发 Playwright） */
  scheduleBootDataBackfill();
});
