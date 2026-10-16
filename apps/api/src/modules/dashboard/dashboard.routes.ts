import { Router } from "express";
import type { AdsFact, AppState, SalesFact } from "../../common/types.js";
import {
  buildCatalogDisplayMap,
  catalogDisplayOf,
} from "../../common/catalog-display.js";
import { getActiveShop } from "../../shops/registry.js";
import { inferStorePrefixes } from "../../platforms/feishu/ingest/local.js";
import {
  loadLatestPackingLines,
  summarizePackingInTransit,
} from "../../platforms/feishu/normalize/packing-lines.js";
import {
  isCatalogStockHintWarehouse,
  stockLastImpexAt,
} from "../sync/live-impex-domains.js";
import { shanghaiHour } from "../sync/gap-audit.js";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function pctChange(curr: number, prev: number): number | null {
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  if (prev === 0) return curr === 0 ? 0 : null;
  return round2(((curr - prev) / Math.abs(prev)) * 100);
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** 最新单日广告事实（from=to），且日期 ≤ onOrBefore */
function latestExactDayAds(
  facts: AdsFact[],
  onOrBefore: string,
): { day: string; facts: AdsFact[] } | null {
  const byDay = new Map<string, AdsFact[]>();
  for (const f of facts) {
    if (f.fromDate !== f.toDate || f.fromDate > onOrBefore) continue;
    const arr = byDay.get(f.fromDate) ?? [];
    arr.push(f);
    byDay.set(f.fromDate, arr);
  }
  let best: string | null = null;
  for (const day of byDay.keys()) {
    if (!best || day > best) best = day;
  }
  if (!best) return null;
  return { day: best, facts: byDay.get(best)! };
}

function rollupSales(facts: SalesFact[]) {
  const byDate: Record<string, { units: number; amount: number }> = {};
  const bySku = new Map<string, { units: number; amount: number }>();
  let units = 0;
  let amount = 0;
  for (const f of facts) {
    units += f.units;
    amount += f.amount;
    const d = byDate[f.date] ?? { units: 0, amount: 0 };
    d.units += f.units;
    d.amount += f.amount;
    byDate[f.date] = d;
    const s = bySku.get(f.partnerSku) ?? { units: 0, amount: 0 };
    s.units += f.units;
    s.amount += f.amount;
    bySku.set(f.partnerSku, s);
  }
  return { units, amount, byDate, bySku };
}

/** 下单日（上海日历日），与看板「昨天」对齐 */
function orderPlacedYmd(placedAt: string): string | null {
  const t = Date.parse(placedAt);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

/** 成交单：排除取消/作废等，按 orderNr 去重 */
function isDealOrderStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  if (!s) return true;
  return !/cancel|void|fail|reject|refunded|returned/.test(s);
}

/**
 * Noon Active Net 按 SKU：优先 Catalog.stockFbnNet，否则分仓 FBN ledger（排除假仓）。
 */
function rollupActiveNetBySku(state: AppState): Map<string, number> {
  const map = new Map<string, number>();
  const fromCatalog = new Set<string>();
  for (const item of state.catalog ?? []) {
    const sku = (item.partnerSku || "").trim();
    if (!sku) continue;
    if (item.stockFbnNet != null && Number.isFinite(item.stockFbnNet)) {
      map.set(sku, Math.max(0, Math.floor(Number(item.stockFbnNet))));
      fromCatalog.add(sku);
    }
  }
  const fbnLedger = new Map<string, number>();
  for (const s of state.stock ?? []) {
    const sku = (s.partnerSku || "").trim();
    if (!sku || fromCatalog.has(sku)) continue;
    if (isCatalogStockHintWarehouse(s.warehouseCode)) continue;
    if (s.fulfillment !== "fbn") continue;
    fbnLedger.set(sku, (fbnLedger.get(sku) ?? 0) + (s.qty || 0));
  }
  for (const [sku, qty] of fbnLedger) {
    if (!map.has(sku)) map.set(sku, qty);
  }
  return map;
}

function rollupDealOrdersByDate(
  orders: AppState["orders"],
): Map<string, number> {
  const byDate = new Map<string, Set<string>>();
  for (const o of orders) {
    if (!isDealOrderStatus(o.status)) continue;
    const ymd = orderPlacedYmd(o.placedAt);
    if (!ymd || !o.orderNr) continue;
    let set = byDate.get(ymd);
    if (!set) {
      set = new Set();
      byDate.set(ymd, set);
    }
    set.add(o.orderNr);
  }
  const out = new Map<string, number>();
  for (const [ymd, set] of byDate) out.set(ymd, set.size);
  return out;
}

/**
 * 数据看板：统一口径汇总（主营收 = salesFacts，非 orders.totalAmount）
 */
export function createDashboardRouter(getState: () => AppState) {
  const router = Router();

  router.get("/overview", (_req, res) => {
    const state = getState();
    const shop = getActiveShop();
    const display = buildCatalogDisplayMap(state);
    const today = shanghaiToday();
    const sales = rollupSales(state.salesFacts);

    const dates = Object.keys(sales.byDate).sort();
    const lastDate = dates[dates.length - 1] ?? today;
    const seriesDays = 30;
    const seriesStart = addDays(lastDate, -(seriesDays - 1));
    const series: Array<{ date: string; units: number; amount: number }> = [];
    for (let i = 0; i < seriesDays; i++) {
      const date = addDays(seriesStart, i);
      const row = sales.byDate[date] ?? { units: 0, amount: 0 };
      series.push({
        date,
        units: row.units,
        amount: round2(row.amount),
      });
    }

    const yday = addDays(lastDate, -1);
    const dayBefore = addDays(lastDate, -2);
    const last = sales.byDate[lastDate] ?? { units: 0, amount: 0 };
    const prev = sales.byDate[yday] ?? { units: 0, amount: 0 };
    const prev2 = sales.byDate[dayBefore] ?? { units: 0, amount: 0 };

    const orderGmv = state.orders.reduce((s, o) => s + (o.totalAmount || 0), 0);
    const orderUnits = state.orders.reduce((s, o) => s + (o.itemCount || 0), 0);
    const byStatus: Record<string, number> = {};
    for (const o of state.orders) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    }
    const pendingShip =
      (byStatus["pending"] ?? 0) +
      (byStatus["confirmed"] ?? 0) +
      (byStatus["unshipped"] ?? 0);

    /** 固定「昨天 / 前天」成交单数（上海日历），非 salesFacts 最新日 */
    const yesterday = addDays(today, -1);
    const dayBeforeYesterday = addDays(today, -2);
    const dealOrdersByDate = rollupDealOrdersByDate(state.orders);
    const yesterdayOrderCount = dealOrdersByDate.get(yesterday) ?? 0;
    const dayBeforeOrderCount = dealOrdersByDate.get(dayBeforeYesterday) ?? 0;

    /**
     * 广告卡：优先昨天单日 → 区间覆盖昨天 → 最新可用单日（日更约 17:00，白天常无昨日）。
     * 自然单/自然 GMV 只扣「昨天」广告，不把回退日的广告混进昨日自然口径。
     */
    let adsSpend = 0;
    let adsRevenue = 0;
    let adsOrders = 0;
    let adsYesterdayFactCount = 0;
    let adsScope: "exact-day" | "covering" | "latest-day" | "none" = "none";
    let adsShowDate = yesterday;
    let adsReportFrom: string | null = null;
    let adsReportTo: string | null = null;
    const allAdsFacts = state.adsFacts ?? [];
    const exactDayFacts = allAdsFacts.filter(
      (f) => f.fromDate === yesterday && f.toDate === yesterday,
    );
    const coveringYesterdayFacts =
      exactDayFacts.length > 0
        ? exactDayFacts
        : allAdsFacts.filter(
            (f) => f.fromDate <= yesterday && f.toDate >= yesterday,
          );
    let cardFacts: AdsFact[] = [];
    if (exactDayFacts.length > 0) {
      adsScope = "exact-day";
      cardFacts = exactDayFacts;
      adsShowDate = yesterday;
      adsReportFrom = yesterday;
      adsReportTo = yesterday;
    } else if (coveringYesterdayFacts.length > 0) {
      adsScope = "covering";
      cardFacts = coveringYesterdayFacts;
      adsShowDate = yesterday;
      adsReportFrom = yesterday;
      adsReportTo = yesterday;
    } else {
      const latest = latestExactDayAds(allAdsFacts, yesterday);
      if (latest) {
        adsScope = "latest-day";
        cardFacts = latest.facts;
        adsShowDate = latest.day;
        adsReportFrom = latest.day;
        adsReportTo = latest.day;
      }
    }
    for (const f of cardFacts) {
      adsSpend += f.spend;
      adsRevenue += f.revenue;
      adsOrders += f.orders;
      adsYesterdayFactCount += 1;
    }
    /** 昨日广告（仅用于自然口径；无昨日时为 0） */
    let ydayAdsRevenue = 0;
    let ydayAdsOrders = 0;
    if (adsScope === "exact-day" || adsScope === "covering") {
      ydayAdsRevenue = adsRevenue;
      ydayAdsOrders = adsOrders;
    }
    const adsRoas = adsSpend > 0 ? round2(adsRevenue / adsSpend) : null;
    const ydaySales = sales.byDate[yesterday] ?? { units: 0, amount: 0 };
    const dayBeforeSales = sales.byDate[dayBeforeYesterday] ?? {
      units: 0,
      amount: 0,
    };
    const adsCardSales = sales.byDate[adsShowDate] ?? { units: 0, amount: 0 };

    /**
     * 自然 GMV = 总 GMV − 广告归因收入。
     * 总 GMV 优先取日历昨日 salesFacts；昨日销售报表未入库时回退最新销售日
     *（与销售额卡同一天），避免 0−广告 被夹成 0。
     */
    const gmvFallback =
      !(ydaySales.amount > 0) && lastDate && lastDate <= yesterday;
    const totalGmvDate = ydaySales.amount > 0 ? yesterday : gmvFallback ? lastDate : yesterday;
    const totalGmvRow =
      totalGmvDate === yesterday ? ydaySales : (sales.byDate[totalGmvDate] ?? ydaySales);
    const totalGmvAmount = round2(totalGmvRow.amount);
    const adsContributionBase =
      adsScope === "latest-day" ? adsCardSales.amount : totalGmvAmount;
    const adsContribution =
      adsContributionBase > 0
        ? round2((adsRevenue / adsContributionBase) * 100)
        : null;

    /** 自然单：昨日成交单 − 昨日广告归因单；自然 GMV：总 GMV − 昨日广告归因收入 */
    const organicOrderCount = Math.max(
      0,
      yesterdayOrderCount - Math.round(ydayAdsOrders),
    );
    const organicGmv = Math.max(0, round2(totalGmvAmount - ydayAdsRevenue));

    /** 对齐 Noon Active Net：优先 Catalog stockFbnNet，否则分仓 FBN */
    const activeNetBySku = rollupActiveNetBySku(state);
    let onHand = 0;
    let stockSkuCount = 0;
    for (const qty of activeNetBySku.values()) {
      onHand += qty;
      if (qty > 0) stockSkuCount += 1;
    }
    const stockSyncedAt = stockLastImpexAt(state);

    /** 在途：装箱明细「送仓时间」为空，按当前店 N 前缀过滤 */
    const storePrefixes = inferStorePrefixes(state.catalog ?? []);
    const packingTransit = storePrefixes.length
      ? summarizePackingInTransit(loadLatestPackingLines(), storePrefixes)
      : {
          qty: 0,
          skuCount: 0,
          boxCount: 0,
          ticketCount: 0,
          bySku: [] as ReturnType<typeof summarizePackingInTransit>["bySku"],
          byTicket: [] as ReturnType<typeof summarizePackingInTransit>["byTicket"],
        };
    const inTransit = packingTransit.qty;

    const sparkBySku = buildSkuSpark(
      state.salesFacts,
      series.map((s) => s.date),
    );
    const topSkus = [...sales.bySku.entries()]
      .filter(([partnerSku]) => {
        const s = partnerSku.trim();
        return s && s !== "-" && s !== "—" && s.toLowerCase() !== "null";
      })
      .map(([partnerSku, v]) => {
        const d = catalogDisplayOf(display, partnerSku);
        return {
          partnerSku,
          title: d.title || partnerSku,
          imageUrl: d.imageUrl || "",
          units: v.units,
          amount: round2(v.amount),
          spark: sparkBySku.get(partnerSku) ?? series.map(() => 0),
        };
      })
      .sort((a, b) => b.units - a.units)
      .slice(0, 8);

    let platformOutbound = 0;
    for (const f of state.feeSnapshots ?? []) {
      platformOutbound += f.outboundFee || 0;
    }

    const caveats: string[] = [];
    if (shanghaiHour() < 14) {
      caveats.push(
        "日历昨日销售/订单以当天下午同步后为准（Noon 官方出数滞后，非本地漏导）。",
      );
    } else {
      caveats.push(
        "日历昨日销售/订单：Noon 官方通常下午出全；若仍偏低请再补拉 sales/orders。",
      );
    }
    if (sales.amount > 0 && orderGmv === 0 && state.orders.length > 0) {
      caveats.push(
        "履约订单 totalAmount 全为 0：看板营收以 salesFacts（销售报表）为准，不用 orders 金额。",
      );
    }
    if ((state.shipping?.buybackRate ?? 0) <= 0) {
      caveats.push("购汇汇率未配置：CNY 利润估算不可用（见 Catalog/财务配置）。");
    }
    if (!(state.invoiceDocs ?? []).length) {
      caveats.push("发票未同步（Impex invoices）。");
    }
    if (!(state.adsFacts ?? []).length) {
      caveats.push("广告报表未导入：广告卡为空。");
    } else if (adsScope === "latest-day") {
      caveats.push(
        `昨日（${yesterday}）广告尚未入库（日更约 17:00）：广告卡暂展示最新可用日 ${adsShowDate}；自然单暂不扣广告。`,
      );
    } else if (adsScope === "none") {
      caveats.push(
        `昨日（${yesterday}）无广告事实：请确认广告日更导出已入库。`,
      );
    } else if (adsScope === "covering") {
      caveats.push(
        `昨日广告为「区间覆盖」汇总（非单日 from=to）：投产比/自然单仅作参考，建议补昨日单日导出。`,
      );
    }
    const ydaySalesUnits = ydaySales.units;
    if (yesterdayOrderCount === 0 && ydaySalesUnits > 0) {
      caveats.push(
        `昨日（${yesterday}）销售报表有 ${ydaySalesUnits} 件，但成交订单为 0：请检查订单同步是否覆盖该日。`,
      );
    }
    if (ydayAdsOrders > yesterdayOrderCount && yesterdayOrderCount > 0) {
      caveats.push(
        `昨日广告归因订单（${ydayAdsOrders}）大于成交订单（${yesterdayOrderCount}）：自然单已夹为 0；广告订单与履约单口径不同。`,
      );
    }
    if (gmvFallback && totalGmvAmount > 0) {
      caveats.push(
        `昨日（${yesterday}）销售报表尚未入库：自然 GMV 暂用最新销售日 ${totalGmvDate} 的总 GMV（${totalGmvAmount}）− 昨日广告归因。`,
      );
    }
    if (!storePrefixes.length && (state.catalog ?? []).length === 0) {
      caveats.push(
        "Catalog 为空，无法按店前缀统计装箱在途（请先同步价库）。",
      );
    }

    const confidence =
      sales.amount > 0 && orderGmv === 0
        ? "medium"
        : sales.amount > 0
          ? "high"
          : "low";

    res.json({
      data: {
        asOf: new Date().toISOString(),
        shop: { id: shop.id, name: shop.name, projectCode: shop.projectCode },
        currency: "SAR",
        confidence,
        caveats,
        definitions: [
          {
            id: "sales",
            label: "店铺销售额",
            source: "salesFacts",
            grain: "SKU×日",
            note: "主营收口径；与销量统计页一致",
          },
          {
            id: "yesterdayOrders",
            label: "昨日成交订单 / GMV",
            source: "orders.placedAt + salesFacts",
            grain: "订单×下单日 / SKU×日",
            note: "订单数按 orderNr 去重；GMV 取销售报表昨日金额（非 orders.totalAmount）",
          },
          {
            id: "ads",
            label: "广告归因",
            source: "adsFacts",
            grain: "活动×SKU×日",
            note: "优先昨天单日 → 区间覆盖昨天 → 最新可用单日（广告日更约 17:00）。投产比=归因收入/花费",
          },
          {
            id: "organic",
            label: "自然订单 / 自然 GMV",
            source: "orders − ads.orders；salesFacts − ads.revenue",
            grain: "昨日",
            note: "仅扣日历昨日广告；昨日广告未入库时自然口径暂不扣广告。总GMV优先昨日销售报表，缺失则回退最新销售日",
          },
          {
            id: "stockSku",
            label: "有库存 SKU",
            source: "catalog.stockFbnNet || stock(fbn)",
            grain: "partnerSku",
            note: "对齐 Noon Active Net：优先 Catalog stock_fbn_net，无则分仓 FBN；Active Net>0 的 SKU 数",
          },
          {
            id: "onHand",
            label: "在库件数",
            source: "catalog.stockFbnNet || stock(fbn)",
            grain: "partnerSku",
            note: "对齐 Noon Active Net 合计；库存日更上海 09:30 / 16:00",
          },
          {
            id: "inTransit",
            label: "在途件数",
            source: "feishu packing 装箱明细",
            grain: "SKU×箱",
            note: "送仓时间为空视为在途；按当前店 Catalog 的 N 前缀过滤",
          },
        ],
        sales: {
          totalAmount: round2(sales.amount),
          totalUnits: sales.units,
          skuCount: sales.bySku.size,
          factCount: state.salesFacts.length,
          latestDate: lastDate || null,
          latest: {
            date: lastDate,
            amount: round2(last.amount),
            units: last.units,
          },
          previous: {
            date: yday,
            amount: round2(prev.amount),
            units: prev.units,
          },
          vsPreviousPct: {
            amount: pctChange(last.amount, prev.amount),
            units: pctChange(last.units, prev.units),
          },
          vsDayBeforePct: {
            amount: pctChange(prev.amount, prev2.amount),
            units: pctChange(prev.units, prev2.units),
          },
          series,
        },
        ads: {
          /** 卡片展示日（昨日或最新可用日） */
          date: adsScope === "none" ? yesterday : adsShowDate,
          /** 口径目标日：上海日历昨天 */
          requestedDate: yesterday,
          scope: adsScope,
          spend: round2(adsSpend),
          revenue: round2(adsRevenue),
          orders: Math.round(adsOrders),
          roas: adsRoas,
          contributionPct: adsContribution,
          reportFrom: adsReportFrom,
          reportTo: adsReportTo,
          factCount: adsYesterdayFactCount,
          allFactCount: allAdsFacts.length,
        },
        catalog: {
          stockSkuCount,
          salesSkuCount: sales.bySku.size,
          onHandQty: onHand,
          stockSyncedAt,
          stockMetric: "activeNet",
          inTransitQty: inTransit,
          inTransitSkuCount: packingTransit.skuCount,
          inTransitBoxCount: packingTransit.boxCount,
          inTransitTicketCount: packingTransit.ticketCount,
          inTransitSource: "packing-no-arriveAt",
          storePrefixes,
        },
        orders: {
          count: state.orders.length,
          gmv: round2(orderGmv),
          units: orderUnits,
          byStatus,
          pendingApprox: pendingShip,
          yesterday: {
            date: yesterday,
            count: yesterdayOrderCount,
            /** 展示用 GMV：优先昨日销售，否则回退最新销售日 */
            gmv: totalGmvAmount,
            units: totalGmvRow.units,
            gmvDate: totalGmvDate,
            gmvFallback: Boolean(gmvFallback && totalGmvDate !== yesterday),
          },
          dayBefore: {
            date: dayBeforeYesterday,
            count: dayBeforeOrderCount,
            gmv: round2(dayBeforeSales.amount),
            units: dayBeforeSales.units,
          },
          vsPreviousDayPct: pctChange(
            yesterdayOrderCount,
            dayBeforeOrderCount,
          ),
          vsPreviousDayGmvPct: pctChange(
            totalGmvAmount,
            dayBeforeSales.amount,
          ),
          organic: {
            date: yesterday,
            orders: organicOrderCount,
            gmv: organicGmv,
            totalGmv: totalGmvAmount,
            totalGmvDate,
            gmvFallback: Boolean(gmvFallback && totalGmvDate !== yesterday),
            adOrders: Math.round(ydayAdsOrders),
            adGmv: round2(ydayAdsRevenue),
          },
        },
        fees: {
          outboundFeeSar: round2(platformOutbound),
          feeSkuCount: (state.feeSnapshots ?? []).length,
        },
        topSkus,
      },
    });
  });

  return router;
}

function buildSkuSpark(
  facts: SalesFact[],
  dates: string[],
): Map<string, number[]> {
  const idx = new Map(dates.map((d, i) => [d, i]));
  const map = new Map<string, number[]>();
  for (const f of facts) {
    const i = idx.get(f.date);
    if (i == null) continue;
    let arr = map.get(f.partnerSku);
    if (!arr) {
      arr = dates.map(() => 0);
      map.set(f.partnerSku, arr);
    }
    arr[i] = (arr[i] ?? 0) + f.units;
  }
  return map;
}
