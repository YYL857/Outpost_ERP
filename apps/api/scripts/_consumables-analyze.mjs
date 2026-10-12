/**
 * Analyze Amazon.sa (+ optional Noon) consumables for easy-money SKUs.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const outDir = "scripts/_out";
const amzPath = JSON.parse(
  readFileSync(join(outDir, "amazon-sa-consumables-latest.json"), "utf8"),
).outPath;
const amz = JSON.parse(readFileSync(amzPath, "utf8"));

let noon = null;
const noonLatest = join(outDir, "noon-sa-consumables-latest.json");
if (existsSync(noonLatest)) {
  try {
    const p = JSON.parse(readFileSync(noonLatest, "utf8")).outPath;
    if (p && existsSync(p)) noon = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    /* ignore */
  }
}

function bucket(p) {
  if (p == null) return "no_price";
  if (p < 20) return "0-19";
  if (p < 40) return "20-39";
  if (p < 80) return "40-79";
  if (p < 150) return "80-149";
  return "150+";
}

function classify(title, source) {
  const t = `${title || ""} ${source || ""}`.toLowerCase();
  if (/descaler|descale|除垢/.test(t)) return "coffee_descaler";
  if (/coffee\s*filter|v60|paper filter|cone filter/.test(t)) return "coffee_filters";
  if (/capsule|nespresso|dolce\s*gusto|coffee\s*pod/.test(t)) return "coffee_capsules";
  if (/garbage|trash\s*bag|bin\s*liner|refuse\s*bag|rubbish/.test(t))
    return "garbage_bags";
  if (/aluminum\s*foil|aluminium\s*foil|foil\s*roll/.test(t)) return "aluminum_foil";
  if (/cling\s*film|plastic\s*wrap|食品保鲜膜|saran/.test(t)) return "cling_film";
  if (/ziplock|zip\s*lock|freezer\s*bag|storage\s*bag|food\s*bag/.test(t))
    return "food_bags";
  if (/baby\s*wipe/.test(t)) return "baby_wipes";
  if (/wet\s*wipe|disinfectant\s*wipe|cleaning\s*wipe/.test(t)) return "wet_wipes";
  if (/paper\s*towel|kitchen\s*towel|kitchen\s*roll/.test(t)) return "paper_towels";
  if (/laundry|detergent\s*pod|washing\s*capsule|tide\s*pod|ariel\s*pod/.test(t))
    return "laundry_pods";
  if (/cotton\s*pad|makeup\s*remover\s*pad|facial\s*pad/.test(t)) return "cotton_pads";
  if (/vacuum\s*bag|compression\s*bag|space\s*bag/.test(t)) return "vacuum_bags";
  if (/wipe/.test(t)) return "wet_wipes";
  return "other";
}

function brandGuess(title) {
  const t = title || "";
  const known = [
    "Glad",
    "Hefty",
    "Reynolds",
    "Kirkland",
    "Pampers",
    "Huggies",
    "WaterWipes",
    "Cottonelle",
    "Bounty",
    "Viva",
    "Tide",
    "Ariel",
    "Persil",
    "Fairy",
    "Finish",
    "Nespresso",
    "Lavazza",
    "Starbucks",
    "L'OR",
    "MIBRU",
    "WARAF",
    "Ziploc",
    "Scotch",
    "3M",
    "Dettol",
    "Clorox",
    "Mr Muscle",
    "Alufix",
    "Sanita",
    "Lulu",
    "Pinar",
    "Fine",
    "LuLu",
  ];
  for (const b of known) {
    if (t.toLowerCase().includes(b.toLowerCase())) return b;
  }
  const first = t.trim().split(/\s+/)[0] || "other";
  if (/^[A-Za-z][A-Za-z0-9.&+]{1,}$/.test(first)) return first.slice(0, 20);
  return "other/white";
}

function isConsumableish(seg) {
  return seg !== "other";
}

