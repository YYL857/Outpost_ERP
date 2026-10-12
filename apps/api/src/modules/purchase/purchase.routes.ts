import { Router } from "express";
import {
  requireCapability,
  requirePurchaseAccess,
  type AuthedRequest,
} from "../../auth/middleware.js";
import type { AppState } from "../../common/types.js";
import {
  buildCatalogDisplayMap,
  catalogDisplayOf,
} from "../../common/catalog-display.js";
import { parsePageQuery, slicePage } from "../../common/page-query.js";
import { saveState } from "../../data/store.js";
import { clearCatalogAssembleCache } from "../catalog/query.js";
import {
  formatIngestError,
  ingestFeishuLocalIntoState,
} from "../../platforms/feishu/ingest/local.js";
import { isFeishuError } from "../../platforms/feishu/errors.js";
import {
  loadFeishuDocsConfig,
  normalizeFeishuRun,
  pullFeishuRaw,
} from "../../platforms/feishu/index.js";
import {
  capture1688LoginSession,
  fetchBuyerOrderLogistics,
  get1688SessionStatus,
  hasStorageState,
  shanghaiToday,
} from "../../platforms/alibaba-1688/index.js";
import { pushAlert } from "../sync/alerts.js";
import { setAuditDetail } from "../audit/detail.js";
import {
  applyLogisticsToPurchaseLines,
  collectPurchaseOrderIds,
  confirmArrival,
  listArrivingToday,
} from "./arriving.js";
import {
  appendLedgerRow,
  getLedgerSheetDef,
  listLedgerRows,
  listLedgerSheetMeta,
  resolveAccountsDoc,
  updateLedgerRow,
  type LedgerSheetKey,
} from "./accounts-ledger.js";
import {
  is1688LogisticsSyncRunning,
  readLogisticsProgress,
  release1688LogisticsLock,
  tryAcquire1688LogisticsLock,
  writeLogisticsProgress,
} from "./logistics-progress.js";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** 账目记账审计：只留可追溯键，不落整表单/长备注 */
export function slimLedgerAuditBody(input: {
  sheet: string;
  sheetRow?: number | null;
  action: "append" | "update";
  fields: Record<string, unknown>;
}): Record<string, unknown> {
  const f = input.fields;
  const out: Record<string, unknown> = {
    sheet: input.sheet,
    action: input.action,
    changedKeys: Object.keys(f).sort(),
  };
  if (input.sheetRow != null) out.sheetRow = input.sheetRow;
  for (const key of [
    "partnerSku",
    "packName",
    "category",
    "orderId",
    "qty",
    "amount",
  ] as const) {
    const v = f[key];
    if (v == null || v === "") continue;
    out[key] = typeof v === "string" ? String(v).slice(0, 80) : v;
  }
  return out;
}

async function syncAccountsIntoState(state: AppState) {
  const cfg = loadFeishuDocsConfig();
  const pull = await pullFeishuRaw(cfg, { docIds: ["accounts"] });
  if (!pull.results.some((r) => r.ok && r.docId === "accounts")) {
    return {
      ok: false as const,
      error: "账目表拉取失败或未配置 accounts",
      detail: pull,
    };
  }
  const norm = normalizeFeishuRun({
    rawRunId: pull.runId,
    docIds: ["accounts"],
  });
  const report = ingestFeishuLocalIntoState(state);
  saveState(state);
  clearCatalogAssembleCache();
  return {
    ok: true as const,
    pullRunId: pull.runId,
    normalizeRunId: norm.runId,
    purchase: report.purchase,
    cash: report.cash,
    purchaseLines: state.purchaseLines?.length ?? 0,
    cashLedger: state.cashLedger?.length ?? 0,
  };
}

/**
 * 采购管理：单位成本（产品表）+ 采购明细/现金账（账目表）。
 * 超管与采购可访问（与侧栏 roles 对齐）。
 */
