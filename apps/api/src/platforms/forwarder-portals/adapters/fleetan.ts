/**
 * 飞坦（Fleetan / vip.fleetan.com）适配器
 * - 登录：#/login（持久化 profile 复用会话；凭据兜底）
 * - 主路径：侧栏 Tracking（#/Tracking）填单号 → Track（海运/空运同一入口，更快）
 * - 回退：海运列表 / 空运批次 → 搜票号 → 行内「查看轨迹」
 * 边界：只读门户；结果落本地；不写飞书。
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import {
  getForwarderPortalsDir,
  type ForwarderPortalAccount,
} from "../types.js";

export const FLEETAN_LOGIN = "https://vip.fleetan.com/#/login";
export const FLEETAN_SEA_LIST = "https://vip.fleetan.com/#/B2BSeaOrderList";
export const FLEETAN_AIR_BATCH = "https://vip.fleetan.com/#/overseaLocation";
/** 门户侧栏「Tracking」统一查件页（海运/空运同一入口，比列表点行快） */
export const FLEETAN_TRACKING = "https://vip.fleetan.com/#/Tracking";

export type FleetanShipMode = "sea" | "air" | "auto";

export type FleetanTrackEvent = {
  name: string;
  at?: string;
  desc?: string | null;
};

export type FleetanTrackResult = {
  ok: boolean;
  ticketNo: string;
  modeTried: FleetanShipMode;
  modeHit?: "sea" | "air";
  stage:
    | "launch"
    | "navigate"
    | "login"
    | "menu"
    | "fill"
    | "search"
    | "track"
    | "parse";
  statusText?: string;
  detailLines?: string[];
  events?: FleetanTrackEvent[];
  finalUrl?: string;
  screenshotPath?: string;
  message: string;
  durationMs: number;
};

export type FleetanSessionOptions = {
  headed?: boolean;
  timeoutMs?: number;
  /** 默认 true：先点 Login；失败再用账号密码兜底 */
  login?: boolean;
  /** 默认 true；UI 查件可关以省 1–3s */
  screenshot?: boolean;
};

function fleetanStoragePath(): string {
  return join(getForwarderPortalsDir(), "sessions", "feitan.storage.json");
}

/** 持久化用户目录：飞坦登录态多在 localStorage，比单纯 cookies 的 storageState 更稳 */
function fleetanProfileDir(): string {
  return join(getForwarderPortalsDir(), "sessions", "feitan-profile");
}

/** 空 cookies 且无 localStorage 的 storageState 视为无效 */
function hasUsableFleetanStorage(): boolean {
  const path = fleetanStoragePath();
  if (!existsSync(path)) return false;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      cookies?: unknown[];
      origins?: Array<{ localStorage?: unknown[]; sessionStorage?: unknown[] }>;
    };
    if (Array.isArray(raw.cookies) && raw.cookies.length > 0) return true;
    return (raw.origins ?? []).some(
      (o) =>
        (o.localStorage?.length ?? 0) > 0 || (o.sessionStorage?.length ?? 0) > 0,
    );
  } catch {
    return false;
  }
}

function clearFleetanStorage() {
  try {
    const path = fleetanStoragePath();
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
}

/** 弹窗探测：timeout:0 立刻判断，避免每条选择器干等 400ms */
async function dismissNoise(page: Page) {
  for (const sel of [
    "button:has-text('同意')",
    "button:has-text('确定')",
    "button:has-text('我知道了')",
    "button:has-text('Close')",
    ".el-message-box__btns button",
    ".el-dialog__headerbtn",
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 0 }).catch(() => false)) {
        await btn.click({ timeout: 500 }).catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  }
}

async function fillVisible(
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
        if (!(await loc.isVisible({ timeout: 0 }).catch(() => false))) continue;
        await loc.click({ timeout: 1500 });
        await loc.fill("");
        await loc.fill(value);
        return true;
      } catch {
        /* next */
      }
    }
  }
  return false;
}

async function clickVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const all = page.locator(sel);
    const n = await all.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const loc = all.nth(i);
      try {
        if (!(await loc.isVisible({ timeout: 0 }).catch(() => false))) continue;
        await loc.click({ timeout: 2000 });
        return true;
      } catch {
        /* next */
      }
    }
  }
  return false;
}

