/**
 * 有头登录并保存会话。
 *
 * 稳妥原则：
 * 1. 持久化 browser-profile，不要每次空白浏览器
 * 2. 只用「真登录 Cookie」(cookie2 + 身份) 判定，忽略匿名 t/cna
 * 3. 登录页只打开一次，等待期间绝不刷新/重开登录页
 * 4. 确认登录后先回首页稳 Cookie，再软校验订单列表（最多 1 次）
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Cookie, Page } from "playwright";
import {
  close1688Session,
  open1688Session,
  save1688StorageState,
} from "./session.js";
import {
  BUYER_ORDER_LIST_BASE,
  ensureAlibaba1688Dir,
  getDefaultStorageStatePath,
  hasStorageState,
} from "./types.js";

const HOME_URL = "https://www.1688.com/";
/** Done 指回首页，减少登录后乱跳 */
const LOGIN_URL =
  "https://login.1688.com/member/signin.htm?style=tao_custom&from=1688web&Done=https%3A%2F%2Fwww.1688.com%2F";

/** 真登录相关（不要把匿名追踪 Cookie 算进来） */
const SESSION_COOKIE_NAMES = new Set([
  "cookie2",
  "unb",
  "lid",
  "_nk_",
  "tracknick",
  "sgcookie",
  "csg",
  "sn",
  "_tb_token_",
]);

const IDENTITY_COOKIE_NAMES = new Set(["unb", "_nk_", "lid", "tracknick"]);

export type CaptureLoginResult = {
  ok: boolean;
  message: string;
  storageStatePath: string;
  durationMs: number;
  screenshotPath?: string;
  cookieHits?: string[];
  orderListVerified?: boolean;
};

export type SessionStatus = {
  hasSession: boolean;
  storageStatePath: string;
  cookieHits: string[];
  savedAt: string | null;
  fileBytes: number;
};

async function pageText(page: Page, max = 2000): Promise<string> {
  return ((await page.locator("body").innerText().catch(() => "")) || "").slice(
    0,
    max,
  );
}

function sessionCookieHits(cookies: Cookie[]): string[] {
  const hits = new Set<string>();
  for (const c of cookies) {
    const name = (c.name || "").trim();
    if (!name || !SESSION_COOKIE_NAMES.has(name)) continue;
    if (!(c.value || "").trim()) continue;
    hits.add(name);
  }
  return [...hits].sort();
}

/** cookie2 + 至少一个身份 Cookie 才算登录成功 */
export function isLoggedInCookieHits(hits: string[]): boolean {
  const set = new Set(hits);
  if (!set.has("cookie2")) return false;
  for (const n of IDENTITY_COOKIE_NAMES) {
    if (set.has(n)) return true;
  }
  return false;
}

async function collectSessionHits(context: BrowserContext): Promise<string[]> {
  return sessionCookieHits(await context.cookies());
}

function looksLikeLoginPage(url: string, body: string): boolean {
  if (/login\.1688|login\.taobao|passport\.alibaba|login\.alibaba/i.test(url)) {
    return /扫码登录|密码登录|请输入登录名|手机号登录|打开手机扫码/.test(body);
  }
  return /扫码登录|打开手机扫码|请输入登录名/.test(body.slice(0, 500));
}

