#!/usr/bin/env node
/**
 * Discover NOON Seller Lab navigation links using saved browser profile.
 * Output: scripts/noon-discover/out/nav.json
 *
 * Usage: node scripts/noon-discover/discover-nav.mjs
 */
import {
  profileDir,
  ensureOutDirs,
  writeJson,
  loadPlaywright,
  chromiumLaunchOptions,
  assertNotFaultAborted,
  draftMapping,
  SEED_URLS,
  log,
  FAULT_ABORT_RE,
  writeSeedFallbackOutputs,
} from "./lib.mjs";
import { existsSync } from "node:fs";

const START =
  process.env.NOON_DISCOVER_START?.trim() ||
  "https://www.noon.partners/en-ae/";

async function main() {
  ensureOutDirs();
  const userDataDir = profileDir();
  if (!existsSync(userDataDir)) {
    throw new Error(
      `缺少浏览器登录态目录：${userDataDir}。请先在前哨「NOON 接入」完成浏览器登录。`,
    );
  }

  const { chromium } = await loadPlaywright();
  const headless = process.env.OUTPOST_SOP_HEADLESS === "1";
  log("launching", userDataDir, "headless=", headless);

  const context = await chromium.launchPersistentContext(
    userDataDir,
    chromiumLaunchOptions(headless),
  );

  const result = {
    startedAt: new Date().toISOString(),
    startUrl: START,
    finalUrl: "",
    title: "",
    faultAborted: false,
    links: [],
    seeds: SEED_URLS,
    error: null,
  };

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(90_000);

    await page.goto(START, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(2500);
    await assertNotFaultAborted(page);

    result.finalUrl = page.url();
    result.title = await page.title();

    // Collect same-origin nav-ish anchors
    const raw = await page.evaluate(() => {
      const origin = location.origin;
      const seen = new Set();
      const out = [];
      const nodes = [
        ...document.querySelectorAll("a[href]"),
        ...document.querySelectorAll("[role='navigation'] a[href]"),
        ...document.querySelectorAll("nav a[href]"),
        ...document.querySelectorAll("aside a[href]"),
      ];
      for (const a of nodes) {
        let href = a.href || a.getAttribute("href") || "";
        if (!href || href.startsWith("javascript:")) continue;
        try {
          const u = new URL(href, location.href);
          if (u.origin !== origin) continue;
          if (!u.pathname || u.pathname === "/") {
            // keep home once
          }
          const key = u.origin + u.pathname.replace(/\/$/, "");
          if (seen.has(key)) continue;
          seen.add(key);
          const text = (a.innerText || a.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120);
          out.push({
            text,
            url: u.origin + u.pathname + u.search,
            path: u.pathname,
          });
        } catch {
          /* ignore */
        }
      }
      return out;
    });

    result.links = raw.map((l) => ({
      ...l,
      draft: draftMapping(l),
    }));

    // Also open a couple of top-level paths that often hold menus
    const menuProbes = [
      "https://www.noon.partners/en-ae/catalog",
      "https://www.noon.partners/en-ae/orders",
    ];
    for (const url of menuProbes) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(1500);
        await assertNotFaultAborted(page);
        const more = await page.evaluate(() => {
          const origin = location.origin;
          const seen = new Set();
          const out = [];
          for (const a of document.querySelectorAll("a[href]")) {
            try {
              const u = new URL(a.href, location.href);
              if (u.origin !== origin) continue;
              const key = u.origin + u.pathname.replace(/\/$/, "");
              if (seen.has(key)) continue;
              seen.add(key);
              out.push({
                text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120),
                url: u.origin + u.pathname + u.search,
                path: u.pathname,
              });
            } catch {
              /* ignore */
            }
          }
          return out;
        });
        const existing = new Set(
          result.links.map((l) => l.url.replace(/\/$/, "")),
        );
        for (const l of more) {
          const k = l.url.replace(/\/$/, "");
          if (existing.has(k)) continue;
          existing.add(k);
          result.links.push({ ...l, draft: draftMapping(l) });
        }
      } catch (err) {
        log("menu probe skip", url, err instanceof Error ? err.message : err);
      }
    }

    result.links.sort((a, b) => a.path.localeCompare(b.path));
    const outPath = writeJson("nav.json", result);
    log(`wrote ${outPath} (${result.links.length} links)`);
    log(`title="${result.title}" url=${result.finalUrl}`);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.faultAborted = FAULT_ABORT_RE.test(result.error || "");
    writeJson("nav.json", result);
    writeSeedFallbackOutputs(result.error);
    console.error(result.error);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
