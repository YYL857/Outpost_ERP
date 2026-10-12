/**
 * 起克（chicexpress / erp.chicexpressglobal.com）适配器
 * 流程（独立，不可复用其他货代）：
 * 1. 登录 #/login
 * 2. 素材管理 → B2B → B2B报表
 * 3. 「入仓号」填装箱「物流编号」→ 搜索
 * 4. 从结果行抓取采购单状态 / 运输方式 / 时间等
 * 边界：只读门户；结果落本地；不写飞书。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  getForwarderPortalsDir,
  type ForwarderPortalAccount,
} from "../types.js";

export const CHICEXPRESS_LOGIN =
  "https://erp.chicexpressglobal.com/#/login";
export const CHICEXPRESS_ORIGIN = "https://erp.chicexpressglobal.com";
export const CHICEXPRESS_B2B_REPORT =
  "https://erp.chicexpressglobal.com/#/erp/orders/B2BReport";

export type ChicexpressTrackEvent = {
  name: string;
  at?: string;
  desc?: string | null;
};

export type ChicexpressTrackResult = {
  ok: boolean;
  portalId: "qike";
  logisticsNo: string;
  stage:
    | "launch"
    | "login"
    | "menu"
    | "fill"
    | "search"
    | "parse";
  statusText?: string;
  transportMode?: string;
  detailLines?: string[];
  events?: ChicexpressTrackEvent[];
  finalUrl?: string;
  screenshotPath?: string;
  message: string;
  durationMs: number;
};

export type ChicexpressSessionOptions = {
  headed?: boolean;
  timeoutMs?: number;
  login?: boolean;
};

async function fillFirst(
  page: Page,
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      if (!(await loc.isVisible({ timeout: 2000 }))) continue;
      await loc.click({ timeout: 2000 });
      await loc.fill("");
      await loc.fill(value);
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

async function clickFirst(
  page: Page,
  selectors: string[],
  opts?: { force?: boolean },
): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      const force = opts?.force === true;
      if (!force && !(await loc.isVisible({ timeout: 2000 }))) continue;
      if (force && (await loc.count()) === 0) continue;
      await loc.click({ timeout: 3000, force });
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

function looksLoggedIn(url: string): boolean {
  const u = url.toLowerCase();
  if (u.includes("/login") || u.includes("#/login")) return false;
  return u.includes("chicexpressglobal.com") && u.includes("#/");
}

export async function loginChicexpress(
  page: Page,
  account?: ForwarderPortalAccount | null,
): Promise<{ ok: boolean; message: string }> {
  await page.goto(CHICEXPRESS_LOGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);

  if (looksLoggedIn(page.url())) {
    return { ok: true, message: "已在登录态" };
  }

  if (!account?.username || !account?.password) {
    return { ok: false, message: "无凭据，无法登录" };
  }

  const userOk = await fillFirst(
    page,
    [
      'input[placeholder*="账号"]',
      'input[placeholder*="用户"]',
      'input[placeholder*="手机"]',
      'input[type="text"]',
      ".el-input__inner",
      ".ant-input",
    ],
    account.username,
  );
  if (!userOk) return { ok: false, message: "未找到账号输入框" };

  const passOk = await fillFirst(
    page,
    ['input[type="password"]', 'input[placeholder*="密码"]'],
    account.password,
  );
  if (!passOk) return { ok: false, message: "未找到密码输入框" };

  const clicked = await clickFirst(page, [
    "button:has-text('登录')",
    "button:has-text('登 录')",
    "button.el-button--primary",
    "button.ant-btn-primary",
    'button[type="submit"]',
  ]);
  if (!clicked) await page.keyboard.press("Enter");
  await page.waitForTimeout(3500);

  if (looksLoggedIn(page.url())) {
    return { ok: true, message: "登录成功" };
  }
  await page.waitForTimeout(1500);
  const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(
    0,
    500,
  );
  if (/密码错误|账号不存在|用户名或密码|登录失败|不正确/.test(body)) {
    return { ok: false, message: "账号或密码错误" };
  }
  if (
    (await page.locator("text=素材管理").count().catch(() => 0)) > 0 ||
    (await page.locator("text=B2B").count().catch(() => 0)) > 0 ||
    (await page.locator(".el-menu, .sidebar").count().catch(() => 0)) > 0
  ) {
    return { ok: true, message: "登录成功（侧栏可见）" };
  }
  if (page.url().toLowerCase().includes("login")) {
    return { ok: false, message: `登录后仍在登录页（url=${page.url()}）` };
  }
  return { ok: true, message: `登录后跳转（url=${page.url()}）` };
}

/** 侧栏：直链 B2B报表（菜单文字常在 collapsed DOM 中，需 force） */
async function openB2bReport(page: Page): Promise<void> {
  // 正确路由（#/B2B/report 会白屏）
  await page.goto(CHICEXPRESS_B2B_REPORT, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const hasInbound = async () =>
    (await page.locator("text=入仓号").count().catch(() => 0)) > 0;

  if (await hasInbound()) return;

  // 菜单兜底：force 点击（侧栏折叠时文字不可见但仍在 DOM）
  const ham = page.locator(".hamburger").first();
  const hamClass = (await ham.getAttribute("class").catch(() => "")) || "";
  if (hamClass && !hamClass.includes("is-active")) {
    await ham.click().catch(() => undefined);
    await page.waitForTimeout(800);
  }

  await clickFirst(
    page,
    [
      ".el-submenu__title:has-text('素材管理')",
      "span:has-text('素材管理')",
    ],
    { force: true },
  );
  await page.waitForTimeout(700);
  await clickFirst(
    page,
    [".el-submenu__title:has-text('B2B')", "span:has-text('B2B')"],
    { force: true },
  );
  await page.waitForTimeout(700);
  await clickFirst(
    page,
    [
      ".el-menu-item:has-text('B2B报表')",
      "span:has-text('B2B报表')",
      "li:has-text('B2B报表')",
    ],
    { force: true },
  );
  await page.waitForTimeout(2500);

  if (!(await hasInbound())) {
    await page.goto(CHICEXPRESS_B2B_REPORT, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
  }

  await page
    .locator("text=入仓号")
    .first()
    .waitFor({ state: "visible", timeout: 12_000 })
    .catch(() => undefined);
}

async function searchByInboundNo(
  page: Page,
  logisticsNo: string,
): Promise<boolean> {
  // 再等一波 SPA
  await page
    .locator("text=入仓号")
    .first()
    .waitFor({ state: "visible", timeout: 12_000 })
    .catch(() => undefined);

  await clickFirst(page, [
    "button:has-text('重置')",
    "button:has-text('重 置')",
  ]);
  await page.waitForTimeout(500);

  const byLabel = page
    .locator(
      ".el-form-item:has(label:has-text('入仓号')) input, .el-form-item:has-text('入仓号') input.el-input__inner, form:has-text('入仓号') input",
    )
    .first();
  if (await byLabel.isVisible({ timeout: 4000 }).catch(() => false)) {
    await byLabel.click({ timeout: 2000 });
    await byLabel.fill("");
    await byLabel.fill(logisticsNo);
  } else {
    const inputs = page.locator(
      ".el-form input.el-input__inner:visible, .filter-container input:visible, input.el-input__inner:visible",
    );
    const n = await inputs.count().catch(() => 0);
    let filled = false;
    for (let i = 0; i < Math.min(n, 8); i++) {
      const inp = inputs.nth(i);
      const parentText =
        ((await inp
          .locator(
            "xpath=ancestor::*[contains(@class,'form-item') or contains(@class,'el-form-item') or contains(@class,'filter')][1]",
          )
          .innerText()
          .catch(() => "")) || "");
      if (parentText.includes("入仓号")) {
        await inp.fill("");
        await inp.fill(logisticsNo);
        filled = true;
        break;
      }
    }
    if (!filled && n >= 3) {
      await inputs.nth(2).fill("");
      await inputs.nth(2).fill(logisticsNo);
      filled = true;
    }
    if (!filled) return false;
  }

  const searched = await clickFirst(page, [
    "button.el-button--primary:has-text('搜索')",
    "button:has-text('搜索')",
    "button:has-text('查询')",
  ]);
  if (!searched) await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);
  await page
    .locator(".el-loading-mask")
    .first()
    .waitFor({ state: "hidden", timeout: 8000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);
  return true;
}

function splitStatusChain(statusRaw: string): ChicexpressTrackEvent[] {
  return statusRaw
    .split(/[-－—|｜>/→]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, desc: null }));
}

