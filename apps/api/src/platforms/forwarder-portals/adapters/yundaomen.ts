/**
 * 亦邦（Cititrans / yundaomen.com）适配器
 * - 登录：首页「快速登录」
 * - 查件：点「查轨迹」→ 填装箱表「物流编号」→「查询」
 * 边界：只读门户；结果落本地；不写飞书。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  getForwarderPortalsDir,
  type ForwarderPortalAccount,
} from "../types.js";

export const YUNDAOMEN_HOME =
  "https://www.yundaomen.com/#/index/placeOrder/placeIndex";

export type YundaomenTrackEvent = {
  name: string;
  nameEn?: string;
  desc?: string | null;
  at?: string;
  reasonInfo?: string | null;
};

export type YundaomenTrackResult = {
  ok: boolean;
  logisticsNo: string;
  stage: "launch" | "navigate" | "login" | "track-tab" | "fill" | "query" | "parse";
  statusText?: string;
  detailLines?: string[];
  events?: YundaomenTrackEvent[];
  finalUrl?: string;
  screenshotPath?: string;
  message: string;
  durationMs: number;
};

export type YundaomenSessionOptions = {
  headed?: boolean;
  timeoutMs?: number;
  /**
   * 是否先走「快速登录」。官网「查轨迹」可匿名；默认 false。
   * 设为 true 时登录失败且 requireLogin 则中止。
   */
  login?: boolean;
  /** 与 login 联用：登录失败则中止查件 */
  requireLogin?: boolean;
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
      if (await btn.isVisible({ timeout: 600 })) {
        await btn.click({ timeout: 1000 });
      }
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
    const all = page.locator(sel);
    const n = await all.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const loc = all.nth(i);
      try {
        if (!(await loc.isVisible())) continue;
        await loc.click({ timeout: 2000 });
        await loc.fill("");
        await loc.fill(value);
        return true;
      } catch {
        /* try next match */
      }
    }
  }
  return false;
}

async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const all = page.locator(sel);
    const n = await all.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const loc = all.nth(i);
      try {
        if (!(await loc.isVisible())) continue;
        await loc.click({ timeout: 3000 });
        return true;
      } catch {
        /* try next match */
      }
    }
  }
  return false;
}

async function closeOpenDialog(page: Page) {
  for (const sel of [
    ".el-dialog__headerbtn",
    ".el-dialog .el-icon-close",
    "button[aria-label='Close']",
    ".el-dialog__close",
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 400 })) {
        await btn.click({ timeout: 1000 });
        await page.waitForTimeout(300);
      }
    } catch {
      /* ignore */
    }
  }
}

export async function loginYundaomen(
  page: Page,
  account: ForwarderPortalAccount,
): Promise<{ ok: boolean; message: string }> {
  const opened = await clickFirst(page, [
    "button:has-text('快速登录')",
    "a:has-text('快速登录')",
    "text=快速登录",
  ]);
  if (!opened) {
    return { ok: false, message: "未找到「快速登录」入口" };
  }
  await page.waitForTimeout(900);
  await dismissNoise(page);

  // 确保在「账号登录」页签
  await clickFirst(page, [
    ".el-dialog .el-tabs__item:has-text('账号登录')",
    "text=账号登录",
  ]);

  const userOk = await fillFirst(
    page,
    [
      '.el-dialog input[placeholder*="账号/邮箱"]',
      '.el-dialog input[placeholder*="账号"]',
      '.el-dialog input[placeholder*="邮箱"]',
      'input[placeholder*="账号/邮箱"]',
      'input[placeholder*="账号"]',
      'input[placeholder*="邮箱"]',
    ],
    account.username,
  );
  if (!userOk) return { ok: false, message: "登录框未找到账号输入" };

  const passOk = await fillFirst(
    page,
    [
      '.el-dialog input[type="password"]',
      '.el-dialog input[placeholder*="密码"]',
      'input[type="password"]',
      'input[placeholder*="密码"]',
    ],
    account.password,
  );
  if (!passOk) return { ok: false, message: "登录框未找到密码输入" };

  // 必须勾选服务条款，否则登录按钮无效
  const agree = page
    .locator(".el-dialog .el-checkbox")
    .filter({ hasText: /同意|服务条款/ })
    .first();
  try {
    if (await agree.isVisible({ timeout: 1500 })) {
      const checked = await agree.locator("input").isChecked().catch(() => false);
      if (!checked) await agree.click({ timeout: 2000 });
    } else {
      await clickFirst(page, [
        ".el-dialog .el-checkbox__input",
        ".el-dialog label.el-checkbox",
      ]);
    }
  } catch {
    await clickFirst(page, [".el-dialog .el-checkbox__inner"]);
  }

  const submitted = await clickFirst(page, [
    ".el-dialog button:has-text('登录')",
    ".el-dialog button.el-button--primary",
    "button:has-text('登录')",
    'button[type="submit"]',
  ]);
  if (!submitted) await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  await dismissNoise(page);

  const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(
    0,
    800,
  );
  if (/验证码|滑块|安全验证|captcha/i.test(body)) {
    return { ok: false, message: "登录疑似需要验证码/滑块" };
  }
  if (/密码错误|账号不存在|用户名或密码|登录失败|不正确|请先同意/.test(body)) {
    return { ok: false, message: "账号/密码错误或未同意条款" };
  }
  // 登录成功后顶栏通常不再显示「快速登录」
  const stillQuick = await page.locator("button:has-text('快速登录'), a:has-text('快速登录')").count();
  const dialogVisible = await page.locator(".el-dialog:visible").count();
  if (stillQuick > 0 && dialogVisible > 0) {
    return { ok: false, message: "登录弹窗仍在，未能确认登录成功" };
  }
  if (stillQuick > 0) {
    return { ok: false, message: "提交后仍见「快速登录」，未能确认登录成功" };
  }
  return { ok: true, message: "登录成功（顶栏已离开快速登录）" };
}

