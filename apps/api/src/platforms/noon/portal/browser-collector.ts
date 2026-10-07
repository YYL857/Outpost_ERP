import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  copyFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export type BrowserLoginInput = {
  portalUrl: string;
  userDataDir?: string;
  storageStatePath?: string;
  timeoutMs?: number;
};

export type BrowserLoginResult = {
  cookieCount: number;
  finalUrl: string;
  userDataDir: string;
  storageStatePath: string;
  cookieFilePath: string;
  reusedExistingSession: boolean;
  expiresAt: string | null;
  expiresSource: "cookie" | "estimated" | "unknown";
  message: string;
};

export type SessionCookieMeta = {
  name: string;
  domain: string;
  /** ISO；会话 Cookie 为 null */
  expiresAt: string | null;
};

export type SessionMetaFile = {
  savedAt: string;
  expiresAt: string | null;
  expiresSource: "cookie" | "estimated" | "unknown";
  cookieCount: number;
  cookies: SessionCookieMeta[];
};

export type SessionFileStatus = {
  cookieFilePath: string;
  storageStatePath: string;
  userDataDir: string;
  metaFilePath: string;
  hasSession: boolean;
  cookieCount: number;
  savedAt: string | null;
  expiresAt: string | null;
  expiresSource: "cookie" | "estimated" | "unknown" | null;
  /** 剩余毫秒；无会话为 null */
  remainingMs: number | null;
  /** missing | ok | warning | expired */
  health: "missing" | "ok" | "warning" | "expired";
  warnBeforeMs: number;
};

type PlaywrightCookie = {
  name: string;
  value: string;
  domain?: string;
  expires?: number;
};

function dataRoot() {
  const root =
    process.env.OUTPOST_BROWSER_DIR?.trim() ||
    process.env.OUTPOST_DATA_DIR?.trim() ||
    "D:\\outpost-data";
  return resolve(root.includes("json") ? join(root, "..") : root);
}

export function getBrowserSessionPaths() {
  const base = dataRoot();
  const sessionDir = join(base, "noon-session");
  return {
    userDataDir: join(base, "noon-browser-profile"),
    storageStatePath: join(sessionDir, "storage-state.json"),
    /** 完整 Cookie 数组（对齐 generic_login cookies.json） */
    cookiesJsonPath: join(sessionDir, "cookies.json"),
    cookieFilePath: join(sessionDir, "cookie-header.txt"),
    metaFilePath: join(sessionDir, "session-meta.json"),
    sessionDir,
  };
}

/** 覆盖前备份，避免半截写入毁掉可用会话 */
export function backupSessionArtifacts() {
  const paths = getBrowserSessionPaths();
  for (const src of [
    paths.storageStatePath,
    paths.cookiesJsonPath,
    paths.cookieFilePath,
    paths.metaFilePath,
  ]) {
    if (!existsSync(src)) continue;
    const bak = src.replace(/(\.\w+)$/, "_bak$1");
    try {
      copyFileSync(src, bak);
    } catch {
      /* ignore */
    }
  }
}

function warnBeforeMs() {
  const min = Number(process.env.OUTPOST_SESSION_WARN_MINUTES ?? 30);
  return Math.max(1, Number.isFinite(min) ? min : 30) * 60_000;
}

/** 无明确 Expires 的会话 Cookie：用保存后 N 小时作为软过期估算 */
function estimatedTtlMs() {
  const hours = Number(process.env.OUTPOST_SESSION_ESTIMATED_HOURS ?? 12);
  return Math.max(1, Number.isFinite(hours) ? hours : 12) * 3600_000;
}