async function parseResultRow(
  page: Page,
  logisticsNo: string,
): Promise<{
  ok: boolean;
  statusText?: string;
  transportMode?: string;
  detailLines?: string[];
  events?: ChicexpressTrackEvent[];
  message: string;
}> {
  const body = ((await page.locator("body").innerText().catch(() => "")) || "");
  if (!body.includes(logisticsNo)) {
    return { ok: false, message: "搜索无结果（列表未出现该入仓号/物流编号）" };
  }

  const row = page.locator(`tr:has-text("${logisticsNo}")`).first();
  if (!(await row.isVisible({ timeout: 3000 }).catch(() => false))) {
    return { ok: false, message: "列表文案含入仓号，但未定位到表格行" };
  }

  const cells = row.locator("td");
  const n = await cells.count().catch(() => 0);
  const texts: string[] = [];
  for (let i = 0; i < n; i++) {
    texts.push(((await cells.nth(i).innerText().catch(() => "")) || "").trim());
  }

  // 常见列：客户名称 | 入仓号 | 采购单号 | 采购单状态 | 国家 | 运输方式 | 入库时间 | 发货时间 | 预计起飞…
  let statusRaw = "";
  let transportMode = "";
  let inboundAt = "";
  let shipAt = "";
  let etd = "";

  for (const t of texts) {
    if (
      !statusRaw &&
      /全部到货|已入库|已到仓|已出库|已运仓|待发货|在途|签收/.test(t) &&
      t.length > 2
    ) {
      statusRaw = t.replace(/\s+/g, " ").trim();
    }
    if (!transportMode && /空运|海运|快递|专线/.test(t) && t.length < 40) {
      transportMode = t;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
      if (!inboundAt) inboundAt = t;
      else if (!shipAt) shipAt = t;
      else if (!etd) etd = t;
    }
  }

  // 兜底：第 4 列常为采购单状态（0-index=3）
  if (!statusRaw && texts[3]) statusRaw = texts[3];
  if (!transportMode && texts[5]) transportMode = texts[5];

  const events = statusRaw ? splitStatusChain(statusRaw) : [];
  const detailLines = [
    statusRaw ? `采购单状态：${statusRaw}` : "",
    transportMode ? `运输方式：${transportMode}` : "",
    inboundAt ? `入库时间：${inboundAt}` : "",
    shipAt ? `发货时间：${shipAt}` : "",
    etd ? `预计起飞：${etd}` : "",
    ...events.map((e) => e.name),
  ].filter(Boolean);

  // 状态取链条最后一节（最新进度）或整串
  const statusText =
    events.length > 0 ? events[events.length - 1]!.name : statusRaw || undefined;

  const ok = !!(statusText || detailLines.length > 0);
  return {
    ok,
    statusText,
    transportMode: transportMode || undefined,
    detailLines: detailLines.slice(0, 40),
    events: events.slice(0, 30),
    message: ok ? "已从 B2B 报表抓取入仓行" : "找到行但未解析到状态",
  };
}

