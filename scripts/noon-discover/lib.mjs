/**
 * Shared helpers for NOON Seller Lab discovery (Playwright + persistent profile).
 */
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(__dirname, "../..");
export const OUT_DIR = join(__dirname, "out");
export const PAGES_DIR = join(OUT_DIR, "pages");
export const SHOTS_DIR = join(OUT_DIR, "screenshots");

export function dataRoot() {
  const root =
    process.env.OUTPOST_BROWSER_DIR?.trim() ||
    process.env.OUTPOST_DATA_DIR?.trim() ||
    "D:\\outpost-data";
  return resolve(root.includes("json") ? join(root, "..") : root);
}

export function profileDir() {
  return join(dataRoot(), "noon-browser-profile");
}

export function ensureOutDirs() {
  for (const d of [OUT_DIR, PAGES_DIR, SHOTS_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export function writeJson(name, data) {
  ensureOutDirs();
  const p = join(OUT_DIR, name);
  writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
  return p;
}

export function readJson(name, fallback = null) {
  const p = join(OUT_DIR, name);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Same stealth flags as apps/api browser-launch.ts */
export function chromiumLaunchOptions(headless = false) {
  return {
    headless,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  };
}

export async function loadPlaywright() {
  let mod;
  try {
    mod = await import("playwright");
  } catch {
    const require = createRequire(join(ROOT, "apps/api/package.json"));
    const resolved = require.resolve("playwright");
    mod = await import(pathToFileURL(resolved).href);
  }
  const pw = mod.default ?? mod;
  if (!pw?.chromium) {
    throw new Error(
      "playwright 未正确加载。请在 apps/api 执行: npm install playwright && npx playwright install chromium",
    );
  }
  return pw;
}

export const FAULT_ABORT_RE = /fault\s*filter\s*abort/i;

export async function assertNotFaultAborted(page) {
  const html = await page.content().catch(() => "");
  if (FAULT_ABORT_RE.test(html)) {
    throw new Error(
      `NOON 网关返回 fault filter abort（${page.url()}）。请先在前哨「NOON 接入」重新浏览器登录后再跑探测。`,
    );
  }
}

/** Seed URLs from current SOP + common Seller Lab paths (discovery may expand). */
export const SEED_URLS = [
  { id: "home", label: "Seller Lab Home", url: "https://www.noon.partners/en-ae/" },
  { id: "catalog_exports", label: "Catalog Exports", url: "https://www.noon.partners/en-ae/catalog-exports", domainHint: "catalog" },
  { id: "catalog", label: "Catalog", url: "https://www.noon.partners/en-ae/catalog", domainHint: "catalog" },
  { id: "inventory", label: "Inventory", url: "https://www.noon.partners/en-ae/inventory", domainHint: "stock" },
  { id: "fbn_reports", label: "FBN Reports", url: "https://www.noon.partners/en-ae/fbn-reports", domainHint: "stock" },
  { id: "sales", label: "Sales", url: "https://www.noon.partners/en-ae/sales", domainHint: "sales" },
  { id: "transaction_view", label: "Transaction View", url: "https://www.noon.partners/en-ae/transaction-view", domainHint: "fees" },
  { id: "orders", label: "Orders", url: "https://www.noon.partners/en-ae/orders", domainHint: "orders" },
  { id: "order_list", label: "Order List", url: "https://www.noon.partners/en-ae/order-list", domainHint: "orders" },
  { id: "shipments", label: "Shipments", url: "https://www.noon.partners/en-ae/shipments", domainHint: "fulfillment" },
  { id: "ads", label: "Ads", url: "https://www.noon.partners/en-ae/ads", domainHint: "ads" },
  { id: "noon_ads", label: "Noon Ads", url: "https://www.noon.partners/en-ae/noon-ads", domainHint: "ads" },
  { id: "campaigns", label: "Campaigns", url: "https://www.noon.partners/en-ae/campaigns", domainHint: "campaigns" },
  { id: "pricing", label: "Pricing", url: "https://www.noon.partners/en-ae/pricing", domainHint: "pricing" },
  { id: "finance", label: "Finance", url: "https://www.noon.partners/en-ae/finance", domainHint: "fees" },
  { id: "settlements", label: "Settlements", url: "https://www.noon.partners/en-ae/settlements", domainHint: "fees" },
  { id: "returns", label: "Returns", url: "https://www.noon.partners/en-ae/returns", domainHint: "orders" },
];

/** Heuristic: Noon path → Outpost page / SyncDomain draft */
export function draftMapping(link) {
  const u = (link.url || "").toLowerCase();
  const t = `${link.text || ""} ${link.label || ""}`.toLowerCase();
  const hit = (re) => re.test(u) || re.test(t);

  if (hit(/catalog-export|catalog/)) {
    return {
      syncDomain: "catalog",
      outpostPrimary: "Catalog",
      outpostRefs: ["链接上架"],
      wave: 1,
    };
  }
  if (hit(/inventory|fbn|stock|warehouse/)) {
    return {
      syncDomain: "stock",
      outpostPrimary: "Catalog（库存列）",
      outpostRefs: ["补货计划", "发货管理"],
      wave: 1,
    };
  }
  if (hit(/order/)) {
    return {
      syncDomain: "orders",
      outpostPrimary: "销量统计 / 同步健康",
      outpostRefs: ["Best Sell", "财务报表"],
      wave: 1,
    };
  }
  if (hit(/sales|product.?view/)) {
    return {
      syncDomain: "sales",
      outpostPrimary: "销量统计",
      outpostRefs: ["Catalog（7日销量）"],
      wave: 1,
    };
  }
  if (hit(/transaction|settlement|finance|payout|commission/)) {
    return {
      syncDomain: "fees",
      outpostPrimary: "财务报表",
      outpostRefs: ["Catalog（毛利列）"],
      wave: 1,
    };
  }
  if (hit(/ad|sponsored|campaign.?ad/)) {
    return {
      syncDomain: "ads",
      outpostPrimary: "广告管理",
      outpostRefs: [],
      wave: 2,
    };
  }
  if (hit(/campaign|promo|deal/)) {
    return {
      syncDomain: "campaigns",
      outpostPrimary: "活动管理",
      outpostRefs: [],
      wave: 2,
    };
  }
  if (hit(/ship|fulfill|inbound|replenish|purchase|po\b/)) {
    return {
      syncDomain: "supply",
      outpostPrimary: "采购/补货/发货（占位）",
      outpostRefs: [],
      wave: 2,
    };
  }
  if (hit(/pric/)) {
    return {
      syncDomain: "pricing",
      outpostPrimary: "Catalog（定价列，未实现）",
      outpostRefs: [],
      wave: 2,
    };
  }
  return {
    syncDomain: "unknown",
    outpostPrimary: "未映射",
    outpostRefs: [],
    wave: 3,
  };
}

export function writeSeedFallbackOutputs(reason) {
  ensureOutDirs();
  const links = SEED_URLS.map((s) => ({
    text: s.label,
    url: s.url,
    path: new URL(s.url).pathname,
    draft: draftMapping({ url: s.url, text: s.label }),
    fromSeed: true,
  }));
  const nav = {
    startedAt: new Date().toISOString(),
    startUrl: SEED_URLS[0].url,
    finalUrl: null,
    title: null,
    faultAborted: /fault\s*filter/i.test(reason || ""),
    links,
    seeds: SEED_URLS,
    error: reason,
    fallback: true,
    note: "Live crawl failed; seeded draft only. Re-login and re-run discover-*.mjs.",
  };
  writeJson("nav.json", nav);

  const mappingDraft = {
    generatedAt: new Date().toISOString(),
    principle: "一源一域一主页；Catalog 只拼装商品视图，不独占销量/费用",
    fallback: true,
    reason,
    entries: SEED_URLS.map((s) => {
      const d = draftMapping({ url: s.url, text: s.label });
      return {
        noonUrl: s.url,
        noonLabel: s.label,
        reachable: false,
        syncDomain: d.syncDomain,
        outpostPrimary: d.outpostPrimary,
        outpostRefs: d.outpostRefs,
        wave: d.wave,
        hasExportControls: null,
        tableHeaders: [],
        note: "seed fallback — not live-verified",
      };
    }),
  };
  writeJson("mapping-draft.json", mappingDraft);
  return { nav, mappingDraft };
}

export function log(...args) {
  console.log(`[noon-discover]`, ...args);
}