function moneyScore(seg, stats) {
  // Heuristic scoring for "easy money" for new Noon consumables shop
  // Factors: repurchase, light ship, white-label room, not brand-locked, ASP workable
  const profile = {
    garbage_bags: { repurchase: 5, light: 4, whiteRoom: 5, brandLock: 2, note: "刚需复购，白牌密，重量体积要控" },
    aluminum_foil: { repurchase: 5, light: 4, whiteRoom: 4, brandLock: 2, note: "厨房刚需，规格战" },
    cling_film: { repurchase: 5, light: 5, whiteRoom: 5, brandLock: 2, note: "轻、便宜、易铺" },
    food_bags: { repurchase: 5, light: 5, whiteRoom: 5, brandLock: 2, note: "密封袋易白牌" },
    wet_wipes: { repurchase: 5, light: 3, whiteRoom: 3, brandLock: 3, note: "需求大但大牌+液体物流" },
    baby_wipes: { repurchase: 5, light: 3, whiteRoom: 2, brandLock: 4, note: "Pampers等心智强" },
    paper_towels: { repurchase: 5, light: 2, whiteRoom: 3, brandLock: 3, note: "体积大，运费伤" },
    laundry_pods: { repurchase: 5, light: 3, whiteRoom: 2, brandLock: 5, note: "Ariel/Tide锁客，合规重" },
    coffee_filters: { repurchase: 4, light: 5, whiteRoom: 5, brandLock: 2, note: "轻、可贴咖啡机供应链" },
    coffee_capsules: { repurchase: 5, light: 4, whiteRoom: 2, brandLock: 5, note: "生态锁，兼容机才有戏" },
    coffee_descaler: { repurchase: 4, light: 5, whiteRoom: 5, brandLock: 2, note: "高毛利附件，跟机卖" },
    cotton_pads: { repurchase: 5, light: 5, whiteRoom: 5, brandLock: 2, note: "轻、复购、易白牌" },
    vacuum_bags: { repurchase: 3, light: 4, whiteRoom: 4, brandLock: 2, note: "偏季节/搬家，复购弱于日耗" },
    other: { repurchase: 1, light: 1, whiteRoom: 1, brandLock: 3, note: "噪声" },
  };
  const p = profile[seg] || profile.other;
  // higher brandLock hurts
  const score =
    p.repurchase * 2 +
    p.light * 1.5 +
    p.whiteRoom * 2 +
    (6 - p.brandLock) * 1.5 +
    Math.min(3, (stats.n || 0) / 15) +
    (stats.medianPrice != null && stats.medianPrice >= 15 && stats.medianPrice <= 80
      ? 2
      : 0);
  return { score: +score.toFixed(1), ...p };
}

const rows = [];
for (const page of amz.pages || []) {
  for (const p of page.products || []) {
    const seg = classify(p.title, page.id);
    rows.push({
      ...p,
      segment: seg,
      brand: brandGuess(p.title),
      priceBand: bucket(p.priceSar),
      channel: "amazon.sa",
      sourcePage: page.id,
    });
  }
}

const byAsin = new Map();
for (const r of rows) {
  if (!byAsin.has(r.asin)) byAsin.set(r.asin, { ...r, sources: [r.sourcePage] });
  else {
    const prev = byAsin.get(r.asin);
    if (!prev.sources.includes(r.sourcePage)) prev.sources.push(r.sourcePage);
    if (prev.priceSar == null && r.priceSar != null) prev.priceSar = r.priceSar;
    if ((r.reviewsApprox || 0) > (prev.reviewsApprox || 0))
      prev.reviewsApprox = r.reviewsApprox;
  }
}
const uniq = [...byAsin.values()];
const consumables = uniq.filter((p) => isConsumableish(p.segment));

function median(xs) {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.floor(a.length / 2)];
}
function countBy(arr, key) {
  const m = new Map();
  for (const x of arr) m.set(x[key], (m.get(x[key]) || 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ key: k, n, share: +((n / arr.length) * 100).toFixed(1) }));
}

