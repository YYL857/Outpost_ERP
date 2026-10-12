/**
 * 货代门户登录探测 — Playwright
 * 边界：只读登录页并尝试登录；不写飞书；凭据仅来自本地 credentials.json。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  getForwarderPortalsDir,
  type ForwarderAdapterId,
  type ForwarderPortalAccount,
  type ForwarderPortalRef,
  type LoginProbeResult,
} from "./types.js";

export type ProbeOptions = {
  headed?: boolean;
  timeoutMs?: number;
  keepOpenMs?: number;
};

async function dismissNoise(page: Page) {
  for (const sel of [
    "button:has-text('同意')",
    "button:has-text('确定')",
    "button:has-text('我知道了')",
    ".el-message-box__btns button",
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 800 })) await btn.click({ timeout: 1000 });
    } catch {
      /* ignore */
    }
  }
}

async function fillFirst(
  page: Page,
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 1500 })) {
        await loc.click({ timeout: 2000 });
        await loc.fill("");
        await loc.fill(value);
        return true;
      }
    } catch {
      /* next */
    }
  }
  return false;
}

async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 1500 })) {
        await loc.click({ timeout: 3000 });
        return true;
      }
    } catch {
      /* next */
    }
  }
  return false;
}

const USER_SELECTORS = [
  'input[type="text"]',
  'input[type="tel"]',
  'input[name*="user" i]',
  'input[name*="account" i]',
  'input[name*="login" i]',
  'input[placeholder*="账号"]',
  'input[placeholder*="用户"]',
  'input[placeholder*="手机"]',
  'input[placeholder*="邮箱"]',
  'input[placeholder*="Account" i]',
  'input[placeholder*="用户名"]',
  ".el-input input",
];

const PASS_SELECTORS = [
  'input[type="password"]',
  'input[name*="pass" i]',
  'input[placeholder*="密码"]',
  'input[placeholder*="Password" i]',
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  "button:has-text('登录')",
  "button:has-text('登 录')",
  "button:has-text('Sign in')",
  "button:has-text('Login')",
  ".el-button--primary",
  "a:has-text('登录')",
];

function looksLoggedIn(url: string, adapter: ForwarderAdapterId): boolean {
  const u = url.toLowerCase();
  if (u.includes("login")) return false;
  if (adapter === "nextsls") {
    return u.includes("/tms/wos/") && !u.includes("/login");
  }
  if (adapter === "fleetan") return !u.includes("/login");
  if (adapter === "ontask") return u.includes("dashboard") || !u.includes("login");
  if (adapter === "chicexpress") return !u.includes("login");
  if (adapter === "yundaomen") return !u.includes("login");
  return !u.includes("login");
}

export async function probePortalLogin(
  portal: ForwarderPortalRef,
  account: ForwarderPortalAccount,
  opts: ProbeOptions = {},
): Promise<LoginProbeResult> {
  const started = Date.now();
  const shotDir = join(getForwarderPortalsDir(), "probes");
  mkdirSync(shotDir, { recursive: true });
  const screenshotPath = join(shotDir, `${portal.id}-${Date.now()}.png`);

  let browser: Browser | null = null;
  let stage: LoginProbeResult["stage"] = "launch";
  try {
    browser = await chromium.launch({
      headless: opts.headed === false ? true : false,
      slowMo: opts.headed === false ? 0 : 80,
    });
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1360, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(opts.timeoutMs ?? 25_000);

    stage = "navigate";
    await page.goto(portal.loginUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await dismissNoise(page);

    stage = "fill";
    const userOk = await fillFirst(page, USER_SELECTORS, account.username);
    if (!userOk) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return {
        portalId: portal.id,
        name: portal.name,
        adapter: portal.adapter,
        ok: false,
        stage,
        message: "未找到账号输入框",
        finalUrl: page.url(),
        screenshotPath,
        durationMs: Date.now() - started,
      };
    }
    const passOk = await fillFirst(page, PASS_SELECTORS, account.password);
    if (!passOk) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return {
        portalId: portal.id,
        name: portal.name,
        adapter: portal.adapter,
        ok: false,
        stage,
        message: "未找到密码输入框",
        finalUrl: page.url(),
        screenshotPath,
        durationMs: Date.now() - started,
      };
    }

    stage = "submit";
    const clicked = await clickFirst(page, SUBMIT_SELECTORS);
    if (!clicked) {
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(2500);
    await dismissNoise(page);

    stage = "verify";
    const finalUrl = page.url();
    const bodyText = ((await page.locator("body").innerText().catch(() => "")) || "").slice(
      0,
      500,
    );
    const captcha =
      /验证码|滑块|安全验证|captcha/i.test(bodyText) ||
      (await page.locator("text=验证码").count()) > 0;
    const badPass = /密码错误|账号不存在|用户名或密码|登录失败|不正确/.test(bodyText);
    const ok =
      !captcha &&
      !badPass &&
      looksLoggedIn(finalUrl, portal.adapter);

    await page.screenshot({ path: screenshotPath, fullPage: true });
    if (opts.keepOpenMs && opts.keepOpenMs > 0) {
      await page.waitForTimeout(opts.keepOpenMs);
    }

    return {
      portalId: portal.id,
      name: portal.name,
      adapter: portal.adapter,
      ok,
      stage,
      message: captcha
        ? "疑似需要验证码/滑块，需人工介入或后续专项适配"
        : badPass
          ? "页面提示账号或密码错误"
          : ok
            ? "登录后页面已离开 login，初步成功"
            : `仍停在登录相关页或无法确认（url=${finalUrl.slice(0, 120)}）`,
      finalUrl,
      screenshotPath,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      portalId: portal.id,
      name: portal.name,
      adapter: portal.adapter,
      ok: false,
      stage,
      message: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - started,
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
