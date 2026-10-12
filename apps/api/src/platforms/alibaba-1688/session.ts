/**
 * 1688 Playwright 会话：优先持久化用户目录（登录不丢），并导出 storageState 备份。
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
} from "playwright";
import {
  ensureAlibaba1688Dir,
  getAlibaba1688Dir,
  getDefaultStorageStatePath,
} from "./types.js";

export type OpenSessionOptions = {
  headed?: boolean;
  timeoutMs?: number;
  storageStatePath?: string;
  /** true：不加载 storageState（仅非持久化模式） */
  fresh?: boolean;
  /** true：用 browser-profile 持久化目录（推荐登录/查物流） */
  persistent?: boolean;
};

export type OpenSessionResult = {
  browser: Browser | null;
  context: BrowserContext;
  storageStatePath: string;
  usedStorageState: boolean;
  persistent: boolean;
};

export function get1688BrowserProfileDir(): string {
  const fromEnv = process.env.OUTPOST_1688_PROFILE_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(getAlibaba1688Dir(), "browser-profile");
}

export async function open1688Session(
  opts: OpenSessionOptions = {},
): Promise<OpenSessionResult> {
  ensureAlibaba1688Dir();
  const storageStatePath =
    opts.storageStatePath?.trim() || getDefaultStorageStatePath();
  const headed = opts.headed === true;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const persistent = opts.persistent !== false;

  const launchArgs = ["--disable-blink-features=AutomationControlled"];
  const channel = process.env.OUTPOST_1688_BROWSER_CHANNEL?.trim() || undefined;

  if (persistent) {
    const userDataDir = get1688BrowserProfileDir();
    mkdirSync(userDataDir, { recursive: true });
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: !headed,
      locale: "zh-CN",
      viewport: { width: 1440, height: 900 },
      args: launchArgs,
      ...(channel ? { channel } : {}),
    });
    context.setDefaultTimeout(timeoutMs);
    return {
      browser: null,
      context,
      storageStatePath,
      usedStorageState: existsSync(storageStatePath),
      persistent: true,
    };
  }

  const browser = await chromium.launch({
    headless: !headed,
    args: launchArgs,
    ...(channel ? { channel } : {}),
  });
  const usedStorageState = !opts.fresh && existsSync(storageStatePath);
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
    ...(usedStorageState ? { storageState: storageStatePath } : {}),
  });
  context.setDefaultTimeout(timeoutMs);
  return {
    browser,
    context,
    storageStatePath,
    usedStorageState,
    persistent: false,
  };
}

export async function close1688Session(session: OpenSessionResult): Promise<void> {
  await session.context.close().catch(() => {});
  if (session.browser) await session.browser.close().catch(() => {});
}

export async function save1688StorageState(
  context: BrowserContext,
  path = getDefaultStorageStatePath(),
): Promise<string> {
  ensureAlibaba1688Dir();
  await context.storageState({ path });
  return path;
}
