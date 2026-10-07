/**
 * 真实 NOON Partner API 客户端（Impex 导出为主路径）。
 * 注意：账号通常有「30 分钟内 2 次」导出限额，故默认只拉 catalog=live，
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
  parseOrdersContent,
  parseStockContent,
  parseStockHintsFromCatalogContent,
} from "./portal/parsers.js";
import type {
  NoonCatalogDto,
  NoonClient,
  NoonOrderDto,
  NoonStockDto,
} from "./types.js";

export class LiveNoonClient implements NoonClient {
  readonly mode = "live" as const;
  /** 最近一次 catalog 导出顺带解析的库存提示（pullDomain 可 drain） */
  private stockHints: NoonStockDto[] = [];

  constructor(private readonly connection: NoonConnection) {}

  drainStockHints(): NoonStockDto[] {
    const rows = this.stockHints;
    this.stockHints = [];
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
    const { csv } = await runImpexExportCsv(
      this.connection,
      IMPEX_EXPORT_CATEGORIES.orders,
      range,
    );
    return parseOrdersContent(csv, "csv");
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
    }

    this.stockHints = [...hintMap.values()];
    return [...merged.values()];
  }

  private async safeStockExport(category: string): Promise<NoonStockDto[]> {
    try {
      const { csv } = await runImpexExportCsv(this.connection, category, {});
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
          `Impex 导出限额已用尽（通常 30 分钟 2 次）：${msg.slice(0, 180)}`,
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

function orderDateRange(since: string | null): {
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
  return impexDateRangeDays(30);
}
