import { Router } from "express";
import { z } from "zod";
import { runCollect } from "./collect.js";
import { loadConfig, migrateConfigToLiveDefaults, resolveFitnessThresholds, saveConfig } from "./config.js";
import { runDiscover } from "./discover.js";
import { countPendingInbox } from "./inbox-drain.js";
import {
  getInboxWatcherStatus,
  setInboxWatcherEnabled,
  startInboxWatcher,
} from "./inbox-watcher.js";
import { ingestExtensionPayload } from "./ingest.js";
import { getOpsSummary, purgeTestWatchlist } from "./ops.js";
import { ensureMarketDirs, marketPaths, resolveOutpostRoot } from "./paths.js";
import { runDiscoverPipeline } from "./pipeline.js";
import {
  getSchedulerStatus,
  setSchedulerEnabled,
  startMarketIntelScheduler,
} from "./scheduler.js";
import {
  brandRegistrySummary,
  loadBrandRegistry,
  promotePendingBrand,
} from "./white-label.js";
import { brandIntelStatus, reviewPendingBrands, resolveBrandsForCategory } from "./brand-intel/index.js";
import { computeAllCategoryFitness, computeCategoryFitness } from "./category-fitness.js";
import { ensureWatchlistTitleZh } from "./title-translate.js";
import {
  listRecentJobs,
  loadWatchlist,
  purgeMockWatchlist,
} from "./store.js";

const channelEnum = z.enum(["yingdao", "extension", "inbox", "mock"]);

