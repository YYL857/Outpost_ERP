import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const outDir = "scripts/_out";
const deepLatest = JSON.parse(
  readFileSync(join(outDir, "amazon-sa-coffee-deep-latest.json"), "utf8"),
);
const deep = JSON.parse(readFileSync(deepLatest.outPath, "utf8"));
const round1 = JSON.parse(
  readFileSync(join(outDir, "amazon-sa-coffee-2026-09-23T05-47-25-733Z.json"), "utf8"),
);
const extra = JSON.parse(
  readFileSync(join(outDir, "amazon-sa-coffee-category-extra.json"), "utf8"),
);

function parseReviews(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  const m = String(raw).replace(/,/g, "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function normBrand(b, title) {
  const t = `${title || ""} ${b || ""}`;
  const map = [
    [/de.?longhi/i, "DeLonghi"],
    [/nespresso/i, "Nespresso"],
    [/philips/i, "Philips"],
    [/breville|\bsage\b/i, "Breville/Sage"],
    [/hibrew/i, "HiBREW"],
    [/doscher/i, "DOSCHER"],
    [/casabrews/i, "CASABREWS"],
    [/moulinex/i, "Moulinex"],
    [/krups/i, "Krups"],
    [/black\+?decker|black & decker/i, "Black+Decker"],
    [/arzum/i, "Arzum"],
    [/alsaif|al saif/i, "ALSAIF"],
    [/nikai/i, "Nikai"],
    [/bialetti/i, "Bialetti"],
    [/cafelffe/i, "Cafelffe"],
    [/ibsun/i, "ibsun"],
    [/xbloom/i, "xBloom"],
    [/mibru/i, "MIBRU"],
    [/gevi/i, "Gevi"],
    [/timemore/i, "Timemore"],
    [/wacaco/i, "Wacaco"],
    [/jura/i, "Jura"],
    [/gaggia/i, "Gaggia"],
    [/smeg/i, "Smeg"],
    [/tefal/i, "Tefal"],
    [/kenwood/i, "Kenwood"],
    [/bosch/i, "Bosch"],
    [/dolce\s*gusto/i, "Dolce Gusto"],
  ];
  for (const [re, name] of map) if (re.test(t)) return name;
  const brandLine = (b || "").replace(/Visit the |Brand: |Store/gi, "").trim();
  if (brandLine && brandLine.length < 40) {
    for (const [re, name] of map) if (re.test(brandLine)) return name;
    if (/^[A-Za-z][A-Za-z0-9 .+'&-]{1,30}$/.test(brandLine)) return brandLine.slice(0, 28);
  }
  return "other";
}

function segment(title) {
  const t = (title || "").toLowerCase();
  if (/descaler|tablet|filter paper|server|cup set|portafilter|tamper|pitcher/.test(t))
    return "accessory";
  if (/turkish|okka|جزوة/.test(t)) return "turkish";
  if (/grinder|burr|مطحنة/.test(t) && !/with grinder|built-?in grinder|bean to cup|magnifica|specialista/.test(t))
    return "grinder";
  if (/nespresso|capsule|pod|vertuo|essenza|inissia|dolce\s*gusto/.test(t)) return "capsule";
  if (/fully automatic|bean to cup|magnifica| LatteGo|lattego/i.test(t)) return "fully_auto";
  if (/espresso|semi.?auto|dedica|stilosa|portafilter|barista brew|pump espresso/.test(t))
    return "espresso_semi";
  if (/drip|filter coffee|coffee maker/.test(t)) return "drip";
  if (/with grinder|built-?in grinder|specialista/.test(t)) return "espresso_with_grinder";
  return "other_machine";
}

function tier(brand) {
  const big = new Set([
    "DeLonghi",
    "Nespresso",
    "Philips",
    "Breville/Sage",
    "Moulinex",
    "Krups",
    "Black+Decker",
    "Bialetti",
    "Jura",
    "Gaggia",
    "Smeg",
    "Tefal",
    "Kenwood",
    "Bosch",
    "Dolce Gusto",
  ]);
  const mid = new Set([
    "HiBREW",
    "DOSCHER",
    "Arzum",
    "ALSAIF",
    "Nikai",
    "Cafelffe",
    "ibsun",
    "xBloom",
    "CASABREWS",
    "Gevi",
    "Timemore",
    "Wacaco",
  ]);
  if (big.has(brand)) return "global_big";
  if (mid.has(brand)) return "challenger";
  return "small_white";
}

function bucket(p) {
  if (p == null) return "no_price";
  if (p < 150) return "0-149";
  if (p < 300) return "150-299";
  if (p < 500) return "300-499";
  if (p < 800) return "500-799";
  if (p < 1500) return "800-1499";
  return "1500+";
}

const listRows = [];
for (const pack of [round1, extra, deep]) {
  const pages = pack.pages || pack.listPages || [];
  const round =
    pack === deep ? "deep-2026-09-23b" : pack === extra ? "extra-2026-09-23a" : "round1-2026-09-23a";
  for (const page of pages) {
    for (const p of page.products || []) {
      listRows.push({
        ...p,
        sourcePage: page.id,
        sourceUrl: page.url || p.pageUrl,
        scrapeRound: round,
      });
    }
  }
}

const byAsin = new Map();
for (const p of listRows) {
  const prev = byAsin.get(p.asin);
  if (!prev) {
    byAsin.set(p.asin, {
      asin: p.asin,
      title: p.title,
      priceSar: p.priceSar,
      reviewsApprox: p.reviewsApprox ?? parseReviews(p.reviewsRaw),
      sponsored: !!p.sponsored,
      badge: p.badge || "",
      sources: [`${p.scrapeRound}/${p.sourcePage}`],
      url: p.url || `https://www.amazon.sa/dp/${p.asin}`,
    });
  } else {
    if (!prev.sources.includes(`${p.scrapeRound}/${p.sourcePage}`))
      prev.sources.push(`${p.scrapeRound}/${p.sourcePage}`);
    if (prev.priceSar == null && p.priceSar != null) prev.priceSar = p.priceSar;
    if ((p.reviewsApprox || 0) > (prev.reviewsApprox || 0))
      prev.reviewsApprox = p.reviewsApprox;
    if ((p.title || "").length > (prev.title || "").length) prev.title = p.title;
  }
}

// overlay PDP truth
const pdpByAsin = new Map();
for (const p of deep.pdps || []) {
  if (!p.ok) continue;
  pdpByAsin.set(p.asin, p);
  const row = byAsin.get(p.asin) || {
    asin: p.asin,
    title: p.title,
    sources: ["pdp"],
    url: p.url,
  };
  row.title = p.title || row.title;
  row.brandRaw = p.brand;
  row.priceSar = p.priceSar ?? row.priceSar;
  row.reviews = p.reviews ?? row.reviewsApprox;
  row.reviewsApprox = row.reviews ?? row.reviewsApprox;
  row.ratingText = p.ratingText;
  row.availability = p.availability;
  row.hasPdp = true;
  row.bullets = p.bullets;
  if (!row.sources.includes("pdp-deep")) row.sources.push("pdp-deep");
  byAsin.set(p.asin, row);
}

const uniq = [...byAsin.values()].map((p) => {
  const brand = normBrand(p.brandRaw, p.title);
  const seg = segment(p.title);
  return {
    ...p,
    brand,
    segment: seg,
    tier: tier(brand),
    priceBand: bucket(p.priceSar),
  };
});

const machines = uniq.filter((p) => p.segment !== "accessory");

function countBy(arr, key) {
  const m = new Map();
  for (const x of arr) m.set(x[key], (m.get(x[key]) || 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ key: k, n, share: +((n / arr.length) * 100).toFixed(1) }));
}

function median(nums) {
  const a = nums.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.floor(a.length / 2)];
}

const withPrice = machines.filter((p) => p.priceSar != null);
const prices = withPrice.map((p) => p.priceSar).sort((a, b) => a - b);

const bySeg = {};
for (const s of [
  "espresso_semi",
  "espresso_with_grinder",
  "fully_auto",
  "capsule",
  "grinder",
  "turkish",
  "drip",
  "other_machine",
  "accessory",
]) {
  const rows = uniq.filter((p) => p.segment === s);
  const wp = rows.filter((p) => p.priceSar != null);
  bySeg[s] = {
    n: rows.length,
    medianPrice: median(wp.map((p) => p.priceSar)),
    medianReviews: median(rows.map((p) => p.reviewsApprox).filter(Boolean)),
    brands: countBy(rows, "brand").slice(0, 8),
    tiers: countBy(rows, "tier"),
    topByReviews: [...rows]
      .sort((a, b) => (b.reviewsApprox || 0) - (a.reviewsApprox || 0))
      .slice(0, 8)
      .map((p) => ({
        asin: p.asin,
        brand: p.brand,
        title: (p.title || "").slice(0, 90),
        priceSar: p.priceSar,
        reviews: p.reviewsApprox,
        hasPdp: !!p.hasPdp,
        sources: p.sources.slice(0, 3),
      })),
  };
}

const pdpTable = (deep.pdps || [])
  .filter((p) => p.ok)
  .map((p) => ({
    asin: p.asin,
    brand: normBrand(p.brand, p.title),
    title: (p.title || p.listTitle || "").slice(0, 100),
    priceSar: p.priceSar,
    reviews: p.reviews,
    segment: segment(p.title || p.listTitle),
    tier: tier(normBrand(p.brand, p.title)),
    fromListSource: p.fromListSource,
    url: p.url,
  }))
  .sort((a, b) => (b.reviews || 0) - (a.reviews || 0));

// entry windows
const windows = {
  semiAutoSweet: machines.filter(
    (p) =>
      p.segment === "espresso_semi" &&
      p.priceSar >= 300 &&
      p.priceSar <= 850 &&
      !/cup|moka/i.test(p.title || ""),
  ),
  burrGrinder: machines.filter(
    (p) => p.segment === "grinder" && p.priceSar >= 150 && p.priceSar <= 600,
  ),
  turkishCore: machines.filter(
    (p) => p.segment === "turkish" && p.priceSar >= 100 && p.priceSar <= 450,
  ),
  capsuleWhite: machines.filter(
    (p) =>
      p.segment === "capsule" &&
      p.tier !== "global_big" &&
      p.priceSar != null &&
      p.priceSar <= 500,
  ),
};

const summary = {
  scrapedAt: deep.scrapedAt,
  market: "amazon.sa",
  audience: "Saudi Arabia",
  mode: "headed-playwright",
  coverage: {
    uniqueAsins: uniq.length,
    machines: machines.length,
    withPrice: withPrice.length,
    pdpVerified: pdpTable.length,
    listRowsRaw: listRows.length,
    rounds: [
      "round1: 6 searches + kitchen/home bestsellers",
      "extra: CTE cat p1-2 + turkish search",
      "deep: CTE cat p1-4 + 6 focused searches + 18 PDPs",
    ],
  },
  priceSar: {
    min: prices[0],
    median: median(prices),
    p75: prices[Math.floor(prices.length * 0.75)],
    max: prices[prices.length - 1],
  },
  overallBands: countBy(withPrice, "priceBand"),
  overallBrands: countBy(machines, "brand").slice(0, 12),
  overallTiers: countBy(machines, "tier"),
  bySeg,
  pdpTable,
  windows: {
    semiAutoSweet: windows.semiAutoSweet
      .sort((a, b) => a.priceSar - b.priceSar)
      .slice(0, 12)
      .map((p) => ({
        asin: p.asin,
        brand: p.brand,
        title: (p.title || "").slice(0, 80),
        priceSar: p.priceSar,
        reviews: p.reviewsApprox,
        tier: p.tier,
      })),
    burrGrinder: windows.burrGrinder
      .sort((a, b) => (b.reviewsApprox || 0) - (a.reviewsApprox || 0))
      .slice(0, 10)
      .map((p) => ({
        asin: p.asin,
        brand: p.brand,
        title: (p.title || "").slice(0, 80),
        priceSar: p.priceSar,
        reviews: p.reviewsApprox,
        tier: p.tier,
      })),
    turkishCore: windows.turkishCore
      .sort((a, b) => (b.reviewsApprox || 0) - (a.reviewsApprox || 0))
      .slice(0, 10)
      .map((p) => ({
        asin: p.asin,
        brand: p.brand,
        title: (p.title || "").slice(0, 80),
        priceSar: p.priceSar,
        reviews: p.reviewsApprox,
        tier: p.tier,
      })),
  },
  demandAnchors: pdpTable.slice(0, 12),
};

writeFileSync(
  join(outDir, "amazon-sa-coffee-entry-summary.json"),
  JSON.stringify(summary, null, 2),
);
console.log(
  JSON.stringify(
    {
      coverage: summary.coverage,
      priceSar: summary.priceSar,
      tiers: summary.overallTiers,
      brands: summary.overallBrands.slice(0, 8),
      seg: Object.fromEntries(
        Object.entries(bySeg).map(([k, v]) => [
          k,
          { n: v.n, medP: v.medianPrice, medR: v.medianReviews },
        ]),
      ),
      topPdp: pdpTable.slice(0, 10),
      sweet: summary.windows.semiAutoSweet.slice(0, 8),
      grind: summary.windows.burrGrinder.slice(0, 6),
      turkish: summary.windows.turkishCore.slice(0, 6),
    },
    null,
    2,
  ),
);
