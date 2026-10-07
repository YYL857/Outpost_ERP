import {
  existsSync,
  mkdirSync,
  readFileSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getBrowserSessionPaths,
  getSessionFileStatus,
  readSavedCookieHeader,
  saveContextSession,
} from "./browser-collector.js";
import { getImportDir } from "./auto-ingest.js";
import {
  applyNoonStealth,
  humanDelay,
  launchNoonChromium,
  noonBrowserContextOptions,
  withNoonBrowserLock,
} from "./browser-launch.js";

export type SopAction =
  | { type: "goto"; url: string; optional?: boolean }
  | { type: "click"; selector: string; optional?: boolean }
  | { type: "waitDownload"; filenameIncludes?: string; optional?: boolean }
  | { type: "wait"; ms: number; optional?: boolean };

export type SopReport = {
  id: string;
  label: string;
  domainHint: string;
  url: string;
  actions: SopAction[];
};

export type SopConfig = {
  baseUrl: string;
  headless: boolean;
  timeoutMs: number;
  reports: SopReport[];
};

export type SopRunResult = {
  ok: boolean;
  skipped: boolean;
  message: string;
  downloadDir: string;
  downloads: string[];
  reportResults: Array<{
    id: string;
    label: string;
    ok: boolean;
    detail: string;
    files: string[];
  }>;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAULT_ABORT_RE = /fault\s*filter\s*abort/i;

function loadSopConfig(): SopConfig {
  const p = join(__dirname, "sop-selectors.json");
  const raw = JSON.parse(readFileSync(p, "utf8")) as SopConfig;
  // 默认有头；仅 OUTPOST_SOP_HEADLESS=1 才无头（无头更容易 418）
  if (process.env.OUTPOST_SOP_HEADLESS === "1") raw.headless = true;
  else raw.headless = false;
  return raw;
}

async function assertPageNotFaultAborted(page: {
  content: () => Promise<string>;
  url: () => string;
  title?: () => Promise<string>;
}): Promise<void> {
  const html = await page.content().catch(() => "");
  const title = page.title ? await page.title().catch(() => "") : "";
  if (FAULT_ABORT_RE.test(html) || FAULT_ABORT_RE.test(title)) {
    throw new Error(
      `NOON 网关返回 fault filter abort（${page.url()}）。常见原因：Akamai 机器人 Cookie 过期或自动化被拦截。请重新「打开登录窗」后尽快再同步。`,
    );
  }
}

/**
 * 使用已保存的 storage-state.json 登录态，按 SOP 配置尝试导出报表到 portal-imports。
 * 选择器可配置；单项失败不阻断整批（记入 reportResults）。
 */
export async function runSopExport(opts?: {
  headless?: boolean;
}): Promise<SopRunResult> {
  const session = getSessionFileStatus();
  const downloadDir = getImportDir();
  if (!existsSync(downloadDir)) mkdirSync(downloadDir, { recursive: true });
  if (!session.hasSession && !readSavedCookieHeader()) {
    return {
      ok: false,
      skipped: true,
      message: "无有效登录态：请先点「打开登录窗」保存登录态",
      downloadDir,
      downloads: [],
      reportResults: [],
    };
  }
  return withNoonBrowserLock(() => runSopExportLocked(opts, downloadDir));
}

async function runSopExportLocked(
  opts: { headless?: boolean } | undefined,
  downloadDir: string,
): Promise<SopRunResult> {
  const cfg = loadSopConfig();
  // 调用方显式 true 才无头；否则强制有头
  const headless =
    opts?.headless === true || process.env.OUTPOST_SOP_HEADLESS === "1"
      ? true
      : false;
  const paths = getBrowserSessionPaths();
  const downloads: string[] = [];
  const reportResults: SopRunResult["reportResults"] = [];

  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    return {
      ok: false,
      skipped: true,
      message: "未安装 playwright，无法执行 SOP 自动导出",
      downloadDir,
      downloads: [],
      reportResults: [],
    };
  }

  const { chromium } = playwright;
  const { browser } = await launchNoonChromium(chromium, {
    headless,
    viewport: { width: 1440, height: 900 },
  });

  const storagePath = paths.storageStatePath;
  const context = await browser.newContext(
    noonBrowserContextOptions({
      storageState: existsSync(storagePath) ? storagePath : undefined,
      viewport: { width: 1440, height: 900 },
    }),
  );
  await applyNoonStealth(context);

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(cfg.timeoutMs);
    let abortAll = false;

    // 预热：先轻轻打开后台首页，给网关 Cookie 续命；若已 418 则整批中止，避免连打
    const warmUrl = cfg.baseUrl || "https://www.noon.partners/en-ae/";
    try {
      await page.goto(warmUrl, { waitUntil: "load", timeout: cfg.timeoutMs });
      await humanDelay(2500, 4500);
      await assertPageNotFaultAborted(page);
      try {
        await saveContextSession(context, paths.storageStatePath);
      } catch {
        /* 预热阶段无身份票则跳过 */
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        skipped: false,
        message: FAULT_ABORT_RE.test(detail)
          ? `SOP 预热即被网关拦截：${detail}`
          : `SOP 预热失败：${detail}`,
        downloadDir,
        downloads: [],
        reportResults: [
          {
            id: "_warmup",
            label: "会话预热",
            ok: false,
            detail,
            files: [],
          },
        ],
      };
    }

    for (let i = 0; i < cfg.reports.length; i++) {
      const report = cfg.reports[i]!;
      if (abortAll) {
        reportResults.push({
          id: report.id,
          label: report.label,
          ok: false,
          detail: "已中止：前置报表触发 fault filter abort",
          files: [],
        });
        continue;
      }

      if (i > 0) await humanDelay(1800, 4000);

      const files: string[] = [];
      let ok = true;
      let detail = "ok";
      try {
        for (const action of report.actions) {
          try {
            if (action.type === "goto") {
              await humanDelay(800, 1800);
              await page.goto(action.url, {
                waitUntil: "load",
                timeout: cfg.timeoutMs,
              });
              await humanDelay(1500, 2800);
              await assertPageNotFaultAborted(page);
            } else if (action.type === "wait") {
              await new Promise((r) => setTimeout(r, action.ms));
            } else if (action.type === "click") {
              await humanDelay(600, 1400);
              const loc = page.locator(action.selector).first();
              await loc.click({ timeout: 15_000 });
              await humanDelay(500, 1200);
            } else if (action.type === "waitDownload") {
              const downloadPromise = page.waitForEvent("download", {
                timeout: 45_000,
              });
              let download;
              try {
                download = await downloadPromise;
              } catch {
                const exportBtn = page.locator("text=Export").first();
                if ((await exportBtn.count()) > 0) {
                  const again = page.waitForEvent("download", {
                    timeout: 60_000,
                  });
                  await humanDelay(400, 900);
                  await exportBtn.click({ timeout: 10_000 });
                  download = await again;
                } else {
                  throw new Error("未捕获到下载事件");
                }
              }
              const suggested = download.suggestedFilename();
              const target = join(
                downloadDir,
                suggested || `${report.id}-${Date.now()}.csv`,
              );
              await download.saveAs(target);
              files.push(target);
              downloads.push(target);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (FAULT_ABORT_RE.test(msg)) {
              abortAll = true;
              throw err;
            }
            if (action.optional) {
              detail = `optional skip: ${msg}`;
              continue;
            }
            throw err;
          }
        }
        if (!files.length) {
          ok = false;
          detail = "未下载到文件（请检查 sop-selectors.json 选择器/URL）";
        }
      } catch (err) {
        ok = false;
        detail = err instanceof Error ? err.message : String(err);
        if (FAULT_ABORT_RE.test(detail)) abortAll = true;
      }
      reportResults.push({
        id: report.id,
        label: report.label,
        ok,
        detail,
        files,
      });
    }
  } finally {
    // 对齐 peer_reference：跑完后回写 storage_state，延长可用时间
    try {
      if (browser.isConnected()) {
        await saveContextSession(context, paths.storageStatePath);
      }
    } catch {
      /* 登录态可能已失效，忽略 */
    }
    try {
      await context.close();
    } catch {
      /* ignore */
    }
    try {
      if (browser.isConnected()) await browser.close();
    } catch {
      /* ignore */
    }
  }

  const anyOk = reportResults.some((r) => r.ok && r.files.length > 0);
  const faultHit = reportResults.some((r) => FAULT_ABORT_RE.test(r.detail));
  return {
    ok: anyOk,
    skipped: false,
    message: anyOk
      ? `SOP 导出完成：成功 ${reportResults.filter((r) => r.ok).length}/${reportResults.length}，文件 ${downloads.length}`
      : faultHit
        ? `SOP 被 NOON 网关中止（fault filter abort）。请重新打开登录窗后尽快再同步。明细：${reportResults
            .map((r) => `${r.id}:${r.detail}`)
            .join(" | ")}`
        : `SOP 导出未拿到文件。请用登录态更新 sop-selectors.json 中的 URL/选择器后重试。明细：${reportResults
            .map((r) => `${r.id}:${r.detail}`)
            .join(" | ")}`,
    downloadDir,
    downloads,
    reportResults,
  };
}

/** 开发辅助：把样例目录文件拷进 portal-imports（不覆盖已存在） */
export function seedImportsFromSampleDir(sampleRoot: string): string[] {
  const importDir = getImportDir();
  if (!existsSync(importDir)) mkdirSync(importDir, { recursive: true });
  const copied: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.csv$/i.test(name)) {
        const dest = join(importDir, name);
        if (!existsSync(dest)) {
          copyFileSync(full, dest);
          copied.push(dest);
        }
      }
    }
  };
  walk(resolve(sampleRoot));
  return copied;
}