export function createMarketIntelRouter() {
  const router = Router();
  ensureMarketDirs("sa");
  migrateConfigToLiveDefaults();

  router.get("/status", (_req, res) => {
    const cfg = loadConfig();
    const wl = loadWatchlist();
    const paths = marketPaths("sa");
    const pending = countPendingInbox();
    const ops = getOpsSummary();
    res.json({
      data: {
        market: "sa",
        locale: cfg.locale,
        currency: cfg.currency,
        outpostRoot: resolveOutpostRoot(),
        paths: {
          ...paths,
          inboxYingdao: `${paths.inbox}\\yingdao`,
          inboxExtension: `${paths.inbox}\\extension`,
        },
        categoriesEnabled: cfg.categories.filter((c) => c.enabled).length,
        categoriesTotal: cfg.categories.length,
        watchlistCount: wl.items.length,
        watchingCount: wl.items.filter((i) => i.status === "watching").length,
        realWatchCount: ops.realCount,
        mockWatchCount: ops.mockCount,
        ops,
        pendingInbox: pending,
        primaryChannel: cfg.primaryChannel,
        fallbackChannel: cfg.fallbackChannel,
        allowMock: cfg.allowMock,
        autoCollectAfterDiscover: cfg.autoCollectAfterDiscover,
        autoCollectAfterIngest: cfg.autoCollectAfterIngest,
        dataPolicy:
          "策略目标=白板小牌。品牌分层见 brand-registry.json（avoidCompete / pendingReview / confirmedWhite）。未知品牌进 pending；可用 AI 联网审核当地知名度（规则优先，模型只判有证据的牌）。",
        brandRegistry: brandRegistrySummary(),
        brandIntel: brandIntelStatus(),
        scheduler: getSchedulerStatus(),
        inboxWatcher: getInboxWatcherStatus(),
        recentJobs: listRecentJobs(8),
        goLive: {
          dropYingdao: `${paths.inbox}\\yingdao\\*.json`,
          extensionDir: "apps/market-intel-extension",
          ingestApi: "POST /api/market-intel/ingest",
        },
      },
    });
  });

  router.get("/brands", (_req, res) => {
    res.json({ data: { summary: brandRegistrySummary(), registry: loadBrandRegistry() } });
  });

  /** 品类适销结论 + 白牌热销短名单 */
  router.get("/category-fitness", (req, res) => {
    const categoryId =
      typeof req.query.categoryId === "string" ? req.query.categoryId.trim() : "";
    if (categoryId) {
      res.json({ data: computeCategoryFitness(categoryId) });
      return;
    }
    res.json({ data: computeAllCategoryFitness() });
  });

  /** 商品标题译成中文并写回监控池（短名单对照用） */
  router.post("/titles/zh", async (req, res) => {
    try {
      const body = z
        .object({
          categoryId: z.string().optional(),
          productKeys: z.array(z.string()).max(40).optional(),
          limit: z.number().int().min(1).max(40).optional(),
          force: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      const result = await ensureWatchlistTitleZh(body);
      res.json({
        data: result,
        message: result.configured
          ? `translated=${result.translated} skipped=${result.skipped}`
          : "DeepSeek 未配置，仅返回已有缓存",
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/brands/promote", (req, res) => {
    const body = z
      .object({
        token: z.string().min(1),
        to: z.enum(["avoidCompete", "confirmedWhite"]),
        categoryId: z.string().optional(),
      })
      .parse(req.body ?? {});
    const reg = promotePendingBrand(body.token, body.to, body.categoryId);
    res.json({
      data: reg,
      message: `promoted ${body.token} → ${body.to}${body.categoryId ? `@${body.categoryId}` : ""}`,
    });
  });

  /** 影刀主路径：查表 → 未知才 LLM → 写回品类索引 */
  router.post("/brands/resolve", async (req, res) => {
    try {
      const body = z
        .object({
          categoryId: z.string().min(1),
          items: z
            .array(
              z.object({
                token: z.string().min(1),
                example: z.string().optional(),
              }),
            )
            .min(1)
            .max(80),
          force: z.boolean().optional(),
          dryRun: z.boolean().optional(),
          autoApply: z.boolean().optional(),
          maxLlm: z.number().int().min(0).max(20).optional(),
        })
        .parse(req.body ?? {});
      const result = await resolveBrandsForCategory(body);
      res.json({
        data: result,
        message: `tableHits=${result.tableHits} llm=${result.llmCalls} appliedAvoid=${result.appliedAvoid.length}`,
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** AI 联网审核 pending：搜证走代码，模型只做结构化判定 */
  router.get("/brands/ai-status", (_req, res) => {
    res.json({ data: brandIntelStatus() });
  });

  router.post("/brands/ai-review", async (req, res) => {
    try {
      const body = z
        .object({
          tokens: z.array(z.string().min(1)).optional(),
          categoryId: z.string().optional(),
          limit: z.number().int().min(1).max(30).optional(),
          force: z.boolean().optional(),
          dryRun: z.boolean().optional(),
          autoApply: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      const result = await reviewPendingBrands(body);
      res.json({
        data: result,
        message: `reviewed=${result.reviewed.length} llm=${result.llmCalls} search=${result.searchCalls} appliedAvoid=${result.appliedAvoid.length}`,
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/config", (_req, res) => {
    res.json({ data: loadConfig() });
  });

  router.put("/config", (req, res) => {
    const body = z
      .object({
        topN: z.number().int().min(1).max(200).optional(),
        primaryChannel: channelEnum.optional(),
        fallbackChannel: channelEnum.optional(),
        allowMock: z.boolean().optional(),
        autoCollectAfterDiscover: z.boolean().optional(),
        autoCollectAfterIngest: z.boolean().optional(),
        inboxWatchEnabled: z.boolean().optional(),
        inboxWatchEveryMs: z.number().int().min(10_000).optional(),
        scheduler: z
          .object({
            enabled: z.boolean().optional(),
            discoverEveryMs: z.number().int().min(60_000).optional(),
            collectEveryMs: z.number().int().min(60_000).optional(),
          })
          .optional(),
        categories: z
          .array(
            z.object({
              id: z.string(),
              path: z.string(),
              url: z.string(),
              title: z.string(),
              enabled: z.boolean(),
              priority: z.number(),
              topN: z.number().int().optional(),
            }),
          )
          .optional(),
        fitness: z
          .object({
            aspMin: z.number().positive().optional(),
            aspMax: z.number().positive().optional(),
            soldRecentlyFloor: z.number().nonnegative().optional(),
            whiteShareSweetMin: z.number().min(0).max(1).optional(),
            whiteShareSweetMax: z.number().min(0).max(1).optional(),
            shortlistLimit: z.number().int().min(5).max(100).optional(),
          })
          .optional(),
      })
      .parse(req.body ?? {});

    const cfg = loadConfig();
    if (body.topN != null) cfg.topN = body.topN;
    if (body.primaryChannel) cfg.primaryChannel = body.primaryChannel;
    if (body.fallbackChannel) cfg.fallbackChannel = body.fallbackChannel;
    if (body.allowMock != null) cfg.allowMock = body.allowMock;
    if (body.autoCollectAfterDiscover != null) {
      cfg.autoCollectAfterDiscover = body.autoCollectAfterDiscover;
    }
    if (body.autoCollectAfterIngest != null) {
      cfg.autoCollectAfterIngest = body.autoCollectAfterIngest;
    }
    if (body.inboxWatchEveryMs != null) cfg.inboxWatchEveryMs = body.inboxWatchEveryMs;
    if (body.categories) cfg.categories = body.categories;
    if (body.scheduler) cfg.scheduler = { ...cfg.scheduler, ...body.scheduler };
    if (body.fitness) {
      cfg.fitness = { ...resolveFitnessThresholds(cfg), ...body.fitness };
    }
    const saved = saveConfig(cfg);
    if (body.scheduler?.enabled != null) setSchedulerEnabled(body.scheduler.enabled);
    if (body.inboxWatchEnabled != null) setInboxWatcherEnabled(body.inboxWatchEnabled);
    res.json({ data: loadConfig() });
    void saved;
  });

  router.get("/watchlist", (_req, res) => {
    const wl = loadWatchlist();
    res.json({
      data: wl.items,
      meta: { count: wl.items.length, updatedAt: wl.updatedAt },
    });
  });

  router.post("/watchlist/purge-mock", (_req, res) => {
    const result = purgeMockWatchlist();
    res.json({
      data: result,
      message: `removed ${result.removed} mock items, remaining ${result.remaining}`,
    });
  });

  router.post("/watchlist/purge-test", (_req, res) => {
    const result = purgeTestWatchlist();
    res.json({
      data: result,
      message: `removed ${result.removed} test items, remaining ${result.remaining}`,
    });
  });

  router.post("/config/live-mode", (_req, res) => {
    const cfg = loadConfig();
    cfg.allowMock = false;
    cfg.primaryChannel = "yingdao";
    cfg.fallbackChannel = "extension";
    cfg.autoCollectAfterDiscover = true;
    cfg.autoCollectAfterIngest = true;
    cfg.inboxWatchEnabled = true;
    cfg.scheduler.enabled = true;
    cfg.opsVersion = 2;
    const saved = saveConfig(cfg);
    const purged = purgeTestWatchlist();
    setSchedulerEnabled(true);
    setInboxWatcherEnabled(true);
    res.json({
      data: { config: saved, purged },
      message: "live mode on: watcher+scheduler+auto-collect, test items purged",
    });
  });

  router.get("/jobs", (req, res) => {
    const limit = Number(req.query.limit ?? 20);
    res.json({ data: listRecentJobs(Number.isFinite(limit) ? limit : 20) });
  });

  router.post("/ingest", async (req, res) => {
    try {
      const body = z
        .object({
          categoryId: z.string().optional(),
          source: z.enum(["extension", "yingdao"]).optional(),
          products: z.array(z.unknown()).optional(),
          payload: z.unknown().optional(),
        })
        .parse(req.body ?? {});
      const result = await ingestExtensionPayload(body);
      res.status(result.ingest.ok ? 200 : 422).json({ data: result });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/discover", async (req, res) => {
    try {
      const body = z
        .object({
          categoryIds: z.array(z.string()).optional(),
          forceMock: z.boolean().optional(),
          skipCollect: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      if (body.forceMock) {
        const job = await runDiscover(body);
        res.json({ data: { discover: job, collect: null } });
        return;
      }
      const result = await runDiscoverPipeline(body);
      res.json({ data: result });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/collect", async (req, res) => {
    try {
      const body = z
        .object({
          limit: z.number().int().min(1).max(2000).optional(),
          forceMock: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      const job = await runCollect(body);
      res.json({ data: job });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/scheduler/start", (_req, res) => {
    res.json({ data: setSchedulerEnabled(true) });
  });

  router.post("/scheduler/stop", (_req, res) => {
    res.json({ data: setSchedulerEnabled(false) });
  });

  router.get("/scheduler", (_req, res) => {
    res.json({ data: getSchedulerStatus() });
  });

  router.post("/watcher/start", (_req, res) => {
    res.json({ data: setInboxWatcherEnabled(true) });
  });

  router.post("/watcher/stop", (_req, res) => {
    res.json({ data: setInboxWatcherEnabled(false) });
  });

  router.get("/watcher", (_req, res) => {
    res.json({ data: getInboxWatcherStatus() });
  });

  void startMarketIntelScheduler;
  void startInboxWatcher;

  return router;
}
