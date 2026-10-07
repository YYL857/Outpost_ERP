import type {
  NoonAdsDto,
  NoonCatalogDto,
  NoonFeeDto,
  NoonOrderDto,
  NoonSalesDto,
  NoonStockDto,
} from "../types.js";

export type PortalImportDomain =
  | "orders"
  | "catalog"
  | "stock"
  | "sales"
  | "fees"
  | "ads"
  | "fee_estimates"
  | "fbn_dims";

function stripBom(text: string) {
  return text.replace(/^\uFEFF/, "");
}

/** 简易 CSV：支持逗号分隔、双引号字段 */
export function parseCsv(text: string): Record<string, string>[] {
  const raw = stripBom(text).trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const hit = Object.entries(row).find(
      ([rk]) => rk === k || rk.replace(/\s+/g, "_") === k,
    );
    if (hit && hit[1]) return hit[1];
  }
  for (const k of keys) {
    const hit = Object.entries(row).find(([rk]) => rk.includes(k));
    if (hit && hit[1]) return hit[1];
  }
  return "";
}

function toNumber(v: string | number | unknown, fallback = 0) {
  const n = Number(String(v ?? "").replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function detectFormat(content: string, format: "csv" | "json" | "auto"): "csv" | "json" {
  if (format === "csv" || format === "json") return format;
  const t = stripBom(content).trim();
  if (t.startsWith("[") || t.startsWith("{")) return "json";
  return "csv";
}

function extractArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const k of ["data", "orders", "items", "products", "result", "rows", "sales", "fees"]) {
      if (Array.isArray(obj[k])) return obj[k] as unknown[];
    }
  }
  return [];
}

function parseFulfillment(raw: unknown): "fbn" | "fbp" | "unknown" {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("fbn") || s.includes("noon") || s.includes("saleable")) return "fbn";
  if (s.includes("fbp") || s.includes("partner") || s.includes("seller") || s.includes("xdock")) {
    return "fbp";
  }
  return "unknown";
}

