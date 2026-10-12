import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";
import type { AppState } from "../../common/types.js";
import {
  buildCatalogDisplayMap,
  catalogDisplayOf,
} from "../../common/catalog-display.js";
import { saveState } from "../../data/store.js";
import { ingestFeishuOpsIntoState } from "../../platforms/feishu/ingest/ops.js";
import {
  clearForwarderBoardCache,
  buildForwarderBoard,
} from "../../platforms/feishu/normalize/forwarder-board.js";
import {
  buildHeadhaulPayload,
  clearHeadhaulCache,
  getBoxHeadhaul,
  getSkuHeadhaulSummary,
} from "./headhaul/index.js";
import {
  clearPackingLinesCache,
  loadLatestPackingLines,
  summarizePackingInTransit,
} from "../../platforms/feishu/normalize/packing-lines.js";
import { inferStorePrefixes } from "../../platforms/feishu/ingest/local.js";
import {
  loadFeishuDocsConfig,
  normalizeDailyBriefRun,
  pullFeishuRaw,
} from "../../platforms/feishu/index.js";
import { isFeishuError } from "../../platforms/feishu/errors.js";
import { runYundaomenTrack } from "../../platforms/forwarder-portals/adapters/yundaomen.js";
import {
  packingModeToFleetan,
  runFleetanTrack,
} from "../../platforms/forwarder-portals/adapters/fleetan.js";
import {
  runHanshaTrack,
  runYayouhuiTrack,
  runYiteTrack,
} from "../../platforms/forwarder-portals/adapters/nextsls.js";
import { runAnshidaTrack } from "../../platforms/forwarder-portals/adapters/ontask.js";
import { runQikeTrack } from "../../platforms/forwarder-portals/adapters/chicexpress.js";
import {
  listAnshidaTicketNos,
  listFeitanTicketNos,
  listHanshaTicketNos,
  listQikeLogisticsNos,
  listYayouhuiTicketNos,
  listYiteLogisticsNos,
  listYibangLogisticsNos,
  yiteWaybillFromLogistics,
} from "../../platforms/forwarder-portals/packing-keys.js";
import {
  getForwarderPortalsDir,
  loadForwarderCredentials,
} from "../../platforms/forwarder-portals/types.js";
import { summarizeForwarderBoardWithLlm } from "./forwarder-llm.js";
import {
  buildChannelHistoryPayload,
  searchSkuChannelHistory,
} from "./channel-history.js";
import {
  CARGO_KIND_OPTIONS,
  deleteCargoHint,
  listCargoHints,
  upsertCargoHint,
} from "./cargo-hints.js";
import {
  LabelCropError,
  cropAwbLabelPdf,
  croppedDownloadName,
  decodePdfBase64,
} from "./label-crop.js";

/**
 * 物流管理：Noon/飞书在途 + 装箱表货代看板。
 */