type TrackApiPayload = {
  code?: number;
  message?: string;
  data?: Array<{
    name?: string;
    namee?: string;
    desc?: string | null;
    occurrenceDate?: string;
    occurrenceTime?: string;
    fbxBoxTrailDTOList?: Array<{
      name?: string;
      namee?: string;
      desc?: string | null;
      occurrenceDate?: string;
      occurrenceTime?: string;
      reasonInfo?: string | null;
    }>;
  }>;
};

function eventsFromApi(payload: TrackApiPayload | null): YundaomenTrackEvent[] {
  if (!payload?.data?.length) return [];
  const head = payload.data[0];
  const list = head?.fbxBoxTrailDTOList?.length
    ? head.fbxBoxTrailDTOList
    : payload.data;
  return list.map((e) => ({
    name: e.name ?? "",
    nameEn: e.namee,
    desc: e.desc ?? null,
    at:
      e.occurrenceDate && e.occurrenceTime
        ? `${e.occurrenceDate} ${e.occurrenceTime}`
        : e.occurrenceDate,
    reasonInfo: "reasonInfo" in e ? (e.reasonInfo ?? null) : null,
  }));
}

/**
 * 按标注步骤：查轨迹 → 填物流编号 → 点 Guiji 查询 → 优先解析 track API
 */
