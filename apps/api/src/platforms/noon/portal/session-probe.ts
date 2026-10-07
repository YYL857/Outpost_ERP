/**
 * 登录态可用性探针：用与 SOP 相同的 Chrome + storage-state 打开后台页，
 * 区分「文件有 Cookie」与「真能进 Seller Lab」。不改采集落盘逻辑。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  getBrowserSessionPaths,
  getSessionFileStatus,
  readSavedCookieHeader,
} from "./browser-collector.js";
import {
  applyNoonStealth,
  launchNoonChromium,
  noonBrowserContextOptions,
  withNoonBrowserLock,
} from "./browser-launch.js";

export type SessionUsable =
  | "ok"
  | "blocked"
  | "expired"
  | "missing"
  | "unknown";

export type SessionProbeResult = {
  usable: SessionUsable;
  probedAt: string;
  finalUrl: string;
  httpStatus: number | null;
  verdict: string;
  message: string;
  hasIdentityCookies: boolean;
  probeUrl: string;
};

const FAULT_ABORT_RE = /fault\s*filter\s*abort/i;
const DEFAULT_PROBE_URL = "https://www.noon.partners/en-ae/";

function probeResultPath() {
  return join(getBrowserSessionPaths().sessionDir, "session-probe.json");
}

export function readLastSessionProbe(): SessionProbeResult | null {
  const p = probeResultPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SessionProbeResult;
  } catch {
    return null;
  }
}

function writeLastSessionProbe(result: SessionProbeResult) {
  const paths = getBrowserSessionPaths();
  mkdirSync(paths.sessionDir, { recursive: true });
  writeFileSync(probeResultPath(), JSON.stringify(result, null, 2), "utf8");
}

function classify(
  url: string,
  title: string,
  body: string,
  httpStatus: number | null,
): string {
  const u = (url || "").toLowerCase();
  const t = `${title}\n${body}`.toLowerCase();
  if (httpStatus === 418 || FAULT_ABORT_RE.test(t) || FAULT_ABORT_RE.test(title)) {
    return "GATEWAY_BLOCK";
  }
  if (
    u.includes("login.noon.partners") ||
    t.includes("we've sent you an email") ||
    t.includes("log in with otp") ||
    t.includes("session not found")
  ) {
    return "LOGIN_PAGE";
  }
  if (u.includes("www.noon.partners") && !u.includes("login.noon.partners")) {
    if (
      /seller|catalog|inventory|organizations|project|orders|export|partner/i.test(
        t,
      )
    ) {
      return "SELLER_LAB";
    }
    return "NOON_PARTNERS_UNKNOWN";
  }
  return "OTHER";
}

function toUsable(
  verdict: string,
  hasIdentity: boolean,
): SessionUsable {
  if (verdict === "GATEWAY_BLOCK") return "blocked";
  if (verdict === "LOGIN_PAGE" || verdict === "SESSION_NOT_FOUND") return "expired";
  if (verdict === "SELLER_LAB" && hasIdentity) return "ok";
  if (verdict === "SELLER_LAB") return "unknown";
  return "unknown";
}

function messageFor(usable: SessionUsable, verdict: string): string {
  switch (usable) {
    case "ok":
      return "探针通过：已进入 Seller Lab，可执行自动同步";
    case "blocked":
      return "探针失败：NOON 网关拦截（fault filter abort / 418）。请重新打开登录窗后尽快同步";
    case "expired":
      return "探针失败：已回到登录页或会话失效。请重新打开登录窗";
    case "missing":
      return "无本地登录态文件。请先打开登录窗完成登录";
    default:
      return `探针结果不明确（${verdict}）。建议重新打开登录窗后再试`;
  }
}

/**
 * Playwright 探针。默认有头、单页，避免连打。
 */
