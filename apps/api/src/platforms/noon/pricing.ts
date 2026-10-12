/**
 * My Catalog 价格列。
 * Pricing API 的 price 是卖家底价（Manual），促销/Sale 时页面显示的是 Offer 价。
 * GET /offer/v1/product/{partner_sku} ，按店铺国家取 offers[].price.amount。
 * 不占用 Impex 导出配额。
 */
import type { NoonConnection } from "../../common/types.js";
import type { NoonCatalogDto } from "./types.js";
import { NoonHttpError, noonRequest } from "./http.js";

const CONCURRENCY = 8;

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 有有效当前售价且与现价不同时返回新价，否则 null（不覆盖） */
export function nextLivePrice(current: number, live: number | null | undefined): number | null {
  if (live == null || !Number.isFinite(live) || live <= 0) return null;
  const price = roundMoney(live);
  if (Math.abs(price - current) < 0.005) return null;
  return price;
}

export function overlayCatalogDtoPrices(
  rows: NoonCatalogDto[],
  prices: ReadonlyMap<string, number>,
  nowIso: string,
): NoonCatalogDto[] {
  return rows.map((row) => {
    const price = nextLivePrice(row.price, prices.get(row.partner_sku));
    if (price == null) return row;
    return { ...row, price, updated_at: nowIso };
  });
}

type OfferRow = {
  country_code?: string;
  business_model?: string;
  live_status?: boolean;
  price?: { amount?: number | string | null; currency?: string } | null;
};

/** 店铺国家下 My Catalog 正在展示的售价；没有则 null */
export function pickOfferAmount(raw: unknown, countryCode: string): number | null {
  if (!raw || typeof raw !== "object") return null;
  const offers = (raw as { offers?: unknown }).offers;
  if (!Array.isArray(offers)) return null;
  const country = countryCode.toLowerCase();
  const rows = offers.filter((o): o is OfferRow => {
    if (!o || typeof o !== "object") return false;
    return String((o as OfferRow).country_code ?? "").toLowerCase() === country;
  });
  const chosen =
    rows.find((o) => o.live_status && (o.business_model ?? "noon") === "noon") ??
    rows.find((o) => (o.business_model ?? "noon") === "noon") ??
    rows[0];
  if (!chosen?.price || typeof chosen.price !== "object") return null;
  const amount = Number(chosen.price.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return roundMoney(amount);
}

async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

/** partner_sku → My Catalog 当前售价。单个 SKU 失败跳过；全部失败则抛出。 */
export async function batchGetLivePrices(
  connection: NoonConnection,
  partnerSkus: string[],
  countryCode?: string,
): Promise<Map<string, number>> {
  const country = (countryCode || connection.countryCode || "sa").toLowerCase();
  const unique = [...new Set(partnerSkus.map((s) => s.trim()).filter(Boolean))];
  const out = new Map<string, number>();
  let ok = 0;
  let lastErr: unknown;

  await mapPool(unique, CONCURRENCY, async (sku) => {
    try {
      const raw = await noonRequest(
        connection,
        "GET",
        `/offer/v1/product/${encodeURIComponent(sku)}`,
      );
      ok += 1;
      const price = pickOfferAmount(raw, country);
      if (price != null) out.set(sku, price);
    } catch (err) {
      if (err instanceof NoonHttpError && err.status === 404) {
        ok += 1;
        return;
      }
      lastErr = err;
    }
  });

  if (ok === 0 && lastErr) {
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
  return out;
}