export function createPurchaseRouter(getState: () => AppState) {
  const router = Router();
  router.use(requirePurchaseAccess);

  router.get("/ledger/sheets", (_req, res) => {
    try {
      const accounts = resolveAccountsDoc();
      res.json({
        data: {
          spreadsheetToken: accounts.spreadsheetToken,
          url: accounts.url ?? null,
          sheets: listLedgerSheetMeta(),
        },
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

  router.get("/ledger/rows", async (req, res) => {
    const sheetKey = String(req.query.sheet ?? "").trim() as LedgerSheetKey;
    if (!getLedgerSheetDef(sheetKey)) {
      return res.status(400).json({
        error:
          "sheet 须为 product_purchase | packaging_purchase | expense_misc",
      });
    }
    try {
      const limit =
        typeof req.query.limit === "string"
          ? Number(req.query.limit)
          : undefined;
      const data = await listLedgerRows(sheetKey, {
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.json({ data });
    } catch (e) {
      if (isFeishuError(e)) {
        return res.status(400).json({ error: e.message, detail: e.toJSON() });
      }
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post(
    "/ledger/rows",
    requireCapability("purchase.write"),
    async (req, res) => {
      const sheetKey = String(req.body?.sheet ?? "").trim() as LedgerSheetKey;
      if (!getLedgerSheetDef(sheetKey)) {
        return res.status(400).json({
          error:
            "sheet 须为 product_purchase | packaging_purchase | expense_misc",
        });
      }
      const fields =
        req.body?.fields && typeof req.body.fields === "object"
          ? (req.body.fields as Record<string, unknown>)
          : {};
      const syncLocal = req.body?.syncLocal !== false;
      setAuditDetail(req, {
        body: slimLedgerAuditBody({
          sheet: sheetKey,
          action: "append",
          fields,
        }),
      });
      try {
        const written = await appendLedgerRow(sheetKey, fields);
        let sync: Awaited<ReturnType<typeof syncAccountsIntoState>> | null =
          null;
        if (syncLocal) {
          sync = await syncAccountsIntoState(getState());
        }
        setAuditDetail(req, {
          summary: `账目记账追加「${written.title}」${
            written.sheetRow ? `约第 ${written.sheetRow} 行` : ""
          }`,
          entityType: "feishuAccountsLedger",
          entityId: `${sheetKey}:${written.sheetRow ?? "append"}`,
          body: slimLedgerAuditBody({
            sheet: sheetKey,
            sheetRow: written.sheetRow,
            action: "append",
            fields,
          }),
          detail: {
            updatedRange: written.updatedRange ?? null,
          },
        });
        res.json({
          data: { written, sync },
          message: `已追加到飞书「${written.title}」${
            written.sheetRow ? `（约第 ${written.sheetRow} 行）` : ""
          }`,
        });
      } catch (e) {
        if (isFeishuError(e)) {
          return res.status(400).json({
            error: e.message,
            hint: e.hint,
            detail: e.toJSON(),
          });
        }
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  );

  router.put(
    "/ledger/rows",
    requireCapability("purchase.write"),
    async (req, res) => {
      const sheetKey = String(req.body?.sheet ?? "").trim() as LedgerSheetKey;
      if (!getLedgerSheetDef(sheetKey)) {
        return res.status(400).json({
          error:
            "sheet 须为 product_purchase | packaging_purchase | expense_misc",
        });
      }
      const sheetRow = Number(req.body?.sheetRow);
      if (!Number.isFinite(sheetRow) || sheetRow < 2) {
        return res.status(400).json({ error: "sheetRow 必须是 ≥2 的行号" });
      }
      const fields =
        req.body?.fields && typeof req.body.fields === "object"
          ? (req.body.fields as Record<string, unknown>)
          : {};
      const syncLocal = req.body?.syncLocal !== false;
      setAuditDetail(req, {
        body: slimLedgerAuditBody({
          sheet: sheetKey,
          sheetRow,
          action: "update",
          fields,
        }),
      });
      try {
        const written = await updateLedgerRow(sheetKey, sheetRow, fields);
        let sync: Awaited<ReturnType<typeof syncAccountsIntoState>> | null =
          null;
        if (syncLocal) {
          sync = await syncAccountsIntoState(getState());
        }
        setAuditDetail(req, {
          summary: `账目记账更新「${written.title}」第 ${written.sheetRow} 行`,
          entityType: "feishuAccountsLedger",
          entityId: `${sheetKey}:${written.sheetRow}`,
          body: slimLedgerAuditBody({
            sheet: sheetKey,
            sheetRow: written.sheetRow,
            action: "update",
            fields,
          }),
          detail: {
            updatedRange: written.updatedRange ?? null,
          },
        });
        res.json({
          data: { written, sync },
          message: `已更新飞书「${written.title}」第 ${written.sheetRow} 行`,
        });
      } catch (e) {
        if (isFeishuError(e)) {
          return res.status(400).json({
            error: e.message,
            hint: e.hint,
            detail: e.toJSON(),
          });
        }
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  );

  router.get("/summary", (_req, res) => {
    const state = getState();
    const costs = state.skuLocalCosts;
    const withCost = costs.filter((c) => c.purchaseCost > 0);
    const total = withCost.reduce((s, c) => s + c.purchaseCost, 0);
    const lines = state.purchaseLines ?? [];
    const lineAmount = lines.reduce((s, l) => s + (l.amount || 0), 0);
    const cash = state.cashLedger ?? [];
    const income = cash
      .filter((c) => c.kind === "income")
      .reduce((s, c) => s + c.amount, 0);
    const expense = cash
      .filter((c) => c.kind === "expense")
      .reduce((s, c) => s + c.amount, 0);
    const arriving = listArrivingToday(state);
    const session = get1688SessionStatus();

    res.json({
      data: {
        source: "feishu product + accounts",
        rowCount: costs.length,
        withPurchaseCost: withCost.length,
        sumPurchaseCostRmb: round2(total),
        purchaseLineCount: lines.length,
        purchaseLineAmount: round2(lineAmount),
        cashIncome: round2(income),
        cashExpense: round2(expense),
        arrivingTodayCount: arriving.length,
        alibaba1688HasSession: session.hasSession,
        coverageNote:
          lines.length === 0
            ? "尚无产品采购明细：请同步飞书账目表（accounts / 产品采购）"
            : "含单位采购成本 + 产品采购明细",
      },
    });
  });

  router.get("/costs", (req, res) => {
    const state = getState();
    const pageQ = parsePageQuery(req.query as Record<string, unknown>);
    const display = buildCatalogDisplayMap(state);
    const rows = [...state.skuLocalCosts]
      .map((c) => {
        const d = catalogDisplayOf(display, c.partnerSku);
        return {
          partnerSku: c.partnerSku,
          title: d.title,
          imageUrl: d.imageUrl,
          purchaseCost: c.purchaseCost,
          headhaul: c.headhaul,
          preferAir: c.preferAir,
          cargoType: c.cargoType ?? "general",
          source: c.source ?? null,
          updatedAt: c.updatedAt,
        };
      })
      .sort((a, b) => b.purchaseCost - a.purchaseCost);
    const paged = slicePage(rows, pageQ);
    res.json({
      data: paged.data,
      meta: { source: "skuLocalCosts", ...paged.meta },
    });
  });

  router.get("/lines", (req, res) => {
    const state = getState();
    const pageQ = parsePageQuery(req.query as Record<string, unknown>, {
      pageSize: 100,
      maxPageSize: 500,
    });
    const display = buildCatalogDisplayMap(state);
    const rows = [...(state.purchaseLines ?? [])]
      .map((r) => {
        const d = catalogDisplayOf(display, r.partnerSku, r.productName);
        return {
          ...r,
          title: d.title || r.productName,
          imageUrl: d.imageUrl,
        };
      })
      .sort((a, b) =>
        String(b.purchasedAt ?? "").localeCompare(String(a.purchasedAt ?? "")),
      );
    const paged = slicePage(rows, pageQ);
    res.json({
      data: paged.data,
      meta: { source: "purchaseLines (feishu accounts)", ...paged.meta },
    });
  });

  router.get("/cash", (req, res) => {
    const pageQ = parsePageQuery(req.query as Record<string, unknown>, {
      pageSize: 100,
      maxPageSize: 500,
    });
    const rows = [...(getState().cashLedger ?? [])].sort((a, b) =>
      String(b.occurredAt ?? "").localeCompare(String(a.occurredAt ?? "")),
    );
    const paged = slicePage(rows, pageQ);
    res.json({
      data: paged.data,
      meta: { source: "cashLedger (feishu accounts)", ...paged.meta },
    });
  });

  router.get("/arriving-today", (_req, res) => {
    const state = getState();
    const display = buildCatalogDisplayMap(state);
    const today = shanghaiToday();
    const rows = listArrivingToday(state, today).map((r) => {
      const d = catalogDisplayOf(display, r.partnerSku, r.productName);
      return {
        ...r,
        title: d.title || r.productName,
        imageUrl: d.imageUrl,
        noonSku: d.noonSku || "",
      };
    });
    res.json({
      data: rows,
      meta: { today, total: rows.length },
    });
  });

  router.post("/arrival-confirm", (req, res) => {
    const state = getState();
    const user = (req as AuthedRequest).user;
    try {
      const body = req.body ?? {};
      const result = confirmArrival(state, {
        receiptKey:
          typeof body.receiptKey === "string" ? body.receiptKey : undefined,
        id: typeof body.id === "string" ? body.id : undefined,
        partnerSku:
          typeof body.partnerSku === "string" ? body.partnerSku : undefined,
        orderId: typeof body.orderId === "string" ? body.orderId : undefined,
        addQty: body.markComplete
          ? undefined
          : typeof body.addQty === "number"
            ? body.addQty
            : Number(body.addQty),
        markComplete: Boolean(body.markComplete),
        updatedBy: user?.username || user?.id || "",
      });
      saveState(state);
      const display = buildCatalogDisplayMap(state);
      const arriving = listArrivingToday(state).map((r) => {
        const d = catalogDisplayOf(display, r.partnerSku, r.productName);
        return {
          ...r,
          title: d.title || r.productName,
          imageUrl: d.imageUrl,
          noonSku: d.noonSku || "",
        };
      });
      const name =
        result.receipt.partnerSku ||
        result.item?.productName ||
        result.receipt.lineId;
      const op = body.markComplete ? "到齐" : "确认到货";
      setAuditDetail(req, {
        summary: result.cleared
          ? `${op} ${name} ${result.receipt.receivedQty}/${result.receipt.qtyOrdered}，已清出待处理`
          : `${op} ${name} → ${result.receipt.receivedQty}/${result.receipt.qtyOrdered}`,
        entityType: "purchaseArrivalReceipt",
        entityId: result.receipt.key,
        detail: {
          markComplete: Boolean(body.markComplete),
          partnerSku: result.receipt.partnerSku,
          orderId: result.receipt.orderId,
          qtyOrdered: result.receipt.qtyOrdered,
          receivedQty: result.receipt.receivedQty,
          cleared: result.cleared,
        },
      });
      res.json({
        data: {
          receipt: result.receipt,
          cleared: result.cleared,
          arrivingToday: arriving,
          arrivingTodayCount: arriving.length,
        },
        message: result.cleared
          ? `${name} 已到齐，已清出待处理`
          : `${name} 已确认到货 ${result.receipt.receivedQty}/${result.receipt.qtyOrdered}`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/sync-accounts", async (_req, res) => {
    const state = getState();
    try {
      const result = await syncAccountsIntoState(state);
      if (!result.ok) {
        return res.status(400).json({
          error: result.error,
          detail: result.detail,
        });
      }
      res.json({
        data: {
          pullRunId: result.pullRunId,
          normalizeRunId: result.normalizeRunId,
          purchase: result.purchase,
          cash: result.cash,
          purchaseLines: result.purchaseLines,
          cashLedger: result.cashLedger,
        },
        message: `账目入库：采购 ${result.purchase.upserted} · 流水 ${result.cash.upserted}`,
      });
    } catch (e) {
      if (isFeishuError(e)) {
        return res.status(400).json({ error: e.message, detail: e.toJSON() });
      }
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
        detail: formatIngestError(e),
      });
    }
  });

  router.get("/1688-session", (_req, res) => {
    res.json({ data: get1688SessionStatus() });
  });

  router.post("/1688-login", async (req, res) => {
    try {
      const loginWaitMs =
        typeof req.body?.loginWaitMs === "number"
          ? req.body.loginWaitMs
          : 180_000;
      const result = await capture1688LoginSession({ loginWaitMs });
      if (!result.ok) {
        return res.status(400).json({ error: result.message, data: result });
      }
      res.json({ data: result, message: result.message });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/1688-logistics-progress", (_req, res) => {
    res.json({
      data: {
        ...readLogisticsProgress(),
        running: is1688LogisticsSyncRunning(),
      },
    });
  });

  router.post("/sync-1688-logistics", async (req, res) => {
    const state = getState();
    if (!tryAcquire1688LogisticsLock()) {
      return res.status(409).json({
        error: "已有 1688 物流查询在跑，请等当前分块批次完成。",
        data: readLogisticsProgress(),
      });
    }
    try {
      if (!hasStorageState()) {
        return res.status(400).json({
          error:
            "缺少 1688 登录态。请先点「获取 1688 登录态」，在弹出浏览器中登录后再同步物流。",
          data: get1688SessionStatus(),
        });
      }
      const bodyIds = Array.isArray(req.body?.orderIds)
        ? (req.body.orderIds as unknown[])
            .map((x) => String(x || "").trim())
            .filter(Boolean)
        : null;
      const limit =
        typeof req.body?.limit === "number" ? Number(req.body.limit) : 60;
      const recentDays =
        typeof req.body?.recentDays === "number"
          ? Number(req.body.recentDays)
          : 30;
      const chunkSize = Math.min(
        20,
        Math.max(
          1,
          typeof req.body?.chunkSize === "number"
            ? Number(req.body.chunkSize)
            : 15,
        ),
      );
      const onlyOpen = req.body?.onlyOpen !== false;
      const includeUndated = req.body?.includeUndated === true;
      const collected = bodyIds?.length
        ? {
            orderIds: [...new Set(bodyIds)]
              .filter((id) => /^\d{15,22}$/.test(id))
              .slice(0, Math.min(limit, 300)),
            totalWithOrderId: bodyIds.length,
            selected: bodyIds.length,
            recentDays,
            cutoff: null as string | null,
          }
        : collectPurchaseOrderIds(state, {
            onlyOpen,
            limit,
            recentDays,
            includeUndated,
          });
      const orderIds = collected.orderIds;
      if (!orderIds.length) {
        return res.status(400).json({
          error:
            "无待查订单号。默认只查近 30 天、有采购日期、在途/无运单（约几十单）。可先同步飞书账目表，或传 body.orderIds / recentDays:0。",
          data: collected,
        });
      }

      const runId = `run-${Date.now()}`;
      const batchTotal = Math.ceil(orderIds.length / chunkSize);
      writeLogisticsProgress({
        status: "running",
        batchIndex: 0,
        batchTotal,
        orderDone: 0,
        orderTotal: orderIds.length,
        matchedLines: 0,
        okOrders: 0,
        runId,
        message: `准备分块：近${collected.recentDays || "不限"}天 · ${orderIds.length} 单 · ${batchTotal} 批（每批 ${chunkSize}）` +
          (collected.cutoff ? ` · 自 ${collected.cutoff}` : ""),
      });

      let matchedLines = 0;
      let okOrders = 0;
      // 物流批量查询默认无头，避免弹出浏览器打断本机操作；需要排障时 body.headed=true
      const headed = req.body?.headed === true;
      const batch = await fetchBuyerOrderLogistics(orderIds, {
        headed,
        interactiveLogin: false,
        batchSize: chunkSize,
        timeoutMs: 120_000,
        pace: "normal",
        onBatch: async ({
          batchIndex,
          batchTotal: bt,
          orders,
          orderDone,
          orderTotal,
        }) => {
          const applied = applyLogisticsToPurchaseLines(state, orders);
          matchedLines += applied.matchedLines;
          okOrders += orders.filter((o) => o.ok).length;
          saveState(state);
          writeLogisticsProgress({
            status: "running",
            batchIndex,
            batchTotal: bt,
            orderDone,
            orderTotal,
            matchedLines,
            okOrders,
            runId,
            message: `第 ${batchIndex}/${bt} 批完成 · 已查 ${orderDone}/${orderTotal} · 回填 ${matchedLines} 行`,
          });
        },
      });

      if (!batch.ok && batch.message.includes("登录态")) {
        writeLogisticsProgress({
          status: "error",
          message: batch.message,
          error: batch.message,
          runId,
        });
        return res.status(400).json({
          error: batch.message,
          data: {
            batch,
            session: get1688SessionStatus(),
            collected,
            progress: readLogisticsProgress(),
          },
        });
      }

      // 兜底：若未走 onBatch（登录失败提前返回），仍尝试整包回填
      if (matchedLines === 0 && batch.orders.length) {
        const applied = applyLogisticsToPurchaseLines(state, batch.orders);
        matchedLines = applied.matchedLines;
        saveState(state);
      }

      const arrivingRaw = listArrivingToday(state);
      const displayMap = buildCatalogDisplayMap(state);
      const arriving = arrivingRaw.map((r) => {
        const d = catalogDisplayOf(displayMap, r.partnerSku, r.productName);
        return {
          ...r,
          title: d.title || r.productName,
          imageUrl: d.imageUrl,
          noonSku: d.noonSku || "",
        };
      });
      if (arriving.length > 0) {
        const preview = arriving
          .slice(0, 8)
          .map(
            (a) =>
              `${a.partnerSku}×${a.qty} ${a.transitStatus || "关注"}${
                a.trackingNo ? ` ${a.trackingNo}` : ""
              }`,
          )
          .join("；");
        pushAlert(state, {
          level: "warning",
          title: "今日采购到货/派送关注",
          detail: `${shanghaiToday()} 共 ${arriving.length} 行需处理：${preview}${
            arriving.length > 8 ? "…" : ""
          }`,
        });
      }

      const progress = writeLogisticsProgress({
        status: "done",
        batchIndex: batchTotal,
        batchTotal,
        orderDone: orderIds.length,
        orderTotal: orderIds.length,
        matchedLines,
        okOrders: batch.orders.filter((o) => o.ok).length,
        runId,
        message: `${batch.message} · 分 ${batchTotal} 批 · 回填 ${matchedLines} 行`,
      });

      res.json({
        data: {
          orderIdCount: orderIds.length,
          chunkSize,
          collected,
          batch,
          applied: { matchedLines, updatedOrderIds: [] as string[] },
          arrivingToday: arriving,
          arrivingTodayCount: arriving.length,
          session: get1688SessionStatus(),
          progress,
        },
        message: progress.message,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeLogisticsProgress({
        status: "error",
        message: msg,
        error: msg,
      });
      res.status(500).json({ error: msg });
    } finally {
      release1688LogisticsLock();
    }
  });

  return router;
}
