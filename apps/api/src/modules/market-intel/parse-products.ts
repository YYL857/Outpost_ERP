import { classifyBrandTier } from "./white-label.js";
import type { BrandTier, DiscoveredProduct, ReviewItem, SellerIntel } from "./types.js";

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** 解析 "80+" / "2.6K" / "80+ Sold Recently" → 数值 */
export function parseSoldRecentlyCount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.round(raw);
  if (typeof raw !== "string" || !raw.trim()) return null;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([KkMm])?/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const u = (m[2] || "").toUpperCase();
  if (u === "K") n *= 1000;
  if (u === "M") n *= 1_000_000;
  return Math.round(n);
}

function pickListSignals(obj: Record<string, unknown>): {
  soldRecently: number | null;
  soldRecentlyText: string | null;
  isBestSeller: boolean;
  isAd: boolean;
} {
  const text =
    (typeof obj.soldRecentlyText === "string" && obj.soldRecentlyText) ||
    (typeof obj.sold_recently_text === "string" && obj.sold_recently_text) ||
    null;
  const soldRecently =
    parseSoldRecentlyCount(obj.soldRecently) ??
    parseSoldRecentlyCount(obj.sold_recently) ??
    parseSoldRecentlyCount(text);
  return {
    soldRecently,
    soldRecentlyText: text ?? (soldRecently != null ? `${soldRecently}+ Sold Recently` : null),
    isBestSeller: Boolean(obj.isBestSeller || obj.is_best_seller),
    isAd: Boolean(obj.isAd || obj.is_ad || obj.sponsored),
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

const PRODUCT_URL_RE =
  /https?:\/\/(?:www\.)?noon\.com\/(?:saudi-en|saudi-ar)\/([^/?#"']+)\/([A-Za-z0-9]{6,})\/p\//i;

function titleFromSlug(slug: string): string {
  try {
    return decodeURIComponent(slug).replace(/-/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  } catch {
    return slug.replace(/-/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  }
}

function normalizeProductUrl(url: string | null, productKey: string, baseUrl: string): string | null {
  if (!url) return `${baseUrl.replace(/\/$/, "")}/${productKey}/p/`;
  if (/nooncdn\.com/i.test(url) || /\/p\/pzsku\//i.test(url)) return null;
  const m = PRODUCT_URL_RE.exec(url);
  if (m) return `https://www.noon.com/saudi-en/${m[1]}/${m[2]}/p/`;
  if (url.startsWith("http") && /noon\.com/i.test(url) && /\/p\//i.test(url)) return url.split("#")[0]!;
  if (!url.startsWith("http")) {
    return `${baseUrl.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
  }
  return `${baseUrl.replace(/\/$/, "")}/${productKey}/p/`;
}

/** 从影刀/插件投递的 JSON 中抽取商品列表 */
export function extractProductsFromPayload(
  payload: unknown,
  opts: { categoryId: string; currency: string; baseUrl: string; topN: number },
): DiscoveredProduct[] {
  const found: DiscoveredProduct[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown, depth: number) => {
    if (found.length >= opts.topN || depth > 12 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const obj = asRecord(node);
    if (!obj) return;

    const sku =
      (typeof obj.sku === "string" && obj.sku) ||
      (typeof obj.offer_code === "string" && obj.offer_code) ||
      (typeof obj.offerCode === "string" && obj.offerCode) ||
      (typeof obj.catalog_sku === "string" && obj.catalog_sku) ||
      (typeof obj.productKey === "string" && obj.productKey) ||
      null;
    let title =
      (typeof obj.name === "string" && obj.name) ||
      (typeof obj.title === "string" && obj.title) ||
      (typeof obj.product_title === "string" && obj.product_title) ||
      null;
    const urlPath =
      (typeof obj.url === "string" && obj.url) ||
      (typeof obj.slug === "string" && obj.slug) ||
      (typeof obj.product_url === "string" && obj.product_url) ||
      null;

    if (sku && (title || urlPath)) {
      let productKey = String(sku).replace(/[^\w.-]+/g, "_").slice(0, 120);
      const urlHit = urlPath ? PRODUCT_URL_RE.exec(urlPath) : null;
      if (urlHit) {
        productKey = urlHit[2]!.replace(/[^\w.-]+/g, "_").slice(0, 120);
        if (!title || title === sku || title === productKey) title = titleFromSlug(urlHit[1]!);
      }
      if (!title) title = productKey;
      if (!seen.has(productKey)) {
        const url = normalizeProductUrl(urlPath, productKey, opts.baseUrl);
        if (!url) {
          for (const v of Object.values(obj)) visit(v, depth + 1);
          return;
        }
        seen.add(productKey);
        const priceObj = asRecord(obj.price) ?? asRecord(obj.sale_price);
        const price =
          pickNumber(obj.sale_price) ??
          pickNumber(obj.price) ??
          pickNumber(priceObj?.amount) ??
          pickNumber(obj.sellingPrice) ??
          null;
        const sig = pickListSignals(obj);
        const cardTags = Array.isArray(obj.cardTags)
          ? obj.cardTags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
          : [];
        const brand =
          (typeof obj.brand === "string" && obj.brand.trim()) ||
          (typeof obj.brandName === "string" && obj.brandName.trim()) ||
          null;
        found.push({
          productKey,
          url,
          title,
          price,
          currency: opts.currency,
          rating: pickNumber(obj.rating) ?? pickNumber(obj.average_rating),
          reviewCount:
            pickNumber(obj.review_count) ??
            pickNumber(obj.reviews_count) ??
            pickNumber(obj.ratings_count) ??
            pickNumber(obj.reviewCount),
          imageUrl:
            (typeof obj.image_key === "string" && obj.image_key) ||
            (typeof obj.imageUrl === "string" && obj.imageUrl) ||
            (typeof obj.image === "string" && obj.image) ||
            null,
          brand,
          categoryId: opts.categoryId,
          soldRecently: sig.soldRecently,
          soldRecentlyText: sig.soldRecentlyText,
          isBestSeller: sig.isBestSeller,
          isAd: sig.isAd,
          cardTags,
        });
      }
    }

    for (const v of Object.values(obj)) visit(v, depth + 1);
  };

  visit(payload, 0);
  return found.slice(0, opts.topN);
}

export function normalizeFlatProducts(
  rows: unknown[],
  opts: { categoryId: string; currency: string; baseUrl: string; topN: number },
): DiscoveredProduct[] {
  const products: DiscoveredProduct[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    let key = String(r.productKey ?? r.sku ?? r.offer_code ?? "");
    let title = String(r.title ?? r.name ?? "");
    let url = String(r.url ?? "");
    const urlHit = PRODUCT_URL_RE.exec(url);
    if (urlHit) {
      key = urlHit[2]!;
      if (!title || title === key || title === String(r.productKey ?? "")) {
        title = titleFromSlug(urlHit[1]!);
      }
      url = `https://www.noon.com/saudi-en/${urlHit[1]}/${urlHit[2]}/p/`;
    }
    if (!key || !title) continue;
    if (/nooncdn\.com/i.test(url)) continue;
    const normalized = normalizeProductUrl(url || null, key, opts.baseUrl);
    if (!normalized) continue;
    const seller = parseSeller(r.seller ?? r);
    const reviews = parseReviews(r.reviews);
    const brandTier: BrandTier =
      r.brandTier === "avoid_compete" ||
      r.brandTier === "white_candidate" ||
      r.brandTier === "white_label" ||
      r.brandTier === "unknown" ||
      r.brandTier === "big_brand"
        ? r.brandTier === "big_brand"
          ? "avoid_compete"
          : r.brandTier
        : classifyBrandTier(`${title} ${seller?.sellerName ?? ""}`);
    const sig = pickListSignals(r);
    const cardTags = Array.isArray(r.cardTags)
      ? r.cardTags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
      : [];
    const brand =
      (typeof r.brand === "string" && r.brand.trim()) ||
      (typeof r.brandName === "string" && r.brandName.trim()) ||
      null;
    products.push({
      productKey: key.replace(/[^\w.-]+/g, "_").slice(0, 120),
      url: normalized,
      title,
      price: typeof r.price === "number" ? r.price : pickNumber(r.price),
      currency: String(r.currency ?? opts.currency),
      rating: typeof r.rating === "number" ? r.rating : pickNumber(r.rating),
      reviewCount:
        typeof r.reviewCount === "number"
          ? r.reviewCount
          : pickNumber(r.reviewCount ?? r.review_count),
      imageUrl: typeof r.imageUrl === "string" ? r.imageUrl : null,
      brand,
      categoryId: opts.categoryId,
      brandTier,
      soldRecently: sig.soldRecently,
      soldRecentlyText: sig.soldRecentlyText,
      isBestSeller: sig.isBestSeller,
      isAd: sig.isAd,
      cardTags,
      seller,
      reviews,
    });
    if (products.length >= opts.topN) break;
  }
  return products;
}

const SELLER_NAME_JUNK =
  /^(all products( by this seller)?|sold by|fulfilled by|partner|noon|seller|store|shop|view (all )?products|products by|best\s*sellers?|bestsellers)$/i;

function cleanSellerName(name: string | null): string | null {
  if (!name) return null;
  const s = name.replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 80) return null;
  if (SELLER_NAME_JUNK.test(s)) return null;
  if (/all products by this seller/i.test(s)) return null;
  return s;
}

function parseSeller(raw: unknown): SellerIntel | null {
  const o = asRecord(raw);
  if (!o) return null;
  const sellerUrl =
    (typeof o.sellerUrl === "string" && o.sellerUrl) ||
    (typeof o.seller_url === "string" && o.seller_url) ||
    null;
  const rawName =
    (typeof o.sellerName === "string" && o.sellerName) ||
    (typeof o.seller_name === "string" && o.seller_name) ||
    (typeof o.storeName === "string" && o.storeName) ||
    null;
  const sellerName = cleanSellerName(rawName);
  const sellerId =
    (typeof o.sellerId === "string" && o.sellerId) ||
    (typeof o.seller_id === "string" && o.seller_id) ||
    (sellerUrl && /\/seller\/(p-[\w-]+)/i.exec(sellerUrl)?.[1]) ||
    null;
  if (!sellerId && !sellerName && !sellerUrl) return null;
  return {
    sellerId,
    sellerName,
    sellerUrl,
    sellerRating: pickNumber(o.sellerRating ?? o.seller_rating),
    sellerRatingCount: pickNumber(o.sellerRatingCount ?? o.seller_rating_count),
    sellerPositivePct: pickNumber(o.sellerPositivePct ?? o.positiveRatingsPct),
    sellerCustomers90d:
      (typeof o.sellerCustomers90d === "string" && o.sellerCustomers90d) ||
      (typeof o.customers90d === "string" && o.customers90d) ||
      null,
    productAsDescribedPct: pickNumber(
      o.productAsDescribedPct ?? o.product_as_described,
    ),
    sellerSince:
      (typeof o.sellerSince === "string" && o.sellerSince) ||
      (typeof o.seller_since === "string" && o.seller_since) ||
      null,
  };
}

function parseReviews(raw: unknown): ReviewItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ReviewItem[] = [];
  for (const item of raw) {
    const o = asRecord(item);
    if (!o) continue;
    const text =
      (typeof o.text === "string" && o.text) ||
      (typeof o.comment === "string" && o.comment) ||
      (typeof o.body === "string" && o.body) ||
      null;
    out.push({
      author:
        (typeof o.author === "string" && o.author) ||
        (typeof o.name === "string" && o.name) ||
        null,
      date: (typeof o.date === "string" && o.date) || null,
      rating: pickNumber(o.rating ?? o.stars),
      text,
      language: (typeof o.language === "string" && o.language) || null,
      verified:
        typeof o.verified === "boolean"
          ? o.verified
          : typeof o.verifiedPurchase === "boolean"
            ? o.verifiedPurchase
            : null,
    });
  }
  return out;
}
