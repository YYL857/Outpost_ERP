/**
 * 真实 NOON Partner API 客户端（Impex 导出为主路径）。
 * 注意：Noon 约「30 分钟内 20 次」导出限额，故默认只拉 catalog=live，
 * 库存走 FBN ledger；完整同步请错开或依赖 poller 分域轮询。
 * 凭证：OUTPOST_NOON_CREDENTIALS_FILE
 */
import type { NoonConnection } from "../../common/types.js";
import {
  IMPEX_EXPORT_CATEGORIES,
  impexDateRangeDays,
  runImpexExportCsv,
} from "./impex-client.js";
import {
  NoonHttpError,
  noonWhoami,
  readNoonCredentialsFile,
} from "./http.js";
import {
  parseCatalogContent,
  parseCatalogEstimatedFees,
  parseFeesContent,
  parseFbnDimsContent,
  parseInvoicesContent,
  parseOrdersContent,
  parseSalesContent,
  parseStockContent,
  parseStockHintsFromCatalogContent,
  type CatalogFeeEstimateDto,
  type FbnDimsDto,
} from "./portal/parsers.js";
import { batchGetLivePrices, overlayCatalogDtoPrices } from "./pricing.js";
import type {
  NoonCatalogDto,
  NoonClient,
  NoonFeeDto,
  NoonInvoiceDto,
  NoonOrderDto,
  NoonSalesDto,
  NoonStockDto,
} from "./types.js";

/** 进程内复用最近一次 orders 导出，避免 fetchOrder 一单一整表 */
type OrdersExportCache = {
  fetchedAt: number;
  rangeKey: string;
  rows: NoonOrderDto[];
};
let ordersExportCache: OrdersExportCache | null = null;
/** 同 range 并发共用一次 create，防止绕过缓存打光 Noon 配额 */
let ordersExportInflight: {
  rangeKey: string;
  promise: Promise<NoonOrderDto[]>;
} | null = null;

function ordersCacheTtlMs(): number {
  return Math.max(
    60_000,
    Number(process.env.OUTPOST_ORDERS_FETCH_CACHE_MS ?? 10 * 60 * 1000),
  );
}

function cachedOrders(rangeKey: string): NoonOrderDto[] | null {
  const ttl = ordersCacheTtlMs();
  if (
    ordersExportCache &&
    ordersExportCache.rangeKey === rangeKey &&
    Date.now() - ordersExportCache.fetchedAt < ttl
  ) {
    return ordersExportCache.rows;
  }
  return null;
}

export class LiveNoonClient implements NoonClient {
  readonly mode = "live" as const;
  /** 最近一次 catalog 导出顺带解析的库存提示（pullDomain 可 drain） */
  private stockHints: NoonStockDto[] = [];
  /** Catalog Estimated Fees 补缺（不进 feeSnapshots） */
  private feeEstimateHints: CatalogFeeEstimateDto[] = [];
  /** FBN Inventory 尺寸补缺 */
  private fbnDimsHints: FbnDimsDto[] = [];

  constructor(private readonly connection: NoonConnection) {}

  drainStockHints(): NoonStockDto[] {
    const rows = this.stockHints;
    this.stockHints = [];
    return rows;
  }

  drainFeeEstimateHints(): CatalogFeeEstimateDto[] {
    const rows = this.feeEstimateHints;
    this.feeEstimateHints = [];
    return rows;
  }

  drainFbnDimsHints(): FbnDimsDto[] {
    const rows = this.fbnDimsHints;
    this.fbnDimsHints = [];
    return rows;
  }

  async validateCredentials(): Promise<{ ok: boolean; message: string }> {
    const cred = readNoonCredentialsFile();
    if (!cred) {
      return {
        ok: false,
        message:
          "缺少凭证：请配置 Access App 下载的 JSON（环境变量 OUTPOST_NOON_CREDENTIALS_FILE）",
      };
    }
    try {
      const who = (await noonWhoami(this.connection)) as {
        email?: string;
        user?: { email?: string };
      };
      const email = who?.email ?? who?.user?.email ?? "";
      return {
        ok: true,
        message: email
          ? `Partner API whoami 通过（${email} / ${cred.project_code}）`
          : `Partner API whoami 通过（${cred.project_code}）`,
      };
    } catch (err) {
      const msg =
        err instanceof NoonHttpError
          ? `${err.message}: ${err.body.slice(0, 200)}`
          : err instanceof Error
            ? err.message
            : String(err);
      return { ok: false, message: msg };
    }
  }

  async fetchOrdersSince(since: string | null): Promise<NoonOrderDto[]> {
    const range = orderDateRange(since);
    const rangeKey = `${range.from_date}|${range.to_date}`;
    const hit = cachedOrders(rangeKey);
    if (hit) return hit;
    if (ordersExportInflight?.rangeKey === rangeKey) {
      return ordersExportInflight.promise;
    }
    const promise = (async () => {
      try {
        const again = cachedOrders(rangeKey);
        if (again) return again;
        const { csv } = await runImpexExportCsv(
          this.connection,
          IMPEX_EXPORT_CATEGORIES.orders,
          range,
        );
        const rows = parseOrdersContent(csv, "csv");
        ordersExportCache = { fetchedAt: Date.now(), rangeKey, rows };
        return rows;
      } finally {
        if (ordersExportInflight?.rangeKey === rangeKey) {
          ordersExportInflight = null;
        }
      }
    })();
    ordersExportInflight = { rangeKey, promise };
    return promise;
  }

  async fetchOrder(orderNr: string): Promise<NoonOrderDto | null> {
    const rows = await this.fetchOrdersSince(null);
    return rows.find((r) => r.order_nr === orderNr) ?? null;
  }

