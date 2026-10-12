/**
 * Amazon.sa coffee deep probe — headed, visible browser.
 * List pages + PDP review/BSR for Saudi coffee vertical entry judgment.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "_out");
mkdirSync(outDir, { recursive: true });

const LIST_TARGETS = [
  {
    id: "cat-cte-p1",
    url: "https://www.amazon.sa/-/en/s?i=kitchen&rh=n%3A16856216031&s=exact-aware-popularity-rank",
  },
  {
    id: "cat-cte-p2",
    url: "https://www.amazon.sa/-/en/s?i=kitchen&rh=n%3A16856216031&s=exact-aware-popularity-rank&page=2",
  },
  {
    id: "cat-cte-p3",
    url: "https://www.amazon.sa/-/en/s?i=kitchen&rh=n%3A16856216031&s=exact-aware-popularity-rank&page=3",
  },
  {
    id: "cat-cte-p4",
    url: "https://www.amazon.sa/-/en/s?i=kitchen&rh=n%3A16856216031&s=exact-aware-popularity-rank&page=4",
  },
  {
    id: "search-semi-auto",
    url: "https://www.amazon.sa/s?k=semi+automatic+espresso+machine&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "search-dedica-stilosa",
    url: "https://www.amazon.sa/s?k=delonghi+dedica+OR+stilosa&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "search-conical-burr",
    url: "https://www.amazon.sa/s?k=conical+burr+coffee+grinder&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "search-fully-auto",
    url: "https://www.amazon.sa/s?k=fully+automatic+coffee+machine&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "search-turkish",
    url: "https://www.amazon.sa/s?k=turkish+coffee+maker+okka&i=kitchen&s=exact-aware-popularity-rank",
  },
  {
    id: "search-hibrew-doscher",
    url: "https://www.amazon.sa/s?k=hibrew+OR+doscher+coffee&i=kitchen&s=exact-aware-popularity-rank",
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
      if (await el.isVisible({ timeout: 600 })) await el.click({ timeout: 800 });
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
      if (!asin) continue;
      const title = (n.querySelector("h2 a span, h2 span")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const priceRaw =
        n.querySelector(".a-price .a-offscreen")?.textContent?.trim() || "";
      const ratingText =
        n
          .querySelector("i.a-icon-star-small span, i.a-icon-star span")
          ?.textContent?.trim() ||
        n
          .querySelector("[aria-label*='out of 5']")
          ?.getAttribute("aria-label") ||
        "";
      let reviewsRaw = "";
      const revEl = n.querySelector(
        "span[aria-label*='rating'], a[href*='customerReviews'] span",
      );
      if (revEl) {
        reviewsRaw =
          revEl.getAttribute("aria-label") || revEl.textContent || "";
      }
      const badge = n.querySelector(".a-badge-text")?.textContent?.trim() || "";
      const sponsored = !!n.querySelector(".puis-sponsored-label-text");
      const url = n.querySelector("h2 a")?.href || "";
      cards.push({
        asin,
        title,
        priceRaw,
        ratingText,
        reviewsRaw,
        badge,
        sponsored,
        url,
      });
    }
    return cards;
  });
}

async function extractPdp(page) {
  return page.evaluate(() => {
    const title = (
      document.querySelector("#productTitle")?.textContent || ""
    )
      .replace(/\s+/g, " ")
      .trim();
    const brand =
      document.querySelector("#bylineInfo")?.textContent?.trim() ||
      document.querySelector("a#brand")?.textContent?.trim() ||
      "";
    const priceRaw =
      document
        .querySelector(
          "#corePrice_feature_div .a-price .a-offscreen, #corePriceDisplay_desktop_feature_div .a-price .a-offscreen, .a-price .a-offscreen",
        )
        ?.textContent?.trim() || "";
    const ratingText =
      document.querySelector("#acrPopover .a-icon-alt, i.a-icon-star span")
        ?.textContent?.trim() || "";
    const reviewsText =
      document.querySelector("#acrCustomerReviewText")?.textContent?.trim() ||
      "";
    const bullets = [...document.querySelectorAll("#feature-bullets li span")]
      .map((x) => (x.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) => t && t.length > 8 && !/^\d+$/.test(t))
      .slice(0, 6);
    const bsrRows = [];
    for (const tr of document.querySelectorAll(
      "#productDetails_detailBullets_sections1 tr, #detailBulletsWrapper_feature_div li, #productDetails_db_sections tr",
    )) {
      const text = (tr.textContent || "").replace(/\s+/g, " ").trim();
      if (/Best Sellers Rank|bestsellers rank|Sales Rank/i.test(text)) {
        bsrRows.push(text.slice(0, 280));
      }
    }
    // detail bullets often: "#1,234 in Coffee Machines"
    const detailText = (
      document.querySelector("#detailBullets_feature_div")?.innerText ||
      document.querySelector("#productDetails_db_sections")?.innerText ||
      ""
    ).replace(/\s+/g, " ");
    const bsrMatches = [
      ...detailText.matchAll(
        /#([\d,]+)\s+in\s+([A-Za-z0-9 &'/,-]+?)(?:\s*\(|\s*>|\s*$)/g,
      ),
    ].slice(0, 5);
    const ranks = bsrMatches.map((m) => ({
      rank: Number(String(m[1]).replace(/,/g, "")),
      category: m[2].trim(),
    }));
    const availability =
      document.querySelector("#availability span")?.textContent?.trim() || "";
    return {
      title,
      brand,
      priceRaw,
      ratingText,
      reviewsText,
      bullets,
      bsrRows,
      ranks,
      availability,
    };
  });
}

const browser = await chromium.launch({
  headless: false,
  slowMo: 70,
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
await page.waitForTimeout(2000);
await dismissNoise(page);

const listPages = [];
const allList = [];

for (const t of LIST_TARGETS) {
  const entry = { id: t.id, url: t.url, ok: false, products: [], error: null };
  try {
    await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2200);
    await dismissNoise(page);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 1100);
      await page.waitForTimeout(320);
    }
    entry.title = await page.title();
    const cards = await extractSearchCards(page);
    entry.products = cards.map((c, idx) => {
      const row = {
        ...c,
        rankOnPage: idx + 1,
        priceSar: parsePrice(c.priceRaw),
        reviewsApprox: parseReviews(c.reviewsRaw),
        source: t.id,
        pageUrl: t.url,
      };
      allList.push(row);
      return row;
    });
    entry.ok = true;
    entry.n = entry.products.length;
  } catch (e) {
    entry.error = String(e?.message || e);
  }
  listPages.push(entry);
  console.error(
    JSON.stringify({ phase: "list", id: entry.id, n: entry.n, err: entry.error }),
  );
}

// pick PDPs: prioritize machine-like titles with price, diversify brands
const MACHINE_RE =
  /espresso|coffee\s*maker|coffee\s*machine|grinder|nespresso|okka|turkish|dedica|stilosa|burr|capsule|brew/i;
const ACCESSORY_RE =
  /filter paper|server|cup|descaler|portafilter|tamper|pitcher|kettle only|spoon|mat\b/i;

const byAsin = new Map();
for (const p of allList) {
  if (!byAsin.has(p.asin)) byAsin.set(p.asin, p);
}
const candidates = [...byAsin.values()]
  .filter(
    (p) =>
      MACHINE_RE.test(p.title || "") &&
      !ACCESSORY_RE.test(p.title || "") &&
      (p.priceSar == null || p.priceSar >= 80),
  )
  .sort((a, b) => (b.reviewsApprox || 0) - (a.reviewsApprox || 0));

// ensure cover: dedica/stilosa, hibrew, doscher, arzum, alsaiff, capsule white
const mustHints = [
  /dedica/i,
  /stilosa/i,
  /hibrew/i,
  /doscher/i,
  /okka|arzum/i,
  /alsaif/i,
  /cafelffe|ibsun/i,
  /vertuo|essenza|inissia/i,
  /burr|conical/i,
];
const picked = [];
const seen = new Set();
for (const re of mustHints) {
  const hit = candidates.find((c) => re.test(c.title) && !seen.has(c.asin));
  if (hit) {
    picked.push(hit);
    seen.add(hit.asin);
  }
}
for (const c of candidates) {
  if (picked.length >= 18) break;
  if (seen.has(c.asin)) continue;
  picked.push(c);
  seen.add(c.asin);
}

const pdps = [];
for (const c of picked) {
  const url = `https://www.amazon.sa/-/en/dp/${c.asin}`;
  const entry = { asin: c.asin, listTitle: c.title, url, ok: false };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2200);
    await dismissNoise(page);
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(800);
    const raw = await extractPdp(page);
    entry.ok = true;
    entry.title = raw.title || c.title;
    entry.brand = raw.brand;
    entry.priceSar = parsePrice(raw.priceRaw) ?? c.priceSar;
    entry.ratingText = raw.ratingText;
    entry.reviewsText = raw.reviewsText;
    entry.reviews = parseReviews(raw.reviewsText);
    entry.ranks = raw.ranks;
    entry.bsrRows = raw.bsrRows;
    entry.bullets = raw.bullets;
    entry.availability = raw.availability;
    entry.fromListSource = c.source;
  } catch (e) {
    entry.error = String(e?.message || e);
  }
  pdps.push(entry);
  console.error(
    JSON.stringify({
      phase: "pdp",
      asin: entry.asin,
      ok: entry.ok,
      reviews: entry.reviews,
      price: entry.priceSar,
      ranks: (entry.ranks || []).slice(0, 2),
    }),
  );
}

await browser.close();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = join(outDir, `amazon-sa-coffee-deep-${stamp}.json`);
const payload = {
  scrapedAt: new Date().toISOString(),
  market: "amazon.sa",
  mode: "headed",
  listPages,
  listProductCount: allList.length,
  pdps,
};
writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
writeFileSync(
  join(outDir, "amazon-sa-coffee-deep-latest.json"),
  JSON.stringify({ outPath, scrapedAt: payload.scrapedAt, listN: allList.length, pdpN: pdps.length }, null, 2),
);

// merge pointer with prior round if present
const priorMain = join(outDir, "amazon-sa-coffee-2026-09-23T05-47-25-733Z.json");
const priorExtra = join(outDir, "amazon-sa-coffee-category-extra.json");
console.log(
  JSON.stringify(
    {
      outPath,
      lists: listPages.map((p) => ({ id: p.id, n: p.n, ok: p.ok })),
      pdpOk: pdps.filter((p) => p.ok).length,
      priorExists: { main: existsSync(priorMain), extra: existsSync(priorExtra) },
    },
    null,
    2,
  ),
);
