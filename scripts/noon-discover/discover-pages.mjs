#!/usr/bin/env node
/**
 * Visit candidate NOON pages: screenshot + extract export controls / table headers.
 * Prefers nav.json links; falls back to SEED_URLS.
 * Output: out/pages/*.md, out/screenshots/*, out/pages-index.json, out/mapping-draft.json
 *
 * Usage: node scripts/noon-discover/discover-pages.mjs
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  profileDir,
  ensureOutDirs,
  writeJson,
  readJson,
  loadPlaywright,
  chromiumLaunchOptions,
  assertNotFaultAborted,
  draftMapping,
  SEED_URLS,
  PAGES_DIR,
  SHOTS_DIR,
  log,
  FAULT_ABORT_RE,
  writeSeedFallbackOutputs,
} from "./lib.mjs";
import { existsSync } from "node:fs";

function slug(idOrUrl) {
  return String(idOrUrl)
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
}

async function extractPageSignals(page) {
  return page.evaluate(() => {
    const textOf = (el) =>
      (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();

    const buttons = [...document.querySelectorAll("button, a, [role='button']")]
      .map((el) => textOf(el))
      .filter((t) => t && t.length < 80)
      .filter((t) =>
        /export|download|report|csv|excel|upload|create|generate|同步|导出|下载/i.test(
          t,
        ),
      )
      .slice(0, 40);

    const headings = [...document.querySelectorAll("h1,h2,h3")]
      .map((el) => textOf(el))
      .filter(Boolean)
      .slice(0, 20);

    const ths = [...document.querySelectorAll("table th, [role='columnheader']")]
      .map((el) => textOf(el))
      .filter(Boolean)
      .slice(0, 60);

    const bodySnippet = textOf(document.body).slice(0, 400);

    return {
      headings,
      exportLikeControls: [...new Set(buttons)],
      tableHeaders: [...new Set(ths)],
      bodySnippet,
    };
  });
}

async function main() {
  ensureOutDirs();
  const userDataDir = profileDir();
  if (!existsSync(userDataDir)) {
    throw new Error(`缺少浏览器登录态目录：${userDataDir}`);
  }

  const nav = readJson("nav.json", null);
  const candidates = [];
  const seen = new Set();

  const push = (item) => {
    const url = item.url;
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push(item);
  };

  for (const s of SEED_URLS) push(s);
  if (nav?.links?.length) {
    for (const l of nav.links) {
      // Prefer paths that look like modules (short path depth)
      const depth = (l.path || "").split("/").filter(Boolean).length;
      if (depth >= 1 && depth <= 3) {
        push({
          id: slug(l.path),
          label: l.text || l.path,
          url: l.url,
          domainHint: l.draft?.syncDomain,
        });
      }
    }
  }

  // Cap to keep runtime reasonable
  const maxPages = Number(process.env.NOON_DISCOVER_MAX_PAGES ?? 25);
  const list = candidates.slice(0, maxPages);
  log(`will visit ${list.length} pages`);

  const { chromium } = await loadPlaywright();
  const headless = process.env.OUTPOST_SOP_HEADLESS === "1";
  const context = await chromium.launchPersistentContext(
    userDataDir,
    chromiumLaunchOptions(headless),
  );

  const pagesIndex = [];
  const mappingDraft = {
    generatedAt: new Date().toISOString(),
    principle: "一源一域一主页；Catalog 只拼装商品视图，不独占销量/费用",
    entries: [],
  };

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(60_000);

    for (const item of list) {
      const id = item.id || slug(item.url);
      const row = {
        id,
        label: item.label || id,
        url: item.url,
        domainHint: item.domainHint || null,
        ok: false,
        status: null,
        title: "",
        faultAborted: false,
        signals: null,
        screenshot: null,
        error: null,
        draft: draftMapping({ url: item.url, text: item.label }),
      };

      try {
        log("goto", item.url);
        const resp = await page.goto(item.url, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        row.status = resp?.status() ?? null;
        await page.waitForTimeout(2000);
        await assertNotFaultAborted(page);
        row.title = await page.title();
        row.signals = await extractPageSignals(page);

        const shotName = `${id}.png`;
        const shotPath = join(SHOTS_DIR, shotName);
        await page.screenshot({ path: shotPath, fullPage: false });
        row.screenshot = shotPath;
        row.ok = true;

        const md = [
          `# ${row.label}`,
          "",
          `- URL: ${row.url}`,
          `- Title: ${row.title}`,
          `- HTTP: ${row.status}`,
          `- Draft domain: ${row.draft.syncDomain}`,
          `- Outpost primary: ${row.draft.outpostPrimary}`,
          `- Wave: ${row.draft.wave}`,
          "",
          "## Headings",
          ...(row.signals.headings.map((h) => `- ${h}`) || ["- (none)"]),
          "",
          "## Export-like controls",
          ...(row.signals.exportLikeControls.map((b) => `- ${b}`) || [
            "- (none)",
          ]),
          "",
          "## Table headers",
          ...(row.signals.tableHeaders.map((h) => `- ${h}`) || ["- (none)"]),
          "",
          "## Body snippet",
          "```",
          row.signals.bodySnippet,
          "```",
          "",
          `Screenshot: ../screenshots/${shotName}`,
          "",
        ].join("\n");
        writeFileSync(join(PAGES_DIR, `${id}.md`), md, "utf8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        row.error = msg;
        row.faultAborted = FAULT_ABORT_RE.test(msg);
        log("fail", id, msg);
        writeFileSync(
          join(PAGES_DIR, `${id}.md`),
          `# ${row.label}\n\nERROR: ${msg}\n\nURL: ${row.url}\n`,
          "utf8",
        );
        pagesIndex.push(row);
        mappingDraft.entries.push({
          noonUrl: row.url,
          noonLabel: row.label,
          reachable: false,
          syncDomain: row.draft.syncDomain,
          outpostPrimary: row.draft.outpostPrimary,
          outpostRefs: row.draft.outpostRefs,
          wave: row.draft.wave,
          hasExportControls: false,
          tableHeaders: [],
          note: row.error,
        });
        if (row.faultAborted) {
          log("abort remaining pages after fault filter abort");
          break;
        }
        continue;
      }

      pagesIndex.push(row);
      mappingDraft.entries.push({
        noonUrl: row.url,
        noonLabel: row.label,
        reachable: row.ok,
        syncDomain: row.draft.syncDomain,
        outpostPrimary: row.draft.outpostPrimary,
        outpostRefs: row.draft.outpostRefs,
        wave: row.draft.wave,
        hasExportControls: (row.signals?.exportLikeControls?.length ?? 0) > 0,
        tableHeaders: row.signals?.tableHeaders ?? [],
        note: row.error || null,
      });
    }
  } finally {
    await context.close().catch(() => undefined);
  }

  writeJson("pages-index.json", {
    generatedAt: new Date().toISOString(),
    count: pagesIndex.length,
    okCount: pagesIndex.filter((p) => p.ok).length,
    pages: pagesIndex,
  });
  writeJson("mapping-draft.json", mappingDraft);
  log(
    `done: ok=${pagesIndex.filter((p) => p.ok).length}/${pagesIndex.length}`,
  );

  if (pagesIndex.every((p) => !p.ok)) {
    writeSeedFallbackOutputs(
      pagesIndex.find((p) => p.error)?.error || "all page probes failed",
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