function parseRate(raw: unknown): number {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const n = toNumber(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (s.includes("%") || n > 1) return Math.min(1, n / 100);
  return n;
}

function toDateOnly(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return nowIso().slice(0, 10);
  const d = new Date(s.includes(" ") ? s.replace(" ", "T") + "Z" : s);
  if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return nowIso().slice(0, 10);
}

/**
 * 按 SOP 导出文件名推断导入域（不依赖人工选 domain）
 */
export function detectDomainFromFilename(filename: string): PortalImportDomain | null {
  const n = filename.toLowerCase().replace(/\\/g, "/");
  const base = n.split("/").pop() ?? n;
  if (base.startsWith(".")) return null;
  if (!/\.(csv|json|txt)$/i.test(base)) return null;

  // 估费 / 尺寸专用文件名须先于通用 catalog/stock
  if (/catalog_est_fees|estimated_fees|est_fees/.test(base)) return "fee_estimates";
  if (/fbn_dims|inventory_dims|dims_export/.test(base)) return "fbn_dims";

  if (/transactionview|transaction_view|佣金|出库费/.test(base)) return "fees";
  if (
    /ads[_-]?sku|campaign[_-]?overview|overview[_-]?all|noon[_-]?ads|roas|广告|投产/.test(
      base,
    ) ||
    (/^ads[_\-]/.test(base) && !/catalog|sales|order/.test(base))
  ) {
    return "ads";
  }
  if (/sales_export|sales\.csv|_sales/.test(base)) return "sales";
  if (/fbn_inventory|inventory_detailed|库存明细|库存细节/.test(base)) return "stock";
  if (/inventory|库存报表/.test(base)) return "stock";
  if (/_live|_notlive|notlive|catalog|目录/.test(base)) return "catalog";
  if (/productviews|浏览|转化/.test(base)) return "sales";
  if (/order/.test(base)) return "orders";
  return null;
}

/** 从文件名解析报表区间：ads_sku_2026-09-01_2026-09-07.csv */
export function parseDateRangeFromFilename(
  filename?: string,
): { from_date: string; to_date: string } | null {
  if (!filename) return null;
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const m1 = base.match(
    /(20\d{2}-\d{2}-\d{2}).{1,3}(20\d{2}-\d{2}-\d{2})/,
  );
  if (m1) return { from_date: m1[1], to_date: m1[2] };
  const m2 = base.match(/(20\d{2})(\d{2})(\d{2}).{1,3}(20\d{2})(\d{2})(\d{2})/);
  if (m2) {
    return {
      from_date: `${m2[1]}-${m2[2]}-${m2[3]}`,
      to_date: `${m2[4]}-${m2[5]}-${m2[6]}`,
    };
  }
  return null;
}

export function parseOrdersContent(
  content: string,
  format: "csv" | "json" | "auto",
): NoonOrderDto[] {
  const kind = detectFormat(content, format);
  if (kind === "json") {
    const data = extractArray(JSON.parse(stripBom(content)));
    return data.map(normalizeOrder).filter((x): x is NoonOrderDto => Boolean(x));
  }
  return parseCsv(content)
    .map((row) =>
      normalizeOrder({
        order_nr: pick(row, ["order_nr", "order nr", "order_number", "order id", "bayan_nr", "id"]),
        status: pick(row, ["status", "order_status", "state"]),
        currency: pick(row, ["currency", "currency_code", "curr"]) || "SAR",
        total_amount: pick(row, ["total_amount", "gmv_lcy", "gmv", "amount", "grand_total"]),
        item_count: pick(row, ["item_count", "qty", "quantity", "items", "units"]) || "1",
        placed_at: pick(row, ["placed_at", "order_timestamp", "order_date", "created_at", "date"]),
        updated_at: pick(row, ["updated_at", "shipment_timestamp", "delivered_timestamp"]),
      }),
    )
    .filter((x): x is NoonOrderDto => Boolean(x));
}

/** SOP Catalog Exports：*_live.csv / *_notlive.csv */
export function parseCatalogContent(
  content: string,
  format: "csv" | "json" | "auto",
): NoonCatalogDto[] {
  const kind = detectFormat(content, format);
  if (kind === "json") {
    const data = extractArray(JSON.parse(stripBom(content)));
    return data.map(normalizeCatalog).filter((x): x is NoonCatalogDto => Boolean(x));
  }
  return parseCsv(content)
    .map((row) =>
      normalizeCatalog({
        partner_sku: pick(row, ["partner_sku", "psku_code", "psku", "seller_sku"]),
        noon_sku: pick(row, ["sku_child", "noon_sku", "sku", "sku_config"]),
        title: pick(row, ["noon_title", "title", "product_title", "name", "product_name"]),
        is_active: pick(row, ["is_active", "noon_status", "active", "status", "enabled"]),
        image_url: pick(row, [
          "image_url",
          "image_url_1",
          "primary_image",
          "product_image",
          "img_url",
          "imageurl",
          "thumbnail",
          "image",
          "img",
        ]),
        price: pick(row, [
          "active_price",
          "sale_price",
          "offer_price",
          "price",
          "seller_price_min",
        ]),
        currency: pick(row, ["currency", "currency_code", "curr"]) || "SAR",
        listing_type: pick(row, ["mp_code", "listing_type", "family_code", "brand_code"]),
        // 勿用 sale_end_date：促销结束日可达 2033/2099，会锁死 upsert 售价
        updated_at:
          pick(row, ["updated_at", "modified_at", "last_modified"]) || nowIso(),
      }),
    )
    .filter((x): x is NoonCatalogDto => Boolean(x));
}

/**
 * 从 Catalog Exports 顺带抽出 FBN/FBP 库存提示（live/notlive 含 stock_fbn_net 等）
 */
export function parseStockHintsFromCatalogContent(
  content: string,
  format: "csv" | "json" | "auto" = "auto",
): NoonStockDto[] {
  const kind = detectFormat(content, format);
  const rows =
    kind === "json"
      ? extractArray(JSON.parse(stripBom(content))).map((r) => {
          const o = r as Record<string, unknown>;
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(o)) out[k.toLowerCase()] = String(v ?? "");
          return out;
        })
      : parseCsv(content);

  const out: NoonStockDto[] = [];
  const ts = nowIso();
  for (const row of rows) {
    const sku = pick(row, ["partner_sku", "psku_code", "psku"]).trim();
    if (!sku) continue;
    const fbn = Math.max(0, Math.floor(toNumber(pick(row, ["stock_fbn_net", "stock_fbn"]))));
    const fbp = Math.max(
      0,
      Math.floor(toNumber(pick(row, ["stock_xdock_net", "stock_xdock_gross", "stock_fbp"]))),
    );
    if (fbn > 0) {
      out.push({
        partner_sku: sku,
        warehouse_code: "FBN",
        qty: fbn,
        fulfillment: "fbn",
        in_transit_qty: 0,
        updated_at: ts,
      });
    }
    if (fbp > 0) {
      out.push({
        partner_sku: sku,
        warehouse_code: "FBP",
        qty: fbp,
        fulfillment: "fbp",
        in_transit_qty: 0,
        updated_at: ts,
      });
    }
  }
  return out;
}