export function createShippingOpsRouter(getState: () => AppState) {
  const router = Router();

  router.get("/overview", (_req, res) => {
    const state = getState();
    const display = buildCatalogDisplayMap(state);

    type Agg = {
      partnerSku: string;
      title: string;
      imageUrl: string;
      onHand: number;
      inTransit: number;
      warehouses: Set<string>;
    };
    const bySku = new Map<string, Agg>();
    for (const s of state.stock) {
      const d = catalogDisplayOf(display, s.partnerSku);
      const row = bySku.get(s.partnerSku) ?? {
        partnerSku: s.partnerSku,
        title: d.title,
        imageUrl: d.imageUrl,
        onHand: 0,
        inTransit: 0,
        warehouses: new Set<string>(),
      };
      row.onHand += s.qty;
      row.inTransit += s.inTransitQty;
      if (s.warehouseCode) row.warehouses.add(s.warehouseCode);
      bySku.set(s.partnerSku, row);
    }

    const stockRows = [...bySku.values()]
      .map((r) => ({
        partnerSku: r.partnerSku,
        title: r.title,
        imageUrl: r.imageUrl,
        onHand: r.onHand,
        inTransit: r.inTransit,
        warehouseCount: r.warehouses.size,
      }))
      .sort((a, b) => b.inTransit - a.inTransit || b.onHand - a.onHand);

    const withTransit = stockRows.filter((r) => r.inTransit > 0);
    const totalInTransit = withTransit.reduce((s, r) => s + r.inTransit, 0);

    const byStatus: Record<string, number> = {};
    for (const o of state.orders) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    }

    const feishuTransit = [...(state.feishuOpsSnapshots ?? [])]
      .filter((o) => o.airInTransit > 0 || o.seaInTransit > 0)
      .map((o) => {
        const d = catalogDisplayOf(display, o.partnerSku, o.productName);
        return {
          partnerSku: o.partnerSku,
          title: d.title || o.productName,
          imageUrl: d.imageUrl,
          airInTransit: o.airInTransit,
          seaInTransit: o.seaInTransit,
          purchasedQty: o.purchasedQty,
          sheetTitle: o.sheetTitle,
          reportDate: o.reportDate,
        };
      })
      .sort(
        (a, b) =>
          b.airInTransit +
          b.seaInTransit -
          (a.airInTransit + a.seaInTransit),
      );

    const board = buildForwarderBoard();

    const storePrefixes = inferStorePrefixes(state.catalog ?? []);
    const packingDetail = storePrefixes.length
      ? summarizePackingInTransit(loadLatestPackingLines(), storePrefixes)
      : null;
    const packingInTransitDetail = packingDetail
      ? {
          storePrefixes,
          qty: packingDetail.qty,
          skuCount: packingDetail.skuCount,
          boxCount: packingDetail.boxCount,
          ticketCount: packingDetail.ticketCount,
          tickets: packingDetail.byTicket.slice(0, 100).map((t) => ({
            ticketKey: t.ticketKey,
            ticketNo: t.ticketNo,
            logisticsNo: t.logisticsNo,
            forwarder: t.forwarder,
            modeRaw: t.modeRaw,
            shipAt: t.shipAt,
            boxCount: t.boxCount,
            pcs: t.pcs,
            boxes: t.boxes.map((b) => ({
              boxNo: b.boxNo,
              pcs: b.pcs,
              skuCount: b.skuCount,
              modeRaw: b.modeRaw,
              forwarder: b.forwarder,
              logisticsNo: b.logisticsNo,
              ticketNo: b.ticketNo,
              items: b.items.slice(0, 50).map((it) => {
                const d = catalogDisplayOf(display, it.partnerSku);
                return {
                  partnerSku: it.partnerSku,
                  title: d.title || it.name || it.partnerSku,
                  qty: it.qty,
                };
              }),
            })),
          })),
        }
      : null;

    res.json({
      data: {
        summary: {
          stockSkuCount: stockRows.length,
          inTransitSkuCount: withTransit.length,
          totalInTransitQty: totalInTransit,
          feishuTransitSkuCount: feishuTransit.length,
          packingInTransitBoxes: board.inTransit.length,
          packingInTransitPcs: packingDetail?.qty ?? 0,
          packingInTransitTickets: packingDetail?.ticketCount ?? 0,
          forwarderCount: board.source.forwarderCount,
          quoteForwarderCount: board.freightRates.forwarderCount,
          orderCount: state.orders.length,
          ordersByStatus: byStatus,
          source:
            "stock.inTransitQty + feishuOpsSnapshots + packing箱表/明细 + freight-rates货代大纲 + orders.status",
          gap:
            board.inTransit.length === 0 &&
            feishuTransit.length === 0 &&
            withTransit.length === 0 &&
            !(packingDetail?.qty)
              ? "无在途数据：同步 Noon stock / 飞书日报 / 装箱表"
              : board.freightRates.forwarderCount === 0
                ? "货代大纲未同步或权限不足（需 wiki:node:read + 文档协作者）"
                : "装箱实付 + 货代大纲报价已参与排名",
        },
        inTransit: withTransit.slice(0, 200),
        feishuTransit: feishuTransit.slice(0, 200),
        packingInTransit: board.inTransit,
        packingInTransitDetail,
        packingDelivered: board.deliveredSample,
        forwarderBoard: {
          source: board.source,
          freightRates: board.freightRates,
          ranking: board.ranking,
          forwarders: board.forwarders,
          quotes: board.quotes,
        },
        stockSample: stockRows.slice(0, 200),
      },
    });
  });

  router.get("/forwarder-board", (_req, res) => {
    clearForwarderBoardCache();
    const board = buildForwarderBoard();
    res.json({ data: board });
  });

  /** 发货渠道历史参考：货代 × 空/海运（装箱明细已发货行） */
  router.get("/channel-history", (_req, res) => {
    try {
      const payload = buildChannelHistoryPayload();
      res.json({ data: payload });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** 按 PSKU / 品名查历史渠道 */
  router.get("/channel-history/sku", (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (!q) {
        return res.status(400).json({ error: "需要 query 参数 q（PSKU 或品名）" });
      }
      res.json({ data: searchSkuChannelHistory(q) });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** 货代 × PSKU 手工货性 */
  router.get("/cargo-hints", (_req, res) => {
    try {
      res.json({
        data: {
          options: CARGO_KIND_OPTIONS,
          hints: listCargoHints(),
        },
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.put("/cargo-hints", (req, res) => {
    try {
      const partnerSku = String(req.body?.partnerSku ?? "").trim();
      const forwarder = String(req.body?.forwarder ?? "").trim();
      const cargoKind = String(req.body?.cargoKind ?? "").trim();
      const row = upsertCargoHint({ partnerSku, forwarder, cargoKind });
      res.json({
        data: { hint: row, options: CARGO_KIND_OPTIONS },
        message: row
          ? `已标注 ${partnerSku} @ ${row.forwarder}`
          : `已清除 ${partnerSku} @ ${forwarder}`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.delete("/cargo-hints", (req, res) => {
    try {
      const partnerSku = String(
        req.body?.partnerSku ?? req.query.partnerSku ?? "",
      ).trim();
      const forwarder = String(
        req.body?.forwarder ?? req.query.forwarder ?? "",
      ).trim();
      const ok = deleteCargoHint(partnerSku, forwarder);
      res.json({
        data: { deleted: ok },
        message: ok ? "已删除标注" : "无对应标注",
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/forwarder-board/analyze", async (_req, res) => {
    try {
      clearForwarderBoardCache();
      const board = buildForwarderBoard();
      if (board.forwarders.length === 0 && board.quotes.length === 0) {
        return res.status(400).json({
          error: "无装箱/货代大纲数据，请先同步",
        });
      }
      const llm = await summarizeForwarderBoardWithLlm(board);
      res.json({
        data: {
          board: {
            source: board.source,
            freightRates: board.freightRates,
            ranking: board.ranking,
            forwarders: board.forwarders,
            quotes: board.quotes,
          },
          llm,
        },
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/sync-feishu-daily", async (_req, res) => {
    const state = getState();
    try {
      const cfg = loadFeishuDocsConfig();
      const pull = await pullFeishuRaw(cfg, { docIds: ["daily"] });
      if (!pull.results.some((r) => r.ok && r.docId === "daily")) {
        return res.status(400).json({
          error: "日报拉取失败或未配置 daily",
          detail: pull,
        });
      }
      normalizeDailyBriefRun({ rawRunId: pull.runId });
      const ops = ingestFeishuOpsIntoState(state);
      saveState(state);
      res.json({
        data: { ops, feishuOpsCount: state.feishuOpsSnapshots?.length ?? 0 },
        message: `日报在途入库 ${ops.upserted} SKU`,
      });
    } catch (e) {
      if (isFeishuError(e)) {
        return res.status(400).json({ error: e.message, detail: e.toJSON() });
      }
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/sync-packing", async (_req, res) => {
    try {
      const cfg = loadFeishuDocsConfig();
      const pull = await pullFeishuRaw(cfg, { docIds: ["packing"] });
      if (!pull.results.some((r) => r.ok && r.docId === "packing")) {
        return res.status(400).json({
          error: "装箱表拉取失败或未配置 packing",
          detail: pull,
        });
      }
      clearForwarderBoardCache();
      clearPackingLinesCache();
      clearHeadhaulCache();
      const board = buildForwarderBoard();
      res.json({
        data: {
          runId: pull.runId,
          source: board.source,
          forwarderCount: board.source.forwarderCount,
          inTransitBoxes: board.inTransit.length,
        },
        message: `装箱表已同步，货代 ${board.source.forwarderCount} 家，在途箱 ${board.inTransit.length}`,
      });
    } catch (e) {
      if (isFeishuError(e)) {
        return res.status(400).json({ error: e.message, detail: e.toJSON() });
      }
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/sync-freight-rates", async (_req, res) => {
    try {
      const cfg = loadFeishuDocsConfig();
      const pull = await pullFeishuRaw(cfg, { docIds: ["freight-rates"] });
      const hit = pull.results.find((r) => r.docId === "freight-rates");
      if (!hit?.ok) {
        return res.status(400).json({
          error: "货代大纲拉取失败或未配置 freight-rates",
          detail: hit?.error ?? pull,
          hint:
            "请开通只读权限 bitable:app:readonly（不要开可写 bitable:app），发布后确认应用是文档协作者；系统只拉快照不改表",
        });
      }
      clearForwarderBoardCache();
      clearHeadhaulCache();
      const board = buildForwarderBoard();
      res.json({
        data: {
          runId: pull.runId,
          freightRates: board.freightRates,
          quoteForwarderCount: board.freightRates.forwarderCount,
        },
        message: `货代大纲已同步，报价货代 ${board.freightRates.forwarderCount} 家`,
      });
    } catch (e) {
      if (isFeishuError(e)) {
        return res.status(400).json({ error: e.message, detail: e.toJSON() });
      }
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** 头程双轨：全量摘要或 ?boxNo= / 见 /headhaul/sku */
  router.get("/headhaul", (req, res) => {
    try {
      const state = getState();
      const boxNo = String(req.query.boxNo ?? "").trim();
      if (boxNo) {
        const box = getBoxHeadhaul(state.shipping, boxNo);
        if (!box) {
          return res.status(404).json({ error: `未找到箱号 ${boxNo} 的明细头程` });
        }
        return res.json({ data: box });
      }
      const payload = buildHeadhaulPayload(state.shipping);
      res.json({
        data: {
          source: payload.source,
          boxCount: payload.boxes.length,
          skuCount: payload.bySku.length,
          boxes: payload.boxes.slice(0, 100),
          bySku: payload.bySku.slice(0, 200),
        },
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/headhaul/sku", (req, res) => {
    try {
      const state = getState();
      const partnerSku = String(req.query.partnerSku ?? "").trim();
      if (!partnerSku) {
        return res.status(400).json({ error: "需要 partnerSku" });
      }
      const row = getSkuHeadhaulSummary(state.shipping, partnerSku);
      if (!row) {
        return res.status(404).json({
          error: `无装箱头程样本：${partnerSku}`,
          hint: "Catalog 将回退到 preferAir 单方式全局费率",
        });
      }
      res.json({ data: row });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 亦邦查轨迹：物流编号 → Playwright 官网查件 → 落盘 + 回填前端。
   * 边界：不写飞书；凭据只读本地 credentials.json。
   */
  router.post("/track/yibang", async (req, res) => {
    const logisticsNo = String(
      (req.body as { logisticsNo?: unknown })?.logisticsNo ?? "",
    ).trim();
    if (!logisticsNo) {
      return res.status(400).json({ error: "请填写物流编号" });
    }

    try {
      const packing = listYibangLogisticsNos();
      const packingHit =
        packing.keys.find((k) => k.logisticsNo === logisticsNo) ?? null;

      let account = null as
        | { username: string; password: string }
        | null;
      try {
        account = loadForwarderCredentials().accounts.yibang ?? null;
      } catch {
        account = null;
      }

      const track = await runYundaomenTrack({
        logisticsNo,
        account,
        opts: {
          headed: false,
          timeoutMs: 45_000,
          login: false,
        },
      });

      const outDir = getForwarderPortalsDir();
      mkdirSync(outDir, { recursive: true });
      const reportPath = join(outDir, `yibang-track-ui-${Date.now()}.json`);
      const payload = {
        at: new Date().toISOString(),
        portalId: "yibang" as const,
        adapter: "yundaomen" as const,
        queryField: "物流编号" as const,
        packingSource: packing.sourcePath,
        packing: packingHit,
        track,
      };
      writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

      res.json({
        data: { ...payload, reportPath },
        message: track.ok
          ? track.statusText || track.message
          : track.message || "亦邦查件失败",
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 飞坦查轨迹：装箱「票号」→ 海运放货订单 / 沙特仓批次 → 查看轨迹。
   * 海运空运都用票号（用户确认）。不写飞书。
   */
  router.post("/track/feitan", async (req, res) => {
    const body = req.body as {
      ticketNo?: unknown;
      mode?: unknown;
    };
    const ticketNo = String(body.ticketNo ?? "").trim();
    if (!ticketNo) {
      return res.status(400).json({ error: "请填写票号" });
    }
    const modeRaw = String(body.mode ?? "auto").trim().toLowerCase();
    const mode =
      modeRaw === "sea" || modeRaw === "air" || modeRaw === "auto"
        ? modeRaw
        : "auto";

    try {
      const packing = listFeitanTicketNos();
      const packingHit =
        packing.keys.find((k) => k.ticketNo === ticketNo) ?? null;
      const resolvedMode =
        mode !== "auto"
          ? mode
          : packingHit
            ? packingModeToFleetan(packingHit.modeRaw)
            : "auto";

      let account = null as
        | { username: string; password: string }
        | null;
      try {
        account = loadForwarderCredentials().accounts.feitan ?? null;
      } catch {
        account = null;
      }

      const track = await runFleetanTrack({
        ticketNo,
        mode: resolvedMode,
        account,
        opts: {
          headed: false,
          timeoutMs: 45_000,
          login: true,
          screenshot: false,
        },
      });

      const outDir = getForwarderPortalsDir();
      mkdirSync(outDir, { recursive: true });
      const reportPath = join(outDir, `feitan-track-ui-${Date.now()}.json`);
      const payload = {
        at: new Date().toISOString(),
        portalId: "feitan" as const,
        adapter: "fleetan" as const,
        queryField: "票号" as const,
        packingSource: packing.sourcePath,
        packing: packingHit,
        track,
      };
      writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

      res.json({
        data: { ...payload, reportPath },
        message: track.ok
          ? track.statusText || track.message
          : track.message || "飞坦查件失败",
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 汉沙查轨迹：装箱「票号」→ nextsls 运单列表 → 侧滑「路由信息」。
   * 海运空运同一列表。不写飞书。
   */
  router.post("/track/hansha", async (req, res) => {
    const ticketNo = String(
      (req.body as { ticketNo?: unknown })?.ticketNo ?? "",
    ).trim();
    if (!ticketNo) {
      return res.status(400).json({ error: "请填写票号" });
    }

    try {
      const packing = listHanshaTicketNos();
      const packingHit =
        packing.keys.find((k) => k.ticketNo === ticketNo) ?? null;

      let account = null as
        | { username: string; password: string }
        | null;
      try {
        account = loadForwarderCredentials().accounts.hansha ?? null;
      } catch {
        account = null;
      }
      if (!account?.username || !account?.password) {
        return res.status(400).json({
          error: "credentials.json 缺少 hansha 账号",
        });
      }

      const track = await runHanshaTrack({
        ticketNo,
        account,
        opts: {
          headed: false,
          timeoutMs: 55_000,
          login: true,
        },
      });

      const outDir = getForwarderPortalsDir();
      mkdirSync(outDir, { recursive: true });
      const reportPath = join(outDir, `hansha-track-ui-${Date.now()}.json`);
      const payload = {
        at: new Date().toISOString(),
        portalId: "hansha" as const,
        adapter: "nextsls" as const,
        queryField: "票号" as const,
        packingSource: packing.sourcePath,
        packing: packingHit,
        track,
      };
      writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

      res.json({
        data: { ...payload, reportPath },
        message: track.ok
          ? track.statusText || track.message
          : track.message || "汉沙查件失败",
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 亚优汇查轨迹：装箱「票号」→ nextsls 运单列表 → 侧滑「路由信息」。
   * 与汉沙同 UI；海运空运同一列表。不写飞书。
   */
  router.post("/track/yayouhui", async (req, res) => {
    const ticketNo = String(
      (req.body as { ticketNo?: unknown })?.ticketNo ?? "",
    ).trim();
    if (!ticketNo) {
      return res.status(400).json({ error: "请填写票号" });
    }

    try {
      const packing = listYayouhuiTicketNos();
      const packingHit =
        packing.keys.find((k) => k.ticketNo === ticketNo) ?? null;

      let account = null as
        | { username: string; password: string }
        | null;
      try {
        account = loadForwarderCredentials().accounts.yayouhui ?? null;
      } catch {
        account = null;
      }
      if (!account?.username || !account?.password) {
        return res.status(400).json({
          error: "credentials.json 缺少 yayouhui 账号",
        });
      }

      const track = await runYayouhuiTrack({
        ticketNo,
        account,
        opts: {
          headed: false,
          timeoutMs: 55_000,
          login: true,
        },
      });

      const outDir = getForwarderPortalsDir();
      mkdirSync(outDir, { recursive: true });
      const reportPath = join(outDir, `yayouhui-track-ui-${Date.now()}.json`);
      const payload = {
        at: new Date().toISOString(),
        portalId: "yayouhui" as const,
        adapter: "nextsls" as const,
        queryField: "票号" as const,
        packingSource: packing.sourcePath,
        packing: packingHit,
        track,
      };
      writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

      res.json({
        data: { ...payload, reportPath },
        message: track.ok
          ? track.statusText || track.message
          : track.message || "亚优汇查件失败",
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 义特查轨迹：装箱「物流编号」去 U 后缀 → nextsls 运单列表 → 侧滑「路由信息」。
   * 例：YT2604647454U002 → 查 YT2604647454。与汉沙同 UI；走 WOS（非 oms）。不写飞书。
   */
  router.post("/track/yite", async (req, res) => {
    const body = req.body as { logisticsNo?: unknown; ticketNo?: unknown };
    const raw = String(body?.logisticsNo ?? body?.ticketNo ?? "").trim();
    if (!raw) {
      return res.status(400).json({ error: "请填写物流编号" });
    }
    const waybillNo = yiteWaybillFromLogistics(raw);
    if (!waybillNo) {
      return res.status(400).json({ error: "物流编号无效" });
    }

    try {
      const packing = listYiteLogisticsNos();
      const packingHit =
        packing.keys.find(
          (k) =>
            k.waybillNo === waybillNo ||
            k.logisticsNo === raw ||
            yiteWaybillFromLogistics(k.logisticsNo) === waybillNo,
        ) ?? null;

      let account = null as
        | { username: string; password: string }
        | null;
      try {
        account = loadForwarderCredentials().accounts.yite ?? null;
      } catch {
        account = null;
      }
      if (!account?.username || !account?.password) {
        return res.status(400).json({
          error: "credentials.json 缺少 yite 账号",
        });
      }

      const track = await runYiteTrack({
        ticketNo: waybillNo,
        account,
        opts: {
          headed: false,
          timeoutMs: 55_000,
          login: true,
        },
      });

      const outDir = getForwarderPortalsDir();
      mkdirSync(outDir, { recursive: true });
      const reportPath = join(outDir, `yite-track-ui-${Date.now()}.json`);
      const payload = {
        at: new Date().toISOString(),
        portalId: "yite" as const,
        adapter: "nextsls" as const,
        queryField: "物流编号" as const,
        logisticsNo: raw,
        waybillNo,
        packingSource: packing.sourcePath,
        packing: packingHit,
        track,
      };
      writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

      res.json({
        data: { ...payload, reportPath },
        message: track.ok
          ? track.statusText || track.message
          : track.message || "义特查件失败",
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 安时达查轨迹：装箱「票号」→ 中国单「订单号」→ 操作 → 轨迹列表。
   * 独立 ontask 适配器；海运空运同一入口。不写飞书。
   */
  router.post("/track/anshida", async (req, res) => {
    const ticketNo = String(
      (req.body as { ticketNo?: unknown })?.ticketNo ?? "",
    ).trim();
    if (!ticketNo) {
      return res.status(400).json({ error: "请填写票号" });
    }

    try {
      const packing = listAnshidaTicketNos();
      const packingHit =
        packing.keys.find((k) => k.ticketNo === ticketNo) ?? null;

      let account = null as
        | { username: string; password: string }
        | null;
      try {
        account = loadForwarderCredentials().accounts.anshida ?? null;
      } catch {
        account = null;
      }
      if (!account?.username || !account?.password) {
        return res.status(400).json({
          error: "credentials.json 缺少 anshida 账号",
        });
      }

      const track = await runAnshidaTrack({
        ticketNo,
        account,
        opts: {
          headed: false,
          timeoutMs: 55_000,
          login: true,
        },
      });

      const outDir = getForwarderPortalsDir();
      mkdirSync(outDir, { recursive: true });
      const reportPath = join(outDir, `anshida-track-ui-${Date.now()}.json`);
      const payload = {
        at: new Date().toISOString(),
        portalId: "anshida" as const,
        adapter: "ontask" as const,
        queryField: "票号" as const,
        packingSource: packing.sourcePath,
        packing: packingHit,
        track,
      };
      writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

      res.json({
        data: { ...payload, reportPath },
        message: track.ok
          ? track.statusText || track.message
          : track.message || "安时达查件失败",
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 起克查轨迹：装箱「物流编号」→ B2B报表「入仓号」→ 抓采购单状态。
   * 独立 chicexpress 适配器。不写飞书。
   */
  router.post("/track/qike", async (req, res) => {
    const logisticsNo = String(
      (req.body as { logisticsNo?: unknown })?.logisticsNo ?? "",
    ).trim();
    if (!logisticsNo) {
      return res.status(400).json({ error: "请填写物流编号" });
    }

    try {
      const packing = listQikeLogisticsNos();
      const packingHit =
        packing.keys.find((k) => k.logisticsNo === logisticsNo) ?? null;

      let account = null as
        | { username: string; password: string }
        | null;
      try {
        account = loadForwarderCredentials().accounts.qike ?? null;
      } catch {
        account = null;
      }
      if (!account?.username || !account?.password) {
        return res.status(400).json({
          error: "credentials.json 缺少 qike 账号",
        });
      }

      const track = await runQikeTrack({
        logisticsNo,
        account,
        opts: {
          headed: false,
          timeoutMs: 55_000,
          login: true,
        },
      });

      const outDir = getForwarderPortalsDir();
      mkdirSync(outDir, { recursive: true });
      const reportPath = join(outDir, `qike-track-ui-${Date.now()}.json`);
      const payload = {
        at: new Date().toISOString(),
        portalId: "qike" as const,
        adapter: "chicexpress" as const,
        queryField: "物流编号" as const,
        packingSource: packing.sourcePath,
        packing: packingHit,
        track,
      };
      writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

      res.json({
        data: { ...payload, reportPath },
        message: track.ok
          ? track.statusText || track.message
          : track.message || "起克查件失败",
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 货代面单裁标：浏览器打印的 A4 PDF → 只留标签框，可直接打印贴纸。
   */
  router.post("/labels/crop", async (req, res) => {
    const filename = String(
      (req.body as { filename?: unknown })?.filename ?? "",
    ).trim();
    const rawB64 = String((req.body as { base64?: unknown })?.base64 ?? "");
    try {
      const input = decodePdfBase64(rawB64);
      const cropped = await cropAwbLabelPdf(input);
      const outName = croppedDownloadName(filename);
      res.json({
        data: {
          filename: outName,
          mimeType: "application/pdf",
          base64: Buffer.from(cropped.pdfBytes).toString("base64"),
          pageCount: cropped.pageCount,
          widthPt: Math.round(cropped.widthPt * 100) / 100,
          heightPt: Math.round(cropped.heightPt * 100) / 100,
        },
        message: `已裁剪 ${cropped.pageCount} 张标签`,
      });
    } catch (e) {
      if (e instanceof LabelCropError) {
        return res.status(400).json({ error: e.message });
      }
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return router;
}
