import { readFileSync } from "node:fs";
import { Router } from "express";
import type { AppState } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { requireAdmin } from "../../auth/middleware.js";
import { parsePageQuery, slicePage } from "../../common/page-query.js";
import {
  clearCatalogAssembleCache,
  getAssembledCatalogRows,
} from "../catalog/query.js";
import { buildCatalogProvenance } from "../catalog/provenance.js";
import { ingestFeishuOpsIntoState } from "../../platforms/feishu/ingest/ops.js";
import {
  loadFeishuDocsConfig,
  normalizeDailyBriefRun,
  pullFeishuRaw,
} from "../../platforms/feishu/index.js";
import { isFeishuError } from "../../platforms/feishu/errors.js";
import { loadRegistry } from "../../shops/registry.js";
import { findShopPreset } from "../warehouse-booking/pack-ticket.js";
import { lineStatus } from "./ship-plan/service.js";
import * as shipPlan from "./ship-plan/service.js";
import * as workbook from "./workbook/service.js";

/** 显式 prefix 优先；否则按当前店 projectCode 反查 N1/N2… */
function resolveWorkbookPrefix(
  getState: () => AppState,
  rawPrefix: unknown,
): string {
  const explicit = String(rawPrefix ?? "")
    .trim()
    .toUpperCase();
  if (explicit) return explicit;
  const state = getState();
  const project =
    String(state.store?.account ?? "").trim() ||
    String(state.store?.id ?? "").trim();
  const preset = findShopPreset({ projectCode: project });
  return (preset?.prefix || "N1").toUpperCase();
}

/**
 * 补货计划：全量列出 Catalog 装配行（紧急标红靠前），不做「建议补 X 件」。
 * 销量口径：门户 Sales 三态；库存：FBN；品名不足时用飞书/采购名。
 * 另：/workbook 维护本地动态补货表（月均×备货月数+15 + ASN 在途；备货月数默认 3）。
 */
