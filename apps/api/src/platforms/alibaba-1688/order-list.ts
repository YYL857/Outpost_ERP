/**
 * 1688 买家订单列表：先点「全部」→「批量导入」订单号→搜索，再解析物流。
 * 边界：只读门户；结果落本地；不写飞书。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import {
  extractTrackingNo,
  parseEtaDate,
  pickTransitStatus,
} from "./eta.js";
import { open1688Session, close1688Session } from "./session.js";
import {
  BUYER_ORDER_LIST_BASE,
  ensureAlibaba1688Dir,
  getDefaultStorageStatePath,
  hasStorageState,
  type Alibaba1688BatchResult,
  type Alibaba1688FetchOptions,
  type Alibaba1688OrderLogistics,
} from "./types.js";

/** 已买到的货品 · 全部订单入口（不带 orderIds） */
const LIST_HOME = `${BUYER_ORDER_LIST_BASE}?spm=a360q.7751291.topmenu.dmyorder_popup_dallorder&page=1&pageSize=30`;

type PaceMode = "slow" | "normal" | "fast";

function resolvePace(optsPace?: PaceMode): PaceMode {
  const env = (process.env.OUTPOST_1688_PACE || "").trim().toLowerCase();
  if (env === "slow" || env === "normal" || env === "fast") return env;
  if (optsPace) return optsPace;
  return "normal";
}

/** 随机停顿（毫秒），模拟人工间隔 */
async function humanPause(
  page: Page,
  minMs: number,
  maxMs: number,
): Promise<void> {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  const ms = lo + Math.floor(Math.random() * (hi - lo + 1));
  await page.waitForTimeout(ms);
}

function paceScale(pace: PaceMode): number {
  if (pace === "fast") return 0.4;
  if (pace === "slow") return 1.15;
  return 1; // normal：比原先 slow 略快
}

async function pacedPause(
  page: Page,
  pace: PaceMode,
  minMs: number,
  maxMs: number,
): Promise<void> {
  const s = paceScale(pace);
  await humanPause(page, Math.round(minMs * s), Math.round(maxMs * s));
}

/** 轻微鼠标晃动，避免「瞬移点击」 */
async function humanNudge(page: Page): Promise<void> {
  const box = page.viewportSize();
  if (!box) return;
  const x = Math.floor(box.width * (0.3 + Math.random() * 0.4));
  const y = Math.floor(box.height * (0.25 + Math.random() * 0.4));
  await page.mouse.move(x, y, { steps: 4 + Math.floor(Math.random() * 8) }).catch(() => {});
}

async function humanClick(
  page: Page,
  loc: ReturnType<Page["locator"]>,
  pace: PaceMode,
): Promise<void> {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await pacedPause(page, pace, 280, 700);
  await loc.hover({ timeout: 2000 }).catch(() => {});
  await pacedPause(page, pace, 180, 480);
  await loc.click({ timeout: 4000 });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function looksLoggedOut(page: Page): Promise<boolean> {
  const url = page.url();
  if (/login\.taobao|login\.1688|passport\.alibaba/i.test(url)) return true;
  const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(
    0,
    1200,
  );
  if (/请登录|扫码登录|密码登录|登录1688/.test(body) && !/已买到的货品|订单号/.test(body)) {
    return true;
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
        if (!(await loc.isVisible({ timeout: 400 }))) continue;
        await loc.click({ timeout: 2500 });
        return true;
      } catch {
        /* next */
      }
    }
  }
  return false;
}

/** 等 Shadow DOM 列表就绪（订单号搜索 / 批量导入出现） */
async function waitForOrderListReady(page: Page, timeoutMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const batch = page.getByText("批量导入", { exact: true });
    if (await batch.isVisible().catch(() => false)) return true;
    const ph = page.getByPlaceholder(/订单号|商品名称|货品名称/);
    if (await ph.first().isVisible().catch(() => false)) {
      // 入口偶发晚于搜索框
      await page.waitForTimeout(600);
      if (await batch.isVisible().catch(() => false)) return true;
    }
    await page.waitForTimeout(500);
  }
  return page.getByText("批量导入", { exact: true }).isVisible().catch(() => false);
}

