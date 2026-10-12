import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const main = JSON.parse(
  readFileSync(
    "scripts/_out/amazon-sa-coffee-2026-09-23T05-47-25-733Z.json",
    "utf8",
  ),
);
const extra = JSON.parse(
  readFileSync("scripts/_out/amazon-sa-coffee-category-extra.json", "utf8"),
);

const products = [
  ...main.pages.flatMap((p) =>
    (p.products || []).map((x) => ({ ...x, pageId: p.id })),
  ),
  ...extra.pages.flatMap((p) =>
    (p.products || []).map((x) => ({ ...x, pageId: p.id })),
  ),
];

function normBrand(b, title) {
  const t = `${title || ""} ${b || ""}`;
  const map = [
    [/de.?longhi/i, "DeLonghi"],
    [/nespresso/i, "Nespresso"],
    [/philips/i, "Philips"],
    [/breville|sage\b/i, "Breville/Sage"],
    [/hibrew/i, "HiBREW"],
    [/casabrews/i, "CASABREWS"],
    [/geek\s*chef/i, "Geek Chef"],
    [/gevi/i, "Gevi"],
    [/krups/i, "Krups"],
    [/gaggia/i, "Gaggia"],
    [/moulinex/i, "Moulinex"],
    [/tefal/i, "Tefal"],
    [/kenwood/i, "Kenwood"],
    [/bosch/i, "Bosch"],
    [/smeg/i, "Smeg"],
    [/jura/i, "Jura"],
    [/baratza/i, "Baratza"],
    [/timemore/i, "Timemore"],
    [/wacaco/i, "Wacaco"],
    [/ariete/i, "Ariete"],
    [/cuisinart/i, "Cuisinart"],
    [/hamilton/i, "Hamilton Beach"],
    [/black\+?decker|black & decker/i, "Black+Decker"],
    [/instant\s*pot|instant\s*brand/i, "Instant"],
    [/doscher/i, "DOSCHER"],
    [/xiaomi/i, "Xiaomi"],
    [/eureka/i, "Eureka"],
    [/fellow/i, "Fellow"],
    [/hario/i, "Hario"],
    [/bodum/i, "Bodum"],
    [/melitta/i, "Melitta"],
    [/kitchenaid/i, "KitchenAid"],
    [/lavazza/i, "Lavazza"],
    [/saeco/i, "Saeco"],
    [/rancilio/i, "Rancilio"],
    [/flair/i, "Flair"],
    [/bialetti/i, "Bialetti"],
    [/alsaif|al saif/i, "ALSAIF"],
    [/arzum/i, "Arzum"],
    [/nikai/i, "Nikai"],
    [/mibru/i, "MIBRU"],
    [/paracity/i, "ParaCity"],
    [/cafelffe|cafelife|caf[eé]/i, "Cafe-white"],
    [/ibsun/i, "ibsun"],
    [/xbloom/i, "xBloom"],
    [/waraf/i, "WARAF"],
    [/biki/i, "Biki"],
    [/electric\s+coffee/i, "generic-title"],
  ];
  for (const [re, name] of map) if (re.test(t)) return name;
  const first = (b || "unknown").trim();
  if (/^(Electric|Professional|Mini|Al|The)$/i.test(first)) return "generic-title";
  return first.slice(0, 28) || "unknown";
}

function bucket(p) {
  if (p == null) return "no_price";
  if (p < 100) return "0-99";
  if (p < 200) return "100-199";
  if (p < 350) return "200-349";
  if (p < 500) return "350-499";
  if (p < 800) return "500-799";
  if (p < 1200) return "800-1199";
  if (p < 2000) return "1200-1999";
  return "2000+";
}

function segment(title, pageId) {
  const t = `${title || ""}`.toLowerCase();
  const pid = pageId || "";
  if (/turkish|okka|جزوة|قهوة ترك/i.test(t) || /turkish/.test(pid))
    return "turkish";
  if (/grinder|burr|مطحنة/.test(t) || /grinder/.test(pid)) return "grinder";
  if (
    /nespresso|capsule|pod|vertuo|kapsel/.test(t) ||
    /nespresso|capsule/.test(pid)
  )
    return "capsule";
  if (
    /espresso|semi.?auto|barista|portafilter|dedica|stilosa|اسبرسو/.test(t) ||
    /espresso/.test(pid)
  )
    return "espresso";
  if (/drip|filter|brew|pour.?over|french press|v60|server|paper filter/.test(t))
    return "drip_filter_accessory";
  return "other_machine";
}

const big = new Set([
  "DeLonghi",
  "Nespresso",
  "Philips",
  "Breville/Sage",
  "Krups",
  "Gaggia",
  "Moulinex",
  "Tefal",
  "Kenwood",
  "Bosch",
  "Smeg",
  "Jura",
  "Lavazza",
  "Saeco",
  "Cuisinart",
  "KitchenAid",
  "Melitta",
  "Black+Decker",
  "Hamilton Beach",
  "Instant",
  "Bialetti",
]);
const challenger = new Set([
  "HiBREW",
  "CASABREWS",
  "Geek Chef",
  "Gevi",
  "Ariete",
  "Wacaco",
  "Timemore",
  "Baratza",
  "Fellow",
  "Xiaomi",
  "DOSCHER",
  "Flair",
  "Eureka",
  "Hario",
  "xBloom",
  "Arzum",
  "ALSAIF",
  "Nikai",
]);