export async function runChicexpressTrack(params: {
  logisticsNo: string;
  account?: ForwarderPortalAccount | null;
  opts?: ChicexpressSessionOptions;
}): Promise<ChicexpressTrackResult> {
  const started = Date.now();
  const logisticsNo = params.logisticsNo.trim();
  const shotDir = join(getForwarderPortalsDir(), "tracks");
  mkdirSync(shotDir, { recursive: true });
  const screenshotPath = join(
    shotDir,
    `qike-${logisticsNo.replace(/[^\w-]/g, "_")}-${Date.now()}.png`,
  );

  let browser: Browser | null = null;
  let stage: ChicexpressTrackResult["stage"] = "launch";
  try {
    browser = await chromium.launch({
      headless: params.opts?.headed === false,
      slowMo: params.opts?.headed === false ? 0 : 40,
    });
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1600, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(params.opts?.timeoutMs ?? 55_000);

    stage = "login";
    if (params.opts?.login !== false) {
      const login = await loginChicexpress(page, params.account);
      if (!login.ok) {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        return {
          ok: false,
          portalId: "qike",
          logisticsNo,
          stage,
          message: login.message,
          finalUrl: page.url(),
          screenshotPath,
          durationMs: Date.now() - started,
        };
      }
    }

    stage = "menu";
    await openB2bReport(page);

    stage = "fill";
    const filled = await searchByInboundNo(page, logisticsNo);
    if (!filled) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return {
        ok: false,
        portalId: "qike",
        logisticsNo,
        stage,
        message: "未找到入仓号输入框",
        finalUrl: page.url(),
        screenshotPath,
        durationMs: Date.now() - started,
      };
    }

    stage = "search";
    stage = "parse";
    const parsed = await parseResultRow(page, logisticsNo);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      ok: parsed.ok,
      portalId: "qike",
      logisticsNo,
      stage: "parse",
      statusText: parsed.statusText,
      transportMode: parsed.transportMode,
      detailLines: parsed.detailLines,
      events: parsed.events,
      finalUrl: page.url(),
      screenshotPath,
      message: parsed.message,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      portalId: "qike",
      logisticsNo,
      stage,
      message: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - started,
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

/** 起克专用入口 */
export async function runQikeTrack(params: {
  logisticsNo: string;
  account?: ForwarderPortalAccount | null;
  opts?: ChicexpressSessionOptions;
}): Promise<ChicexpressTrackResult> {
  return runChicexpressTrack(params);
}
