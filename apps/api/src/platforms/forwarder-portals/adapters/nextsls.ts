/**
 * nextsls / ParcelOS WOS 适配器（汉沙等同系）
 * - 登录：/tms/wos/login
 * - 查件：发货→运单(/tms/wos/shipment) → 运单号=装箱「票号」→ 搜索 → 侧滑详情「路由信息」
 * 海运/空运同一列表，不分链路。
 * 边界：只读门户；结果落本地；不写飞书。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  getForwarderPortalsDir,
  type ForwarderPortalAccount,
} from "../types.js";

export type NextslsPortalId = "hansha" | "yayouhui" | "yite";

export type NextslsPortalConfig = {
  id: NextslsPortalId;
  name: string;
  origin: string;
  loginPath: string;
  shipmentPath: string;
};

export const NEXTSLS_PORTALS: Record<NextslsPortalId, NextslsPortalConfig> = {
  hansha: {
    id: "hansha",
    name: "汉沙",
    origin: "https://hansha.nextsls.com",
    loginPath: "/tms/wos/login",
    shipmentPath: "/tms/wos/shipment?page=1&pageSize=30&activeTab=all",
  },
  yayouhui: {
    id: "yayouhui",
    name: "亚优汇",
    origin: "https://yayoux.nextsls.com",
    loginPath: "/tms/wos/login",
    shipmentPath: "/tms/wos/shipment?page=1&pageSize=30&activeTab=all",
  },
  yite: {
    id: "yite",
    name: "义特",
    origin: "https://ywyite.nextsls.com",
    loginPath: "/tms/wos/login",
    shipmentPath: "/tms/wos/shipment?page=1&pageSize=30&activeTab=all",
  },
};

export type NextslsTrackEvent = {
  name: string;
  at?: string;
  desc?: string | null;
};

export type NextslsTrackResult = {
  ok: boolean;
  portalId: NextslsPortalId;
  ticketNo: string;
  stage:
    | "launch"
    | "navigate"
    | "login"
    | "menu"
    | "fill"
    | "search"
    | "panel"
    | "parse";
  statusText?: string;
  serviceText?: string;
  detailLines?: string[];
  events?: NextslsTrackEvent[];
  finalUrl?: string;
  screenshotPath?: string;
  message: string;
  durationMs: number;
};

export type NextslsSessionOptions = {
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

function looksLoggedIn(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes("/tms/wos/") && !u.includes("/login");
}

export async function loginNextsls(
  page: Page,
  portal: NextslsPortalConfig,
  account?: ForwarderPortalAccount | null,
): Promise<{ ok: boolean; message: string }> {
  const loginUrl = `${portal.origin}${portal.loginPath}`;
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  if (looksLoggedIn(page.url())) {
    return { ok: true, message: "已在登录态" };
  }

  if (!account?.username || !account?.password) {
    return { ok: false, message: "无凭据，无法登录" };
  }

  const userOk = await fillFirst(
    page,
    [
      'input[type="text"]',
      'input[placeholder*="账号"]',
      'input[placeholder*="用户"]',
      ".ant-input",
      ".el-input input",
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
    "button.ant-btn-primary",
    'button[type="submit"]',
    ".el-button--primary",
  ]);
  if (!clicked) await page.keyboard.press("Enter");
  await page.waitForTimeout(2800);

  if (looksLoggedIn(page.url())) {
    return { ok: true, message: "登录成功" };
  }
  const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(
    0,
    500,
  );
  if (/密码错误|账号不存在|用户名或密码|登录失败|不正确/.test(body)) {
    return { ok: false, message: "账号或密码错误" };
  }
  return { ok: false, message: `登录后仍未进入系统（url=${page.url()}）` };
}

async function selectWaybillNoType(page: Page): Promise<void> {
  const trigger = page.locator("button.ant-dropdown-trigger").first();
  if (!(await trigger.isVisible({ timeout: 2000 }).catch(() => false))) return;
  const label = ((await trigger.innerText().catch(() => "")) || "").trim();
  if (label.includes("运单号")) return;
  await trigger.click();
  await page.waitForTimeout(300);
  await page
    .locator(".ant-dropdown-menu-item:has-text('运单号')")
    .first()
    .click({ timeout: 3000 })
    .catch(() => undefined);
  await page.waitForTimeout(200);
}

/** 运单列表状态 Tab：URL activeTab=all 偶发无效，显式点「全部」再搜 */
async function clickShipmentAllTab(page: Page): Promise<void> {
  const allTab = page
    .locator(
      ".ant-tabs-tab:has-text('全部'), [role=tab]:has-text('全部'), .ant-radio-button-wrapper:has-text('全部')",
    )
    .first();
  if (!(await allTab.isVisible({ timeout: 2500 }).catch(() => false))) return;
  await allTab.click().catch(() => undefined);
  await page.waitForTimeout(600);
}

