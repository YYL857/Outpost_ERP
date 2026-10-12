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
import {
  createConsumablesScrapeRequest,
  DEFAULT_CONSUMABLE_SEARCHES,
  getConsumablesScrapeRequestStatus,
  listConsumablesScrapeRequests,
  yingdaoConsumablesRequestsDir,
} from "./yingdao-consumables-request.js";
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
  discardPendingBrand,
  prunePendingBrandNoise,
} from "./white-label.js";
import { brandIntelStatus, reviewPendingBrands, resolveBrandsForCategory } from "./brand-intel/index.js";
import { computeAllCategoryFitness, computeCategoryFitness } from "./category-fitness.js";
import {
  assumptionsForProfile,
  estimateFbnUnitProfit,
  resolveFbnAssumptionsFromQuery,
  type FbnCommissionProfile,
} from "./fbn-profit.js";
import { ensureWatchlistTitleZh } from "./title-translate.js";
import {
  listRecentJobs,
  loadWatchlist,
  purgeMockWatchlist,
  scrubWatchlistSignalQuality,
} from "./store.js";
import {
  ackPriceAlert,
  ingestPriceObservation,
  listMonitorTargets,
  listObservations,
  listPriceAlerts,
  loadMonitorPool,
  monitorSummary,
  removeMonitorTarget,
  upsertMonitorTarget,
} from "./monitor.js";
import {
  listIntelSources,
  listSourceSnippets,
  pasteSourceSnippet,
  setIntelSourceStatus,
  sourceRegistrySummary,
  upsertIntelSource,
} from "./sources.js";