export function createReplenishRouter(getState: () => AppState) {
  const router = Router();

  // ── 本地动态补货表（按店 xlsx）────────────────────────────────
  router.get("/workbook", (req, res) => {
    try {
      const prefix = resolveWorkbookPrefix(getState, req.query.prefix);
      const coverMonths = workbook.clampCoverMonths(req.query.coverMonths);
      const onlyNeed = String(req.query.onlyNeed ?? "") === "1";
      const topPctRaw = Number(req.query.topPct);
      const topPct =
        Number.isFinite(topPctRaw) && topPctRaw > 0 ? topPctRaw : undefined;
      const q = String(req.query.q ?? "").trim();
      const pageQ = parsePageQuery(req.query as Record<string, unknown>);
      const doc = workbook.loadWorkbookDoc(prefix, {
        rebuildIfMissing: true,
        coverMonths,
      });
      if (!doc) {
        return res.status(404).json({
          error: `未找到店前缀 ${prefix} 的补货表（检查 shop-prefix-map / 店 state）`,
        });
      }
      const filtered = workbook.filterWorkbookRows(doc.rows, {
        q: q || undefined,
        onlyNeed,
        topPct,
      });
      const paged = slicePage(filtered, pageQ);
      res.json({
        data: {
          meta: doc.meta,
          rows: paged.data,
          summary: {
            rowCount: doc.rows.length,
            filteredCount: filtered.length,
            needCount: doc.meta.needCount,
            onlyNeed,
            topPct: topPct ?? null,
            coverMonths,
            formulaNote: doc.meta.formulaNote,
            dir: workbook.listWorkbookBrief().dir,
            manualTagOptions: workbook.manualTagOptions(),
          },
        },
        meta: {
          ...paged.meta,
          prefix,
          coverMonths,
          q: q || undefined,
        },
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/workbook/files", (_req, res) => {
    res.json({ data: workbook.listWorkbookBrief() });
  });

  router.post("/workbook/manual", requireAdmin, (req, res) => {
    try {
      const prefix = String(req.body?.prefix ?? "").trim().toUpperCase();
      const partnerSku = String(req.body?.partnerSku ?? "").trim();
      if (!prefix || !partnerSku) {
        return res.status(400).json({ error: "需要 prefix 与 partnerSku" });
      }
      const hasTag = Object.prototype.hasOwnProperty.call(req.body ?? {}, "manualTag");
      const hasNote = Object.prototype.hasOwnProperty.call(req.body ?? {}, "note");
      const doc = workbook.patchWorkbookManual({
        shopPrefix: prefix,
        partnerSku,
        manualTag: hasTag ? String(req.body.manualTag ?? "") : undefined,
        note: hasNote ? String(req.body.note ?? "") : undefined,
        coverMonths: workbook.clampCoverMonths(req.body?.coverMonths),
      });
      const row = doc.rows.find((r) => r.partnerSku === partnerSku) ?? null;
      res.json({
        data: { meta: doc.meta, row },
        message: `已更新 ${partnerSku} 并回写 ${doc.meta.filePath}`,
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/workbook/rebuild", requireAdmin, (req, res) => {
    try {
      const raw = req.body?.prefixes;
      const prefixes = Array.isArray(raw)
        ? raw.map((p: unknown) => String(p).trim().toUpperCase()).filter(Boolean)
        : undefined;
      const coverMonths = workbook.clampCoverMonths(req.body?.coverMonths);
      const result = workbook.rebuildWorkbooks({ prefixes, coverMonths });
      res.json({
        data: {
          generatedAt: result.generatedAt,
          dir: result.dir,
          shops: result.docs.map((d) => ({
            shopPrefix: d.meta.shopPrefix,
            shopName: d.meta.shopName,
            filePath: d.meta.filePath,
            rowCount: d.meta.rowCount,
            needCount: d.meta.needCount,
          })),
        },
        message: `已重算 ${result.docs.length} 店补货表 → ${result.dir}`,
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/plan", (req, res) => {
    const state = getState();
    const pageQ = parsePageQuery(req.query as Record<string, unknown>);
    const q = String(req.query.q ?? "").trim();
    const assembled = getAssembledCatalogRows(state);
    const provenance = buildCatalogProvenance(state);
    // 用当前请求态的店（state.store），不要用系统默认同步店 getActiveShop
    const reg = loadRegistry();
    const shop =
      reg.shops.find((s) => s.id === state.store?.id) ??
      reg.shops.find((s) => s.projectCode === state.store?.account) ??
      reg.shops[0];
    const shopId = shop?.id ?? state.store?.id ?? "";
    const shopName = shop?.name ?? state.store?.name ?? "";
    const projectCode =
      shop?.projectCode ?? state.store?.account ?? shopId;
    const opsBySku = new Map(
      (state.feishuOpsSnapshots ?? []).map((o) => [o.partnerSku, o] as const),
    );

    const needle = q.toLowerCase();
    let rows = assembled.rows.map((row) => {
      const ops = opsBySku.get(row.partnerSku);
      const offlineCatalog = row.listingType === "orphan";
      const dims =
        row.specs.lengthCm != null &&
        row.specs.widthCm != null &&
        row.specs.heightCm != null
          ? `${row.specs.lengthCm}×${row.specs.widthCm}×${row.specs.heightCm} cm`
          : null;
      const weight =
        row.specs.weightKg != null ? `${row.specs.weightKg} kg` : null;
      return {
        partnerSku: row.partnerSku,
        noonSku: row.noonSku || "",
        title: row.title,
        imageUrl: row.imageUrl || "",
        isActive: row.isActive,
        listingType: row.listingType,
        offlineCatalog,
        offlineHint: offlineCatalog
          ? "未进 Noon Catalog 导出（有销量/库存或飞书记录；无站内图）"
          : null,
        shopId,
        shopName,
        projectCode,
        inventory: row.inventory,
        dailyAvg: row.replenish.dailyAvg,
        availableDays: row.replenish.availableDays,
        safetyDays: row.replenish.safetyDays,
        status: row.replenish.status,
        airLeadDays: row.replenish.airLeadDays,
        seaLeadDays: row.replenish.seaLeadDays,
        salesD7: row.sales.d7.units,
        salesD30: row.sales.d30.units,
        salesD90: row.sales.d90.units,
        specs: {
          dimsLabel: dims,
          weightLabel: weight,
          lengthCm: row.specs.lengthCm,
          widthCm: row.specs.widthCm,
          heightCm: row.specs.heightCm,
          weightKg: row.specs.weightKg,
          purchaseCost: row.specs.purchaseCost,
        },
        feishu: ops
          ? {
              productName: ops.productName || "",
              airReplenishPlan: ops.airReplenishPlan,
              seaReplenishPlan: ops.seaReplenishPlan,
              airInTransit: ops.airInTransit,
              seaInTransit: ops.seaInTransit,
              purchasedQty: ops.purchasedQty,
              sheetTitle: ops.sheetTitle,
              reportDate: ops.reportDate,
            }
          : null,
      };
    });

    rows.sort((a, b) => {
      const rank = (s: string) =>
        s === "urgent" ? 0 : s === "stable" ? 1 : s === "skip" ? 3 : 2;
      const d = rank(a.status) - rank(b.status);
      if (d !== 0) return d;
      const ad = a.availableDays ?? 9999;
      const bd = b.availableDays ?? 9999;
      if (ad !== bd) return ad - bd;
      return (b.salesD7 ?? 0) - (a.salesD7 ?? 0);
    });

    const byStatus: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    }
    const withPlan = rows.filter(
      (r) =>
        (r.feishu?.airReplenishPlan ?? 0) > 0 ||
        (r.feishu?.seaReplenishPlan ?? 0) > 0,
    ).length;
    const skuCount = rows.length;
    const offlineCount = rows.filter((r) => r.offlineCatalog).length;

    const statusFilter = String(req.query.status ?? "")
      .trim()
      .toLowerCase();

    if (needle) {
      rows = rows.filter((r) => {
        const blob = [
          r.partnerSku,
          r.title,
          r.noonSku,
          r.feishu?.productName ?? "",
          r.shopName,
          r.projectCode,
        ]
          .join(" ")
          .toLowerCase();
        return blob.includes(needle);
      });
    }

    if (
      statusFilter &&
      statusFilter !== "all" &&
      ["urgent", "stable", "skip", "unknown"].includes(statusFilter)
    ) {
      rows = rows.filter((r) => r.status === statusFilter);
    }

    const paged = slicePage(rows, pageQ);

    // 补货相关时效：库存 / 销量（与 Catalog 同一套 provenance）
    const freshnessSlices = (provenance.slices ?? []).filter((s) =>
      ["stock", "sales"].includes(s.key),
    );

    res.json({
      data: {
        rows: paged.data,
        summary: {
          skuCount,
          byStatus,
          offlineCatalogCount: offlineCount,
          feishuOpsCount: state.feishuOpsSnapshots?.length ?? 0,
          withFeishuPlan: withPlan,
          shopId,
          shopName,
          projectCode,
          source: "stock + salesFacts + catalog/orphan + feishuOps",
          gap:
            (state.feishuOpsSnapshots?.length ?? 0) === 0
              ? "尚无飞书日报补货列：需要时再点「同步飞书」"
              : null,
          dataNote:
            "实际库存FBN=Catalog Active Net Stock（与门户一致；无则回退分仓ledger）；supermall 仅参考；FBN可撑=FBN÷近90日日均；销量：Impex Sales",
        },
        freshness: {
          today: provenance.today,
          asOf: provenance.asOf,
          slices: freshnessSlices,
        },
      },
      meta: {
        asOf: assembled.asOfIso,
        ...paged.meta,
        q: q || undefined,
        status: statusFilter || "all",
        cached: assembled.cached,
      },
    });
  });

  router.post("/sync-feishu-daily", requireAdmin, async (_req, res) => {
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
      clearCatalogAssembleCache();
      res.json({
        data: {
          pullRunId: pull.runId,
          ops,
          feishuOpsCount: state.feishuOpsSnapshots?.length ?? 0,
        },
        message: `日报补货入库 ${ops.upserted} SKU（${ops.sheetTitle ?? "?"}）`,
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

  // ── 人工导入发货计划（固定格式 xlsx）──────────────────────────

  router.get("/ship-plans", (_req, res) => {
    res.json({ data: shipPlan.listPlansBrief() });
  });

  // 静态路径须在 /:id 之前
  router.post("/ship-plans/import", requireAdmin, (req, res) => {
    try {
      const filename = String(req.body?.filename ?? "").trim() || "upload.xlsx";
      const name = String(req.body?.name ?? "").trim() || undefined;
      const replaceId = String(req.body?.replaceId ?? "").trim() || undefined;
      const filePath = String(req.body?.filePath ?? "").trim();
      let buffer: Buffer;
      if (filePath) {
        buffer = readFileSync(filePath);
      } else {
        const b64 = String(req.body?.base64 ?? "").replace(
          /^data:[^;]+;base64,/,
          "",
        );
        if (!b64) {
          res.status(400).json({
            error: "请提供 base64 或 filePath（本机绝对路径）",
          });
          return;
        }
        buffer = Buffer.from(b64, "base64");
      }
      if (buffer.length > 8 * 1024 * 1024) {
        res.status(400).json({ error: "文件不超过 8MB" });
        return;
      }
      const result = shipPlan.importShipPlanFromBuffer({
        buffer,
        filename,
        name,
        replaceId,
      });
      res.json({
        data: {
          id: result.doc.id,
          summary: result.summary,
          warnings: result.warnings,
          forwarderRollup: shipPlan.rollupByForwarder(result.doc),
          cargoGaps: shipPlan.listCargoGaps(result.doc),
        },
        message: `已导入 ${result.summary.lineCount} 行（纳入 ${result.summary.includeCount}，不补货 ${result.summary.skipCount}）`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/ship-plans/:id", (req, res) => {
    const detail = shipPlan.getPlanDetail(String(req.params.id));
    if (!detail) {
      res.status(404).json({ error: "计划不存在" });
      return;
    }
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const status = String(req.query.status ?? "").trim().toLowerCase();
    const planDate = String(req.query.planDate ?? "").trim();
    let lines = detail.doc.lines.map((line) => ({
      ...line,
      status: lineStatus(line),
    }));
    if (q) {
      lines = lines.filter((l) =>
        [l.partnerSku, l.productName, l.note, ...l.legs.map((g) => g.forwarder)]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    if (status && status !== "all") {
      lines = lines.filter((l) => l.status === status);
    }
    if (planDate === "none") {
      lines = lines.filter((l) => !l.planDate);
    } else if (planDate) {
      lines = lines.filter((l) => l.planDate === planDate);
    }
    res.json({
      data: {
        ...detail,
        doc: { ...detail.doc, lines },
      },
    });
  });

  router.delete("/ship-plans/:id", requireAdmin, (req, res) => {
    const ok = shipPlan.removePlan(String(req.params.id));
    if (!ok) {
      res.status(404).json({ error: "计划不存在" });
      return;
    }
    res.json({ data: { deleted: true } });
  });

  router.patch("/ship-plans/:id/lines/:lineId", (req, res) => {
    try {
      const doc = shipPlan.patchLine(
        String(req.params.id),
        String(req.params.lineId),
        {
          include: req.body?.include,
          note: req.body?.note,
          planDate: req.body?.planDate,
          productName: req.body?.productName,
        },
      );
      res.json({ data: { doc, summary: shipPlan.summarizePlan(doc) } });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.put("/ship-plans/:id/lines/:lineId/legs", (req, res) => {
    try {
      const { doc, leg } = shipPlan.upsertLeg(
        String(req.params.id),
        String(req.params.lineId),
        {
          legId: req.body?.legId,
          forwarder: req.body?.forwarder,
          mode: req.body?.mode,
          qty: req.body?.qty,
          note: req.body?.note,
          cargoKind: req.body?.cargoKind,
          status: req.body?.status,
        },
      );
      res.json({
        data: {
          leg,
          summary: shipPlan.summarizePlan(doc),
          cargoGaps: shipPlan.listCargoGaps(doc),
          forwarderRollup: shipPlan.rollupByForwarder(doc),
        },
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/ship-plans/:id/lines/:lineId/legs/:legId/ship", (req, res) => {
    try {
      const result = shipPlan.recordShipment(
        String(req.params.id),
        String(req.params.lineId),
        String(req.params.legId),
        Number(req.body?.qty),
      );
      res.json({
        data: {
          leg: result.leg,
          remaining: result.remaining,
          summary: shipPlan.summarizePlan(result.doc),
          lineStatus: lineStatus(
            result.doc.lines.find((l) => l.id === req.params.lineId)!,
          ),
        },
        message: `已登记发出；本腿剩余 ${result.remaining} 件`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/ship-plans/:id/cargo-gaps", (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const { updated, doc } = shipPlan.fillCargoGaps(
        String(req.params.id),
        items,
      );
      res.json({
        data: {
          updated,
          cargoGaps: shipPlan.listCargoGaps(doc),
          forwarderRollup: shipPlan.rollupByForwarder(doc),
          summary: shipPlan.summarizePlan(doc),
        },
        message: `已保存 ${updated} 条货代×货性`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/ship-plans/:id/suggest/:partnerSku", (req, res) => {
    const sug = shipPlan.suggestChannelsForLine(String(req.params.partnerSku));
    res.json({ data: sug });
  });

  return router;
}
