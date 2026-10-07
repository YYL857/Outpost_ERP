#!/usr/bin/env node
/**
 * Optional: record XHR/fetch URLs while browsing seed pages (orders etc.).
 * Output: out/network.json
 *
 * Usage: node scripts/noon-discover/discover-network.mjs
 */
import { existsSync } from "node:fs";
import {
  profileDir,
  ensureOutDirs,
  writeJson,
  loadPlaywright,
  chromiumLaunchOptions,
  assertNotFaultAborted,
  SEED_URLS,
  FAULT_ABORT_RE,
  writeSeedFallbackOutputs,
} from "./lib.mjs";

const TARGETS = SEED_URLS.filter((s) =>
  ["orders", "order_list", "sales", "inventory", "catalog", "home"].includes(
    s.id,
  ),
);

async function main() {
  ensureOutDirs();
  const userDataDir = profileDir();
  if (!existsSync(userDataDir)) {
    throw new Error(`缺少浏览器登录态目录：${userDataDir}`);
  }

  const { chromium } = await loadPlaywright();
  const headless = process.env.OUTPOST_SOP_HEADLESS === "1";
  const context = await chromium.launchPersistentContext(
    userDataDir,
    chromiumLaunchOptions(headless),
  );

  const apis = [];
  const seen = new Set();

  const onResponse = async (response) => {
    try {
      const req = response.request();
      const rt = req.resourceType();
      if (rt !== "xhr" && rt !== "fetch") return;
      const url = response.url();
      if (!/noon\.partners|noon\.com|api\./i.test(url)) return;
      const key = `${req.method()} ${url.split("?")[0]}`;
      if (seen.has(key)) return;
      seen.add(key);
      apis.push({
        method: req.method(),
        url,
        status: response.status(),
        resourceType: rt,
        pageUrl: req.frame()?.url?.() ?? null,
      });
    } catch {
      /* ignore */
    }
  };

  context.on("response", onResponse);

  const result = {
    generatedAt: new Date().toISOString(),
    pagesVisited: [],
    apis: [],
    error: null,
  };

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(60_000);

    for (const t of TARGETS) {
      try {
        log("network probe", t.url);
        await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await assertNotFaultAborted(page);
        await page.waitForTimeout(3000);
        result.pagesVisited.push({ id: t.id, url: page.url(), ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.pagesVisited.push({
          id: t.id,
          url: t.url,
          ok: false,
          error: msg,
        });
        if (FAULT_ABORT_RE.test(msg)) {
          log("abort remaining network probes after fault filter abort");
          break;
        }
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    context.off("response", onResponse);
    await context.close().catch(() => undefined);
  }

  result.apis = apis;
  writeJson("network.json", result);
  if (result.error || result.pagesVisited.every((p) => !p.ok)) {
    writeSeedFallbackOutputs(
      result.error ||
        result.pagesVisited.find((p) => p.error)?.error ||
        "network probe failed",
    );
  }
  log(`captured ${apis.length} xhr/fetch endpoints`);
  if (result.error || result.pagesVisited.every((p) => !p.ok)) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
