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
import { createShopsRouter } from "./shops/shops.routes.js";
import { bootstrapShops, getActiveShop } from "./shops/registry.js";
import { startNoonPoller } from "./modules/sync/poller.js";
import { saveState } from "./data/store.js";

// 必须先于 loadEnv / loadState：写入按店 DATA_DIR 与凭证路径
const { active: bootShop } = bootstrapShops();

const env = loadEnv();
const repo = createRepository(env);
const boundGetState = () => repo.getState();

// 启动时把店铺元数据写入 StoreInfo
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
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.use("/api/health", createHealthRouter());
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

app.get("/api/ready", (_req, res) => {
  const s = boundGetState();
  const shop = getActiveShop();
  res.json({
    ok: true,
    service: "outpost-api",
    dataDriver: repo.driver,
    dataDir: process.env.OUTPOST_DATA_DIR ?? env.dataDir,
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
      { key: "noon", title: "NOON 接入", phase: "P0" },
      { key: "catalog", title: "Catalog 产品库", phase: "P1" },
      { key: "listing", title: "链接上架", phase: "P1" },
      { key: "best-sell", title: "Best Sell", phase: "P1" },
      { key: "sales", title: "销量统计", phase: "P1" },
      { key: "finance", title: "财务报表", phase: "P2" },
    ],
  });
});

void saveState;

startNoonPoller(boundGetState, env.pollIntervalMs);

app.listen(env.port, () => {
  const shop = getActiveShop();
  console.log(`[outpost-api] http://127.0.0.1:${env.port}`);
  console.log(
    `[outpost-api] driver=${repo.driver} noon.mode=${boundGetState().noon.mode} enabled=${boundGetState().noon.enabled}`,
  );
  console.log(
    `[outpost-api] shop=${shop.id} cred=${shop.credentialsFile} data=${process.env.OUTPOST_DATA_DIR}`,
  );
  console.log(`[outpost-api] NOON webhook: POST /api/noon/webhook`);
});
