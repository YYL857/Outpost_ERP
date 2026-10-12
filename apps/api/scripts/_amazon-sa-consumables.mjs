/**
 * Amazon.sa consumables probe — headed, Saudi market.
 * One-shot for Noon SA consumables store entry judgment.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "_out");
mkdirSync(outDir, { recursive: true });

const TARGETS = [
  // Bestsellers hubs (consumable-heavy)
  { id: "bs-grocery", url: "https://www.amazon.sa/gp/bestsellers/grocery/" },
  { id: "bs-kitchen", url: "https://www.amazon.sa/gp/bestsellers/kitchen/" },
  { id: "bs-hpc", url: "https://www.amazon.sa/gp/bestsellers/hpc/" },
  { id: "bs-home", url: "https://www.amazon.sa/gp/bestsellers/home/" },
  // Focused searches — repurchase / light / FBN-friendly
  {
    id: "s-garbage-bags",
    url: "https://www.amazon.sa/s?k=garbage+bags&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "s-trash-bags",
    url: "https://www.amazon.sa/s?k=trash+bags&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "s-aluminum-foil",
    url: "https://www.amazon.sa/s?k=aluminum+foil&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "s-cling-film",
    url: "https://www.amazon.sa/s?k=cling+film&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "s-ziplock",
    url: "https://www.amazon.sa/s?k=ziplock+bags&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "s-wet-wipes",
    url: "https://www.amazon.sa/s?k=wet+wipes&i=hpc&s=exact-aware-popularity-rank",
  },
  {
    id: "s-baby-wipes",
    url: "https://www.amazon.sa/s?k=baby+wipes&i=baby&s=exact-aware-popularity-rank",
  },
  {
    id: "s-paper-towels",
    url: "https://www.amazon.sa/s?k=paper+towels&i=grocery&s=exact-aware-popularity-rank",
  },
  {
    id: "s-laundry-pods",
    url: "https://www.amazon.sa/s?k=laundry+detergent+pods&i=hpc&s=exact-aware-popularity-rank",
  },
  {
    id: "s-coffee-filters",
    url: "https://www.amazon.sa/s?k=coffee+filters+v60&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "s-coffee-capsules",
    url: "https://www.amazon.sa/s?k=coffee+capsules&i=grocery&s=exact-aware-popularity-rank",
  },
  {
    id: "s-descaler",
    url: "https://www.amazon.sa/s?k=coffee+machine+descaler&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "s-vacuum-bags",
    url: "https://www.amazon.sa/s?k=vacuum+storage+bags&i=home&s=exact-aware-popularity-rank",
  },
  {
    id: "s-cotton-pads",
    url: "https://www.amazon.sa/s?k=cotton+pads&i=hpc&s=exact-aware-popularity-rank",
  },
];

function parsePrice(raw) {
  const m = String(raw || "")
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function parseReviews(raw) {
  if (!raw) return null;
  const m = String(raw).replace(/,/g, "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

async function dismissNoise(page) {
  for (const sel of ["#sp-cc-accept", "input[name='accept']"]) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 700 });
    } catch {
      /* ignore */
    }
  }
}

async function extractSearch(page) {
  return page.evaluate(() => {
    const cards = [];
    for (const n of document.querySelectorAll(
      'div[data-component-type="s-search-result"][data-asin]',
    )) {
      const asin = n.getAttribute("data-asin") || "";
      if (!asin) continue;
      const title = (n.querySelector("h2 a span, h2 span")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const priceRaw =
        n.querySelector(".a-price .a-offscreen")?.textContent?.trim() || "";
      const ratingText =
        n.querySelector("i.a-icon-star-small span, i.a-icon-star span")
          ?.textContent?.trim() || "";
      let reviewsRaw = "";
      const rev = n.querySelector(
        "span[aria-label*='rating'], a[href*='customerReviews'] span",
      );
      if (rev) reviewsRaw = rev.getAttribute("aria-label") || rev.textContent || "";
      const badge = n.querySelector(".a-badge-text")?.textContent?.trim() || "";
      const sponsored = !!n.querySelector(".puis-sponsored-label-text");
      cards.push({
        asin,
        title,
        priceRaw,
        ratingText,
        reviewsRaw,
        badge,
        sponsored,
        url: n.querySelector("h2 a")?.href || "",
      });
    }
    return cards;
  });
}

async function extractBestsellers(page) {
  return page.evaluate(() => {
    const cards = [];
    let rank = 0;
    for (const n of document.querySelectorAll("[data-asin]")) {
      const asin = n.getAttribute("data-asin") || "";
      if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
      const img = n.querySelector("img[alt]");
      const title = (
        n.querySelector(
          ".p13n-sc-truncate-desktop-type2, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1",
        )?.textContent ||
        img?.getAttribute("alt") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
      if (!title) continue;
      const priceRaw =
        n
          .querySelector(".a-price .a-offscreen, ._cDEzb_p13n-sc-price_3mG9Z")
          ?.textContent?.trim() || "";
      const ratingText =
        n.querySelector("i span.a-icon-alt")?.textContent?.trim() || "";
      rank += 1;
      cards.push({
        asin,
        rank,
        title,
        priceRaw,
        ratingText,
        reviewsRaw: "",
        badge: "",
        sponsored: false,
        url: `https://www.amazon.sa/dp/${asin}`,
      });
    }
    const seen = new Set();
    return cards.filter((c) => {
      if (seen.has(c.asin)) return false;
      seen.add(c.asin);
      return true;
    });
  });
}

const browser = await chromium.launch({
  headless: false,
  slowMo: 60,
  args: ["--disable-blink-features=AutomationControlled", "--start-maximized"],
});
const context = await browser.newContext({
  locale: "en-SA",
  viewport: null,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});

const page = await context.newPage();
await page.goto("https://www.amazon.sa/-/en/", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(1800);
await dismissNoise(page);

const pagesOut = [];
for (const t of TARGETS) {
  const entry = { id: t.id, url: t.url, ok: false, products: [], error: null };
  try {
    await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2200);
    await dismissNoise(page);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 1100);
      await page.waitForTimeout(300);
    }
    entry.title = await page.title();
    const isBs = t.id.startsWith("bs-");
    const cards = isBs ? await extractBestsellers(page) : await extractSearch(page);
    entry.products = cards.map((c, idx) => ({
      ...c,
      rankOnPage: c.rank || idx + 1,
      priceSar: parsePrice(c.priceRaw),
      reviewsApprox: parseReviews(c.reviewsRaw),
      source: t.id,
    }));
    entry.ok = true;
    entry.n = entry.products.length;
  } catch (e) {
    entry.error = String(e?.message || e);
  }
  pagesOut.push(entry);
  console.error(
    JSON.stringify({ id: entry.id, n: entry.n, ok: entry.ok, err: entry.error }),
  );
}

await browser.close();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = join(outDir, `amazon-sa-consumables-${stamp}.json`);
writeFileSync(
  outPath,
  JSON.stringify(
    {
      scrapedAt: new Date().toISOString(),
      market: "amazon.sa",
      topic: "consumables-sa",
      mode: "headed",
      pages: pagesOut,
    },
    null,
    2,
  ),
);
writeFileSync(
  join(outDir, "amazon-sa-consumables-latest.json"),
  JSON.stringify({ outPath, scrapedAt: new Date().toISOString() }, null, 2),
);
console.log(
  JSON.stringify(
    {
      outPath,
      pages: pagesOut.map((p) => ({ id: p.id, n: p.n, ok: p.ok })),
      total: pagesOut.reduce((a, p) => a + (p.n || 0), 0),
    },
    null,
    2,
  ),
);