const channelEnum = z.enum(["yingdao", "extension", "inbox", "mock"]);
const sourceTopicEnum = z.enum([
  "pain",
  "demand",
  "aesthetic",
  "taboo",
  "sentiment",
  "macro",
]);
const sourceTypeEnum = z.enum([
  "marketplace",
  "search",
  "social",
  "news",
  "video",
  "classified",
  "other",
]);
const sourceHowEnum = z.enum([
  "api",
  "rss",
  "manual_paste",
  "extension",
  "yingdao",
]);
const sourceStatusEnum = z.enum(["active", "trial", "watch", "retired"]);

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
        monitor: monitorSummary(),
        sources: sourceRegistrySummary(),
        scheduler: getSchedulerStatus(),
        inboxWatcher: getInboxWatcherStatus(),
        recentJobs: listRecentJobs(8),
        goLive: {
          dropYingdao: `${paths.inbox}\\yingdao\\*.json`,
          extensionDir: "apps/market-intel-extension",
          ingestApi: "POST /api/market-intel/ingest",
          monitorPriceApi: "POST /api/market-intel/monitor/price",
          consumablesScrapeApi: "POST /api/market-intel/request-consumables-scrape",
          consumablesDefaultSearches: [...DEFAULT_CONSUMABLE_SEARCHES],
        },
      },
    });
  });

  /** 页面触发：写影刀 Requests/pending，由 outpost_mi_consumables_watcher 消费 */
  router.post("/request-consumables-scrape", (req, res) => {
    try {
      const body = z
        .object({
          searches: z.array(z.string().min(1)).optional(),
          topN: z.number().int().min(10).max(80).optional(),
          browser: z.string().optional(),
          demo: z.boolean().optional(),
          source: z.string().optional(),
        })
        .parse(req.body ?? {});
      const payload = createConsumablesScrapeRequest(body);
      res.json({
        data: payload,
        message: `已写入影刀请求 pending；请运行 outpost_mi_consumables_watcher 或手动 MODE=search`,
        requestsDir: yingdaoConsumablesRequestsDir(),
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/request-consumables-scrape/:requestId", (req, res) => {
    const st = getConsumablesScrapeRequestStatus(req.params.requestId);
    res.json({ data: st });
  });

  router.get("/request-consumables-scrape", (req, res) => {
    const limit =
      typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
    res.json({
      data: {
        requestsDir: yingdaoConsumablesRequestsDir(),
        defaultSearches: [...DEFAULT_CONSUMABLE_SEARCHES],
        recent: listConsumablesScrapeRequests(
          Number.isFinite(limit) ? limit : 20,
        ),
      },
    });
  });

  /** —— 竞品盯价（扩展主通道；双次同向才告警） —— */
  router.get("/monitor", (req, res) => {
    const activeOnly = String(req.query.activeOnly ?? "") === "1";
    const pool = loadMonitorPool();
    const items = activeOnly
      ? pool.items.filter((i) => i.status === "active")
      : pool.items;
    res.json({
      data: {
        items,
        pendingChanges: pool.pendingChanges,
        summary: monitorSummary(),
        alerts: listPriceAlerts({ limit: 30 }),
      },
    });
  });

  router.get("/monitor/targets", (req, res) => {
    const activeOnly = String(req.query.activeOnly ?? "1") !== "0";
    res.json({
      data: listMonitorTargets({ activeOnly }),
      meta: monitorSummary(),
    });
  });

  router.post("/monitor/targets", (req, res) => {
    try {
      const body = z
        .object({
          productKey: z.string().min(1),
          url: z.string().url(),
          title: z.string().optional(),
          note: z.string().optional(),
          addedFrom: z.enum(["watchlist", "manual", "extension"]).optional(),
          status: z.enum(["active", "paused"]).optional(),
        })
        .parse(req.body ?? {});
      const item = upsertMonitorTarget(body);
      res.json({ data: item, message: `monitor target ${item.productKey}` });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.delete("/monitor/targets/:productKey", (req, res) => {
    const ok = removeMonitorTarget(req.params.productKey);
    if (!ok) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ data: { removed: true }, message: "removed" });
  });

  router.get("/monitor/observations/:productKey", (req, res) => {
    const limit = Number(req.query.limit ?? 40);
    res.json({
      data: listObservations(
        req.params.productKey,
        Number.isFinite(limit) ? limit : 40,
      ),
    });
  });

  router.get("/monitor/alerts", (req, res) => {
    const status =
      req.query.status === "open" || req.query.status === "acked"
        ? req.query.status
        : undefined;
    const limit = Number(req.query.limit ?? 50);
    res.json({
      data: listPriceAlerts({
        status,
        limit: Number.isFinite(limit) ? limit : 50,
      }),
    });
  });

  router.post("/monitor/alerts/:alertId/ack", (req, res) => {
    const a = ackPriceAlert(req.params.alertId);
    if (!a) {
      res.status(404).json({ error: "alert not found" });
      return;
    }
    res.json({ data: a, message: "acked" });
  });

  router.post("/monitor/price", (req, res) => {
    try {
      const body = z
        .object({
          productKey: z.string().min(1),
          url: z.string().min(1),
          title: z.string().optional(),
          price: z.number().nullable(),
          currency: z.string().optional(),
          promoText: z.string().nullable().optional(),
          inStock: z.boolean().nullable().optional(),
          source: z.enum(["extension", "yingdao", "manual"]).optional(),
          parseMethod: z
            .enum(["dom", "json_ld", "regex", "llm", "manual"])
            .optional(),
          ensureTarget: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      const result = ingestPriceObservation(body);
      res.json({
        data: result,
        message: result.alert
          ? `price alert ${result.alert.direction} ${result.alert.fromPrice}→${result.alert.toPrice}`
          : result.pending
            ? `pending ${result.pending.direction} confirm`
            : result.skippedAlertReason ?? "observation stored",
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** —— 情报来源注册 + 人工粘贴 —— */
  router.get("/sources", (_req, res) => {
    res.json({
      data: {
        summary: sourceRegistrySummary(),
        sources: listIntelSources(),
        snippets: listSourceSnippets({ limit: 30 }),
      },
    });
  });

  router.post("/sources", (req, res) => {
    try {
      const body = z
        .object({
          sourceId: z.string().min(1),
          title: z.string().min(1),
          type: sourceTypeEnum,
          locale: z.string().optional(),
          howWeGet: sourceHowEnum,
          topics: z.array(sourceTopicEnum).optional(),
          score: z.number().min(0).max(1).optional(),
          status: sourceStatusEnum.optional(),
          note: z.string().optional(),
        })
        .parse(req.body ?? {});
      const src = upsertIntelSource(body);
      res.json({ data: src, message: `source ${src.sourceId}` });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/sources/:sourceId/status", (req, res) => {
    try {
      const body = z.object({ status: sourceStatusEnum }).parse(req.body ?? {});
      const src = setIntelSourceStatus(req.params.sourceId, body.status);
      if (!src) {
        res.status(404).json({ error: "source not found" });
        return;
      }
      res.json({ data: src, message: `status → ${src.status}` });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/sources/paste", (req, res) => {
    try {
      const body = z
        .object({
          sourceId: z.string().min(1),
          text: z.string().min(1),
          title: z.string().optional(),
          url: z.string().optional(),
          topics: z.array(sourceTopicEnum).optional(),
        })
        .parse(req.body ?? {});
      const snip = pasteSourceSnippet(body);
      res.json({
        data: snip,
        message: `snippet ${snip.id} @ ${snip.sourceId} (${snip.tier})`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/sources/snippets", (req, res) => {
    const sourceId =
      typeof req.query.sourceId === "string" ? req.query.sourceId : undefined;
    const limit = Number(req.query.limit ?? 40);
    res.json({
      data: listSourceSnippets({
        sourceId,
        limit: Number.isFinite(limit) ? limit : 40,
      }),
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

  /**
   * FBN 单件核算默认假设（对齐成本利润表；选品页/CSV 共用）。
   * 当前采集通常只有售价，其余为可调假设。
   */
  router.get("/fbn-profit/defaults", (req, res) => {
    const profileRaw =
      typeof req.query.profile === "string" ? req.query.profile.trim() : "general_15";
    const profile: FbnCommissionProfile =
      profileRaw === "fashion_25" ? "fashion_25" : "general_15";
    res.json({
      data: {
        profile,
        assumptions: assumptionsForProfile(profile),
        note:
          "对齐《NOON平台的成本与利润核算表》FBN 单件公式；货源/仓储等需手工填，缺省项利润标估算。",
      },
    });
  });

  /**
   * 导出选品表 CSV：短名单 + FBN 单件毛利估算（表公式）。
   * 货源/仓配/广告等由运营手工填；不做自动爬货源。
   * 兼容旧参数 costSar / shipSar（→ 采购成本 / 落地配）。
   */
  router.get("/export/shortlist.csv", (req, res) => {
    const categoryId =
      typeof req.query.categoryId === "string" ? req.query.categoryId.trim() : "";
    if (!categoryId) {
      res.status(400).json({ error: "categoryId required" });
      return;
    }
    const assumptions = resolveFbnAssumptionsFromQuery(
      req.query as Record<string, unknown>,
    );
    const report = computeCategoryFitness(categoryId);
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = [
      "productKey",
      "titleZh",
      "title",
      "url",
      "brandTier",
      "priceSar",
      "soldRecently",
      "sellerName",
      "purchaseCostSar",
      "firstMileSar",
      "outboundFeeSar",
      "referralFeeSar",
      "vatPayableSar",
      "storageSar",
      "adCostSar",
      "fbnProfitSar",
      "fbnMarginPct",
      "multiple",
      "profitComplete",
      "verdict",
      "categoryId",
    ];
    const lines = [header.join(",")];
    for (const p of report.shortlist) {
      const est = estimateFbnUnitProfit(p.price, assumptions);
      lines.push(
        [
          esc(p.productKey),
          esc(p.titleZh),
          esc(p.title),
          esc(p.url),
          esc(p.brandTier),
          esc(p.price),
          esc(p.soldRecently),
          esc(p.sellerName),
          esc(est?.purchaseCostSar ?? assumptions.purchaseCostSar),
          esc(assumptions.firstMileSar),
          esc(assumptions.outboundFeeSar),
          esc(est?.referralFeeSar ?? ""),
          esc(est?.vatPayableSar ?? ""),
          esc(assumptions.storageSar),
          esc(est?.adCostSar ?? ""),
          esc(est?.profitSar ?? ""),
          esc(est?.marginPct ?? ""),
          esc(est?.multiple ?? ""),
          esc(est?.profitComplete ?? false),
          esc(report.verdict),
          esc(report.categoryId),
        ].join(","),
      );
    }
    const filename = `market-intel-${categoryId}-shortlist.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(`\uFEFF${lines.join("\n")}`);
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

  /** 从 pending 删除（不进白板/避开）；脏 token / 信息不足用 */
  router.post("/brands/discard", (req, res) => {
    const body = z
      .object({
        token: z.string().min(1),
        categoryId: z.string().optional(),
      })
      .parse(req.body ?? {});
    discardPendingBrand(body.token, body.categoryId);
    res.json({
      data: brandRegistrySummary(body.categoryId),
      message: `discarded pending ${body.token}${body.categoryId ? `@${body.categoryId}` : ""}`,
    });
  });

  /** 按 skip 表清掉 pending 噪声（店名/UI/促销词等） */
  router.post("/brands/prune-noise", (req, res) => {
    const body = z
      .object({ categoryId: z.string().optional() })
      .parse(req.body ?? {});
    const removed = prunePendingBrandNoise(body.categoryId);
    res.json({
      data: { removed, summary: brandRegistrySummary(body.categoryId) },
      message: `pruned ${removed} noisy pending token(s)`,
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

  /** 清历史脏价 / 脏卖家名 / pending 噪声（不删商品） */
  router.post("/watchlist/scrub-signals", (_req, res) => {
    const result = scrubWatchlistSignalQuality();
    res.json({
      data: {
        priceCleared: result.priceCleared,
        sellerCleared: result.sellerCleared,
        remaining: result.watchlist.items.length,
      },
      message: `cleared prices=${result.priceCleared} sellers=${result.sellerCleared}`,
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
