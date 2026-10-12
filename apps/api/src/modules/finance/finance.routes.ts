import { Router } from "express";
import { requireCapability } from "../../auth/permissions.js";
import type { AppState, InvoiceDoc } from "../../common/types.js";
import {
  buildCatalogDisplayMap,
  catalogDisplayOf,
} from "../../common/catalog-display.js";
import { saveState } from "../../data/store.js";
import { createNoonClient } from "../../platforms/noon/index.js";
import { LiveNoonClient } from "../../platforms/noon/live-client.js";
import { closeGpMonth } from "./gp-close.js";
import {
  buildSettlementSummary,
  evaluateCloseGate,
  previousCalendarMonth,
} from "./statement-settlement.js";

/**
 * 财务报表：
 * - 经营概览：salesFacts + feeSnapshots + 本地估成本（非账单口径）
 * - 结算对账：Statement of Account 月聚合（Net Proceeds / 四费 / VAT）
 * - 发票：invoiceDocs
 * 权限：仅超管（finance.read）
 */
export function createFinanceRouter(getState: () => AppState) {
  const router = Router();
  router.use(requireCapability("finance.read"));

  router.get("/overview", (_req, res) => {
    const state = getState();
    /** 主营收口径：与销量统计 / 数据看板一致，用 salesFacts */
    const salesRevenueSar = state.salesFacts.reduce((s, f) => s + f.amount, 0);
    const salesUnits = state.salesFacts.reduce((s, f) => s + f.units, 0);
    const orderRevenueSar = state.orders.reduce((s, o) => s + o.totalAmount, 0);
    const revenueSar = salesRevenueSar;
    const revenueCny = revenueSar * state.shipping.buybackRate;

    const units = salesUnits || state.orders.reduce((s, o) => s + o.itemCount, 0);
    const airCostAed = units * 0.5 * state.shipping.airFreightAedPerKg;
    const airCostCny = airCostAed * state.shipping.buybackRate;

    const reviewCostCny =
      units * (state.review.commissionRmb + state.review.expressFeeRmb);

    let platformOutbound = 0;
    let platformTax = 0;
    for (const f of state.feeSnapshots) {
      platformOutbound += f.outboundFee || 0;
      platformTax += f.taxAmount || 0;
    }

    const feeSkuCount = state.feeSnapshots.length;
    const avgCommissionRate =
      feeSkuCount === 0
        ? 0
        : state.feeSnapshots.reduce((s, f) => s + (f.commissionRate || 0), 0) /
          feeSkuCount;
    const platformCommission = revenueSar * avgCommissionRate;

    const platformFeesSar = platformCommission + platformOutbound + platformTax;
    const platformFeesCny = platformFeesSar * state.shipping.buybackRate;

    const profitCny =
      revenueCny - airCostCny - reviewCostCny - platformFeesCny;

    const invoices = state.invoiceDocs ?? [];
    const invoiceAmount = invoices.reduce((s, i) => s + (i.amount || 0), 0);

    const caveats: string[] = [];
    if (salesRevenueSar > 0 && orderRevenueSar === 0 && state.orders.length > 0) {
      caveats.push(
        "orders.totalAmount 均为 0：营收已改用 salesFacts，履约单金额仅作对照。",
      );
    }
    if (state.shipping.buybackRate <= 0) {
      caveats.push("购汇汇率为 0：CNY 字段仅供参考。");
    }
    caveats.push(
      "本页为经营概览（非账单口径）。月末对账请看「结算对账」：Statement Net Proceeds / 平台四费 / VAT。",
    );

    res.json({
      data: {
        source: "salesFacts(primary) + feeSnapshots + invoices + local cost",
        primaryRevenue: "salesFacts",
        orderCount: state.orders.length,
        units,
        salesRevenueSar: round2(salesRevenueSar),
        orderRevenueSar: round2(orderRevenueSar),
        revenueSar: round2(revenueSar),
        revenueCny: round2(revenueCny),
        platformFees: {
          feeSkuCount,
          avgCommissionRate: round2(avgCommissionRate),
          commissionSar: round2(platformCommission),
          outboundFeeSar: round2(platformOutbound),
          taxSar: round2(platformTax),
          totalSar: round2(platformFeesSar),
          totalCny: round2(platformFeesCny),
        },
        invoices: {
          count: invoices.length,
          amountSar: round2(invoiceAmount),
          gap:
            invoices.length === 0
              ? "尚未同步 Impex invoicesandcreditnotes，可点「同步发票」"
              : null,
        },
        airCostCny: round2(airCostCny),
        reviewCostCny: round2(reviewCostCny),
        profitCny: round2(profitCny),
        caveats,
        snapshot: {
          buybackRate: state.shipping.buybackRate,
          airFreightAedPerKg: state.shipping.airFreightAedPerKg,
          reviewCommissionRmb: state.review.commissionRmb,
          takenAt: new Date().toISOString(),
        },
      },
    });
  });

  router.get("/settlement", (req, res) => {
    const from =
      typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const data = buildSettlementSummary(getState(), { from, to });
    res.json({
      data,
      meta: {
        source: "settlementMonths (noon Statement of Account)",
        monthCount: data.months.length,
        targetMonth: data.targetMonth,
      },
    });
  });

  router.get("/close-gate", (req, res) => {
    const month =
      typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
        ? req.query.month
        : previousCalendarMonth();
    const gate = evaluateCloseGate(getState(), month);
    res.json({ data: gate });
  });

  router.post("/close", (req, res) => {
    const body = (req.body ?? {}) as { month?: string; replace?: boolean };
    const month =
      typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month)
        ? body.month
        : previousCalendarMonth();
    const state = getState();
    const result = closeGpMonth(state, month, {
      replace: Boolean(body.replace),
      closedBy: "manual",
    });
    if (!result.ok) {
      return res.status(result.status).json({
        error: result.error,
        data: result.gate ?? null,
      });
    }
    saveState(state);
    res.json({
      data: result.close,
      message: `${month} 已关账（账单口径终稿）`,
    });
  });

  router.get("/fees", (_req, res) => {
    const fees = [...getState().feeSnapshots].sort((a, b) =>
      a.partnerSku.localeCompare(b.partnerSku),
    );
    res.json({
      data: fees.slice(0, 500),
      meta: { source: "NOON feeSnapshots", total: fees.length },
    });
  });

  router.get("/invoices", (_req, res) => {
    const state = getState();
    const display = buildCatalogDisplayMap(state);
    const rows = [...(state.invoiceDocs ?? [])]
      .map((r) => {
        const d = r.partnerSku
          ? catalogDisplayOf(display, r.partnerSku)
          : { title: "", imageUrl: "" };
        return {
          ...r,
          title: d.title,
          imageUrl: d.imageUrl,
        };
      })
      .sort((a, b) =>
        String(b.issuedAt ?? "").localeCompare(String(a.issuedAt ?? "")),
      );
    res.json({
      data: rows.slice(0, 500),
      meta: {
        source: "NOON invoiceDocs (Impex invoicesandcreditnotes)",
        total: rows.length,
      },
    });
  });

  router.post("/sync-invoices", async (_req, res) => {
    const state = getState();
    if (!state.noon.enabled) {
      return res.status(400).json({ error: "NOON 接入未启用" });
    }
    try {
      const client = createNoonClient(state);
      if (!(client instanceof LiveNoonClient)) {
        return res.status(400).json({
          error: "发票同步仅支持 live Impex（当前模式无 invoices 导出）",
          detail: { mode: client.mode },
        });
      }
      const rows = await client.fetchInvoicesSince(state.cursors.feesSince);
      const map = new Map(
        (state.invoiceDocs ?? []).map((x) => [x.id, x] as const),
      );
      for (const r of rows) {
        const doc: InvoiceDoc = {
          id: r.invoice_nr,
          invoiceNr: r.invoice_nr,
          invoiceType: r.invoice_type,
          status: r.status,
          currency: r.currency,
          amount: r.amount,
          issuedAt: r.issued_at,
          dueAt: r.due_at,
          partnerSku: r.partner_sku,
          updatedAt: r.updated_at,
        };
        map.set(doc.id, doc);
      }
      state.invoiceDocs = [...map.values()];
      saveState(state);
      res.json({
        data: { imported: rows.length, total: state.invoiceDocs.length },
        message: `已同步发票 ${rows.length} 条`,
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return router;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