export async function probeSessionUsability(opts?: {
  probeUrl?: string;
  headless?: boolean;
}): Promise<SessionProbeResult> {
  const paths = getBrowserSessionPaths();
  const probeUrl =
    opts?.probeUrl?.trim() ||
    process.env.OUTPOST_NOON_PROBE_URL?.trim() ||
    DEFAULT_PROBE_URL;
  const probedAt = new Date().toISOString();

  if (!existsSync(paths.storageStatePath) && !readSavedCookieHeader()) {
    const missing: SessionProbeResult = {
      usable: "missing",
      probedAt,
      finalUrl: "",
      httpStatus: null,
      verdict: "MISSING",
      message: messageFor("missing", "MISSING"),
      hasIdentityCookies: false,
      probeUrl,
    };
    writeLastSessionProbe(missing);
    return missing;
  }

  if (!existsSync(paths.storageStatePath)) {
    const unknown: SessionProbeResult = {
      usable: "unknown",
      probedAt,
      finalUrl: "",
      httpStatus: null,
      verdict: "NO_STORAGE_STATE",
      message:
        "仅有 cookie-header，缺少 storage-state.json。请重新打开登录窗保存完整会话",
      hasIdentityCookies: Boolean(readSavedCookieHeader()?.includes("_npsid")),
      probeUrl,
    };
    writeLastSessionProbe(unknown);
    return unknown;
  }

  const fileStatus = getSessionFileStatus();
  if (fileStatus.health === "expired") {
    const expired: SessionProbeResult = {
      usable: "expired",
      probedAt,
      finalUrl: "",
      httpStatus: null,
      verdict: "META_EXPIRED",
      message: messageFor("expired", "META_EXPIRED"),
      hasIdentityCookies: true,
      probeUrl,
    };
    writeLastSessionProbe(expired);
    return expired;
  }

  return withNoonBrowserLock(async () => {
    let playwright: typeof import("playwright");
    try {
      playwright = await import("playwright");
    } catch {
      const unknown: SessionProbeResult = {
        usable: "unknown",
        probedAt,
        finalUrl: "",
        httpStatus: null,
        verdict: "NO_PLAYWRIGHT",
        message: "未安装 playwright，无法探针。请在 apps/api 安装 playwright",
        hasIdentityCookies: false,
        probeUrl,
      };
      writeLastSessionProbe(unknown);
      return unknown;
    }

    const headless =
      opts?.headless === true || process.env.OUTPOST_SOP_HEADLESS === "1";
    const { browser } = await launchNoonChromium(playwright.chromium, {
      headless,
      viewport: { width: 1360, height: 900 },
    });

    try {
      const context = await browser.newContext(
        noonBrowserContextOptions({
          storageState: paths.storageStatePath,
          viewport: { width: 1360, height: 900 },
        }),
      );
      await applyNoonStealth(context);
      const page = await context.newPage();

      let httpStatus: number | null = null;
      let finalUrl = "";
      let title = "";
      let body = "";
      let verdict = "ERROR";

      try {
        const res = await page.goto(probeUrl, {
          waitUntil: "load",
          timeout: 90_000,
        });
        httpStatus = res?.status() ?? null;
        await new Promise((r) => setTimeout(r, 3_500));
        finalUrl = page.url();
        title = await page.title().catch(() => "");
        body = (await page.locator("body").innerText().catch(() => "")).slice(
          0,
          1200,
        );
        verdict = classify(finalUrl, title, body, httpStatus);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/ERR_HTTP2|418|fault/i.test(msg)) {
          verdict = "GATEWAY_BLOCK";
        } else {
          verdict = "ERROR";
          const unknown: SessionProbeResult = {
            usable: "unknown",
            probedAt,
            finalUrl,
            httpStatus,
            verdict,
            message: `探针导航失败：${msg.slice(0, 200)}`,
            hasIdentityCookies: false,
            probeUrl,
          };
          writeLastSessionProbe(unknown);
          await context.close().catch(() => undefined);
          return unknown;
        }
      }

      const cookies = (await context.cookies(
        "https://www.noon.partners/",
      )) as Array<{ name: string }>;
      const hasIdentityCookies = cookies.some(
        (c: { name: string }) =>
          c.name === "_npsid" || c.name === "_nprtnetid",
      );
      const usable = toUsable(verdict, hasIdentityCookies);
      const result: SessionProbeResult = {
        usable,
        probedAt,
        finalUrl,
        httpStatus,
        verdict,
        message: messageFor(usable, verdict),
        hasIdentityCookies,
        probeUrl,
      };
      writeLastSessionProbe(result);
      await context.close().catch(() => undefined);
      return result;
    } finally {
      try {
        if (browser.isConnected()) await browser.close();
      } catch {
        /* ignore */
      }
    }
  });
}