async function looksLoggedIn(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes("#/login") || url.endsWith("/login")) return false;
  if (
    url.includes("#/menu") ||
    url.includes("#/tracking") ||
    url.includes("b2bseaorderlist") ||
    url.includes("oversealocation") ||
    url.includes("orderlist")
  ) {
    return true;
  }
  const side = await page.locator("text=海运订单").count();
  const air = await page.locator("text=沙特仓履单").count();
  const home = await page.locator("text=首页").count();
  const track = await page.locator("text=Tracking").count();
  return side + air + home + track > 0;
}

async function waitUntilLoggedIn(page: Page, maxMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await looksLoggedIn(page)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

const SEARCH_BTN =
  "button:has-text('搜索'), button:has-text('Search'), button:has-text('查询')";

async function waitForSearchReady(page: Page, maxMs = 8_000): Promise<boolean> {
  try {
    await page
      .locator(SEARCH_BTN)
      .first()
      .waitFor({ state: "visible", timeout: maxMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * 登录：优先直接点 Login（浏览器缓存 / storageState）；失败再用账号密码兜底。
 */
export async function loginFleetan(
  page: Page,
  account?: ForwarderPortalAccount | null,
): Promise<{ ok: boolean; message: string }> {
  await page.goto(FLEETAN_LOGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await dismissNoise(page);

  if (await looksLoggedIn(page)) {
    await preferChinese(page);
    return { ok: true, message: "已在登录态" };
  }

  let clicked = await clickVisible(page, [
    "button:has-text('Login')",
    "button:has-text('登录')",
    ".el-button--primary:has-text('Login')",
    "button.el-button--primary",
  ]);
  if (clicked) {
    if (await waitUntilLoggedIn(page, 8_000)) {
      await dismissNoise(page);
      await preferChinese(page);
      return { ok: true, message: "缓存登录成功" };
    }
  }

  if (!account?.username || !account?.password) {
    return { ok: false, message: "无缓存登录且无凭据兜底" };
  }

  const userOk = await fillVisible(
    page,
    [
      'input[type="text"]',
      'input[type="email"]',
      'input[placeholder*="mail" i]',
      'input[placeholder*="账号"]',
      'input[placeholder*="用户"]',
      ".el-input__inner",
    ],
    account.username,
  );
  if (!userOk) return { ok: false, message: "未找到账号输入框" };

  const passOk = await fillVisible(
    page,
    [
      'input[type="password"]',
      'input[placeholder*="密码" i]',
      'input[placeholder*="pass" i]',
    ],
    account.password,
  );
  if (!passOk) return { ok: false, message: "未找到密码输入框" };

  clicked = await clickVisible(page, [
    "button:has-text('Login')",
    "button:has-text('登录')",
    "button.el-button--primary",
  ]);
  if (!clicked) await page.keyboard.press("Enter");

  if (await waitUntilLoggedIn(page, 12_000)) {
    await dismissNoise(page);
    await preferChinese(page);
    return { ok: true, message: "账号密码登录成功" };
  }
  const body = (
    (await page.locator("body").innerText().catch(() => "")) || ""
  ).slice(0, 600);
  if (/密码错误|不正确|失败|invalid|incorrect/i.test(body)) {
    return { ok: false, message: "账号或密码错误" };
  }
  return { ok: false, message: `登录后仍未进入系统（url=${page.url()}）` };
}

const TRACK_LINK_SELS = [
  "a:has-text('查看轨迹')",
  "button:has-text('查看轨迹')",
  "span:has-text('查看轨迹')",
  "a:has-text('Tracking')",
  "button:has-text('Tracking')",
  "span:has-text('Tracking')",
  "a:has-text('View Track')",
  "button:has-text('View Track')",
  "span:has-text('View Track')",
];

async function clickTrackLink(scope: Page | Locator): Promise<boolean> {
  for (const sel of TRACK_LINK_SELS) {
    const loc = scope.locator(sel).first();
    try {
      if (!(await loc.isVisible({ timeout: 0 }).catch(() => false))) continue;
      await loc.click({ timeout: 2000 });
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

/** 尽量切到中文；下拉文案为「Zh - 中文」 */
async function preferChinese(page: Page) {
  try {
    if (
      await page
        .locator("text=海运订单")
        .first()
        .isVisible({ timeout: 0 })
        .catch(() => false)
    ) {
      return;
    }
    const lang = page.locator("text=English").first();
    if (!(await lang.isVisible({ timeout: 0 }).catch(() => false))) return;
    await lang.click({ timeout: 1000 });
    await page.waitForTimeout(200);
    const switched = await clickVisible(page, [
      "text=Zh - 中文",
      "text=中文",
      "text=简体中文",
      "li:has-text('中文')",
      ".el-dropdown-menu__item:has-text('中文')",
      ".el-select-dropdown__item:has-text('中文')",
      ".el-dropdown-menu__item:has-text('Zh')",
    ]);
    if (switched) {
      await page.waitForTimeout(500);
    } else {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  } catch {
    await page.keyboard.press("Escape").catch(() => undefined);
  }
}

async function openSeaList(page: Page): Promise<boolean> {
  await page.goto(FLEETAN_SEA_LIST, { waitUntil: "domcontentloaded" });
  await dismissNoise(page);
  if (await waitForSearchReady(page, 5_000)) return true;
  await clickVisible(page, [
    "text=海运订单",
    "text=Sea Order",
    ".el-submenu__title:has-text('海运')",
    ".el-submenu__title:has-text('Sea')",
    "li:has-text('海运订单')",
    "li:has-text('Sea Order')",
  ]);
  await page.waitForTimeout(200);
  await clickVisible(page, [
    "text=海运放货订单",
    "text=Sea Delivery",
    "a:has-text('海运放货订单')",
    "a:has-text('Sea')",
    "li:has-text('海运放货订单')",
  ]);
  return waitForSearchReady(page, 6_000);
}

async function openAirBatch(page: Page): Promise<boolean> {
  await page.goto(FLEETAN_AIR_BATCH, { waitUntil: "domcontentloaded" });
  await dismissNoise(page);
  if (await waitForSearchReady(page, 5_000)) return true;
  await clickVisible(page, [
    "text=沙特仓履单",
    "text=KSA WH",
    "text=KSA",
    ".el-submenu__title:has-text('沙特')",
    ".el-submenu__title:has-text('KSA')",
    "li:has-text('沙特仓履单')",
    "li:has-text('KSA WH')",
  ]);
  await page.waitForTimeout(200);
  await clickVisible(page, [
    "text=批次管理",
    "text=Batch",
    "a:has-text('批次管理')",
    "a:has-text('Batch')",
    "li:has-text('批次管理')",
    "li:has-text('Batch')",
  ]);
  return waitForSearchReady(page, 6_000);
}

async function searchByTicket(page: Page, ticketNo: string): Promise<boolean> {
  // 英文态 Order No 是 textarea；中文可能是 input — 两类都试
  await page.keyboard.press("Escape").catch(() => undefined);
  const filled = await fillVisible(
    page,
    [
      'textarea[placeholder="Order No"]',
      'textarea[placeholder="订单号"]',
      'input[placeholder="订单号"]',
      'input[placeholder="Order No"]',
      'textarea[placeholder="票号"]',
      'input[placeholder="票号"]',
      'textarea[placeholder*="票号"]',
      'input[placeholder*="票号"]',
      'textarea.el-textarea__inner',
      ".el-form .el-form-item:first-child textarea",
      ".el-form .el-form-item:first-child input.el-input__inner",
      ".el-form textarea.el-textarea__inner",
      ".el-form input.el-input__inner",
    ],
    ticketNo,
  );
  if (!filled) return false;
  const searched = await clickVisible(page, [
    "button:has-text('搜索')",
    "button:has-text('Search')",
    "button:has-text('查询')",
    ".el-button--primary:has-text('搜索')",
    ".el-button--primary:has-text('Search')",
  ]);
  if (!searched) await page.keyboard.press("Enter");

  // 等本票号出现在表格，或明确空态（最多 6s）
  const row = page.locator(`tbody tr:has-text("${ticketNo}")`).first();
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    await dismissNoise(page);
    if (await row.isVisible({ timeout: 0 }).catch(() => false)) return true;
    const body =
      (await page.locator(".el-table, body").innerText().catch(() => "")) || "";
    if (/暂无数据|无数据|没有找到|No Data|No data/i.test(body)) return false;
    await page.waitForTimeout(200);
  }
  return (await row.isVisible({ timeout: 0 }).catch(() => false)) || false;
}

async function openTrackAndParse(
  page: Page,
  ticketNo: string,
): Promise<{
  ok: boolean;
  statusText?: string;
  detailLines?: string[];
  events?: FleetanTrackEvent[];
  message: string;
}> {
  const row = page.locator(`tbody tr:has-text("${ticketNo}")`).first();
  let opened = false;
  if (await row.isVisible({ timeout: 0 }).catch(() => false)) {
    opened = await clickTrackLink(row);
  }
  // 禁止点侧栏「Tracking」菜单；只在表格操作列找链接
  if (!opened) {
    opened = await clickTrackLink(page.locator(".el-table, .el-table__body"));
  }

  if (!opened) {
    const empty = /暂无数据|无数据|没有找到|No Data|No data/i.test(
      (await page.locator("body").innerText().catch(() => "")) || "",
    );
    return {
      ok: false,
      message: empty
        ? "搜索无结果（票号可能不在本列表）"
        : "未找到「查看轨迹 / Tracking」",
    };
  }

  const panel = page
    .locator(".el-drawer__body, .el-dialog__body, .el-drawer, .el-dialog, .el-popup-parent--hidden .el-drawer")
    .last();
  try {
    await panel.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    // 有的版本点 Tracking 会新开页 / 路由跳转
    const url = page.url();
    if (/track|route|轨迹/i.test(url)) {
      await page.waitForTimeout(800);
      const bodyText = ((await page.locator("body").innerText().catch(() => "")) || "").trim();
      if (bodyText) {
        const lines = bodyText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 40);
        return {
          ok: lines.length > 0,
          statusText: lines.find((l) => /签收|入库|Deliver|Success/i.test(l)) ?? lines[0],
          detailLines: lines,
          events: lines.slice(0, 15).map((l) => ({ name: l })),
          message: "已跳转轨迹页并抓取文案",
        };
      }
    }
    return { ok: false, message: "轨迹面板未弹出" };
  }
  await dismissNoise(page);

  const text = ((await panel.innerText().catch(() => "")) || "").trim();
  if (!text) {
    return { ok: false, message: "轨迹面板无文案" };
  }

  const menuNoise =
    /^(沙特仓履单|退仓管理|轨迹查询|海运订单|空运订单|首页|KSA WH|Bulk Cargo|Sea Order|Air Order)$/i;
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !menuNoise.test(l));
  const trackish = lines.filter((l) =>
    /签收|清关|入库|出库|派送|到达|运输|干线|扫描|轨迹|Remarks|Deliver|Customs|Warehouse|Transit|订单轨迹|\d{4}[-/]\d{1,2}/i.test(
      l,
    ),
  );
  const detailLines = (trackish.length ? trackish : lines).slice(0, 40);
  const statusText =
    detailLines.find((l) =>
      /签收|入库|出库|清关|派送|到达|待出库|运输中|成功|Deliver|Success|Pending/i.test(
        l,
      ),
    ) ??
    detailLines.find((l) => /订单轨迹|Remarks/i.test(l)) ??
    detailLines[0] ??
    "已打开轨迹（需人工核对）";

  const events: FleetanTrackEvent[] = detailLines.slice(0, 20).map((l) => {
    const m = l.match(
      /(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/,
    );
    return { name: l, at: m?.[1], desc: null };
  });

  await clickVisible(page, [
    ".el-drawer__close-btn",
    ".el-dialog__headerbtn",
    "button:has-text('关闭')",
    "button:has-text('Close')",
    "button:has-text('取 消')",
  ]);

  const looksLikeTrack =
    trackish.length > 0 ||
    /订单轨迹|Remarks|Tracking|轨迹信息/i.test(text);
  return {
    ok: looksLikeTrack,
    statusText,
    detailLines,
    events,
    message: looksLikeTrack
      ? "已打开查看轨迹并抓取文案"
      : "已点击轨迹但未识别到轨迹正文",
  };
}

async function parseTrackText(text: string): Promise<{
  ok: boolean;
  statusText?: string;
  detailLines?: string[];
  events?: FleetanTrackEvent[];
  message: string;
}> {
  const menuNoise =
    /^(沙特仓履单|退仓管理|轨迹查询|海运订单|空运订单|首页|KSA WH|Bulk Cargo|Sea Order|Air Order|Tracking)$/i;
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !menuNoise.test(l));
  const trackish = lines.filter((l) =>
    /签收|清关|入库|出库|派送|到达|运输|干线|扫描|轨迹|Remarks|Deliver|Customs|Warehouse|Transit|订单轨迹|\d{4}[-/]\d{1,2}/i.test(
      l,
    ),
  );
  const detailLines = (trackish.length ? trackish : lines).slice(0, 40);
  const statusText =
    detailLines.find((l) =>
      /签收|入库|出库|清关|派送|到达|待出库|运输中|成功|Deliver|Success|Pending/i.test(
        l,
      ),
    ) ??
    detailLines.find((l) => /订单轨迹|Remarks/i.test(l)) ??
    detailLines[0] ??
    "已打开轨迹（需人工核对）";

  const events: FleetanTrackEvent[] = detailLines.slice(0, 20).map((l) => {
    const m = l.match(
      /(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/,
    );
    return { name: l, at: m?.[1], desc: null };
  });

  const looksLikeTrack =
    trackish.length > 0 || /订单轨迹|Remarks|Tracking|轨迹信息/i.test(text);
  return {
    ok: looksLikeTrack,
    statusText,
    detailLines,
    events,
    message: looksLikeTrack
      ? "Tracking 页已查出轨迹"
      : "Tracking 页已提交但未识别到轨迹正文",
  };
}

/**
 * 优先路径：侧栏 Tracking 统一查件（#/Tracking）
 * 比海运/空运列表搜行再点「查看轨迹」少 1～2 轮页面等待。
 */
async function trackViaTrackingPage(
  page: Page,
  ticketNo: string,
): Promise<{
  ok: boolean;
  stage: FleetanTrackResult["stage"];
  statusText?: string;
  detailLines?: string[];
  events?: FleetanTrackEvent[];
  message: string;
}> {
  await page.goto(FLEETAN_TRACKING, { waitUntil: "domcontentloaded" });
  await dismissNoise(page);
  await preferChinese(page);

  const inputReady = await page
    .locator(
      'input[placeholder*="Order Number" i], input[placeholder*="订单" i], input[placeholder*="单号" i], input.el-input__inner',
    )
    .first()
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!inputReady) {
    return { ok: false, stage: "menu", message: "未打开 Tracking 页" };
  }

  const filled = await fillVisible(
    page,
    [
      'input[placeholder*="Order Number" i]',
      'input[placeholder*="订单号"]',
      'input[placeholder*="单号"]',
      'input[placeholder*="票号"]',
      'input[placeholder*="Order" i]',
      "input.el-input__inner",
    ],
    ticketNo,
  );
  if (!filled) {
    return { ok: false, stage: "fill", message: "Tracking 页未找到单号输入框" };
  }

  const tracked = await clickVisible(page, [
    "button:has-text('Track')",
    "button:has-text('查询')",
    "button:has-text('轨迹')",
    "button:has-text('搜索')",
    ".el-button--primary:has-text('Track')",
    "button.el-button--primary",
  ]);
  if (!tracked) await page.keyboard.press("Enter");

  // 等结果区 / 抽屉 / 时间戳文案
  const deadline = Date.now() + 8_000;
  let text = "";
  while (Date.now() < deadline) {
    await dismissNoise(page);
    const panel = page
      .locator(".el-drawer__body, .el-dialog__body, .el-drawer, .el-dialog")
      .last();
    if (await panel.isVisible({ timeout: 0 }).catch(() => false)) {
      text = ((await panel.innerText().catch(() => "")) || "").trim();
      if (text.length > 20) break;
    }
    const main = page.locator(".app-main, .el-main, .main-container, body").last();
    const bodyText = ((await main.innerText().catch(() => "")) || "").trim();
    if (
      /签收|入库|Remarks|订单轨迹|Deliver|Transit|Customs|\d{4}[-/]\d{1,2}[-/]\d{1,2}/i.test(
        bodyText,
      ) &&
      !/Input Order Number/i.test(bodyText.slice(0, 80))
    ) {
      // 去掉页头噪音
      text = bodyText
        .replace(/^[\s\S]*?\bTrack\b/i, "")
        .trim() || bodyText;
      if (text.length > 30) break;
    }
    if (/暂无|无数据|No Data|not found|不存在/i.test(bodyText)) {
      return {
        ok: false,
        stage: "search",
        message: "Tracking 页无此单号",
      };
    }
    await page.waitForTimeout(250);
  }

  if (!text) {
    return { ok: false, stage: "track", message: "Tracking 页无返回文案" };
  }

  const parsed = await parseTrackText(text);
  return {
    ok: parsed.ok,
    stage: parsed.ok ? "parse" : "track",
    statusText: parsed.statusText,
    detailLines: parsed.detailLines,
    events: parsed.events,
    message: parsed.message,
  };
}

async function trackOnce(
  page: Page,
  ticketNo: string,
  mode: "sea" | "air",
): Promise<{
  ok: boolean;
  stage: FleetanTrackResult["stage"];
  statusText?: string;
  detailLines?: string[];
  events?: FleetanTrackEvent[];
  message: string;
}> {
  const opened =
    mode === "sea" ? await openSeaList(page) : await openAirBatch(page);
  if (!opened) {
    return {
      ok: false,
      stage: "menu",
      message: `未打开${mode === "sea" ? "海运" : "空运"}列表（无搜索按钮）`,
    };
  }

  const filled = await searchByTicket(page, ticketNo);
  if (!filled) {
    // searchByTicket false：可能是填框失败，也可能是搜无此票
    const hasInput = await page
      .locator(
        'textarea[placeholder="Order No"], textarea[placeholder="订单号"], input[placeholder="订单号"], input[placeholder="Order No"], input[placeholder*="票号"], textarea.el-textarea__inner',
      )
      .first()
      .isVisible({ timeout: 0 })
      .catch(() => false);
    return {
      ok: false,
      stage: hasInput ? "search" : "fill",
      message: hasInput
        ? `搜索无结果（票号不在${mode === "sea" ? "海运" : "空运"}列表）`
        : `未找到${mode === "sea" ? "海运" : "空运"}单号输入框`,
    };
  }

  const parsed = await openTrackAndParse(page, ticketNo);
  return {
    ok: parsed.ok,
    stage: parsed.ok ? "parse" : "track",
    statusText: parsed.statusText,
    detailLines: parsed.detailLines,
    events: parsed.events,
    message: parsed.message,
  };
}

async function saveStorage(context: BrowserContext) {
  try {
    const path = fleetanStoragePath();
    mkdirSync(dirname(path), { recursive: true });
    await context.storageState({ path });
    if (!hasUsableFleetanStorage()) clearFleetanStorage();
  } catch {
    /* ignore */
  }
}

/** 持久化 profile 下先直达 Tracking；未登录再走 loginFleetan */
async function ensureFleetanSession(
  page: Page,
  account: ForwarderPortalAccount | null | undefined,
  _preferMode: "sea" | "air" | "auto",
): Promise<{ ok: boolean; message: string; reused: boolean }> {
  await page.goto(FLEETAN_TRACKING, { waitUntil: "domcontentloaded" });
  await dismissNoise(page);
  if (await looksLoggedIn(page)) {
    const hasTrackInput = await page
      .locator(
        'input[placeholder*="Order Number" i], input[placeholder*="订单" i], input.el-input__inner',
      )
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (hasTrackInput || !page.url().toLowerCase().includes("#/login")) {
      await preferChinese(page);
      if (await looksLoggedIn(page)) {
        return { ok: true, message: "复用会话", reused: true };
      }
    }
  }

  const login = await loginFleetan(page, account);
  return { ...login, reused: false };
}

export async function runFleetanTrack(params: {
  ticketNo: string;
  mode?: FleetanShipMode;
  account?: ForwarderPortalAccount | null;
  opts?: FleetanSessionOptions;
}): Promise<FleetanTrackResult> {
  const started = Date.now();
  const ticketNo = params.ticketNo.trim();
  const modeWanted: FleetanShipMode = params.mode ?? "auto";
  const shotDir = join(getForwarderPortalsDir(), "tracks");
  mkdirSync(shotDir, { recursive: true });
  const screenshotPath = join(
    shotDir,
    `feitan-${ticketNo.replace(/[^\w-]/g, "_")}-${Date.now()}.png`,
  );
  const wantShot = params.opts?.screenshot !== false;

  let context: BrowserContext | null = null;
  let stage: FleetanTrackResult["stage"] = "launch";
  try {
    const headless = params.opts?.headed === false;
    mkdirSync(fleetanProfileDir(), { recursive: true });
    context = await chromium.launchPersistentContext(fleetanProfileDir(), {
      headless,
      slowMo: headless ? 0 : 50,
      locale: "zh-CN",
      viewport: { width: 1440, height: 900 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(params.opts?.timeoutMs ?? 40_000);

    stage = "login";
    if (params.opts?.login !== false) {
      const login = await ensureFleetanSession(
        page,
        params.account,
        modeWanted === "auto" ? "sea" : modeWanted,
      );
      if (!login.ok) {
        if (wantShot) {
          await page.screenshot({ path: screenshotPath }).catch(() => undefined);
        }
        return {
          ok: false,
          ticketNo,
          modeTried: modeWanted,
          stage,
          message: login.message,
          finalUrl: page.url(),
          screenshotPath: wantShot ? screenshotPath : undefined,
          durationMs: Date.now() - started,
        };
      }
      await saveStorage(context);
    }

    // 1) 优先统一 Tracking 页（海运空运同一入口）
    stage = "menu";
    const viaTrack = await trackViaTrackingPage(page, ticketNo);
    if (viaTrack.ok) {
      await saveStorage(context);
      if (wantShot) {
        await page.screenshot({ path: screenshotPath }).catch(() => undefined);
      }
      const modeHit =
        modeWanted === "air" || modeWanted === "sea" ? modeWanted : undefined;
      return {
        ok: true,
        ticketNo,
        modeTried: modeWanted,
        modeHit,
        stage: viaTrack.stage,
        statusText: viaTrack.statusText,
        detailLines: viaTrack.detailLines,
        events: viaTrack.events,
        finalUrl: page.url(),
        screenshotPath: wantShot ? screenshotPath : undefined,
        message: viaTrack.message,
        durationMs: Date.now() - started,
      };
    }

    // 2) 回退：按海运/空运列表搜行点轨迹
    const order: Array<"sea" | "air"> =
      modeWanted === "sea"
        ? ["sea"]
        : modeWanted === "air"
          ? ["air"]
          : ["sea", "air"];

    let lastMsg = viaTrack.message || "未查询到轨迹";
    for (const mode of order) {
      stage = "menu";
      const r = await trackOnce(page, ticketNo, mode);
      if (r.ok) {
        await saveStorage(context);
        if (wantShot) {
          await page.screenshot({ path: screenshotPath }).catch(() => undefined);
        }
        return {
          ok: true,
          ticketNo,
          modeTried: modeWanted,
          modeHit: mode,
          stage: r.stage,
          statusText: r.statusText,
          detailLines: r.detailLines,
          events: r.events,
          finalUrl: page.url(),
          screenshotPath: wantShot ? screenshotPath : undefined,
          message: `${mode === "sea" ? "海运" : "空运"}列表：${r.message}`,
          durationMs: Date.now() - started,
        };
      }
      lastMsg = `${mode === "sea" ? "海运" : "空运"}列表：${r.message}`;
    }

    if (wantShot) {
      await page.screenshot({ path: screenshotPath }).catch(() => undefined);
    }
    return {
      ok: false,
      ticketNo,
      modeTried: modeWanted,
      stage,
      message: lastMsg,
      finalUrl: page.url(),
      screenshotPath: wantShot ? screenshotPath : undefined,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      ticketNo,
      modeTried: modeWanted,
      stage,
      message: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - started,
    };
  } finally {
    if (context) await context.close().catch(() => undefined);
  }
}

/** 装箱运输方式 → 飞坦查询模式 */
export function packingModeToFleetan(modeRaw: string): FleetanShipMode {
  const m = modeRaw.trim();
  if (/海运|海派|整柜|拼柜/.test(m)) return "sea";
  if (/空运|空派|单品/.test(m)) return "air";
  return "auto";
}
