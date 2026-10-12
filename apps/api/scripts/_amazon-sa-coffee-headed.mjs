/**
 * Amazon.sa coffee category probe — headed Chromium, one-shot.
 * Outputs JSON under scripts/_out/
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "_out");
mkdirSync(outDir, { recursive: true });

const TARGETS = [
  {
    id: "search-coffee-maker",
    url: "https://www.amazon.sa/s?k=coffee+maker&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "search-espresso-machine",
    url: "https://www.amazon.sa/s?k=espresso+machine&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "search-semi-auto-espresso",
    url: "https://www.amazon.sa/s?k=semi+automatic+espresso&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "search-coffee-grinder",
    url: "https://www.amazon.sa/s?k=coffee+grinder&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "search-burr-grinder",
    url: "https://www.amazon.sa/s?k=burr+coffee+grinder&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "search-capsule-nespresso",
    url: "https://www.amazon.sa/s?k=nespresso+machine&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "bestsellers-kitchen",
    url: "https://www.amazon.sa/gp/bestsellers/kitchen/",
  },
  {
    id: "bestsellers-home",
    url: "https://www.amazon.sa/gp/bestsellers/home/",
  },
];

const COFFEE_RE =
  /coffee|espresso|nespresso|cappuccino|latte|grinder|brew|كوفي|قهوة|اسبرسو|مطحنة|ماكينة/i;

async function dismissNoise(page) {
  for (const sel of [
    "#sp-cc-accept",
    "input[name='accept']",
    "#a-autoid-0-announce",
    "[data-action='a-popover-close']",
  ]) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 800 })) await el.click({ timeout: 1000 });
    } catch {
      /* ignore */
    }
  }
}

async function extractSearchCards(page) {
  return page.evaluate(() => {
    const cards = [];
    const nodes = document.querySelectorAll(
      'div[data-component-type="s-search-result"][data-asin]',
    );
    for (const n of nodes) {
      const asin = n.getAttribute("data-asin") || "";
      if (!asin || asin.length < 8) continue;
      const titleEl =
        n.querySelector("h2 a span") ||
        n.querySelector("h2 span") ||
        n.querySelector("h2");
      const title = (titleEl?.textContent || "").replace(/\s+/g, " ").trim();
      const priceWhole = n.querySelector(".a-price .a-offscreen")?.textContent?.trim() || "";
      const rating =
        n.querySelector("i.a-icon-star-small span, i.a-icon-star span")?.textContent?.trim() ||
        n.querySelector("[aria-label*='out of 5']")?.getAttribute("aria-label") ||
        "";
      const reviews =
        n.querySelector("span[aria-label$='ratings'], span[aria-label$='rating']")?.getAttribute(
          "aria-label",
        ) ||
        n.querySelector("a[href*='customerReviews'] span")?.textContent?.trim() ||
        "";
      const badge =
        n.querySelector(".a-badge-text")?.textContent?.trim() ||
        n.querySelector(".puis-label-popover-default span")?.textContent?.trim() ||
        "";
      const sponsored = !!n.querySelector(
        ".puis-sponsored-label-text, .s-label-popover-default .a-color-secondary",
      );
      const url = n.querySelector("h2 a")?.href || "";
      cards.push({ asin, title, priceRaw: priceWhole, rating, reviews, badge, sponsored, url });
    }
    return cards;
  });
}

async function extractBestSellerCards(page) {
  return page.evaluate(() => {
    const cards = [];
    const nodes = document.querySelectorAll("[data-asin]");
    let rank = 0;
    for (const n of nodes) {
      const asin = n.getAttribute("data-asin") || "";
      if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) continue;
      const titleEl =
        n.querySelector(".p13n-sc-truncate-desktop-type2, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1, a span div") ||
        n.querySelector("a[href*='/dp/'] span") ||
        n.querySelector("img[alt]");
      let title = "";
      if (titleEl?.tagName === "IMG") title = titleEl.getAttribute("alt") || "";
      else title = (titleEl?.textContent || titleEl?.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
      if (!title) {
        const img = n.querySelector("img[alt]");
        title = img?.getAttribute("alt") || "";
      }
      const priceRaw =
        n.querySelector(".a-price .a-offscreen, ._cDEzb_p13n-sc-price_3mG9Z")?.textContent?.trim() ||
        "";
      const rating =
        n.querySelector("i span.a-icon-alt, [aria-label*='out of 5']")?.textContent?.trim() ||
        n.querySelector("[aria-label*='out of 5']")?.getAttribute("aria-label") ||
        "";
      rank += 1;
      cards.push({
        asin,
        rank,
        title,
        priceRaw,
        rating,
        url: `https://www.amazon.sa/dp/${asin}`,
      });
    }
    // dedupe by asin keeping first (best rank)
    const seen = new Set();
    return cards.filter((c) => {
      if (seen.has(c.asin)) return false;
      seen.add(c.asin);
      return true;
    });
  });
}