function parseRouteEvents(panelText: string): NextslsTrackEvent[] {
  const events: NextslsTrackEvent[] = [];
  const routeIdx = panelText.indexOf("路由信息");
  const chunk =
    routeIdx >= 0
      ? panelText.slice(routeIdx, panelText.indexOf("货箱信息", routeIdx) >= 0
          ? panelText.indexOf("货箱信息", routeIdx)
          : routeIdx + 2500)
      : panelText;
  const lines = chunk
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i]!;
    if (!/^\d{4}-\d{2}-\d{2}/.test(at)) continue;
    const name = lines[i + 1] && !/^\d{4}-\d{2}-\d{2}/.test(lines[i + 1]!)
      ? lines[i + 1]!
      : at;
    if (name === "路由信息") continue;
    events.push({ name: name === at ? name : name, at, desc: null });
    if (name !== at) i++;
  }
  return events;
}

function parseStatusFromPanel(panelText: string): {
  statusText?: string;
  serviceText?: string;
} {
  const lines = panelText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let statusText: string | undefined;
  let serviceText: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "状态" && lines[i - 1]) statusText = lines[i - 1];
    if (lines[i] === "服务类型" && lines[i - 1]) serviceText = lines[i - 1];
  }
  if (!statusText) {
    const m = panelText.match(
      /(已签收|转运中|已收货|已下单|已取消|退件|运送中)/,
    );
    statusText = m?.[1];
  }
  return { statusText, serviceText };
}