/** SOP Inventory / FBN detailed */
export function parseStockContent(
  content: string,
  format: "csv" | "json" | "auto",
): NoonStockDto[] {
  const kind = detectFormat(content, format);
  const rawRows =
    kind === "json"
      ? extractArray(JSON.parse(stripBom(content)))
      : parseCsv(content);

  const mapped = (kind === "json" ? rawRows : rawRows).map((row) => {
    if (kind === "json") return normalizeStock(row);
    const r = row as Record<string, string>;
    const fulfillmentRaw =
      pick(r, ["fulfillment_type", "fulfillment", "inventory_type", "channel"]) ||
      "saleable";
    const qty = pick(r, ["qty", "quantity", "stock", "available"]);
    const txn = pick(r, ["transaction_type", "reason"]).toLowerCase();
    const isTransit = /in.?transit|inbound|transfer_in|receiving|putaway/.test(txn);

    return normalizeStock({
      partner_sku: pick(r, ["partner_sku", "psku", "sku", "seller_sku"]),
      warehouse_code: pick(r, ["warehouse_code", "warehouse", "wh"]),
      qty: isTransit ? "0" : qty,
      fulfillment: fulfillmentRaw,
      in_transit_qty: isTransit ? qty : pick(r, ["in_transit_qty", "in_transit"]),
      updated_at: pick(r, [
        "inventory_snapshot_at",
        "posted_date",
        "updated_at",
        "modified_at",
      ]),
    });
  });

  // 按 sku+warehouse+fulfillment 合并
  const map = new Map<string, NoonStockDto>();
  for (const s of mapped) {
    if (!s) continue;
    const key = `${s.partner_sku}|${s.warehouse_code}|${s.fulfillment}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...s });
      continue;
    }
    prev.qty += s.qty;
    prev.in_transit_qty += s.in_transit_qty;
    if (s.updated_at > prev.updated_at) prev.updated_at = s.updated_at;
  }
  return [...map.values()];
}

/** SOP Sales export：按 partner_sku + 日聚合 */
export function parseSalesContent(
  content: string,
  format: "csv" | "json" | "auto",
): NoonSalesDto[] {
  const kind = detectFormat(content, format);
  const rows =
    kind === "json"
      ? extractArray(JSON.parse(stripBom(content)))
          .map(normalizeSalesLoose)
          .filter((x): x is NoonSalesDto => Boolean(x))
      : parseCsv(content)
          .map((row) =>
            normalizeSalesLoose({
              partner_sku: pick(row, [
                "partner_sku",
                "partner sku",
                "partner skus",
                "psku",
                "psku_code",
                "seller_sku",
                "sku",
              ]),
              date: pick(row, [
                "order_timestamp",
                "visit_date",
                "date",
                "sale_date",
                "order_date",
                "day",
                "report_date",
              ]),
              units: pick(row, [
                "units",
                "shipped_units",
                "gross_units",
                "sold_units",
                "units_sold",
                "qty",
                "quantity",
                "orders",
              ]),
              amount: pick(row, [
                "gmv_lcy",
                "revenue_shipped",
                "amount",
                "gmv",
                "offer_price",
                "revenue",
                "sales_amount",
                "net_sales",
                "sales",
                "sold_gmv",
                "gmv_sar",
              ]),
              updated_at: pick(row, [
                "delivered_timestamp",
                "shipment_timestamp",
                "updated_at",
              ]),
            }),
          )
          .filter((x): x is NoonSalesDto => Boolean(x));

  const map = new Map<string, NoonSalesDto>();
  for (const r of rows) {
    const key = `${r.partner_sku}|${r.date}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r });
      continue;
    }
    prev.units += r.units;
    prev.amount += r.amount;
    if (r.updated_at > prev.updated_at) prev.updated_at = r.updated_at;
  }
  return [...map.values()];
}