function parsePriceSar(raw) {
  if (!raw) return null;
  const m = String(raw).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function brandGuess(title) {
  if (!title) return "unknown";
  const t = title.trim();
  // common patterns: "Brand Name ..." or Arabic then Brand
  const first = t.split(/[\s,|\-–—:/]+/)[0] || "unknown";
  const known = [
    "DeLonghi",
    "De'Longhi",
    "Nespresso",
    "Philips",
    "Breville",
    "Sage",
    "Krups",
    "Bosch",
    "Siemens",
    "Gaggia",
    "Saeco",
    "Lavazza",
    "HiBREW",
    "Gevi",
    "CASABREWS",
    "Geek Chef",
    "Moccamaster",
    "Cuisinart",
    "Oster",
    "Black+",
    "Hamilton",
    "Sunshine",
    "Ariete",
    "Klarstein",
    "Kenwood",
    "Moulinex",
    "Tefal",
    "Baratza",
    "Fellow",
    "DF64",
    "Timemore",
    "Xiaomi",
    "Dreo",
    "COSORI",
    "Instant",
    "Keurig",
    "Smeg",
    "KitchenAid",
    "Melitta",
    "Jura",
    "Wacaco",
    "Flair",
    "Capresso",
    "Bodum",
    "Hario",
    "Wilfa",
    "Niche",
    "Eureka",
    "Rancilio",
    "Profitec",
    "Lelit",
    "Ascaso",
    "Rocket",
    "DOSCHER",
    "Hibrew",
    "HIBREW",
  ];
  for (const b of known) {
    if (t.toLowerCase().includes(b.toLowerCase())) return b.replace(/HIBREW/i, "HiBREW");
  }
  if (/^[A-Za-z0-9'&.+]+$/.test(first) && first.length >= 2) return first;
  // try second token if first is generic
  const parts = t.split(/\s+/);
  for (const p of parts.slice(0, 4)) {
    if (/^[A-Za-z][A-Za-z0-9'&.+]{1,}$/.test(p) && p.length >= 3) return p;
  }
  return first || "unknown";
}

const browser = await chromium.launch({
  headless: false,
  slowMo: 80,
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
const pagesOut = [];
const allProducts = [];

// warm session
await page.goto("https://www.amazon.sa/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);
await dismissNoise(page);

for (const t of TARGETS) {
  const started = Date.now();
  const entry = { id: t.id, url: t.url, ok: false, ms: 0, products: [], error: null, title: "" };
  try {
    const resp = await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    entry.httpStatus = resp?.status() ?? null;
    await page.waitForTimeout(2800);
    await dismissNoise(page);
    // scroll to load lazy cards
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(400);
    }
    entry.title = await page.title();
    const html = await page.content();
    const blocked =
      /validateCaptcha|automated access|api-services-support@amazon\.com/i.test(html) &&
      html.length < 80000;
    if (blocked) {
      entry.error = "blocked_captcha";
      entry.ok = false;
    } else {
      let cards =
        t.id.startsWith("bestsellers")
          ? await extractBestSellerCards(page)
          : await extractSearchCards(page);
      if (t.id.startsWith("bestsellers")) {
        cards = cards.filter((c) => COFFEE_RE.test(c.title || ""));
      }
      entry.products = cards.map((c) => {
        const priceSar = parsePriceSar(c.priceRaw);
        const brand = brandGuess(c.title);
        const row = {
          ...c,
          priceSar,
          brand,
          source: t.id,
          pageUrl: t.url,
        };
        allProducts.push(row);
        return row;
      });
      entry.ok = true;
    }
  } catch (e) {
    entry.error = String(e?.message || e);
  }
  entry.ms = Date.now() - started;
  pagesOut.push(entry);
  console.error(
    JSON.stringify({
      id: entry.id,
      ok: entry.ok,
      n: entry.products.length,
      ms: entry.ms,
      err: entry.error,
    }),
  );
}

await browser.close();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const rawPath = join(outDir, `amazon-sa-coffee-${stamp}.json`);
writeFileSync(
  rawPath,
  JSON.stringify(
    {
      scrapedAt: new Date().toISOString(),
      market: "amazon.sa",
      mode: "headed",
      pages: pagesOut,
      productCount: allProducts.length,
    },
    null,
    2,
  ),
  "utf8",
);

// also write latest pointer for analysis
writeFileSync(join(outDir, "amazon-sa-coffee-latest.json"), JSON.stringify({ rawPath, scrapedAt: new Date().toISOString(), productCount: allProducts.length }, null, 2));
console.log(JSON.stringify({ rawPath, pages: pagesOut.map((p) => ({ id: p.id, ok: p.ok, n: p.products.length, err: p.error })), productCount: allProducts.length }, null, 2));