function cookiesToHeader(cookies: PlaywrightCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function hasLeftLoginPage(url: string): boolean {
  const u = url.toLowerCase();
  if (!u.includes("noon.partners")) return false;
  if (u.includes("login.noon.partners")) return false;
  return true;
}

/** 统计 / 广告 / 无关第三方 Cookie 名（即使挂在 noon.partners 域下也丢掉） */
const EXCLUDED_COOKIE_NAMES =
  /^(_clck|_clsk|_cs_|CLID|MUID|MR|SM|SRM_B|ANONCHK|_ga|_gid|_fbp|_gcl|_etc)/i;

/** 非 NOON 业务域 */
const EXCLUDED_DOMAINS =
  /(clarity\.ms|bing\.com|google\.|facebook\.|doubleclick|googletagmanager)/i;

/**
 * 只保留访问 NOON Seller Lab 所需的 Cookie。
 * 排除 Clarity/Bing 等短效跟踪 Cookie，避免污染失效时间与请求头。
 */
export function filterSessionCookies(
  cookies: PlaywrightCookie[],
): PlaywrightCookie[] {
  return cookies.filter((c) => {
    const domain = c.domain ?? "";
    if (EXCLUDED_DOMAINS.test(domain)) return false;
    if (!/noon\.partners/i.test(domain)) return false;
    if (EXCLUDED_COOKIE_NAMES.test(c.name)) return false;
    return true;
  });
}

const AUTH_COOKIE_NAMES = /^(_npsid|_nprtnetid)$/i;

/** 从已过滤的 Cookie 列表解析业务失效时间 */
export function deriveExpiryFromCookies(cookies: PlaywrightCookie[]): {
  expiresAt: string | null;
  expiresSource: "cookie" | "estimated" | "unknown";
  metaCookies: SessionCookieMeta[];
} {
  const relevant = filterSessionCookies(cookies);
  const nowSec = Date.now() / 1000;
  const metaCookies: SessionCookieMeta[] = relevant.map((c) => {
    const exp = c.expires;
    const expiresAt =
      typeof exp === "number" && exp > 0
        ? new Date(exp * 1000).toISOString()
        : null;
    return {
      name: c.name,
      domain: c.domain ?? "",
      expiresAt,
    };
  });

  const authDated = relevant
    .filter((c) => AUTH_COOKIE_NAMES.test(c.name))
    .map((c) => c.expires)
    .filter((e): e is number => typeof e === "number" && e > nowSec);

  if (authDated.length > 0) {
    const earliestAuth = Math.min(...authDated);
    return {
      expiresAt: new Date(earliestAuth * 1000).toISOString(),
      expiresSource: "cookie",
      metaCookies,
    };
  }

  const noonDated = relevant
    .map((c) => c.expires)
    .filter((e): e is number => typeof e === "number" && e > nowSec);

  if (noonDated.length > 0) {
    const earliest = Math.min(...noonDated);
    return {
      expiresAt: new Date(earliest * 1000).toISOString(),
      expiresSource: "cookie",
      metaCookies,
    };
  }

  if (relevant.length > 0) {
    return {
      expiresAt: new Date(Date.now() + estimatedTtlMs()).toISOString(),
      expiresSource: "estimated",
      metaCookies,
    };
  }

  return { expiresAt: null, expiresSource: "unknown", metaCookies };
}

export function writeSessionArtifacts(cookies: PlaywrightCookie[]) {
  const { cookieFilePath, metaFilePath, sessionDir } = getBrowserSessionPaths();
  mkdirSync(sessionDir, { recursive: true });

  const relevant = filterSessionCookies(cookies);
  if (!relevant.some((c) => AUTH_COOKIE_NAMES.test(c.name))) {
    throw new Error(
      "过滤后未找到身份 Cookie（_npsid / _nprtnetid）。请确认已登录并进入 Seller Lab",
    );
  }

  const header = cookiesToHeader(relevant);
  writeFileSync(cookieFilePath, header, "utf8");

  const derived = deriveExpiryFromCookies(relevant);
  const meta: SessionMetaFile = {
    savedAt: new Date().toISOString(),
    expiresAt: derived.expiresAt,
    expiresSource: derived.expiresSource,
    cookieCount: relevant.length,
    cookies: derived.metaCookies,
  };
  writeFileSync(metaFilePath, JSON.stringify(meta, null, 2), "utf8");

  return { ...meta, cookieHeader: header };
}

/** 写出完整 storage_state + cookies.json + cookie-header（对齐 generic_login._save_state） */
export async function saveContextSession(
  context: {
    storageState: (opts: { path: string }) => Promise<unknown>;
    cookies: () => Promise<PlaywrightCookie[]>;
  },
  storageStatePath?: string,
) {
  const paths = getBrowserSessionPaths();
  const statePath = resolve(storageStatePath || paths.storageStatePath);
  mkdirSync(paths.sessionDir, { recursive: true });

  const allCookies = (await context.cookies()) as PlaywrightCookie[];
  const relevant = filterSessionCookies(allCookies);
  if (!relevant.some((c) => AUTH_COOKIE_NAMES.test(c.name))) {
    throw new Error(
      "当前浏览器上下文无有效身份 Cookie，拒绝覆盖已有登录态",
    );
  }

  backupSessionArtifacts();
  await context.storageState({ path: statePath });
  writeFileSync(
    paths.cookiesJsonPath,
    JSON.stringify(allCookies, null, 2),
    "utf8",
  );
  const meta = writeSessionArtifacts(allCookies);
  return { meta, cookies: allCookies, storageStatePath: statePath };
}

/** 清洗已落盘的会话文件（去掉第三方/短效无关 Cookie） */
export function pruneSavedSessionFiles(): SessionMetaFile | null {
  const { storageStatePath, cookieFilePath } = getBrowserSessionPaths();
  let cookies: PlaywrightCookie[] = [];
  if (existsSync(storageStatePath)) {
    try {
      const raw = JSON.parse(readFileSync(storageStatePath, "utf8")) as {
        cookies?: PlaywrightCookie[];
      };
      cookies = raw.cookies ?? [];
    } catch {
      cookies = [];
    }
  }
  if (!cookies.length && existsSync(cookieFilePath)) {
    // 仅有 header、无 storage-state 时无法按 domain 精滤，跳过
    return readSessionMeta();
  }
  if (!cookies.length) return null;
  return writeSessionArtifacts(cookies);
}

/** @deprecated 仅写 header；请用 writeSessionArtifacts */
export function writeSavedCookieHeader(cookieHeader: string) {
  const { cookieFilePath, sessionDir } = getBrowserSessionPaths();
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(cookieFilePath, cookieHeader.trim(), "utf8");
}

export function readSavedCookieHeader(): string | null {
  const { cookieFilePath } = getBrowserSessionPaths();
  if (!existsSync(cookieFilePath)) return null;
  const text = readFileSync(cookieFilePath, "utf8").trim();
  return text || null;
}

export function readSessionMeta(): SessionMetaFile | null {
  const { metaFilePath } = getBrowserSessionPaths();
  if (!existsSync(metaFilePath)) return null;
  try {
    return JSON.parse(readFileSync(metaFilePath, "utf8")) as SessionMetaFile;
  } catch {
    return null;
  }
}

export function clearSavedCookieHeader() {
  const { cookieFilePath, metaFilePath } = getBrowserSessionPaths();
  if (existsSync(cookieFilePath)) unlinkSync(cookieFilePath);
  if (existsSync(metaFilePath)) unlinkSync(metaFilePath);
}

export function getSessionFileStatus(): SessionFileStatus {
  const paths = getBrowserSessionPaths();
  const cookie = readSavedCookieHeader();
  const meta = readSessionMeta();
  const warnMs = warnBeforeMs();
  const hasSession = Boolean(cookie);
  const expiresAt = meta?.expiresAt ?? null;
  const savedAt = meta?.savedAt ?? null;
  let remainingMs: number | null = null;
  let health: SessionFileStatus["health"] = "missing";

  if (hasSession) {
    if (expiresAt) {
      remainingMs = new Date(expiresAt).getTime() - Date.now();
      if (remainingMs <= 0) health = "expired";
      else if (remainingMs <= warnMs) health = "warning";
      else health = "ok";
    } else {
      health = "ok";
      remainingMs = null;
    }
  }

  return {
    cookieFilePath: paths.cookieFilePath,
    storageStatePath: paths.storageStatePath,
    userDataDir: paths.userDataDir,
    metaFilePath: paths.metaFilePath,
    hasSession,
    cookieCount: meta?.cookieCount
      ?? (cookie
        ? cookie.split(";").map((s) => s.trim()).filter(Boolean).length
        : 0),
    savedAt,
    expiresAt,
    expiresSource: meta?.expiresSource ?? null,
    remainingMs,
    health,
    warnBeforeMs: warnMs,
  };
}

/**
 * 打开浏览器登录页 → 进入 Seller Lab 后延迟落盘 → 关窗收尾。
 *
 * 对齐 F:\抖音电商复约自动化\scraper\generic_login.py 的 fresh_login：
 * - 本机 Chrome channel（非 persistent profile）
 * - 干净上下文，不注入旧 storage_state（否则 NOON OTP 易 Session not found）
 * - 检测到目标页后 sleep 3s 再保存
 * - 完整 storage_state.json + cookies.json；覆盖前备份
 */
export async function collectWithBrowser(
  input: BrowserLoginInput,
): Promise<BrowserLoginResult> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error(
      "未安装 playwright。请在 apps/api 目录执行：npm install playwright && npx playwright install chromium",
    );
  }

  const paths = getBrowserSessionPaths();
  const userDataDir = resolve(input.userDataDir || paths.userDataDir);
  const storageStatePath = resolve(
    input.storageStatePath || paths.storageStatePath,
  );
  mkdirSync(paths.sessionDir, { recursive: true });
  mkdirSync(userDataDir, { recursive: true });

  const portalUrl = input.portalUrl || "https://login.noon.partners/";
  const timeoutMs = input.timeoutMs ?? 15 * 60 * 1000;
  /** Seller Lab 成功 URL 片段（对齐 generic_login --success-url） */
  const successUrlHint =
    process.env.OUTPOST_NOON_SUCCESS_URL?.trim() || "www.noon.partners";

  const {
    launchNoonChromium,
    noonBrowserContextOptions,
    applyNoonStealth,
    withNoonBrowserLock,
  } = await import("./browser-launch.js");

  return withNoonBrowserLock(async () => {
    const { chromium } = playwright;
    const { browser, channel } = await launchNoonChromium(chromium, {
      headless: false,
      viewport: { width: 1360, height: 900 },
      forLogin: true,
    });

    // 对齐 generic_login 的 fresh_login：登录窗必须干净上下文。
    // 若注入旧 storage_state，NOON OTP 常报 Session not found（验证码对也会失败）。
    const context = await browser.newContext(
      noonBrowserContextOptions({
        viewport: { width: 1360, height: 900 },
      }),
    );
    await applyNoonStealth(context);

    let lastCookies: PlaywrightCookie[] = [];
    let lastUrl = portalUrl;
    let persistedMeta: ReturnType<typeof writeSessionArtifacts> | null = null;

    const refreshMemory = async () => {
      try {
        for (const p of context.pages()) {
          if (p.isClosed()) continue;
          try {
            const u = p.url();
            if (u && u !== "about:blank" && hasLeftLoginPage(u)) lastUrl = u;
            else if (u && /noon\.partners/i.test(u)) lastUrl = u;
          } catch {
            /* ignore */
          }
        }
        lastCookies = (await context.cookies()) as PlaywrightCookie[];
      } catch {
        /* ignore */
      }
    };

    const hasAuthCookies = () =>
      filterSessionCookies(lastCookies).some((c) =>
        AUTH_COOKIE_NAMES.test(c.name),
      );

    const isSellerLabReady = () => {
      const urlOk =
        hasLeftLoginPage(lastUrl) ||
        (Boolean(successUrlHint) &&
          lastUrl.toLowerCase().includes(successUrlHint.toLowerCase()) &&
          !/login\.noon\.partners/i.test(lastUrl));
      return urlOk && hasAuthCookies();
    };

    const persistSettled = async (): Promise<boolean> => {
      await refreshMemory();
      if (!isSellerLabReady()) return false;
      // generic_login：检测到成功后先等 3 秒再落盘
      await new Promise((r) => setTimeout(r, 3_000));
      await refreshMemory();
      if (!hasAuthCookies()) return false;
      try {
        const saved = await saveContextSession(context, storageStatePath);
        persistedMeta = saved.meta;
        lastCookies = saved.cookies;
        return true;
      } catch {
        return false;
      }
    };

    const buildResult = (
      meta: ReturnType<typeof writeSessionArtifacts>,
    ): BrowserLoginResult => {
      const expHint = meta.expiresAt
        ? meta.expiresSource === "estimated"
          ? `（估算失效 ${meta.expiresAt}）`
          : `（身份票失效 ${meta.expiresAt}）`
        : "";
      const authNames = meta.cookies
        .filter((c) => AUTH_COOKIE_NAMES.test(c.name))
        .map((c) => c.name)
        .join(",");
      const via = channel ? `（${channel}）` : "（Chromium）";
      return {
        cookieCount: meta.cookieCount,
        finalUrl: lastUrl,
        userDataDir,
        storageStatePath,
        cookieFilePath: paths.cookieFilePath,
        reusedExistingSession: hasLeftLoginPage(lastUrl),
        expiresAt: meta.expiresAt,
        expiresSource: meta.expiresSource,
        message: `登录态已保存${via}：${meta.cookieCount} 条 NOON Cookie（含 ${authNames || "身份票"}），页面 ${lastUrl}${expHint}。可关闭登录窗。`,
      };
    };

    try {
      const page = await context.newPage();
      await page.goto(portalUrl, {
        waitUntil: "load",
        timeout: 120_000,
      });
      await refreshMemory();

      // 干净上下文一般不会一打开就在后台；SSO 完成后仍可能瞬时就绪
      if (isSellerLabReady()) {
        await persistSettled();
      }

      const closedPromise = new Promise<"closed">((resolve) => {
        browser.on("disconnected", () => resolve("closed"));
        page.on("close", () => {
          if (!browser.isConnected()) resolve("closed");
        });
      });

      const pollPromise = (async (): Promise<"saved" | "timeout"> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (!browser.isConnected()) return "timeout";
          await refreshMemory();
          if (!persistedMeta && isSellerLabReady()) {
            const ok = await persistSettled();
            if (ok) return "saved";
          }
          if (persistedMeta) return "saved";
          await new Promise((r) => setTimeout(r, 2_000));
        }
        return "timeout";
      })();

      const first = await Promise.race([closedPromise, pollPromise]);

      if (first === "saved") {
        // 已落盘：等用户关窗收尾；关窗前再刷一次（续期 Cookie）
        const end = await Promise.race([
          closedPromise,
          new Promise<"timeout">((r) => setTimeout(() => r("timeout"), timeoutMs)),
        ]);
        if (browser.isConnected()) {
          try {
            const saved = await saveContextSession(context, storageStatePath);
            persistedMeta = saved.meta;
          } catch {
            /* ignore */
          }
          if (end === "timeout") {
            await browser.close().catch(() => undefined);
          }
        }
        if (persistedMeta) return buildResult(persistedMeta);
      }

      if (first === "closed" || !browser.isConnected()) {
        // 关窗瞬间若尚未落盘，已无法从活 context 再写；只能报错
        if (persistedMeta) return buildResult(persistedMeta);
        throw new Error(
          "浏览器已关闭，但未保存到有效登录态。请重新打开登录窗，进入 Seller Lab（www.noon.partners）并稍等几秒后再关窗",
        );
      }

      // timeout without save
      if (browser.isConnected()) {
        await refreshMemory();
        if (isSellerLabReady()) {
          const ok = await persistSettled();
          await browser.close().catch(() => undefined);
          if (ok && persistedMeta) return buildResult(persistedMeta);
        }
        await browser.close().catch(() => undefined);
      }

      throw new Error(
        "等待超时：请登录并进入 Seller Lab（地址栏含 www.noon.partners）。进入后系统会等待约 3 秒自动保存，再关闭窗口即可",
      );
    } finally {
      try {
        if (browser.isConnected()) await browser.close();
      } catch {
        /* already closed */
      }
    }
  });
}