/** SOP Transaction View：按 Partner SKUs 聚合佣金/出库费 */
export function parseFeesContent(
  content: string,
  format: "csv" | "json" | "auto",
): NoonFeeDto[] {
  const kind = detectFormat(content, format);
  if (kind === "json") {
    const data = extractArray(JSON.parse(stripBom(content)));
    return data.map(normalizeFee).filter((x): x is NoonFeeDto => Boolean(x));
  }

  type Agg = {
    referral: number;
    fulfill: number;
    base: number;
    n: number;
    updated_at: string;
  };
  const map = new Map<string, Agg>();

  for (const row of parseCsv(content)) {
    const sku = pick(row, [
      "partner skus",
      "partner_skus",
      "partner_sku",
      "psku",
      "sku",
    ]).trim();
    if (!sku || sku === '""') continue;

    const referral = Math.abs(
      toNumber(
        pick(row, [
          "referral fee including vat",
          "referral_fee",
          "commission",
          "commission_rate",
        ]),
      ),
    );
    const fulfill = Math.abs(
      toNumber(
        pick(row, [
          "fullfilment & logistics fees including vat",
          "fulfillment & logistics fees including vat",
          "fulfillment_fee",
          "outbound_fee",
          "outbound",
        ]),
      ),
    );
    const net = Math.abs(toNumber(pick(row, ["net proceeds", "net_proceeds"])));
    const base = net + referral;
    const updated = pick(row, ["transaction date", "order date", "updated_at"]) || nowIso();

    // 一行可能含多个 SKU（逗号分隔）
    for (const part of sku.split(/[|,;]/).map((s) => s.trim()).filter(Boolean)) {
      const prev = map.get(part) ?? {
        referral: 0,
        fulfill: 0,
        base: 0,
        n: 0,
        updated_at: updated,
      };
      prev.referral += referral;
      prev.fulfill += fulfill;
      prev.base += base > 0 ? base : 0;
      prev.n += 1;
      if (updated > prev.updated_at) prev.updated_at = updated;
      map.set(part, prev);
    }
  }

  const out: NoonFeeDto[] = [];
  for (const [partner_sku, a] of map) {
    const rate = a.base > 0 ? Math.min(1, a.referral / a.base) : 0;
    out.push({
      partner_sku,
      commission_rate: Math.round(rate * 10000) / 10000,
      outbound_fee: a.n > 0 ? Math.round((a.fulfill / a.n) * 100) / 100 : 0,
      tax_amount: 0,
      updated_at: a.updated_at.includes("T")
        ? a.updated_at
        : new Date(a.updated_at).toISOString(),
    });
  }
  return out;
}

