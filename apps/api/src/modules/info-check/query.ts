import { resolveFieldValue } from "./field-aliases.js";
import type {
  InfoCheckBundle,
  InfoCheckCompareCell,
  InfoCheckQueryMode,
  InfoCheckQueryRow,
} from "./types.js";

const MAX_RESULTS = 80;

function norm(s: string) {
  return s.trim().toLowerCase();
}

function valuesMatch(...vals: string[]): boolean {
  const nonempty = vals.map((v) => v.trim()).filter((v) => v.length > 0);
  if (nonempty.length <= 1) return true;
  const first = nonempty[0]!;
  return nonempty.every((v) => v === first);
}

function buildCompare(
  psku: string,
  bundle: InfoCheckBundle,
  fields: string[],
): InfoCheckCompareCell[] {
  const product = bundle.product.byPsku.get(psku);
  const monthlyDeals = bundle.monthlyDeals.byPsku.get(psku);
  const infoCheck = bundle.infoCheck.byPsku.get(psku);
  return fields.map((field) => {
    const p = resolveFieldValue(product, field);
    const d = resolveFieldValue(monthlyDeals, field);
    const i = resolveFieldValue(infoCheck, field);
    return {
      field,
      product: p.value,
      monthlyDeals: d.value,
      infoCheck: i.value,
      mismatch: !valuesMatch(p.value, d.value, i.value),
      sources: {
        product: p.matchedField,
        monthlyDeals: d.matchedField,
        infoCheck: i.matchedField,
      },
    };
  });
}

function rowMatchesFuzzy(
  psku: string,
  fields: Record<string, string>,
  needle: string,
): boolean {
  if (norm(psku).includes(needle)) return true;
  for (const v of Object.values(fields)) {
    if (norm(v).includes(needle)) return true;
  }
  return false;
}

export type InfoCheckQueryInput = {
  q: string;
  mode: InfoCheckQueryMode;
  /** 空 = 返回整行 sources；非空 = 附加 compare */
  fields: string[];
  limit?: number;
};

export function queryInfoCheck(
  bundle: InfoCheckBundle,
  input: InfoCheckQueryInput,
): { rows: InfoCheckQueryRow[]; totalMatched: number; truncated: boolean } {
  const q = input.q.trim();
  const limit = Math.min(Math.max(input.limit ?? MAX_RESULTS, 1), 200);
  const mode = input.mode === "exact" ? "exact" : "fuzzy";

  /** 以产品表为准 */
  let matched: string[] = [];
  if (!q) {
    matched = [...bundle.product.byPsku.keys()].sort();
  } else if (mode === "exact") {
    const hit = bundle.product.byPsku.has(q)
      ? q
      : [...bundle.product.byPsku.keys()].find(
          (k) => k.toLowerCase() === q.toLowerCase(),
        );
    matched = hit ? [hit] : [];
  } else {
    const needle = norm(q);
    matched = [...bundle.product.byPsku.entries()]
      .filter(([psku, fields]) => rowMatchesFuzzy(psku, fields, needle))
      .map(([psku]) => psku)
      .sort();
  }

  const totalMatched = matched.length;
  const truncated = totalMatched > limit;
  const slice = matched.slice(0, limit);
  const fieldFilter = input.fields.map((f) => f.trim()).filter(Boolean);

  const rows: InfoCheckQueryRow[] = slice.map((psku) => {
    const product = bundle.product.byPsku.get(psku) ?? null;
    const monthlyDeals = bundle.monthlyDeals.byPsku.get(psku) ?? null;
    const infoCheck = bundle.infoCheck.byPsku.get(psku) ?? null;

    let sources = { product, monthlyDeals, infoCheck };
    if (fieldFilter.length > 0) {
      const pick = (rec: Record<string, string> | null) => {
        if (!rec) return null;
        const out: Record<string, string> = {};
        for (const f of fieldFilter) {
          const got = resolveFieldValue(rec, f);
          if (got.matchedField != null) out[f] = got.value;
        }
        return Object.keys(out).length ? out : null;
      };
      sources = {
        product: pick(product),
        monthlyDeals: pick(monthlyDeals),
        infoCheck: pick(infoCheck),
      };
    }

    const row: InfoCheckQueryRow = { psku, sources };
    if (fieldFilter.length > 0) {
      row.compare = buildCompare(psku, bundle, fieldFilter);
    }
    return row;
  });

  return { rows, totalMatched, truncated };
}

export function serializeTableMeta(bundle: InfoCheckBundle) {
  const ser = (t: InfoCheckBundle["product"]) => ({
    docId: t.docId,
    label: t.label,
    pulledAt: t.pulledAt,
    headerCount: t.headers.length,
    headers: t.headers,
    rowCount: t.byPsku.size,
    hasSnapshot: Boolean(t.snapshotPath),
  });
  return {
    product: ser(bundle.product),
    monthlyDeals: ser(bundle.monthlyDeals),
    infoCheck: ser(bundle.infoCheck),
    commonFields: bundle.commonFields,
  };
}