const bySeg = {};
for (const seg of [
  "garbage_bags",
  "aluminum_foil",
  "cling_film",
  "food_bags",
  "wet_wipes",
  "baby_wipes",
  "paper_towels",
  "laundry_pods",
  "coffee_filters",
  "coffee_capsules",
  "coffee_descaler",
  "cotton_pads",
  "vacuum_bags",
]) {
  const list = consumables.filter((p) => p.segment === seg);
  const wp = list.filter((p) => p.priceSar != null);
  const brands = countBy(list, "brand").slice(0, 8);
  const whiteish = list.filter(
    (p) =>
      p.brand === "other/white" ||
      !/Glad|Hefty|Reynolds|Pampers|Huggies|Tide|Ariel|Nespresso|Starbucks|Dettol|Clorox|Bounty|Ziploc|Persil|Fairy|Lavazza|Kirkland/i.test(
        p.brand,
      ),
  ).length;
  const stats = {
    n: list.length,
    withPrice: wp.length,
    medianPrice: median(wp.map((p) => p.priceSar)),
    p25: median(wp.map((p) => p.priceSar).sort((a,b)=>a-b).slice(0, Math.ceil(wp.length/2))),
    min: wp.length ? Math.min(...wp.map((p) => p.priceSar)) : null,
    max: wp.length ? Math.max(...wp.map((p) => p.priceSar)) : null,
    medianReviews: median(list.map((p) => p.reviewsApprox).filter(Boolean)),
    brands,
    whiteShare: list.length ? +((whiteish / list.length) * 100).toFixed(1) : 0,
    top: [...list]
      .sort(
        (a, b) =>
          (b.reviewsApprox || 0) - (a.reviewsApprox || 0) ||
          (a.rankOnPage || 99) - (b.rankOnPage || 99),
      )
      .slice(0, 8)
      .map((p) => ({
        asin: p.asin,
        brand: p.brand,
        title: (p.title || "").slice(0, 90),
        priceSar: p.priceSar,
        reviews: p.reviewsApprox,
        sources: p.sources?.slice(0, 2),
      })),
  };
  const money = moneyScore(seg, stats);
  bySeg[seg] = { ...stats, money };
}

// Noon overlay if any
let noonBySeg = {};
if (noon) {
  const nRows = [];
  for (const page of noon.pages || []) {
    for (const p of page.products || []) {
      const seg = classify(p.title || p.text, page.id);
      nRows.push({ ...p, segment: seg, channel: "noon.sa", sourcePage: page.id });
    }
  }
  for (const seg of Object.keys(bySeg)) {
    const list = nRows.filter((p) => p.segment === seg);
    noonBySeg[seg] = {
      n: list.length,
      medianPrice: median(list.map((p) => p.priceSar)),
      medianSold: median(list.map((p) => p.soldRecently).filter(Boolean)),
      withSold: list.filter((p) => p.soldRecently != null).length,
      top: list
        .filter((p) => p.soldRecently != null)
        .sort((a, b) => (b.soldRecently || 0) - (a.soldRecently || 0))
        .slice(0, 5)
        .map((p) => ({
          title: (p.title || "").slice(0, 80),
          priceSar: p.priceSar,
          soldRecently: p.soldRecently,
        })),
    };
  }
}

const ranked = Object.entries(bySeg)
  .map(([seg, v]) => ({
    seg,
    score: v.money.score,
    n: v.n,
    medianPrice: v.medianPrice,
    whiteShare: v.whiteShare,
    note: v.money.note,
    repurchase: v.money.repurchase,
    light: v.money.light,
    whiteRoom: v.money.whiteRoom,
    brandLock: v.money.brandLock,
    noon: noonBySeg[seg] || null,
  }))
  .sort((a, b) => b.score - a.score);

const summary = {
  scrapedAt: amz.scrapedAt,
  amazon: {
    unique: uniq.length,
    consumables: consumables.length,
    pages: (amz.pages || []).map((p) => ({ id: p.id, n: p.n })),
  },
  noon: noon
    ? {
        scrapedAt: noon.scrapedAt,
        pages: (noon.pages || []).map((p) => ({
          id: p.id,
          n: p.n,
          ok: p.ok,
          err: p.error,
        })),
        total: (noon.pages || []).reduce((a, p) => a + (p.n || 0), 0),
      }
    : null,
  bySeg,
  ranked,
  pickEasyMoney: ranked.filter((r) => r.score >= 18).slice(0, 6),
  avoid: ranked.filter((r) => r.brandLock >= 4 || r.score < 14).slice(0, 6),
};

writeFileSync(
  join(outDir, "consumables-sa-summary.json"),
  JSON.stringify(summary, null, 2),
);
console.log(
  JSON.stringify(
    {
      amazonN: summary.amazon.consumables,
      noon: summary.noon,
      ranked: summary.ranked.map((r) => ({
        seg: r.seg,
        score: r.score,
        n: r.n,
        medP: r.medianPrice,
        white: r.whiteShare,
        noonSoldMed: r.noon?.medianSold,
        note: r.note,
      })),
    },
    null,
    2,
  ),
);