  async fetchStockSince(_since: string | null): Promise<NoonStockDto[]> {
    return this.safeStockExport(IMPEX_EXPORT_CATEGORIES.stockFbnDetailed);
  }

  async fetchCatalogSince(_since: string | null): Promise<NoonCatalogDto[]> {
    const country = this.connection.countryCode || "sa";
    const statuses = catalogStatusesFromEnv();
    const merged = new Map<string, NoonCatalogDto>();
    const hintMap = new Map<string, NoonStockDto>();
    const feeMap = new Map<string, CatalogFeeEstimateDto>();

    for (const noon_status of statuses) {
      const { csv } = await runImpexExportCsv(
        this.connection,
        IMPEX_EXPORT_CATEGORIES.catalog,
        { country, noon_status },
      );
      for (const row of parseCatalogContent(csv, "csv")) {
        merged.set(row.partner_sku, row);
      }
      for (const hint of parseStockHintsFromCatalogContent(csv, "csv")) {
        const key = `${hint.partner_sku}|${hint.warehouse_code}|${hint.fulfillment}`;
        hintMap.set(key, hint);
      }
      for (const est of parseCatalogEstimatedFees(csv, "csv")) {
        const prev = feeMap.get(est.partner_sku);
        if (prev?.fulfillment === "fbn" && est.fulfillment === "fbp") continue;
        feeMap.set(est.partner_sku, est);
      }
    }

    this.stockHints = [...hintMap.values()];
    this.feeEstimateHints = [...feeMap.values()];
    const rows = [...merged.values()];
    try {
      const live = await batchGetLivePrices(
        this.connection,
        rows.map((r) => r.partner_sku),
        country,
      );
      return overlayCatalogDtoPrices(rows, live, new Date().toISOString());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[live-noon] catalog live price overlay skipped:", msg.slice(0, 200));
      return rows;
    }
  }

  /** Impex product views & sales → salesFacts（Catalog GMV 列） */
  async fetchSalesSince(since: string | null): Promise<NoonSalesDto[]> {
    const lookback = Math.max(
      30,
      Number(process.env.OUTPOST_NOON_SALES_LOOKBACK_DAYS ?? 90) || 90,
    );
    const range = orderDateRange(since, lookback);
    const country = (this.connection.countryCode || "sa").toLowerCase();
    const lang = (process.env.OUTPOST_NOON_LANG || "en").trim().toLowerCase();
    const { csv } = await runImpexExportCsv(
      this.connection,
      IMPEX_EXPORT_CATEGORIES.sales,
      { ...range, country, lang },
    );
    return parseSalesContent(csv, "csv");
  }

  /** Impex transaction view item-level → feeSnapshots（Catalog 费用/毛利） */
  async fetchFeesSince(since: string | null): Promise<NoonFeeDto[]> {
    const range = orderDateRange(since);
    const country = (this.connection.countryCode || "sa").toLowerCase();
    const lang = (process.env.OUTPOST_NOON_LANG || "en").trim().toLowerCase();
    // fees 实测可无 lang；一并附上以免个别账号校验变严
    const { csv } = await runImpexExportCsv(
      this.connection,
      IMPEX_EXPORT_CATEGORIES.fees,
      { ...range, country, lang },
    );
    return parseFeesContent(csv, "csv");
  }

  /** Impex invoicesandcreditnotes → invoiceDocs（不占 SyncDomain，按需拉取） */
  async fetchInvoicesSince(since: string | null): Promise<NoonInvoiceDto[]> {
    const range = orderDateRange(since);
    const country = (this.connection.countryCode || "sa").toLowerCase();
    const lang = (process.env.OUTPOST_NOON_LANG || "en").trim().toLowerCase();
    const { csv } = await runImpexExportCsv(
      this.connection,
      IMPEX_EXPORT_CATEGORIES.invoices,
      { ...range, country, lang },
    );
    return parseInvoicesContent(csv, "csv");
  }

  private async safeStockExport(category: string): Promise<NoonStockDto[]> {
    try {
      const { csv } = await runImpexExportCsv(this.connection, category, {});
      const dims = parseFbnDimsContent(csv, "csv");
      if (dims.length) {
        const map = new Map(this.fbnDimsHints.map((d) => [d.partner_sku, d]));
        for (const d of dims) map.set(d.partner_sku, d);
        this.fbnDimsHints = [...map.values()];
      }
      return parseStockContent(csv, "csv");
    } catch (err) {
      const msg =
        err instanceof NoonHttpError
          ? `${err.message} ${err.body}`
          : err instanceof Error
            ? err.message
            : String(err);
      if (/export limit|rate.?limit|too many/i.test(msg)) {
        throw new Error(
          `Impex 导出限额已用尽（Noon 约 30 分钟内 20 次）：${msg.slice(0, 180)}`,
        );
      }
      console.warn("[live-noon] FBN stock export skipped:", msg.slice(0, 200));
      return [];
    }
  }
}

/** 默认只拉 live，省配额；需要 notlive 时设 OUTPOST_NOON_CATALOG_STATUSES=live,notlive */
function catalogStatusesFromEnv(): string[] {
  const raw = process.env.OUTPOST_NOON_CATALOG_STATUSES?.trim();
  if (!raw) return ["live"];
  const list = raw
    .split(/[,|\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : ["live"];
}

function orderDateRange(
  since: string | null,
  defaultDays = 30,
): {
  from_date: string;
  to_date: string;
} {
  if (since) {
    const from = new Date(since);
    if (!Number.isNaN(from.getTime())) {
      const to = new Date();
      from.setUTCDate(from.getUTCDate() - 1);
      return {
        from_date: from.toISOString().slice(0, 10),
        to_date: to.toISOString().slice(0, 10),
      };
    }
  }
  return impexDateRangeDays(defaultDays);
}