function tier(b) {
  if (big.has(b)) return "global_big";
  if (challenger.has(b)) return "challenger_local";
  if (b === "generic-title" || b === "unknown") return "unparsed";
  return "small_whiteish";
}

const byAsin = new Map();
for (const p of products) {
  if (!byAsin.has(p.asin)) {
    byAsin.set(p.asin, { ...p, pages: [p.pageId] });
  } else {
    const prev = byAsin.get(p.asin);
    if (!prev.pages.includes(p.pageId)) prev.pages.push(p.pageId);
    if (prev.priceSar == null && p.priceSar != null) prev.priceSar = p.priceSar;
  }
}

const uniq = [...byAsin.values()].map((p) => {
  const brandN = normBrand(p.brand, p.title);
  return {
    asin: p.asin,
    title: p.title,
    priceSar: p.priceSar,
    brand: brandN,
    segment: segment(p.title, p.pageId),
    tier: tier(brandN),
    priceBand: bucket(p.priceSar),
    sponsored: !!p.sponsored,
    badge: p.badge || "",
    pages: p.pages,
    url: p.url || `https://www.amazon.sa/dp/${p.asin}`,
  };
});

function countBy(arr, key) {
  const m = new Map();
  for (const x of arr) m.set(x[key], (m.get(x[key]) || 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({
      key: k,
      n,
      share: +((n / arr.length) * 100).toFixed(1),
    }));
}

const withPrice = uniq.filter((p) => p.priceSar != null);
const prices = withPrice.map((p) => p.priceSar).sort((a, b) => a - b);
const pct = (q) =>
  prices.length
    ? prices[Math.min(prices.length - 1, Math.floor((prices.length - 1) * q))]
    : null;

const machines = uniq.filter(
  (p) =>
    !/server|paper filter|cups? set|ring espresso cups|filter cone/i.test(
      p.title || "",
    ),
);

const bySeg = {};
for (const s of [
  "espresso",
  "capsule",
  "grinder",
  "turkish",
  "drip_filter_accessory",
  "other_machine",
]) {
  const rows = uniq.filter((p) => p.segment === s);
  const wp = rows.filter((p) => p.priceSar != null);
  const ps = wp.map((p) => p.priceSar).sort((a, b) => a - b);
  bySeg[s] = {
    n: rows.length,
    withPrice: wp.length,
    median: ps.length ? ps[Math.floor(ps.length / 2)] : null,
    p25: ps.length ? ps[Math.floor(ps.length * 0.25)] : null,
    p75: ps.length ? ps[Math.floor(ps.length * 0.75)] : null,
    min: ps[0] ?? null,
    max: ps[ps.length - 1] ?? null,
    brands: countBy(rows, "brand").slice(0, 10),
    tiers: countBy(rows, "tier"),
    bands: countBy(
      wp.map((p) => ({ priceBand: p.priceBand })),
      "priceBand",
    ),
    top: rows.slice(0, 15).map((p) => ({
      asin: p.asin,
      brand: p.brand,
      title: (p.title || "").slice(0, 100),
      priceSar: p.priceSar,
      tier: p.tier,
      sponsored: p.sponsored,
      badge: p.badge,
    })),
  };
}

// espresso sweet-spot shortlist: 200-900 SAR semi-auto / pump, not accessory
const espressoSweet = uniq
  .filter(
    (p) =>
      p.segment === "espresso" &&
      p.priceSar != null &&
      p.priceSar >= 200 &&
      p.priceSar <= 900 &&
      !/cup|moka express|turkish/i.test(p.title || ""),
  )
  .sort((a, b) => a.priceSar - b.priceSar);

const summary = {
  scrapedAt: main.scrapedAt,
  market: "amazon.sa",
  mode: "headed-playwright",
  sources: [
    ...main.pages.map((p) => ({ id: p.id, n: (p.products || []).length })),
    ...extra.pages.map((p) => ({ id: p.id, n: (p.products || []).length })),
  ],
  uniqueAsins: uniq.length,
  machineLike: machines.length,
  withPrice: withPrice.length,
  priceSar: {
    min: prices[0],
    p25: pct(0.25),
    median: pct(0.5),
    p75: pct(0.75),
    max: prices[prices.length - 1],
  },
  overallBands: countBy(withPrice, "priceBand"),
  overallBrands: countBy(uniq, "brand").slice(0, 15),
  overallTiers: countBy(uniq, "tier"),
  machineTiers: countBy(machines, "tier"),
  bySeg,
  espressoSweet: espressoSweet.slice(0, 20).map((p) => ({
    asin: p.asin,
    brand: p.brand,
    title: (p.title || "").slice(0, 110),
    priceSar: p.priceSar,
    tier: p.tier,
  })),
  sponsoredShare: +((uniq.filter((p) => p.sponsored).length / uniq.length) * 100).toFixed(1),
  notes: [
    "Kitchen/Home bestsellers 总榜几乎无咖啡机；热度以搜索 popularity + Coffee/Tea/Espresso 类目为准",
    "当日有 National Day Deal 角标，价位可能偏低",
    "无独立 Sold Recently；Amazon 用 Best Seller / 评价量代理热度",
  ],
};

writeFileSync(
  "scripts/_out/amazon-sa-coffee-summary-merged.json",
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
