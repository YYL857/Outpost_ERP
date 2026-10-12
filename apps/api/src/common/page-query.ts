/**
 * 通用列表分页参数解析（销售/采购等轻量表）。
 */
export type PageQuery = {
  page: number;
  pageSize: number;
  all: boolean;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function truthy(v: unknown): boolean {
  if (v === true || v === 1) return true;
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

export function parsePageQuery(
  raw: Record<string, unknown> | undefined,
  defaults?: { pageSize?: number; maxPageSize?: number },
): PageQuery {
  const q = raw ?? {};
  const max = defaults?.maxPageSize ?? MAX_PAGE_SIZE;
  const fallback = defaults?.pageSize ?? DEFAULT_PAGE_SIZE;
  const all = truthy(q.all);
  let page = Number(q.page ?? 1);
  let pageSize = Number(q.pageSize ?? fallback);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = fallback;
  pageSize = Math.min(max, Math.floor(pageSize));
  page = Math.floor(page);
  return { page, pageSize, all };
}

export function slicePage<T>(
  rows: T[],
  query: PageQuery,
): {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
} {
  const total = rows.length;
  if (query.all) {
    return {
      data: rows,
      meta: {
        total,
        page: 1,
        pageSize: total || 1,
        pageCount: 1,
      },
    };
  }
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);
  const start = (page - 1) * query.pageSize;
  return {
    data: rows.slice(start, start + query.pageSize),
    meta: {
      total,
      page,
      pageSize: query.pageSize,
      pageCount,
    },
  };
}
