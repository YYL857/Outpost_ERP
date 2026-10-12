import { chromium } from "playwright";
import { writeFileSync } from "fs";

const urls = [
  {
    id: "cat-coffee-tea-espresso-p1",
    url: "https://www.amazon.sa/-/en/s?i=kitchen&rh=n%3A16856216031&s=exact-aware-popularity-rank",
  },
  {
    id: "cat-coffee-tea-espresso-p2",
    url: "https://www.amazon.sa/-/en/s?i=kitchen&rh=n%3A16856216031&s=exact-aware-popularity-rank&page=2",
  },
  {
    id: "search-turkish-coffee-maker",
    url: "https://www.amazon.sa/s?k=turkish+coffee+maker&i=kitchen&s=exact-aware-popularity-rank",
  },
];

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
await page.goto("https://www.amazon.sa/", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(1500);

async function extractSearchCards(page) {
  return page.evaluate(() => {
    const cards = [];
    const nodes = document.querySelectorAll(
      'div[data-component-type="s-search-result"][data-asin]',
    );
    for (const n of nodes) {
      const asin = n.getAttribute("data-asin") || "";
      if (!asin) continue;
      const title = (
        n.querySelector("h2 a span, h2 span")?.textContent || ""
      )
        .replace(/\s+/g, " ")
        .trim();
      const priceRaw =
        n.querySelector(".a-price .a-offscreen")?.textContent?.trim() || "";
      const rating =
        n
          .querySelector("i.a-icon-star-small span, i.a-icon-star span")
          ?.textContent?.trim() || "";
      const badge = n.querySelector(".a-badge-text")?.textContent?.trim() || "";
      const sponsored = !!n.querySelector(".puis-sponsored-label-text");
      cards.push({
        asin,
        title,
        priceRaw,
        rating,
        badge,
        sponsored,
        url: n.querySelector("h2 a")?.href || "",
      });
    }
    return cards;
  });
}

function parsePrice(raw) {
  const m = String(raw || "")
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

const pages = [];
for (const t of urls) {
  const entry = { id: t.id, url: t.url, products: [], ok: false };
  try {
    await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 1100);
      await page.waitForTimeout(350);
    }
    entry.title = await page.title();
    const cards = await extractSearchCards(page);
    entry.products = cards.map((c) => ({
      ...c,
      priceSar: parsePrice(c.priceRaw),
      source: t.id,
    }));
    entry.ok = true;
    entry.n = entry.products.length;
  } catch (e) {
    entry.error = String(e.message || e);
  }
  pages.push(entry);
  console.error(JSON.stringify({ id: entry.id, n: entry.n, err: entry.error }));
}
await browser.close();
writeFileSync(
  "scripts/_out/amazon-sa-coffee-category-extra.json",
  JSON.stringify({ scrapedAt: new Date().toISOString(), pages }, null, 2),
);
console.log(
  JSON.stringify({
    pages: pages.map((p) => ({ id: p.id, n: p.n, ok: p.ok })),
  }),
);