export async function runNextslsTrack(params: {
  portalId: NextslsPortalId;
  ticketNo: string;
  account?: ForwarderPortalAccount | null;
  opts?: NextslsSessionOptions;
}): Promise<NextslsTrackResult> {
  const started = Date.now();
  const portal = NEXTSLS_PORTALS[params.portalId];
  const ticketNo = params.ticketNo.trim();
  const shotDir = join(getForwarderPortalsDir(), "tracks");
  mkdirSync(shotDir, { recursive: true });
  const screenshotPath = join(
    shotDir,
    `${portal.id}-${ticketNo.replace(/[^\w-]/g, "_")}-${Date.now()}.png`,
  );

  let browser: Browser | null = null;
  let stage: NextslsTrackResult["stage"] = "launch";
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
    page.setDefaultTimeout(params.opts?.timeoutMs ?? 45_000);

    stage = "login";
    if (params.opts?.login !== false) {
      const login = await loginNextsls(page, portal, params.account);
      if (!login.ok) {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        return {
          ok: false,
          portalId: portal.id,
          ticketNo,
          stage,
          message: login.message,
          finalUrl: page.url(),
          screenshotPath,
          durationMs: Date.now() - started,
        };
      }
    }

    stage = "menu";
    await page.goto(`${portal.origin}${portal.shipmentPath}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);
    await clickShipmentAllTab(page);

    stage = "fill";
    await selectWaybillNoType(page);
    const filled = await fillFirst(
      page,
      [
        'input[name="keywords"]',
        'input[placeholder*="单号"]',
        'input[placeholder*="隔开"]',
        "input.ant-input",
      ],
      ticketNo,
    );
    if (!filled) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return {
        ok: false,
        portalId: portal.id,
        ticketNo,
        stage,
        message: "未找到运单号输入框",
        finalUrl: page.url(),
        screenshotPath,
        durationMs: Date.now() - started,
      };
    }

    stage = "search";
    await clickShipmentAllTab(page);
    const searched = await clickFirst(page, [
      "button[type='submit']",
      "button.pod-btn-success",
      "button:has-text('搜 索')",
      "button:has-text('搜索')",
    ]);
    if (!searched) await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    // 部分租户搜索后仍落在状态子 Tab，再点一次「全部」露出结果
    await clickShipmentAllTab(page);
    await page.waitForTimeout(800);

    const listText =
      ((await page.locator("body").innerText().catch(() => "")) || "");
    if (!listText.includes(ticketNo)) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return {
        ok: false,
        portalId: portal.id,
        ticketNo,
        stage,
        message: "搜索无结果（票号在运单列表未找到）",
        finalUrl: page.url(),
        screenshotPath,
        durationMs: Date.now() - started,
      };
    }

    stage = "panel";
    // 装箱票号可能是运单号前缀（如 YT260464 → YT2604647454）
    const opened = await clickFirst(page, [
      `span.btn-slidepanel-open:has-text("${ticketNo}")`,
      `span.click-btn:has-text("${ticketNo}")`,
      `span.primary:has-text("${ticketNo}")`,
      `td.ant-table-cell:has-text("${ticketNo}") span.click-btn`,
      `td.ant-table-cell:has-text("${ticketNo}") span.btn-slidepanel-open`,
      `a:has-text("${ticketNo}")`,
    ]);
    if (!opened) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return {
        ok: false,
        portalId: portal.id,
        ticketNo,
        stage,
        message: "列表有票号，但未能点开侧滑详情",
        finalUrl: page.url(),
        screenshotPath,
        durationMs: Date.now() - started,
      };
    }
    await page.waitForTimeout(2200);

    stage = "parse";
    const panel = page
      .locator(
        ".ant-drawer-content-wrapper:visible .ant-drawer-body, .ant-drawer:not(.ant-drawer-content-hidden) .ant-drawer-body, .ant-drawer-content",
      )
      .last();
    let panelText = "";
    if (await panel.isVisible({ timeout: 3000 }).catch(() => false)) {
      panelText = ((await panel.innerText().catch(() => "")) || "").trim();
    }
    if (!panelText) {
      panelText = ((await page.locator("body").innerText().catch(() => "")) || "").trim();
    }

    const { statusText, serviceText } = parseStatusFromPanel(panelText);
    const events = parseRouteEvents(panelText);
    const detailLines = events.map((e) =>
      [e.at, e.name].filter(Boolean).join(" "),
    );
    const ok = !!(statusText || events.length > 0);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      ok,
      portalId: portal.id,
      ticketNo,
      stage,
      statusText: statusText || events[0]?.name,
      serviceText,
      detailLines: detailLines.slice(0, 40),
      events: events.slice(0, 30),
      finalUrl: page.url(),
      screenshotPath,
      message: ok
        ? `已打开运单侧滑并抓取路由${serviceText ? `（${serviceText}）` : ""}`
        : "已打开侧滑但未解析到状态/路由",
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      portalId: params.portalId,
      ticketNo,
      stage,
      message: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - started,
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

/** 汉沙专用入口 */
export async function runHanshaTrack(params: {
  ticketNo: string;
  account?: ForwarderPortalAccount | null;
  opts?: NextslsSessionOptions;
}): Promise<NextslsTrackResult> {
  return runNextslsTrack({
    portalId: "hansha",
    ticketNo: params.ticketNo,
    account: params.account,
    opts: params.opts,
  });
}

/** 亚优汇专用入口（与汉沙同 UI：票号=运单号） */
export async function runYayouhuiTrack(params: {
  ticketNo: string;
  account?: ForwarderPortalAccount | null;
  opts?: NextslsSessionOptions;
}): Promise<NextslsTrackResult> {
  return runNextslsTrack({
    portalId: "yayouhui",
    ticketNo: params.ticketNo,
    account: params.account,
    opts: params.opts,
  });
}

/** 义特专用入口（与汉沙同 UI；查件键=装箱物流编号去 U 后缀后的运单号） */
export async function runYiteTrack(params: {
  ticketNo: string;
  account?: ForwarderPortalAccount | null;
  opts?: NextslsSessionOptions;
}): Promise<NextslsTrackResult> {
  return runNextslsTrack({
    portalId: "yite",
    ticketNo: params.ticketNo,
    account: params.account,
    opts: params.opts,
  });
}