/** 状态条点「全部」（待付款/待收货那一行） */
async function clickAllStatusTab(
  page: Page,
  pace: PaceMode = "normal",
): Promise<boolean> {
  try {
    const statusRow = page
      .getByText("待收货", { exact: false })
      .locator("xpath=ancestor::*[self::div or self::ul or self::nav][1]");
    const allInRow = statusRow.getByText("全部", { exact: true }).first();
    if (await allInRow.isVisible({ timeout: 1500 }).catch(() => false)) {
      await humanClick(page, allInRow, pace);
      await pacedPause(page, pace, 1200, 2400);
      return true;
    }
  } catch {
    /* fall through */
  }
  const allTab = page.getByText("全部", { exact: true }).first();
  if (await allTab.isVisible({ timeout: 800 }).catch(() => false)) {
    await humanClick(page, allTab, pace).catch(() => {});
    await pacedPause(page, pace, 900, 1800);
    return true;
  }
  return false;
}

/**
 * 批量导入订单号 → 弹窗 → 慢速键入 → 点「确定/查询」。
 */
async function batchImportAndSearch(
  page: Page,
  orderIds: string[],
  pace: PaceMode = "normal",
): Promise<{ ok: boolean; message: string }> {
  await waitForOrderListReady(page);
  await humanNudge(page);
  await pacedPause(page, pace, 600, 1400);

  const entry = page.getByText("批量导入", { exact: true }).first();
  if (!(await entry.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { ok: false, message: "未找到「批量导入」入口（Shadow DOM 未就绪）" };
  }
  await humanClick(page, entry, pace);
  await pacedPause(page, pace, 900, 1800);

  const area = page
    .locator(
      "textarea[placeholder*='分隔符'], textarea[placeholder*='一行一个'], textarea[placeholder*='支持'], q-dialog textarea",
    )
    .locator("visible=true")
    .first();

  if (!(await area.isVisible({ timeout: 6000 }).catch(() => false))) {
    await humanClick(page, entry, pace).catch(() => {});
    await pacedPause(page, pace, 800, 1500);
  }
  if (!(await area.isVisible({ timeout: 4000 }).catch(() => false))) {
    return { ok: false, message: "点了批量导入，但未出现批量查询 textarea" };
  }

  const payload = orderIds.join("\n");
  const preview = orderIds[0] ?? "";

  await area.click({ timeout: 3000 });
  await pacedPause(page, pace, 350, 800);
  await area.fill("");
  await pacedPause(page, pace, 250, 600);

  // 逐字/逐行键入，避免瞬间 fill 整批单号（比原先慢节奏略快）
  const typeDelay =
    pace === "fast" ? 6 : pace === "slow" ? 22 + Math.floor(Math.random() * 12) : 14 + Math.floor(Math.random() * 10);
  try {
    for (let i = 0; i < orderIds.length; i++) {
      const line = orderIds[i]!;
      await page.keyboard.type(line, { delay: typeDelay });
      if (i < orderIds.length - 1) {
        await page.keyboard.press("Enter");
        if (Math.random() < 0.25) {
          await pacedPause(page, pace, 120, 380);
        }
      }
    }
  } catch {
    await area.fill(payload);
  }

  let written = await area.inputValue().catch(() => "");
  if (preview && !written.includes(preview)) {
    await area.fill(payload);
    written = await area.inputValue().catch(() => "");
  }
  if (preview && !written.includes(preview)) {
    return { ok: false, message: "订单号未写入批量查询 textarea" };
  }

  await pacedPause(page, pace, 500, 1200);
  await humanNudge(page);

  const confirmRe = /^(确定|查询|确认)$/;
  const candidates = page.locator("q-button").locator("visible=true");
  const n = await candidates.count().catch(() => 0);
  let clicked = false;
  for (let i = 0; i < n; i++) {
    const btn = candidates.nth(i);
    const label = ((await btn.innerText().catch(() => "")) || "")
      .replace(/\s+/g, "")
      .trim();
    if (!confirmRe.test(label)) continue;
    await humanClick(page, btn, pace);
    clicked = true;
    break;
  }
  if (!clicked) {
    for (let i = 0; i < n; i++) {
      const btn = candidates.nth(i);
      const label = ((await btn.innerText().catch(() => "")) || "")
        .replace(/\s+/g, "")
        .trim();
      if (label !== "取消") continue;
      const box = await btn.boundingBox().catch(() => null);
      if (!box) continue;
      await pacedPause(page, pace, 200, 500);
      await page.mouse.click(box.x + box.width + 48, box.y + box.height / 2);
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    return {
      ok: false,
      message: `弹窗内未找到「确定/查询」按钮（可见 q-button×${n}）`,
    };
  }

  await area.waitFor({ state: "hidden", timeout: 12_000 }).catch(() => {});
  // 等列表刷新：人为多停一会
  await pacedPause(page, pace, 2000, 3800);
  return { ok: true, message: "已批量查询订单" };
}

type DomOrderRow = {
  orderId: string;
  orderStatus: string;
  blockText: string;
};

/** 穿透 open Shadow DOM 收集节点（1688 订单列表在 shadow 内） */
async function scrapeOrderBlocks(page: Page): Promise<DomOrderRow[]> {
  // 必须用字符串 evaluate：tsx 会给函数回调注入 __name 导致浏览器侧报错
  return page.evaluate(`(() => {
    const rows = [];
    const seen = new Set();
    const idRe = /\\b(\\d{15,22})\\b/g;
    const statusHints =
      /待付款|待发货|待收货|等待买家收货|待评价|退款|交易成功|已收货|已签收|交易关闭|部分发货|已发货|运输中|派送中|派件中|已揽收/;

    function walkAll(root) {
      const out = [];
      const visit = (node) => {
        node.querySelectorAll("*").forEach((el) => {
          out.push(el);
          if (el.shadowRoot) visit(el.shadowRoot);
        });
      };
      visit(root);
      return out;
    }

    const allEls = walkAll(document);
    const candidates = allEls.filter((el) => {
      const cls = (el.className && el.className.toString) ? el.className.toString() : "";
      const tag = el.tagName.toLowerCase();
      return (
        /order|Order|trade|list-item|table-row/i.test(cls) ||
        tag === "tr" ||
        tag === "li"
      );
    });
    const roots = candidates.length > 0 ? candidates : allEls;

    for (const el of roots) {
      const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
      if (text.length < 20 || text.length > 4000) continue;
      if (!/订单号|下单时间|卖家/.test(text) && !statusHints.test(text)) continue;
      idRe.lastIndex = 0;
      const m = idRe.exec(text);
      if (!m) continue;
      const orderId = m[1];
      if (seen.has(orderId)) continue;
      seen.add(orderId);

      // 从命中节点向上抬升，尽量吃到状态列 + 运输中摘要 + 运单
      let best = text;
      let node = el;
      for (let up = 0; up < 12 && node; up++) {
        const t = (node.textContent || "").replace(/\\s+/g, " ").trim();
        if (t.length > 40 && t.length < 4000) {
          const rich =
            statusHints.test(t) ||
            /查看物流|运输中|派送|运单|快递/.test(t);
          if (rich) {
            best = t;
            if (
              /订单号/.test(t) &&
              (statusHints.test(t) || /运输中|派送|运单/.test(t))
            ) {
              break;
            }
          } else if (t.length > best.length && t.length < 800) {
            best = t;
          }
        }
        node =
          node.parentElement ||
          (node.getRootNode && node.getRootNode().host) ||
          null;
      }

      const st = best.match(statusHints);
      rows.push({
        orderId,
        orderStatus: st ? st[0] : "",
        blockText: best.slice(0, 1500),
      });
    }

    if (rows.length === 0) {
      const chunks = [];
      for (const el of allEls) {
        if (el.childElementCount === 0) {
          const t = (el.textContent || "").trim();
          if (t) chunks.push(t);
        }
      }
      const body = chunks.join(" ").replace(/\\s+/g, " ");
      const allIds = [];
      const re2 = /\\b(\\d{15,22})\\b/g;
      let mm;
      while ((mm = re2.exec(body))) allIds.push(mm[1]);
      const uniq = [...new Set(allIds)];
      for (const orderId of uniq) {
        const idx = body.indexOf(orderId);
        const slice = body.slice(Math.max(0, idx - 40), idx + 400);
        const st = slice.match(statusHints);
        rows.push({
          orderId,
          orderStatus: st ? st[0] : "",
          blockText: slice,
        });
      }
    }
    return rows;
  })()`) as Promise<DomOrderRow[]>;
}

async function tryExpandLogistics(page: Page): Promise<void> {
  const labels = ["查看物流", "物流详情", "物流"];
  for (const label of labels) {
    const locs = page.getByText(label, { exact: label !== "物流" });
    const n = Math.min(await locs.count().catch(() => 0), 8);
    for (let i = 0; i < n; i++) {
      try {
        const loc = locs.nth(i);
        if (!(await loc.isVisible({ timeout: 300 }))) continue;
        await loc.click({ timeout: 1500 });
        await page.waitForTimeout(400);
      } catch {
        /* ignore */
      }
    }
  }
}

function toLogistics(
  row: DomOrderRow,
  requested: Set<string>,
): Alibaba1688OrderLogistics {
  const trackingNo = extractTrackingNo(row.blockText);
  const transitStatus = pickTransitStatus(row.orderStatus, row.blockText);
  const etaDate = parseEtaDate(`${row.orderStatus} ${row.blockText}`);
  const inBatch = requested.has(row.orderId);
  // 列表能定位到订单即 ok（状态/运单可能需点开物流才有）
  return {
    orderId: row.orderId,
    ok: inBatch,
    orderStatus: row.orderStatus,
    trackingNo,
    transitStatus:
      transitStatus ||
      row.orderStatus ||
      (inBatch ? "列表已定位" : ""),
    etaDate,
    logisticsText: row.blockText.slice(0, 500),
    message: inBatch
      ? row.orderStatus || trackingNo || transitStatus
        ? "ok"
        : "parsed_without_status"
      : "not_in_request",
  };
}

/**
 * 用可见坐标把「运输中/运单」贴到最近的订单号（同卡常为订单号下方一截）。
 */
async function associateLogisticsByProximity(
  page: Page,
  orderIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  type Pt = { id: string; x: number; y: number; t: string };
  const orders: Pt[] = [];

  for (const orderId of orderIds) {
    const loc = page.getByText(orderId, { exact: false }).first();
    if (!(await loc.isVisible({ timeout: 400 }).catch(() => false))) continue;
    const box = await loc.boundingBox().catch(() => null);
    if (!box) continue;
    orders.push({
      id: orderId,
      x: box.x + box.width / 2,
      y: box.y,
      t: "",
    });
  }
  if (!orders.length) return map;

  const seedRe =
    /运输中|派送中|派件中|已揽收|已签收|已收货|正在派送|上门投递|已送达/;
  const seeds = page.getByText(seedRe);
  const sn = Math.min(await seeds.count().catch(() => 0), 40);
  for (let i = 0; i < sn; i++) {
    const loc = seeds.nth(i);
    if (!(await loc.isVisible({ timeout: 200 }).catch(() => false))) continue;
    const box = await loc.boundingBox().catch(() => null);
    if (!box) continue;
    const tip = ((await loc.innerText().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
    // 抬一层拿运单号
    let blob = tip;
    try {
      const parentTx = await loc.evaluate(`(el) => {
        let n = el;
        for (let k = 0; k < 5 && n; k++) {
          const tx = (n.innerText || n.textContent || "")
            .replace(/\\s+/g, " ")
            .trim();
          if (tx.length > 15 && tx.length < 500) return tx;
          n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
        }
        return "";
      }`);
      if (parentTx && String(parentTx).length > blob.length) {
        blob = String(parentTx);
      }
    } catch {
      /* ignore */
    }
    const cy = box.y + box.height / 2;
    const cx = box.x + box.width / 2;
    let best: Pt | null = null;
    let bestScore = Infinity;
    for (const o of orders) {
      // 物流摘要一般在订单号下方 0–420px，水平不要偏太远
      const dy = cy - o.y;
      if (dy < -40 || dy > 480) continue;
      const dx = Math.abs(cx - o.x);
      if (dx > 900) continue;
      const score = dy + dx * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (!best) continue;
    const prev = map.get(best.id) || "";
    const merged = `${prev} ${blob}`.replace(/\s+/g, " ").trim();
    map.set(best.id, merged.slice(0, 1500));
  }

  // 纯数字运单（12–17 位）同样按坐标贴靠
  const digitSeeds = page.getByText(/\b\d{12,17}\b/);
  const dn = Math.min(await digitSeeds.count().catch(() => 0), 30);
  for (let i = 0; i < dn; i++) {
    const loc = digitSeeds.nth(i);
    if (!(await loc.isVisible({ timeout: 150 }).catch(() => false))) continue;
    const raw = ((await loc.innerText().catch(() => "")) || "").trim();
    const m = raw.match(/\b(\d{12,17})\b/);
    if (!m?.[1] || /^\d{18,22}$/.test(m[1])) continue;
    // 跳过看起来像订单号片段的
    if (orderIds.some((id) => id.includes(m[1]!))) continue;
    const box = await loc.boundingBox().catch(() => null);
    if (!box) continue;
    const cy = box.y + box.height / 2;
    const cx = box.x + box.width / 2;
    let best: Pt | null = null;
    let bestScore = Infinity;
    for (const o of orders) {
      const dy = cy - o.y;
      if (dy < -40 || dy > 480) continue;
      const dx = Math.abs(cx - o.x);
      if (dx > 900) continue;
      const score = dy + dx * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (!best) continue;
    const prev = map.get(best.id) || "";
    if (prev.includes(m[1]!)) continue;
    map.set(
      best.id,
      `${prev} 运单号 ${m[1]}`.replace(/\s+/g, " ").trim().slice(0, 1500),
    );
  }

  return map;
}

/** 合并 climb + 坐标邻近物流文案 */
async function enrichRowsFromPage(
  page: Page,
  rows: DomOrderRow[],
  orderIds: string[],
): Promise<DomOrderRow[]> {
  const statusRe =
    /等待买家收货|待付款|待发货|待收货|待评价|退款中|交易成功|已收货|已签收|交易关闭|部分发货|已发货|运输中|派送中|派件中|已揽收/;
  const byId = new Map(rows.map((r) => [r.orderId, { ...r }]));
  const near = await associateLogisticsByProximity(page, orderIds);

  for (const orderId of orderIds) {
    const next = byId.get(orderId) ?? {
      orderId,
      orderStatus: "",
      blockText: "",
    };
    const parts = [next.blockText, near.get(orderId) || ""]
      .filter(Boolean)
      .join(" ");
    const merged = parts.replace(/\s+/g, " ").trim();
    if (merged) next.blockText = merged.slice(0, 1500);
    if (!next.orderStatus) {
      const st = (next.blockText || "").match(statusRe);
      if (st) next.orderStatus = st[0];
    }
    byId.set(orderId, next);
  }

  return orderIds.map(
    (id) =>
      byId.get(id) ?? {
        orderId: id,
        orderStatus: "",
        blockText: "",
      },
  );
}

async function fetchOneBatch(
  page: Page,
  orderIds: string[],
  timeoutMs: number,
  opts?: { alreadyOnList?: boolean; pace?: PaceMode },
): Promise<Alibaba1688OrderLogistics[]> {
  const pace = opts?.pace ?? "normal";
  if (!opts?.alreadyOnList) {
    await page.goto(LIST_HOME, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await pacedPause(page, pace, 2200, 4200);
  }

  if (await looksLoggedOut(page)) {
    return orderIds.map((orderId) => ({
      orderId,
      ok: false,
      orderStatus: "",
      trackingNo: "",
      transitStatus: "",
      etaDate: null,
      logisticsText: "",
      message: "未登录或会话失效，请先获取 1688 登录态",
    }));
  }

  await waitForOrderListReady(page, Math.min(timeoutMs, 25_000));
  await pacedPause(page, pace, 700, 1500);
  await clickAllStatusTab(page, pace);
  await pacedPause(page, pace, 900, 1800);
  await waitForOrderListReady(page, 15_000);

  const imported = await batchImportAndSearch(page, orderIds, pace);
  if (!imported.ok) {
    return orderIds.map((orderId) => ({
      orderId,
      ok: false,
      orderStatus: "",
      trackingNo: "",
      transitStatus: "",
      etaDate: null,
      logisticsText: "",
      message: imported.message,
    }));
  }

  await pacedPause(page, pace, 800, 1600);
  // 少点「查看物流」连点，主要靠列表摘要；避免短时间狂点
  if (pace !== "slow" || Math.random() < 0.35) {
    await tryExpandLogistics(page);
    await pacedPause(page, pace, 600, 1200);
  }

  let blocks = await scrapeOrderBlocks(page);
  await pacedPause(page, pace, 400, 900);
  blocks = await enrichRowsFromPage(page, blocks, orderIds);

  const requested = new Set(orderIds);
  const byId = new Map<string, Alibaba1688OrderLogistics>();

  for (const b of blocks) {
    if (!requested.has(b.orderId)) continue;
    if (!(b.blockText || b.orderStatus)) continue;
    byId.set(b.orderId, toLogistics(b, requested));
  }

  return orderIds.map((orderId) => {
    const hit = byId.get(orderId);
    if (hit) return hit;
    return {
      orderId,
      ok: false,
      orderStatus: "",
      trackingNo: "",
      transitStatus: "",
      etaDate: null,
      logisticsText: "",
      message: "页面未找到该订单",
    };
  });
}

/**
 * 批量拉取：打开列表 → 点「全部」→ 每批「批量导入」→ 解析。
 */
export async function fetchBuyerOrderLogistics(
  orderIds: string[],
  opts: Alibaba1688FetchOptions = {},
): Promise<Alibaba1688BatchResult> {
  const started = Date.now();
  const dir = ensureAlibaba1688Dir();
  const uniq = [...new Set(orderIds.map((x) => x.trim()).filter(Boolean))];
  if (!uniq.length) {
    return {
      ok: false,
      message: "无订单号",
      durationMs: 0,
      batches: 0,
      orders: [],
    };
  }

  const storageStatePath =
    opts.storageStatePath?.trim() || getDefaultStorageStatePath();
  if (!hasStorageState(storageStatePath)) {
    return {
      ok: false,
      message:
        "缺少 1688 登录态。请先点「获取 1688 登录态」，在弹出浏览器中登录后再同步物流。",
      durationMs: Date.now() - started,
      batches: 0,
      orders: uniq.map((orderId) => ({
        orderId,
        ok: false,
        orderStatus: "",
        trackingNo: "",
        transitStatus: "",
        etaDate: null,
        logisticsText: "",
        message: "missing_storage_state",
      })),
    };
  }

  const batchSize = Math.min(Math.max(opts.batchSize ?? 20, 1), 30);
  const batches = chunk(uniq, batchSize);
  const timeoutMs = opts.timeoutMs ?? 90_000;
  // 默认无头；显式 headed:true 才弹窗（登录扫码仍走 login.ts 强制有头）
  const headed = opts.headed === true;
  const pace = resolvePace(opts.pace);

  const session = await open1688Session({
    headed,
    timeoutMs,
    storageStatePath,
    persistent: true,
  });

  const all: Alibaba1688OrderLogistics[] = [];
  let screenshotPath: string | undefined;
  let fatalMessage = "";

  try {
    const page =
      session.context.pages()[0] ?? (await session.context.newPage());
    await page.goto(LIST_HOME, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await pacedPause(page, pace, 2500, 4800);
    await humanNudge(page);
    await waitForOrderListReady(page, Math.min(timeoutMs, 25_000));
    if (await looksLoggedOut(page)) {
      fatalMessage =
        "1688 登录态已失效。请重新点「获取 1688 登录态」后再同步物流。";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      screenshotPath = join(dir, "runs", `session-expired-${stamp}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      for (const orderId of uniq) {
        all.push({
          orderId,
          ok: false,
          orderStatus: "",
          trackingNo: "",
          transitStatus: "",
          etaDate: null,
          logisticsText: "",
          message: fatalMessage,
        });
      }
    } else {
      await clickAllStatusTab(page, pace);
      await pacedPause(page, pace, 1000, 2000);
      let bi = 0;
      for (const batch of batches) {
        bi++;
        try {
          if (bi > 1) {
            await humanNudge(page);
            await pacedPause(page, pace, 2800, 5500);
          }
          const part = await fetchOneBatch(page, batch, timeoutMs, {
            alreadyOnList: true,
            pace,
          });
          all.push(...part);
          if (opts.onBatch) {
            await opts.onBatch({
              batchIndex: bi,
              batchTotal: batches.length,
              orders: part,
              orderDone: all.length,
              orderTotal: uniq.length,
            });
          } else {
            writeFileSync(
              join(dir, "runs", "progress.json"),
              JSON.stringify(
                {
                  updatedAt: new Date().toISOString(),
                  batchIndex: bi,
                  batchTotal: batches.length,
                  orderDone: all.length,
                  orderTotal: uniq.length,
                  message: `第 ${bi}/${batches.length} 批（全部→批量导入）…`,
                },
                null,
                2,
              ),
              "utf8",
            );
          }
          if (part.some((p) => p.message.includes("未登录"))) {
            fatalMessage =
              "1688 登录态已失效。请重新点「获取 1688 登录态」后再同步物流。";
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            screenshotPath = join(dir, "runs", `session-expired-${stamp}.png`);
            await page
              .screenshot({ path: screenshotPath, fullPage: true })
              .catch(() => {});
            break;
          }
          if (
            part.length &&
            part.every((p) => !p.ok) &&
            part.some((p) => /未找到|批量导入|输入框/.test(p.message))
          ) {
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            screenshotPath = join(dir, "runs", `batch-empty-${stamp}.png`);
            await page
              .screenshot({ path: screenshotPath, fullPage: true })
              .catch(() => {});
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const failOrders = batch.map((orderId) => ({
            orderId,
            ok: false,
            orderStatus: "",
            trackingNo: "",
            transitStatus: "",
            etaDate: null as string | null,
            logisticsText: "",
            message: msg,
          }));
          all.push(...failOrders);
          if (opts.onBatch) {
            await opts.onBatch({
              batchIndex: bi,
              batchTotal: batches.length,
              orders: failOrders,
              orderDone: all.length,
              orderTotal: uniq.length,
            });
          }
        }
      }
    }
  } finally {
    await close1688Session(session);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runPath = join(dir, "runs", `logistics-${stamp}.json`);
  const okCount = all.filter((o) => o.ok).length;
  const result: Alibaba1688BatchResult = {
    ok:
      okCount > 0 &&
      !fatalMessage.includes("失效") &&
      !fatalMessage.includes("缺少"),
    message: fatalMessage
      ? fatalMessage
      : `解析 ${okCount}/${all.length} 单 · ${batches.length} 批（全部→批量导入）`,
    durationMs: Date.now() - started,
    batches: batches.length,
    orders: all,
    screenshotPath,
    runPath,
  };
  writeFileSync(runPath, JSON.stringify(result, null, 2), "utf8");
  return result;
}
