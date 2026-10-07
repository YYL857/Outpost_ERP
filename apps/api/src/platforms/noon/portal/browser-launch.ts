/**
 * Playwright 启动选项（登录采集 + SOP 共用）。
 * 目标：降低被 NOON/Akamai 当成明显机器人的概率（不能保证不被拦）。
 */

export const NOON_STEALTH_INIT_SCRIPT = `
() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!window.chrome) {
    window.chrome = { runtime: {} };
  }
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-AE', 'en-US', 'en', 'ar'],
  });
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });
}
`;

export function noonChromiumLaunchOptions(opts: {
  headless: boolean;
  viewport?: { width: number; height: number };
  /** 登录采集时关掉崩溃恢复多标签，减少闪屏（仅 persistent profile 需要） */
  forLogin?: boolean;
}) {
  const args = [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (opts.forLogin) {
    args.push(
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--disable-restore-session-state",
    );
  }
  return {
    headless: opts.headless,
    acceptDownloads: true as const,
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"] as string[],
    args,
  };
}

/** 优先本机 Chrome（与 generic_login --chrome 一致），失败再回退捆绑 Chromium */
export function resolveNoonBrowserChannel(): string | undefined {
  const raw = process.env.OUTPOST_BROWSER_CHANNEL?.trim().toLowerCase();
  if (raw === "chromium" || raw === "bundled" || raw === "none") return undefined;
  if (raw === "chrome" || raw === "msedge" || raw === "chrome-beta") return raw;
  return "chrome";
}

export async function launchNoonChromium(
  chromium: { launch: (opts: Record<string, unknown>) => Promise<any> },
  opts: {
    headless: boolean;
    viewport?: { width: number; height: number };
    forLogin?: boolean;
  },
): Promise<{ browser: any; channel: string | undefined }> {
  // 无头更容易被拦：除非显式 OUTPOST_SOP_HEADLESS=1，SOP 侧应传 headless:false
  const base = noonChromiumLaunchOptions(opts);
  const channel = resolveNoonBrowserChannel();
  if (channel) {
    try {
      return {
        browser: await chromium.launch({ ...base, channel }),
        channel,
      };
    } catch {
      /* 本机未装 Chrome 时回退 */
    }
  }
  return {
    browser: await chromium.launch({ ...base }),
    channel: undefined,
  };
}

/** 与登录窗尽量一致的 context 参数，减少「登录一套、导出另一套」指纹差 */
export function noonBrowserContextOptions(opts?: {
  storageState?: string;
  viewport?: { width: number; height: number };
}) {
  return {
    viewport: opts?.viewport ?? { width: 1440, height: 900 },
    acceptDownloads: true,
    locale: "en-AE",
    timezoneId: process.env.OUTPOST_NOON_TZ?.trim() || "Asia/Dubai",
    colorScheme: "light" as const,
    hasTouch: false,
    javaScriptEnabled: true,
    ...(opts?.storageState ? { storageState: opts.storageState } : {}),
  };
}

export async function applyNoonStealth(context: {
  addInitScript: (script: string) => Promise<unknown>;
}) {
  await context.addInitScript(NOON_STEALTH_INIT_SCRIPT);
}

/** 动作间随机停顿，避免报表连点像脚本 */
export function humanPauseMs(minMs = 1200, maxMs = 3200): number {
  const lo = Math.max(200, minMs);
  const hi = Math.max(lo, maxMs);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export async function humanDelay(minMs = 1200, maxMs = 3200): Promise<void> {
  await new Promise((r) => setTimeout(r, humanPauseMs(minMs, maxMs)));
}

/** 同一时刻只允许一个 NOON 浏览器任务（登录或 SOP） */
let browserBusy = false;

export async function withNoonBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  if (browserBusy) {
    throw new Error(
      "NOON 浏览器正被占用（登录或 SOP 导出进行中）。请等待当前任务结束后再试。",
    );
  }
  browserBusy = true;
  try {
    return await fn();
  } finally {
    browserBusy = false;
  }
}