export async function trackByLogisticsNo(
  page: Page,
  logisticsNo: string,
): Promise<{
  ok: boolean;
  statusText?: string;
  detailLines?: string[];
  events?: YundaomenTrackEvent[];
  message: string;
  stage: YundaomenTrackResult["stage"];
}> {
  await closeOpenDialog(page);

  const tabOk = await clickFirst(page, [
    "li.oldnavcalss:has-text('查轨迹')",
    "li.navStyle:has-text('查轨迹')",
    "li:has-text('查轨迹')",
    "span:has-text('查轨迹')",
    "text=查轨迹",
  ]);
  if (!tabOk) {
    return {
      ok: false,
      stage: "track-tab",
      message: "未找到「查轨迹」页签",
    };
  }
  await page.waitForTimeout(800);

  const filled = await fillFirst(
    page,
    [
      'input[placeholder="请输入单号查询"]',
      'input[placeholder*="请输入单号"]',
      'input[placeholder*="单号查询"]',
      'input.el-input__inner[placeholder*="单号"]',
    ],
    logisticsNo,
  );
  if (!filled) {
    return { ok: false, stage: "fill", message: "未找到单号输入框" };
  }

  const apiWait = page.waitForResponse(
    (res) =>
      res.url().includes("newQueryCommonTrackByNo") && res.status() === 200,
    { timeout: 15_000 },
  );

  const queried = await clickFirst(page, [
    "div.Guiji button.el-button--primary",
    "div.Guiji button:has-text('查询')",
    "button.el-icon-search.el-button--primary",
    "button.el-button--primary:has-text('查询')",
  ]);
  if (!queried) {
    return { ok: false, stage: "query", message: "未找到查轨迹「查询」按钮" };
  }

  let apiPayload: TrackApiPayload | null = null;
  try {
    const res = await apiWait;
    apiPayload = (await res.json()) as TrackApiPayload;
  } catch {
    await page.waitForTimeout(2500);
  }
  await dismissNoise(page);

  const events = eventsFromApi(apiPayload);
  if (events.length) {
    const latest = events[0]!;
    const statusText = [
      latest.name,
      latest.nameEn,
      latest.at,
      latest.desc,
      latest.reasonInfo,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      ok: true,
      stage: "parse",
      message: "已从亦邦 track API 解析轨迹",
      statusText,
      detailLines: events.map((e) =>
        [e.at, e.name, e.nameEn, e.desc, e.reasonInfo].filter(Boolean).join(" · "),
      ),
      events,
    };
  }

  const body = ((await page.locator("body").innerText().catch(() => "")) || "")
    .replace(/\r/g, "")
    .trim();
  if (/未查询到|查无|不存在|无数据|暂无/.test(body)) {
    return {
      ok: false,
      stage: "parse",
      message: "查询无结果（单号可能无效或未出库）",
      statusText: "未查到",
    };
  }

  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const trackish = lines.filter((l) =>
    /派送|清关|入库|出库|签收|到达|约仓|Delivered|delivery|Customs|Amazon|\d{4}-\d{2}-\d{2}/.test(
      l,
    ),
  );
  const detailLines = (trackish.length ? trackish : lines).slice(0, 40);
  const statusText =
    detailLines.find((l) => /派送|签收|入库|清关|约仓|Delivered/.test(l)) ??
    detailLines[0] ??
    "已返回页面文案（需人工核对）";

  return {
    ok: Boolean(trackish.length),
    stage: "parse",
    message: trackish.length
      ? "已提交查询并抓取页面文案"
      : "已点查询但未解析到轨迹文案",
    statusText,
    detailLines,
  };
}

export async function openYundaomenSession(
  opts: YundaomenSessionOptions = {},
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await chromium.launch({
    headless: opts.headed === false,
    slowMo: opts.headed === false ? 0 : 60,
  });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1360, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(opts.timeoutMs ?? 30_000);
  return { browser, context, page };
}

export async function runYundaomenTrack(params: {
  logisticsNo: string;
  account?: ForwarderPortalAccount | null;
  opts?: YundaomenSessionOptions;
}): Promise<YundaomenTrackResult> {
  const started = Date.now();
  const shotDir = join(getForwarderPortalsDir(), "tracks");
  mkdirSync(shotDir, { recursive: true });
  const screenshotPath = join(
    shotDir,
    `yibang-${params.logisticsNo.replace(/[^\w-]/g, "_")}-${Date.now()}.png`,
  );

  let browser: Browser | null = null;
  let stage: YundaomenTrackResult["stage"] = "launch";
  try {
    const session = await openYundaomenSession(params.opts);
    browser = session.browser;
    const { page } = session;

    stage = "navigate";
    await page.goto(YUNDAOMEN_HOME, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await dismissNoise(page);

    const wantLogin = params.opts?.login === true;
    if (
      wantLogin &&
      params.account?.username &&
      params.account?.password
    ) {
      stage = "login";
      const login = await loginYundaomen(page, params.account);
      if (!login.ok && params.opts?.requireLogin) {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        return {
          ok: false,
          logisticsNo: params.logisticsNo,
          stage,
          message: login.message,
          finalUrl: page.url(),
          screenshotPath,
          durationMs: Date.now() - started,
        };
      }
      await closeOpenDialog(page);
    }

    const tracked = await trackByLogisticsNo(page, params.logisticsNo);
    stage = tracked.stage;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      ok: tracked.ok,
      logisticsNo: params.logisticsNo,
      stage,
      statusText: tracked.statusText,
      detailLines: tracked.detailLines,
      events: tracked.events,
      finalUrl: page.url(),
      screenshotPath,
      message: tracked.message,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      logisticsNo: params.logisticsNo,
      stage,
      message: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - started,
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