async function softVerifyOrderListOnce(page: Page): Promise<boolean> {
  await page
    .goto(
      `${BUYER_ORDER_LIST_BASE}?spm=a360q.7751291.topmenu.dmyorder_popup_dallorder&page=1&pageSize=30`,
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(3000);
  const url = page.url();
  const body = await pageText(page);
  if (looksLikeLoginPage(url, body)) return false;
  return (
    /已买到的货品|待收货|待发货|订单号|批量导入|共查询到/.test(body) ||
    /\b\d{18,19}\b/.test(body)
  );
}

/**
 * 弹出有头浏览器（持久化目录）：扫码一次即可，等待期间不刷新登录页。
 */
export async function capture1688LoginSession(opts?: {
  loginWaitMs?: number;
  storageStatePath?: string;
}): Promise<CaptureLoginResult> {
  const started = Date.now();
  const dir = ensureAlibaba1688Dir();
  const storageStatePath =
    opts?.storageStatePath?.trim() || getDefaultStorageStatePath();
  const loginWaitMs = opts?.loginWaitMs ?? 300_000;

  const session = await open1688Session({
    headed: true,
    timeoutMs: Math.max(90_000, loginWaitMs),
    persistent: true,
    storageStatePath,
  });

  let screenshotPath: string | undefined;
  try {
    const page =
      session.context.pages()[0] ?? (await session.context.newPage());

    // 先回首页看是否已登录（复用 profile，避免反复扫码）
    await page.goto(HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);
    let hits = await collectSessionHits(session.context);

    if (
      isLoggedInCookieHits(hits) &&
      !looksLikeLoginPage(page.url(), await pageText(page))
    ) {
      await save1688StorageState(session.context, storageStatePath);
      const verified = await softVerifyOrderListOnce(page);
      await save1688StorageState(session.context, storageStatePath);
      hits = await collectSessionHits(session.context);
      return {
        ok: true,
        message: verified
          ? `已有登录态（复用本地浏览器配置），订单列表可用。Cookie: ${hits.join(", ")}`
          : `已有登录 Cookie 并已保存。订单列表未完全打开，可先试同步物流。Cookie: ${hits.join(", ")}`,
        storageStatePath,
        durationMs: Date.now() - started,
        cookieHits: hits,
        orderListVerified: verified,
      };
    }

    // 未登录：登录页只打开一次，之后只轮询 Cookie，绝不刷新登录页
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(1500);

    const deadline = Date.now() + loginWaitMs;
    let logged = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2500);
      hits = await collectSessionHits(session.context);
      const url = page.url();
      const body = await pageText(page);
      const leftLogin = !looksLikeLoginPage(url, body);

      // 必须：真登录 Cookie；并已离开扫码页（或首页已有账号痕迹）
      if (isLoggedInCookieHits(hits) && leftLogin) {
        logged = true;
        break;
      }
      // 仍在登录域但 Cookie 已齐：再等 SSO 跳转，不要 goto
      if (isLoggedInCookieHits(hits) && !leftLogin) {
        await page.waitForTimeout(3000);
        hits = await collectSessionHits(session.context);
        const body2 = await pageText(page);
        if (
          isLoggedInCookieHits(hits) &&
          !looksLikeLoginPage(page.url(), body2)
        ) {
          logged = true;
          break;
        }
        // Cookie 齐了也算成功，稍后主动回首页
        if (isLoggedInCookieHits(hits)) {
          logged = true;
          break;
        }
      }
    }

    if (!logged || !isLoggedInCookieHits(hits)) {
      screenshotPath = join(
        dir,
        "runs",
        `login-timeout-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      return {
        ok: false,
        message: `等待登录超时（${Math.round(loginWaitMs / 1000)}s）。请只扫一次码，不要关窗口；成功后会自动保存。若二维码自己变了，那是 1688 正常刷新，请扫最新码。`,
        storageStatePath,
        durationMs: Date.now() - started,
        screenshotPath,
        cookieHits: hits,
        orderListVerified: false,
      };
    }

    // 登录成功：先回首页稳住 SSO，再落盘（不要连跳订单页导致踢回登录）
    await page.waitForTimeout(2000);
    await page.goto(HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    }).catch(() => {});
    await page.waitForTimeout(3000);
    hits = await collectSessionHits(session.context);
    await save1688StorageState(session.context, storageStatePath);

    if (!isLoggedInCookieHits(hits)) {
      screenshotPath = join(
        dir,
        "runs",
        `login-cookie-lost-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      return {
        ok: false,
        message:
          "扫码后 Cookie 未稳住。请再点一次「获取 1688 登录态」（会复用同一浏览器配置，通常不用重扫）。",
        storageStatePath,
        durationMs: Date.now() - started,
        screenshotPath,
        cookieHits: hits,
        orderListVerified: false,
      };
    }

    const verified = await softVerifyOrderListOnce(page);
    await save1688StorageState(session.context, storageStatePath);
    hits = await collectSessionHits(session.context);

    if (!verified) {
      screenshotPath = join(
        dir,
        "runs",
        `login-soft-verify-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    }

    return {
      ok: true,
      message: verified
        ? `登录态已保存（持久化配置 + Cookie: ${hits.join(", ")}），订单列表可用`
        : `登录 Cookie 已保存（${hits.join(", ")}）。订单列表校验未过，可先试同步；失败再点获取登录态（一般不用重扫）`,
      storageStatePath,
      durationMs: Date.now() - started,
      screenshotPath,
      cookieHits: hits,
      orderListVerified: verified,
    };
  } finally {
    await close1688Session(session);
  }
}

export function get1688SessionStatus(): SessionStatus {
  const storageStatePath = getDefaultStorageStatePath();
  if (!hasStorageState(storageStatePath)) {
    return {
      hasSession: false,
      storageStatePath,
      cookieHits: [],
      savedAt: null,
      fileBytes: 0,
    };
  }
  try {
    const st = statSync(storageStatePath);
    const raw = JSON.parse(readFileSync(storageStatePath, "utf8")) as {
      cookies?: Array<{ name?: string; domain?: string; value?: string }>;
    };
    const fakeCookies = (raw.cookies ?? []).map((c) => ({
      name: c.name || "",
      value: c.value || "",
      domain: c.domain || "",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    }));
    const cookieHits = sessionCookieHits(fakeCookies);
    return {
      hasSession: isLoggedInCookieHits(cookieHits),
      storageStatePath,
      cookieHits,
      savedAt: st.mtime.toISOString(),
      fileBytes: st.size,
    };
  } catch {
    return {
      hasSession: existsSync(storageStatePath),
      storageStatePath,
      cookieHits: [],
      savedAt: null,
      fileBytes: 0,
    };
  }
}