/**
 * Noon Ads Campaign Overview → SKU sheet（CSV）。
 * 官方字段：SKU / Campaign Name / Spend / Revenue / Orders / Views / Clicks。
 * ROAS 入库时不信任导出值，拼装时用 ΣRevenue/ΣSpend 重算。
 * 区间优先行内 from_date/to_date，其次文件名，最后默认近 7 日。
 */
export function parseAdsContent(
  content: string,
  format: "csv" | "json" | "auto",
  opts?: { filename?: string; asOf?: Date },
): NoonAdsDto[] {
  const kind = detectFormat(content, format);
  const fileRange = parseDateRangeFromFilename(opts?.filename);
  const asOf = opts?.asOf ?? new Date();
  const fallbackTo = toDateOnly(asOf.toISOString());
  const fallbackFrom = toDateOnly(
    new Date(asOf.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  );

  const loose =
    kind === "json"
      ? extractArray(JSON.parse(stripBom(content)))
      : parseCsv(content);

  const rows: NoonAdsDto[] = [];
  for (const raw of loose) {
    const n = normalizeAdsLoose(raw, fileRange, fallbackFrom, fallbackTo);
    if (n) rows.push(n);
  }

  // 同 SKU+活动+区间合并（防同文件重复行）
  const map = new Map<string, NoonAdsDto>();
  for (const r of rows) {
    const key = `${r.partner_sku}|${r.campaign}|${r.from_date}|${r.to_date}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r });
      continue;
    }
    prev.spend += r.spend;
    prev.revenue += r.revenue;
    prev.orders += r.orders;
    prev.views += r.views;
    prev.clicks += r.clicks;
    if (r.updated_at > prev.updated_at) prev.updated_at = r.updated_at;
  }
  return [...map.values()].filter((r) => r.spend > 0 || r.revenue > 0 || r.orders > 0);
}

function normalizeAdsLoose(
  raw: unknown,
  fileRange: { from_date: string; to_date: string } | null,
  fallbackFrom: string,
  fallbackTo: string,
): NoonAdsDto | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sku = String(
    o.partner_sku ??
      o.partnerSku ??
      o.psku ??
      o.sku ??
      o["partner sku"] ??
      "",
  ).trim();
  if (!sku || sku.toLowerCase() === "sku") return null;

  const campaign = String(
    o.campaign ?? o.campaign_name ?? o["campaign name"] ?? "",
  ).trim();

  const fromRaw =
    o.from_date ?? o.fromDate ?? o.start_date ?? o["start date"] ?? fileRange?.from_date;
  const toRaw =
    o.to_date ?? o.toDate ?? o.end_date ?? o["end date"] ?? fileRange?.to_date;
  const from_date = fromRaw
    ? toDateOnly(fromRaw)
    : fallbackFrom;
  const to_date = toRaw ? toDateOnly(toRaw) : fallbackTo;
  if (from_date > to_date) return null;

  const spend = Math.max(
    0,
    toNumber(
      o.spend ??
        o.spends ??
        o.cost ??
        o.ad_spend ??
        o.adSpend ??
        o["ad spend"] ??
        0,
    ),
  );
  const revenue = Math.max(
    0,
    toNumber(
      o.revenue ??
        o.sales ??
        o.ad_revenue ??
        o.adRevenue ??
        o.ad_sales ??
        o["ad revenue"] ??
        o.gmv ??
        0,
    ),
  );
  const orders = Math.max(
    0,
    Math.floor(toNumber(o.orders ?? o.units ?? o.conversions ?? 0)),
  );
  const views = Math.max(0, Math.floor(toNumber(o.views ?? o.impressions ?? 0)));
  const clicks = Math.max(0, Math.floor(toNumber(o.clicks ?? 0)));

  return {
    partner_sku: sku,
    campaign,
    from_date,
    to_date,
    spend: Math.round(spend * 100) / 100,
    revenue: Math.round(revenue * 100) / 100,
    orders,
    views,
    clicks,
    updated_at: String(o.updated_at ?? o.updatedAt ?? "").trim() || nowIso(),
  };
}

function normalizeOrder(raw: unknown): NoonOrderDto | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const orderNr = String(o.order_nr ?? o.orderNr ?? o.order_number ?? o.id ?? "").trim();
  if (!orderNr) return null;
  const updated =
    String(o.updated_at ?? o.updatedAt ?? o.placed_at ?? o.placedAt ?? "").trim() ||
    nowIso();
  const status =
    String(o.status ?? o.order_status ?? o.orderStatus ?? "").trim() || "unknown";
  return {
    order_nr: orderNr,
    status,
    currency: String(o.currency ?? "SAR"),
    total_amount: toNumber(o.total_amount ?? o.totalAmount ?? o.total ?? 0),
    item_count: Math.max(1, Math.floor(toNumber(o.item_count ?? o.itemCount ?? o.qty ?? 1, 1))),
    placed_at: String(o.placed_at ?? o.placedAt ?? updated).trim() || updated,
    updated_at: updated,
  };
}

function normalizeCatalog(raw: unknown): NoonCatalogDto | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sku = String(
    o.partner_sku ?? o.partnerSku ?? o.psku_code ?? o.psku ?? o.seller_sku ?? "",
  ).trim();
  if (!sku) return null;
  const activeRaw =
    o.is_active ?? o.isActive ?? o.noon_status ?? o.active ?? o.status ?? true;
  const statusStr = String(activeRaw).toLowerCase();
  const isActive =
    typeof activeRaw === "boolean"
      ? activeRaw
      : !["0", "false", "inactive", "disabled", "下架", "offline", "notlive"].includes(
          statusStr,
        ) && statusStr !== "dead";
  const noonSku = String(o.noon_sku ?? o.noonSku ?? o.sku_child ?? o.sku ?? "").trim();
  const price = Math.max(
    0,
    toNumber(
      o.active_price ??
        o.activePrice ??
        o.sale_price ??
        o.salePrice ??
        o.offer_price ??
        o.offerPrice ??
        o.price ??
        o.seller_price_min ??
        o.sellerPriceMin ??
        o.selling_price ??
        0,
    ),
  );
  return {
    partner_sku: sku,
    title: String(o.noon_title ?? o.noonTitle ?? o.title ?? o.name ?? sku),
    is_active: isActive,
    noon_sku: noonSku === sku ? "" : noonSku,
    image_url: String(
      o.image_url ??
        o.imageUrl ??
        o.image_url_1 ??
        o.primary_image ??
        o.product_image ??
        o.img_url ??
        o.thumbnail ??
        o.image ??
        "",
    ),
    price,
    currency: String(o.currency ?? o.currency_code ?? "SAR") || "SAR",
    listing_type: String(o.listing_type ?? o.listingType ?? o.mp_code ?? o.type ?? ""),
    // 勿用 sale_end_date 作版本时间（促销结束日会锁死后续官方价）
    updated_at: String(
      o.updated_at ?? o.updatedAt ?? o.modified_at ?? o.modifiedAt ?? "",
    ).trim() || nowIso(),
  };
}

function normalizeStock(raw: unknown): NoonStockDto | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sku = String(o.partner_sku ?? o.partnerSku ?? o.sku ?? "").trim();
  if (!sku) return null;
  const fulfillment = parseFulfillment(
    o.fulfillment ?? o.fulfillment_type ?? o.fulfillmentType ?? o.inventory_type ?? o.channel,
  );
  return {
    partner_sku: sku,
    warehouse_code: String(
      o.warehouse_code ?? o.warehouseCode ?? o.warehouse ?? "DEFAULT",
    ),
    qty: Math.max(0, Math.floor(toNumber(o.qty ?? o.quantity ?? 0))),
    fulfillment,
    in_transit_qty: Math.max(
      0,
      Math.floor(toNumber(o.in_transit_qty ?? o.inTransitQty ?? o.in_transit ?? 0)),
    ),
    updated_at: String(o.updated_at ?? o.updatedAt ?? nowIso()),
  };
}

function normalizeSalesLoose(raw: unknown): NoonSalesDto | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sku = String(o.partner_sku ?? o.partnerSku ?? o.sku ?? "").trim();
  if (!sku) return null;
  const unitsRaw = o.units ?? o.qty ?? o.quantity ?? o.shipped_units;
  const units =
    unitsRaw === undefined || unitsRaw === ""
      ? 1
      : Math.max(0, Math.floor(toNumber(unitsRaw, 1)));
  return {
    partner_sku: sku,
    date: toDateOnly(o.date ?? o.order_timestamp ?? o.sale_date ?? o.visit_date),
    units: units > 0 ? units : 1,
    amount: Math.max(0, toNumber(o.amount ?? o.gmv_lcy ?? o.gmv ?? o.offer_price ?? 0)),
    updated_at: String(o.updated_at ?? o.updatedAt ?? "").trim() || nowIso(),
  };
}

function normalizeFee(raw: unknown): NoonFeeDto | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sku = String(o.partner_sku ?? o.partnerSku ?? o.sku ?? "").trim();
  if (!sku) return null;
  return {
    partner_sku: sku,
    commission_rate: parseRate(o.commission_rate ?? o.commissionRate ?? o.commission),
    outbound_fee: Math.max(
      0,
      toNumber(o.outbound_fee ?? o.outboundFee ?? o.fulfillment_fee ?? 0),
    ),
    tax_amount: Math.max(0, toNumber(o.tax_amount ?? o.taxAmount ?? o.tax ?? o.vat ?? 0)),
    updated_at: String(o.updated_at ?? o.updatedAt ?? nowIso()),
  };
}

/** Catalog / 影刀 Estimated Fees 行（写入 AppState.feeEstimates，非 feeSnapshots） */
export type CatalogFeeEstimateDto = {
  partner_sku: string;
  commission_rate: number;
  outbound_fee: number;
  estimated_fee_total: number;
  fulfillment: "fbn" | "fbp" | "unknown";
  updated_at: string;
};

/** FBN Inventory 尺寸行（gap-fill → skuDims） */
export type FbnDimsDto = {
  partner_sku: string;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  weight_kg: number;
  updated_at: string;
};

function parseDimensionTriplet(raw: string): {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
} | null {
  const s = raw.trim();
  if (!s) return null;
  const parts = s.split(/[x×*✕]\s*/i).map((p) => p.trim());
  if (parts.length < 3) return null;
  const lengthCm = toNumber(parts[0]);
  const widthCm = toNumber(parts[1]);
  const heightCm = toNumber(parts[2]);
  if (lengthCm <= 0 && widthCm <= 0 && heightCm <= 0) return null;
  return { lengthCm, widthCm, heightCm };
}

/**
 * My Catalog Export / catalog_est_fees_*.csv → Estimated Fees（优先 FBN）
 * 兼容列：estimated_fees_fbn / fbn_fee / fees_fbn / commission + outbound 分列
 */
export function parseCatalogEstimatedFees(
  content: string,
  format: "csv" | "json" | "auto" = "auto",
): CatalogFeeEstimateDto[] {
  const kind = detectFormat(content, format);
  const rows =
    kind === "json"
      ? extractArray(JSON.parse(stripBom(content))).map((r) => {
          const o = r as Record<string, unknown>;
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(o)) {
            out[k.toLowerCase()] = String(v ?? "");
          }
          return out;
        })
      : parseCsv(content);

  const ts = nowIso();
  const out: CatalogFeeEstimateDto[] = [];
  for (const row of rows) {
    const sku = pick(row, [
      "partner_sku",
      "psku_code",
      "psku",
      "seller_sku",
      "partner sku",
    ]).trim();
    if (!sku) continue;

    const commissionRate = parseRate(
      pick(row, [
        "commission_rate",
        "commission",
        "platform_commission",
        "estimated_commission",
      ]),
    );
    const outbound = Math.max(
      0,
      toNumber(
        pick(row, [
          "outbound_fee",
          "outbound",
          "fulfillment_fee",
          "fbn_outbound",
          "warehouse_fee",
        ]),
      ),
    );
    const fbnTotal = Math.max(
      0,
      toNumber(
        pick(row, [
          "estimated_fees_fbn",
          "estimated_fee_fbn",
          "estimated_fees",
          "fbn_fee",
          "fees_fbn",
          "fbn_estimated_fees",
          "estimated fees fbn",
          "estimated fees (fbn)",
        ]),
      ),
    );
    const fbpTotal = Math.max(
      0,
      toNumber(
        pick(row, [
          "estimated_fees_fbp",
          "estimated_fee_fbp",
          "fbp_fee",
          "fees_fbp",
          "estimated fees fbp",
          "estimated fees (fbp)",
        ]),
      ),
    );

    const estimatedFeeTotal = fbnTotal > 0 ? fbnTotal : fbpTotal;
    const fulfillment: "fbn" | "fbp" | "unknown" =
      fbnTotal > 0 ? "fbn" : fbpTotal > 0 ? "fbp" : "unknown";

    if (commissionRate <= 0 && outbound <= 0 && estimatedFeeTotal <= 0) continue;

    out.push({
      partner_sku: sku,
      commission_rate: commissionRate,
      outbound_fee: outbound,
      estimated_fee_total: estimatedFeeTotal,
      fulfillment,
      updated_at: pick(row, ["updated_at", "modified_at"]) || ts,
    });
  }
  return out;
}

/**
 * FBN Inventory Export / fbn_dims_*.csv → 尺寸重量
 * 兼容 Dimensions「L x W x H」单列或长/宽/高分列
 */
export function parseFbnDimsContent(
  content: string,
  format: "csv" | "json" | "auto" = "auto",
): FbnDimsDto[] {
  const kind = detectFormat(content, format);
  const rows =
    kind === "json"
      ? extractArray(JSON.parse(stripBom(content))).map((r) => {
          const o = r as Record<string, unknown>;
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(o)) {
            out[k.toLowerCase()] = String(v ?? "");
          }
          return out;
        })
      : parseCsv(content);

  const ts = nowIso();
  const map = new Map<string, FbnDimsDto>();
  for (const row of rows) {
    const sku = pick(row, [
      "partner_sku",
      "psku",
      "psku_code",
      "seller_sku",
      "sku",
      "pbarcode",
    ]).trim();
    if (!sku) continue;

    let lengthCm = toNumber(
      pick(row, ["length_cm", "length", "长", "length (cm)"]),
    );
    let widthCm = toNumber(pick(row, ["width_cm", "width", "宽", "width (cm)"]));
    let heightCm = toNumber(
      pick(row, ["height_cm", "height", "高", "height (cm)"]),
    );
    const dimRaw = pick(row, [
      "dimensions",
      "dimension",
      "size",
      "dims",
      "product_dimensions",
    ]);
    if ((lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) && dimRaw) {
      const trip = parseDimensionTriplet(dimRaw);
      if (trip) {
        lengthCm = lengthCm > 0 ? lengthCm : trip.lengthCm;
        widthCm = widthCm > 0 ? widthCm : trip.widthCm;
        heightCm = heightCm > 0 ? heightCm : trip.heightCm;
      }
    }
    const weightKg = toNumber(
      pick(row, ["weight_kg", "weight", "重量", "net_weight", "weight (kg)"]),
    );
    if (lengthCm <= 0 && widthCm <= 0 && heightCm <= 0 && weightKg <= 0) continue;

    map.set(sku, {
      partner_sku: sku,
      length_cm: lengthCm,
      width_cm: widthCm,
      height_cm: heightCm,
      weight_kg: weightKg,
      updated_at: pick(row, ["updated_at", "inventory_snapshot_at"]) || ts,
    });
  }
  return [...map.values()];
}

