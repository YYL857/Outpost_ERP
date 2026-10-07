import type { AppState } from "../../../common/types.js";
import { saveState } from "../../../data/store.js";
import { enqueueInbox } from "../../../modules/sync/inbox.js";
import { processPendingInbox } from "../../../modules/sync/pipeline.js";
import { pushAlert } from "../../../modules/sync/alerts.js";
import {
  detectDomainFromFilename,
  parseCatalogContent,
  parseFeesContent,
  parseOrdersContent,
  parseSalesContent,
  parseStockContent,
  parseStockHintsFromCatalogContent,
  type PortalImportDomain,
} from "./parsers.js";
import { fetchPortalBySession } from "./session-fetcher.js";
import type {
  NoonCatalogDto,
  NoonFeeDto,
  NoonOrderDto,
  NoonSalesDto,
  NoonStockDto,
} from "../types.js";

export type PortalDomain = PortalImportDomain;

export function importPortalContent(
  state: AppState,
  input: {
    domain: PortalDomain;
    content: string;
    format?: "csv" | "json" | "auto";
    filename?: string;
  },
) {
  const format = input.format ?? "auto";
  let count = 0;

  if (input.domain === "orders") {
    const rows = parseOrdersContent(input.content, format);
    state.portalCache.orders = rows;
    count = rows.length;
    enqueueParsed(state, "orders", rows);
  } else if (input.domain === "catalog") {
    const rows = parseCatalogContent(input.content, format);
    state.portalCache.catalog = rows;
    count = rows.length;
    enqueueParsed(state, "catalog", rows);
    const stockHints = parseStockHintsFromCatalogContent(input.content, format);
    if (stockHints.length) {
      state.portalCache.stock = [...(state.portalCache.stock ?? []), ...stockHints];
      enqueueParsed(state, "stock", stockHints);
    }
  } else if (input.domain === "stock") {
    const rows = parseStockContent(input.content, format);
    state.portalCache.stock = rows;
    count = rows.length;
    enqueueParsed(state, "stock", rows);
  } else if (input.domain === "sales") {
    const rows = parseSalesContent(input.content, format);
    state.portalCache.sales = rows;
    count = rows.length;
    enqueueParsed(state, "sales", rows);
  } else {
    const rows = parseFeesContent(input.content, format);
    state.portalCache.fees = rows;
    count = rows.length;
    enqueueParsed(state, "fees", rows);
  }

  if (!count) {
    throw new Error(
      "未解析到有效行，请检查文件是否为 CSV/JSON，以及表头是否包含 SKU/订单号等字段",
    );
  }

  state.portalCache.updatedAt = new Date().toISOString();
  state.noon.portal.lastImportAt = state.portalCache.updatedAt;
  state.noon.portal.lastImportSummary = `${input.domain} 导入 ${count} 条${
    input.filename ? `（${input.filename}）` : ""
  }`;

  saveState(state);

  return {
    domain: input.domain,
    count,
    summary: state.noon.portal.lastImportSummary,
  };
}

/** 按文件名自动识别 domain 后导入 */
export function importPortalFileByName(
  state: AppState,
  filename: string,
  content: string,
) {
  const domain = detectDomainFromFilename(filename);
  if (!domain) {
    throw new Error(`无法从文件名识别报表类型: ${filename}`);
  }
  return importPortalContent(state, {
    domain,
    content,
    format: "auto",
    filename,
  });
}

export async function runPortalSessionFetch(state: AppState) {
  const result = await fetchPortalBySession(state.noon.portal);
  state.portalCache = {
    orders: result.orders,
    catalog: result.catalog,
    stock: result.stock,
    sales: state.portalCache.sales ?? [],
    fees: state.portalCache.fees ?? [],
    updatedAt: new Date().toISOString(),
  };
  state.noon.portal.lastFetchAt = state.portalCache.updatedAt;
  state.noon.portal.lastImportSummary = `会话拉取 订单${result.orders.length}/商品${result.catalog.length}/库存${result.stock.length}`;

  if (result.orders.length) enqueueParsed(state, "orders", result.orders);
  if (result.catalog.length) enqueueParsed(state, "catalog", result.catalog);
  if (result.stock.length) enqueueParsed(state, "stock", result.stock);

  for (const w of result.warnings) {
    pushAlert(state, {
      level: "warning",
      title: "门户采集警告",
      detail: w,
    });
  }

  saveState(state);
  await processPendingInbox(state);
  return {
    ...result,
    summary: state.noon.portal.lastImportSummary,
  };
}

function enqueueParsed(
  state: AppState,
  domain: PortalDomain,
  rows:
    | NoonOrderDto[]
    | NoonCatalogDto[]
    | NoonStockDto[]
    | NoonSalesDto[]
    | NoonFeeDto[],
) {
  for (const row of rows) {
    if (domain === "orders") {
      const r = row as NoonOrderDto;
      enqueueInbox(state, {
        eventId: `portal:orders:${r.order_nr}:${r.updated_at}`,
        source: "manual",
        domain: "orders",
        entityKey: r.order_nr,
        payload: r,
      });
    } else if (domain === "catalog") {
      const r = row as NoonCatalogDto;
      enqueueInbox(state, {
        eventId: `portal:catalog:${r.partner_sku}:${r.updated_at}`,
        source: "manual",
        domain: "catalog",
        entityKey: r.partner_sku,
        payload: r,
      });
    } else if (domain === "stock") {
      const r = row as NoonStockDto;
      enqueueInbox(state, {
        eventId: `portal:stock:${r.partner_sku}:${r.warehouse_code}:${r.fulfillment}:${r.updated_at}`,
        source: "manual",
        domain: "stock",
        entityKey: `${r.partner_sku}@${r.warehouse_code}@${r.fulfillment}`,
        payload: r,
      });
    } else if (domain === "sales") {
      const r = row as NoonSalesDto;
      enqueueInbox(state, {
        eventId: `portal:sales:${r.partner_sku}:${r.date}:${r.updated_at}`,
        source: "manual",
        domain: "sales",
        entityKey: `${r.partner_sku}@${r.date}`,
        payload: r,
      });
    } else {
      const r = row as NoonFeeDto;
      enqueueInbox(state, {
        eventId: `portal:fees:${r.partner_sku}:${r.updated_at}`,
        source: "manual",
        domain: "fees",
        entityKey: r.partner_sku,
        payload: r,
      });
    }
  }
}
