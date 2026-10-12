/**
 * 安时达（ontask / hk-customer-client.ontaskksad2d.com）适配器
 * 流程（与 nextsls 等不可复用）：
 * 1. 登录 /login
 * 2. 头程单 → 中国单（/front-order/china）
 * 3. 「订单号」填装箱「票号」→ 查询
 * 4. 操作 → 轨迹列表 → 抓取状态/轨迹
 * 边界：只读门户；结果落本地；不写飞书。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  getForwarderPortalsDir,
  type ForwarderPortalAccount,
} from "../types.js";

export const ONTASK_LOGIN =
  "https://hk-customer-client.ontaskksad2d.com/login";
export const ONTASK_CHINA_ORDERS =
  "https://hk-customer-client.ontaskksad2d.com/front-order/china";

export type OntaskTrackEvent = {
  name: string;
  at?: string;
  desc?: string | null;
};

export type OntaskTrackResult = {
  ok: boolean;
  portalId: "anshida";
  ticketNo: string;
  stage:
    | "launch"
    | "login"
    | "menu"
    | "fill"
    | "search"
    | "track"
    | "parse";
  statusText?: string;
  detailLines?: string[];
  events?: OntaskTrackEvent[];
  finalUrl?: string;
  screenshotPath?: string;
  message: string;
  durationMs: number;
};

export type OntaskSessionOptions = {
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

async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      if (!(await loc.isVisible({ timeout: 2000 }))) continue;
      await loc.click({ timeout: 3000 });
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

function looksLoggedIn(url: string): boolean {
  const u = url.toLowerCase();
  if (u.includes("/login")) return false;
  return (
    u.includes("ontaskksad2d.com") &&
    (u.includes("front-order") ||
      u.includes("dashboard") ||
      u.includes("client") ||
      !u.endsWith("/login"))
  );
}

export async function loginOntask(
  page: Page,
  account?: ForwarderPortalAccount | null,
): Promise<{ ok: boolean; message: string }> {
  await page.goto(ONTASK_LOGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  if (looksLoggedIn(page.url()) && !page.url().toLowerCase().includes("/login")) {
    return { ok: true, message: "已在登录态" };
  }

  if (!account?.username || !account?.password) {
    return { ok: false, message: "无凭据，无法登录" };
  }

  const userOk = await fillFirst(
    page,
    [
      'input[placeholder*="账号"]',
      'input[placeholder*="请输入"]',
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
  await page.waitForTimeout(3000);

  if (!page.url().toLowerCase().includes("/login")) {
    return { ok: true, message: "登录成功" };
  }
  const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(
    0,
    400,
  );
  if (/密码错误|账号不存在|用户名或密码|登录失败|不正确/.test(body)) {
    return { ok: false, message: "账号或密码错误" };
  }
  return { ok: false, message: `登录后仍在登录页（url=${page.url()}）` };
}

async function openChinaOrders(page: Page): Promise<void> {
  await page.goto(ONTASK_CHINA_ORDERS, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // 若直链未到，点侧栏：头程单 → 中国单
  const onChina =
    page.url().includes("/front-order/china") ||
    (await page.locator("text=中国单").first().isVisible().catch(() => false));
  if (onChina && page.url().includes("china")) return;

  await clickFirst(page, [
    ".el-menu-item:has-text('头程单')",
    "li:has-text('头程单')",
    "span:has-text('头程单')",
    "div:has-text('头程单')",
  ]);
  await page.waitForTimeout(600);
  await clickFirst(page, [
    ".el-menu-item:has-text('中国单')",
    "li:has-text('中国单')",
    "a:has-text('中国单')",
    "span:has-text('中国单')",
  ]);
  await page.waitForTimeout(1500);
}

/** 在「订单号」栏填票号并查询 */
async function searchByOrderNo(page: Page, ticketNo: string): Promise<boolean> {
  // 先重置，避免残留日期/状态筛选把结果滤空
  await clickFirst(page, [
    "button:has-text('重置')",
    "button:has-text('重 置')",
  ]);
  await page.waitForTimeout(800);

  // 优先：标签「订单号」旁的输入框
  const byLabel = page
    .locator(
      ".el-form-item:has(label:has-text('订单号')) input, .el-form-item:has-text('订单号') input.el-input__inner, .ant-form-item:has-text('订单号') input",
    )
    .first();
  if (await byLabel.isVisible({ timeout: 2500 }).catch(() => false)) {
    await byLabel.click({ timeout: 2000 });
    await byLabel.fill("");
    await byLabel.fill(ticketNo);
  } else {
    const filled = await fillFirst(
      page,
      [
        'input[placeholder*="请输入"]',
        'input[placeholder*="订单"]',
        ".el-form-item input.el-input__inner",
        ".ant-form-item input.ant-input",
      ],
      ticketNo,
    );
    if (!filled) return false;
  }

  const searched = await clickFirst(page, [
    "button.el-button--primary:has-text('查询')",
    "button.ant-btn-primary:has-text('查询')",
    "button:has-text('查询')",
    "button:has-text('查 询')",
  ]);
  if (!searched) await page.keyboard.press("Enter");
  await page.waitForTimeout(3500);
  // 等 loading 消失
  await page
    .locator(".el-loading-mask, .ant-spin-spinning")
    .first()
    .waitFor({ state: "hidden", timeout: 8000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
  return true;
}

function parseStatusFromText(text: string): string | undefined {
  const m = text.match(
    /运输状态[:：\s]*([^\s\n]+)|状态[:：\s]*(已签收|在途|转运|出库|入库|已取消|待发货)/,
  );
  if (m?.[1]) return m[1].trim();
  if (m?.[2]) return m[2].trim();
  for (const s of ["已签收", "转运中", "在途", "已出库", "已入库", "待发货"]) {
    if (text.includes(s)) return s;
  }
  return undefined;
}

function parseTrackEvents(text: string): OntaskTrackEvent[] {
  const events: OntaskTrackEvent[] = [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const atMatch = line.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/);
    if (atMatch) {
      const at = atMatch[1];
      const rest = line.slice(atMatch[0].length).trim();
      const name =
        rest ||
        (lines[i + 1] && !/^\d{4}[-/]/.test(lines[i + 1]!)
          ? lines[i + 1]!
          : "轨迹");
      // 跳过纯英文行作为 name
      const zhName =
        name && /[\u4e00-\u9fff]/.test(name)
          ? name
          : lines[i + 1] && /[\u4e00-\u9fff]/.test(lines[i + 1]!)
            ? lines[i + 1]!
            : name;
      events.push({ name: zhName, at, desc: null });
    }
  }
  return events;
}

/** 从轨迹弹窗表格抓取（时间点 / 轨迹-中） */
async function scrapeTrackTable(
  page: Page,
): Promise<OntaskTrackEvent[]> {
  const dialog = page
    .locator(
      ".el-dialog:visible:has-text('轨迹'), .el-dialog:visible, .ant-modal:visible",
    )
    .last();
  if (!(await dialog.isVisible({ timeout: 2000 }).catch(() => false))) {
    return [];
  }
  const rows = dialog.locator(
    ".el-table__body-wrapper tbody tr, .el-table__body tbody tr, table tbody tr",
  );
  const n = await rows.count().catch(() => 0);
  const events: OntaskTrackEvent[] = [];
  for (let i = 0; i < Math.min(n, 30); i++) {
    const cells = rows.nth(i).locator("td");
    const cellCount = await cells.count().catch(() => 0);
    if (cellCount < 3) continue;
    // 列：ID | 时间点 | 轨迹-中 | 轨迹-英 | …
    const at = ((await cells.nth(1).innerText().catch(() => "")) || "").trim();
    const name = ((await cells.nth(2).innerText().catch(() => "")) || "").trim();
    if (!at && !name) continue;
    if (!/\d{4}/.test(at)) continue; // 跳过表头（无时间）
    if (/^轨迹/.test(name) && name.length <= 4) continue;
    events.push({
      name: name || "轨迹",
      at,
      desc: null,
    });
  }
  return events;
}

async function openTrackListAndParse(
  page: Page,
  ticketNo: string,
): Promise<{
  ok: boolean;
  statusText?: string;
  detailLines?: string[];
  events?: OntaskTrackEvent[];
  message: string;
}> {
  const bodyBefore =
    ((await page.locator("body").innerText().catch(() => "")) || "");
  if (!bodyBefore.includes(ticketNo)) {
    return {
      ok: false,
      message: "查询无结果（列表未出现该票号/订单号）",
    };
  }

  // 列表行运输状态（打开轨迹前先抓一份）
  let listStatus: string | undefined;
  const statusCell = page
    .locator(`tr:has-text("${ticketNo}") td`)
    .filter({ hasText: /已签收|在途|转运|出库|入库|待发货/ })
    .first();
  if (await statusCell.isVisible({ timeout: 1500 }).catch(() => false)) {
    listStatus = ((await statusCell.innerText().catch(() => "")) || "").trim();
  }

  // 点该行「操作」下拉
  const row = page.locator(`tr:has-text("${ticketNo}")`).first();
  const opBtn = row
    .locator(
      "button:has-text('操作'), button.el-dropdown-selfdefine, .el-dropdown button, button:has(.el-icon-arrow-down), button .el-icon-arrow-down, .el-button--primary",
    )
    .last();
  if (await opBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await opBtn.click({ timeout: 3000 });
  } else {
    const fallback = row.locator("td").last().locator("button").first();
    if (!(await fallback.isVisible({ timeout: 2000 }).catch(() => false))) {
      return {
        ok: false,
        statusText: listStatus,
        message: "找到订单但未找到「操作」按钮",
      };
    }
    await fallback.click({ timeout: 3000 });
  }
  await page.waitForTimeout(800);

  // 下拉常挂到 body，visibility 偶发失败 → force 点击「轨迹列表」
  const trackCandidates = [
    page.locator(".el-dropdown-menu:visible li").filter({ hasText: "轨迹列表" }),
    page.locator(".el-dropdown-menu__item").filter({ hasText: "轨迹列表" }),
    page.locator(".el-popper:visible li").filter({ hasText: "轨迹列表" }),
    page.getByText("轨迹列表", { exact: true }),
  ];
  let clickedTrack = false;
  for (const loc of trackCandidates) {
    try {
      const target = loc.first();
      if ((await target.count()) === 0) continue;
      await target.click({ force: true, timeout: 3000 });
      clickedTrack = true;
      break;
    } catch {
      /* next */
    }
  }
  if (!clickedTrack) {
    return {
      ok: false,
      statusText: listStatus,
      message: "操作菜单中未找到「轨迹列表」",
    };
  }
  await page.waitForTimeout(2200);

  const panel = page
    .locator(
      ".el-dialog:visible, .el-drawer__body:visible, .ant-modal:visible, .ant-drawer-body:visible",
    )
    .last();
  let panelText = "";
  if (await panel.isVisible({ timeout: 3000 }).catch(() => false)) {
    panelText = ((await panel.innerText().catch(() => "")) || "").trim();
  }
  if (!panelText) {
    panelText = ((await page.locator("body").innerText().catch(() => "")) || "").trim();
  }

  let events = await scrapeTrackTable(page);
  if (!events.length) events = parseTrackEvents(panelText);
  const statusText =
    listStatus || parseStatusFromText(panelText) || events[0]?.name;
  const detailLines = events.map((e) =>
    [e.at, e.name].filter(Boolean).join(" "),
  );

  // 关闭弹层
  await clickFirst(page, [
    ".el-dialog__headerbtn",
    ".el-drawer__close-btn",
    ".ant-modal-close",
    "button:has-text('关闭')",
    "button:has-text('取 消')",
  ]);

  const ok = !!(statusText || events.length > 0);
  return {
    ok,
    statusText,
    detailLines: detailLines.slice(0, 40),
    events: events.slice(0, 30),
    message: ok
      ? "已打开轨迹列表并抓取"
      : "已打开轨迹列表但未解析到状态/轨迹",
  };
}

export async function runOntaskTrack(params: {
  ticketNo: string;
  account?: ForwarderPortalAccount | null;
  opts?: OntaskSessionOptions;
}): Promise<OntaskTrackResult> {
  const started = Date.now();
  const ticketNo = params.ticketNo.trim();
  const shotDir = join(getForwarderPortalsDir(), "tracks");
  mkdirSync(shotDir, { recursive: true });
  const screenshotPath = join(
    shotDir,
    `anshida-${ticketNo.replace(/[^\w-]/g, "_")}-${Date.now()}.png`,
  );

  let browser: Browser | null = null;
  let stage: OntaskTrackResult["stage"] = "launch";
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
    page.setDefaultTimeout(params.opts?.timeoutMs ?? 50_000);

    stage = "login";
    if (params.opts?.login !== false) {
      const login = await loginOntask(page, params.account);
      if (!login.ok) {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        return {
          ok: false,
          portalId: "anshida",
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
    await openChinaOrders(page);

    stage = "fill";
    const filled = await searchByOrderNo(page, ticketNo);
    if (!filled) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return {
        ok: false,
        portalId: "anshida",
        ticketNo,
        stage,
        message: "未找到订单号输入框",
        finalUrl: page.url(),
        screenshotPath,
        durationMs: Date.now() - started,
      };
    }

    stage = "search";
    stage = "track";
    const parsed = await openTrackListAndParse(page, ticketNo);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      ok: parsed.ok,
      portalId: "anshida",
      ticketNo,
      stage: parsed.ok ? "parse" : "track",
      statusText: parsed.statusText,
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
      portalId: "anshida",
      ticketNo,
      stage,
      message: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - started,
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

/** 安时达专用入口 */
export async function runAnshidaTrack(params: {
  ticketNo: string;
  account?: ForwarderPortalAccount | null;
  opts?: OntaskSessionOptions;
}): Promise<OntaskTrackResult> {
  return runOntaskTrack(params);
}
