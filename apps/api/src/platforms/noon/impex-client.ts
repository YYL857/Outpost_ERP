/**
 * Partner Impex：异步导出 CSV（绕过 Seller Lab / Akamai）。
 * 流程：create → poll status → download_url → CSV 文本
 */
import type { NoonConnection } from "../../common/types.js";
import { NoonHttpError, noonRequest, readNoonCredentialsFile } from "./http.js";

export const IMPEX_EXPORT_CATEGORIES = {
  catalog: "noon_catalog_catalogexport",
  catalogGlobal: "noon_catalog_globalcatalogexport",
  orders: "noon_noonoms_ordersexport",
  stockFbnDetailed: "fbn_inventoryv2_ledgerdetailedview",
  stockFbnSummary: "fbn_inventoryv2_ledgersummaryview",
  stockAging: "fbn_inventoryv2_aging",
  sales: "noon_catalog_reports_productviewsandsalesdata",
  fees: "noon_financeweb_transactionviewreportonitemlevel",
  invoices: "noon_financeweb_invoicesandcreditnotes",
} as const;

export type ImpexExportCategoryCode =
  (typeof IMPEX_EXPORT_CATEGORIES)[keyof typeof IMPEX_EXPORT_CATEGORIES];

type ImpexCreateResult = { export_code?: string };
type ImpexStatusResult = {
  export_code?: string;
  export_status?: string;
  download_url?: string | null;
  export_category_code?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 串行锁：同一进程同时只跑一个 Impex 导出 */
let impexChain: Promise<unknown> = Promise.resolve();

function withImpexLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = impexChain.then(fn, fn);
  impexChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function impexDateYmd(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function impexDateRangeDays(days: number): {
  from_date: string;
  to_date: string;
} {
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { from_date: impexDateYmd(from), to_date: impexDateYmd(to) };
}

export async function createImpexExport(
  connection: NoonConnection,
  exportCategoryCode: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): Promise<string> {
  const body: Record<string, unknown> = {
    export_category_code: exportCategoryCode,
  };
  if (params && Object.keys(params).length) {
    const cleaned: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      cleaned[k] = v;
    }
    if (Object.keys(cleaned).length) body.params = cleaned;
  }
  const raw = (await noonRequest(
    connection,
    "POST",
    "/impex/v1/export/create",
    body,
  )) as ImpexCreateResult;
  const code = raw?.export_code?.trim();
  if (!code) {
    throw new Error(
      `Impex create 未返回 export_code（${exportCategoryCode}）: ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }
  return code;
}

export async function getImpexExportStatus(
  connection: NoonConnection,
  exportCode: string,
): Promise<ImpexStatusResult> {
  return (await noonRequest(connection, "POST", "/impex/v1/export/status", {
    export_code: exportCode,
  })) as ImpexStatusResult;
}

export async function waitImpexExport(
  connection: NoonConnection,
  exportCode: string,
  opts?: { timeoutMs?: number; pollMs?: number },
): Promise<ImpexStatusResult> {
  const timeoutMs = opts?.timeoutMs ?? 10 * 60 * 1000;
  const pollMs = opts?.pollMs ?? 2500;
  const started = Date.now();
  for (;;) {
    const st = await getImpexExportStatus(connection, exportCode);
    const status = (st.export_status ?? "").toUpperCase();
    if (
      status &&
      status !== "RUNNING" &&
      status !== "QUEUED" &&
      status !== "PENDING"
    ) {
      if (
        status !== "COMPLETE" &&
        status !== "COMPLETED" &&
        status !== "SUCCESS"
      ) {
        throw new Error(
          `Impex 导出失败 ${exportCode}: status=${st.export_status} ${JSON.stringify(st).slice(0, 300)}`,
        );
      }
      if (!st.download_url) {
        throw new Error(`Impex 导出完成但无 download_url: ${exportCode}`);
      }
      return st;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `Impex 导出超时 ${exportCode}（>${Math.round(timeoutMs / 1000)}s）status=${st.export_status ?? "?"}`,
      );
    }
    await sleep(pollMs);
  }
}

export async function downloadImpexCsv(downloadUrl: string): Promise<string> {
  const res = await fetch(downloadUrl, {
    headers: { Accept: "text/csv,*/*" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new NoonHttpError(
      `Impex download HTTP ${res.status}`,
      res.status,
      text.slice(0, 400),
    );
  }
  return text;
}

/**
 * 创建并等待下载指定类别的 CSV。
 * 若提示「已有导出在跑」，短暂重试 create。
 */
export async function runImpexExportCsv(
  connection: NoonConnection,
  exportCategoryCode: string,
  params?: Record<string, string | number | boolean | null | undefined>,
  opts?: { timeoutMs?: number; pollMs?: number },
): Promise<{ exportCode: string; csv: string; category: string }> {
  if (!readNoonCredentialsFile()) {
    throw new Error(
      "Impex 需要 OUTPOST_NOON_CREDENTIALS_FILE（Service Account JSON）",
    );
  }

  return withImpexLock(async () => {
    let exportCode = "";
    let lastErr: unknown;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        exportCode = await createImpexExport(
          connection,
          exportCategoryCode,
          params,
        );
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg =
          err instanceof NoonHttpError
            ? `${err.message} ${err.body}`
            : err instanceof Error
              ? err.message
              : String(err);
        if (/already running|already in progress|concurrent/i.test(msg)) {
          await sleep(5000);
          continue;
        }
        if (/export limit reached|exports in the last/i.test(msg)) {
          throw new Error(
            `Impex 导出限额已用尽（通常 30 分钟内 2 次）。请稍后再同步。详情：${msg.slice(0, 200)}`,
          );
        }
        throw err;
      }
    }
    if (!exportCode) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error(`Impex create 失败: ${String(lastErr)}`);
    }

    const st = await waitImpexExport(connection, exportCode, opts);
    const csv = await downloadImpexCsv(st.download_url!);
    return {
      exportCode,
      csv,
      category: st.export_category_code ?? exportCategoryCode,
    };
  });
}
