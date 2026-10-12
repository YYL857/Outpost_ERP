/**
 * Noon.sa consumables probe — headed.
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
    id: "noon-search-garbage-bags",
    url: "https://www.noon.com/saudi-en/search/?q=garbage%20bags",
  },
  {
    id: "noon-search-trash-bags",
    url: "https://www.noon.com/saudi-en/search/?q=trash%20bags",
  },
  {
    id: "noon-search-aluminum-foil",
    url: "https://www.noon.com/saudi-en/search/?q=aluminum%20foil",
  },
  {
    id: "noon-search-wet-wipes",
    url: "https://www.noon.com/saudi-en/search/?q=wet%20wipes",
  },
  {
    id: "noon-search-baby-wipes",
    url: "https://www.noon.com/saudi-en/search/?q=baby%20wipes",
  },
  {
    id: "noon-search-ziplock",
    url: "https://www.noon.com/saudi-en/search/?q=ziplock%20bags",
  },
  {
    id: "noon-search-coffee-filters",
    url: "https://www.noon.com/saudi-en/search/?q=coffee%20filters",
  },
  {
    id: "noon-search-coffee-capsules",
    url: "https://www.noon.com/saudi-en/search/?q=coffee%20capsules",
  },
  {
    id: "noon-search-descaler",
    url: "https://www.noon.com/saudi-en/search/?q=descaler",
  },
  {
    id: "noon-search-laundry-pods",
    url: "https://www.noon.com/saudi-en/search/?q=laundry%20pods",
  },
  {
    id: "noon-search-paper-towels",
    url: "https://www.noon.com/saudi-en/search/?q=paper%20towels",
  },
  {
    id: "noon-search-cotton-pads",
    url: "https://www.noon.com/saudi-en/search/?q=cotton%20pads",
  },
];

function parsePrice(raw) {
  const m = String(raw || "")
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function parseSold(raw) {
  if (!raw) return null;
  const t = String(raw).toLowerCase();
  const m = t.match(/([\d,.]+)\s*k?\+?\s*sold/i) || t.match(/sold\s*([\d,.]+)/i);
  if (!m) return null;
  let n = m[1].replace(/,/g, "");
  if (/k/i.test(t) && !/\d+k/i.test(m[0]) === false) {
    /* handled below */
  }
  if (/([\d.]+)\s*k/i.test(m[0])) {
    return Math.round(parseFloat(RegExp.$1) * 1000);
  }
  const km = String(raw).match(/([\d.]+)\s*k/i);
  if (km) return Math.round(parseFloat(km[1]) * 1000);
  return Number(n) || null;
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

await page.goto("https://www.noon.com/saudi-en/", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
}).catch(() => {});
await page.waitForTimeout(2500);

for (const t of TARGETS) {
  const entry = { id: t.id, url: t.url, ok: false, products: [], error: null };
  try {
    const resp = await page.goto(t.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    entry.httpStatus = resp?.status() ?? null;
    await page.waitForTimeout(3200);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(400);
    }
    entry.title = await page.title();
    const htmlLen = (await page.content()).length;
    entry.htmlBytes = htmlLen;

    const cards = await page.evaluate(() => {
      const out = [];
      // noon product boxes — multiple possible selectors
      const nodes = [
        ...document.querySelectorAll(
          '[data-qa="product-name"], .productContainer, [class*="ProductBox"], a[href*="/N/"]',
        ),
      ];
      const seen = new Set();
      for (const a of document.querySelectorAll('a[href*="/saudi-en/"]')) {
        const href = a.href || "";
        if (!/\/[A-Z0-9]+\/p\/|\/N[A-Z0-9]+/i.test(href) && !href.includes("/p/"))
          continue;
        // skip nav
        if (href.includes("/search")) continue;
        const root =
          a.closest('[class*="product"]') ||
          a.closest('[class*="Product"]') ||
          a.parentElement?.parentElement ||
          a;
        const block = (root?.innerText || a.innerText || "").replace(/\s+/g, " ").trim();
        if (block.length < 8 || block.length > 500) continue;
        const key = href.split("?")[0];
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ href: key, text: block.slice(0, 280) });
        if (out.length >= 30) break;
      }
      return out;
    });

    entry.products = cards.map((c, i) => {
      const priceSar = parsePrice(c.text);
      const soldMatch = c.text.match(/([\d,.]+)\s*k?\+?\s*sold recently/i) ||
        c.text.match(/sold recently[:\s]*([\d,.]+k?)/i) ||
        c.text.match(/([\d,.]+)\s*sold/i);
      let soldRecently = null;
      if (soldMatch) {
        const raw = soldMatch[1] || soldMatch[0];
        if (/k/i.test(raw)) soldRecently = Math.round(parseFloat(raw) * 1000);
        else soldRecently = Number(String(raw).replace(/,/g, "")) || null;
      }
      // title ≈ first line-ish
      const title = c.text.split(/(?:SAR|AED|\d+\.\d{2})/)[0].trim().slice(0, 120);
      return {
        rankOnPage: i + 1,
        title,
        text: c.text,
        priceSar,
        soldRecently,
        url: c.href,
        source: t.id,
      };
    });
    entry.ok = entry.products.length > 0;
    entry.n = entry.products.length;
    if (!entry.ok && htmlLen < 20000) entry.error = "likely_blocked_or_empty";
  } catch (e) {
    entry.error = String(e?.message || e);
  }
  pagesOut.push(entry);
  console.error(
    JSON.stringify({
      id: entry.id,
      n: entry.n,
      ok: entry.ok,
      err: entry.error,
      http: entry.httpStatus,
    }),
  );
}

await browser.close();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = join(outDir, `noon-sa-consumables-${stamp}.json`);
writeFileSync(
  outPath,
  JSON.stringify(
    {
      scrapedAt: new Date().toISOString(),
      market: "noon.sa",
      topic: "consumables-sa",
      mode: "headed",
      pages: pagesOut,
    },
    null,
    2,
  ),
);
writeFileSync(
  join(outDir, "noon-sa-consumables-latest.json"),
  JSON.stringify({ outPath }, null, 2),
);
console.log(
  JSON.stringify(
    {
      outPath,
      pages: pagesOut.map((p) => ({ id: p.id, n: p.n, ok: p.ok, err: p.error })),
      total: pagesOut.reduce((a, p) => a + (p.n || 0), 0),
    },
    null,
    2,
  ),
);
