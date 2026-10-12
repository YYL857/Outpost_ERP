/**
 * 约仓结果回填飞书装箱表（箱表 + 装箱明细）。
 *
 * 规则（与运营标注一致）：
 * - 按票号找关联箱，再按店前缀（N1/N2…）分店写入，禁止串店
 * - 箱表：只写 FBA/ASN、送仓时间；不到仓情况（公式列，整行覆盖会毁掉公式）
 * - 装箱明细：写 ASN、送仓时间，并把到仓情况写成「已入库」
 * - 只改目标单元格，不整行 PUT
 */
import {
  colIndexToLetter,
  createFeishuHttpClient,
  listSpreadsheetSheets,
  readSheetValues,
  updateSheetRow,
  type FeishuSheetMeta,
} from "../../platforms/feishu/http.js";
import { FeishuError } from "../../platforms/feishu/errors.js";
import {
  loadFeishuDocsConfig,
  readFeishuCredentials,
} from "../../platforms/feishu/config.js";
import { cellText, headerIndexMap } from "../../platforms/feishu/normalize/cells.js";
import {
  clearPackingLinesCache,
  shopPrefixFromBoxNo,
  shopPrefixFromPartnerSku,
} from "../../platforms/feishu/normalize/packing-lines.js";
import { pullFeishuRaw } from "../../platforms/feishu/puller.js";
import { formatScheduledDisplay } from "./notify.js";
import type { BookingShopBucket, WarehouseBookingSession } from "./types.js";

export const FEISHU_PACKING_WRITE_PERM_HINT =
  "开通 sheets:spreadsheet（电子表格读写）并发布应用版本；把企业自建应用「开发-机器人」加为装箱表「可编辑」协作者。开放平台：https://open.feishu.cn/app";

const ASN_HEADER_ALIASES = [
  "FBA号/ASN号",
  "FBA单/ASN号",
  "FBA单号/ASN号",
  "ASN号",
  "FBA号",
  "FBA单号",
];

const ARRIVE_HEADER_ALIASES = ["送仓时间", "到仓时间", "入库时间"];

const STATUS_HEADER_ALIASES = ["到仓情况", "入库情况", "仓库状态"];

const TICKET_HEADER_ALIASES = ["票号"];

const LOGISTICS_HEADER_ALIASES = [
  "物流编号",
  "物流单号",
  "运单号",
  "物流号",
];

const BOX_HEADER_ALIASES = ["箱号"];

const SHOP_HEADER_ALIASES = [
  "店铺Code",
  "后端Code",
  "店铺",
  "店Code",
  "Shop Code",
];

const PSKU_HEADER_ALIASES = ["PSKU", "psku", "Partner SKU"];

const NAME_HEADER_ALIASES = ["名称", "品名", "产品名称", "商品名"];

/** RTV / 包装盒等：同票可填送仓时间，但不填 ASN */
export function isPackagingOnlyRow(
  partnerSku: string,
  name = "",
): boolean {
  const sku = partnerSku.trim().toUpperCase();
  const n = name.trim();
  if (!sku && !n) return false;
  if (sku === "RTV" || sku.startsWith("RTV")) return true;
  if (/包装盒/.test(n) || /^RTV/i.test(n)) return true;
  if (sku.includes("包装")) return true;
  return false;
}

export type PackingSheetWriteTarget = "box" | "detail";

export type PackingSheetCellPatch = {
  sheetRow: number;
  /** 0-based */
  col: number;
  value: string;
  field: "asn" | "arriveAt" | "status";
};

export type PackingSheetPlan = {
  target: PackingSheetWriteTarget;
  title: string;
  sheetId: string;
  matchedRows: number[];
  patches: PackingSheetCellPatch[];
};

export type PackingSheetSyncSheetResult = {
  title: string;
  target: PackingSheetWriteTarget;
  matchedRows: number;
  updatedCells: number;
  skipped: boolean;
  skipReason?: string;
};

export type PackingSheetSyncResult = {
  shopPrefix: string;
  asnId: string;
  /** 写入装箱表的送仓日期 YYYY/MM/DD */
  arriveAtSheet: string;
  /** 发群用完整展示（含时段） */
  scheduledDisplay: string | null;
  logisticsNos: string[];
  sheets: PackingSheetSyncSheetResult[];
  refreshedSnapshot: boolean;
  dryRun: boolean;
};

/**
 * 物流编号比对键：票号#箱序（数字）。
 * 10001711U001 / 100017110001 / 10001711001 → 10001711#1
 */
export function normalizeLogisticsKey(
  raw: string,
  ticketPrefix?: string,
): string {
  const s = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s) return "";
  const withU = s.match(/^(\d+)U(\d+)$/);
  if (withU) return `${withU[1]}#${Number(withU[2])}`;
  const ticket = (ticketPrefix || "").trim();
  if (ticket && s.startsWith(ticket) && /^\d+$/.test(s)) {
    const rest = s.slice(ticket.length);
    if (rest && /^\d+$/.test(rest)) return `${ticket}#${Number(rest)}`;
  }
  // 无票号上下文时：去掉 U 后原样（仅作弱比对）
  return s.replace(/U/g, "");
}

export function formatArriveAtForSheet(scheduledDate: string): string {
  const t = scheduledDate.trim();
  const m = t.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return t.replace(/-/g, "/");
  const y = m[1]!;
  const mo = String(Number(m[2])).padStart(2, "0");
  const d = String(Number(m[3])).padStart(2, "0");
  return `${y}/${mo}/${d}`;
}

export function resolvePackingDoc() {
  const cfg = loadFeishuDocsConfig();
  const doc = cfg.docs.find((d) => d.id === "packing" && d.enabled !== false);
  if (!doc?.spreadsheetToken) {
    throw new FeishuError(
      "未配置装箱表 packing（spreadsheetToken）",
      "CONFIG_MISSING",
      "config",
      { docsPath: "feishu.docs.json id=packing" },
      "在 feishu.docs.json 配置 packing 的 spreadsheetToken",
    );
  }
  return doc;
}

function findSheetMeta(
  sheets: FeishuSheetMeta[],
  titles: string[],
): FeishuSheetMeta | undefined {
  for (const title of titles) {
    const exact = sheets.find((s) => s.title === title);
    if (exact) return exact;
  }
  for (const title of titles) {
    const fuzzy = sheets.find((s) => s.title.includes(title));
    if (fuzzy) return fuzzy;
  }
  return undefined;
}

function headerMapLoose(headerRow: unknown[]): Map<string, number> {
  const map = headerIndexMap(headerRow);
  for (const [k, i] of [...map.entries()]) {
    const compact = k.replace(/\s+/g, "");
    if (compact && !map.has(compact)) map.set(compact, i);
  }
  return map;
}

export function findHeaderCol(
  headers: Map<string, number>,
  aliases: string[],
): number | null {
  for (const alias of aliases) {
    const idx = headers.get(alias);
    if (idx != null) return idx;
    const compact = alias.replace(/\s+/g, "");
    const idx2 = headers.get(compact);
    if (idx2 != null) return idx2;
  }
  // 表头偶发带换行
  for (const [k, i] of headers) {
    const compact = k.replace(/\s+/g, "");
    for (const alias of aliases) {
      if (compact === alias.replace(/\s+/g, "")) return i;
    }
  }
  return null;
}

export function rowShopPrefix(opts: {
  shopCell: string;
  boxNo: string;
  partnerSku: string;
}): string | null {
  const fromShop = opts.shopCell.trim().toUpperCase();
  const fromSku = shopPrefixFromPartnerSku(opts.partnerSku);
  const fromBox = shopPrefixFromBoxNo(opts.boxNo);
  // 同票混装时箱号/店铺Code 常仍是 N1，但货是 N2 PSKU → 以 PSKU 为准
  if (fromSku && fromShop && /^N\d+$/i.test(fromShop) && fromSku !== fromShop) {
    return fromSku;
  }
  if (fromSku && fromBox && fromSku !== fromBox) return fromSku;
  if (fromShop && /^N\d+$/i.test(fromShop)) return fromShop;
  return fromSku || fromBox || null;
}

export function rowMatchesBookingShop(opts: {
  ticketPrefix: string;
  shopPrefix: string;
  /** 已用 normalizeLogisticsKey(..., ticketPrefix) 规范化的集合 */
  logisticsNos: Set<string>;
  ticketCell: string;
  logisticsCell: string;
  shopCell: string;
  boxNo: string;
  partnerSku: string;
}): boolean {
  const lnKey = normalizeLogisticsKey(opts.logisticsCell, opts.ticketPrefix);
  // 会话已按店拆好的物流号：以清单为准，勿被箱号里的 -N1- / 店铺Code 误拦
  // （例：10001566U001 货是 N2 PSKU，箱号仍写 2606-253-N1-H）
  if (lnKey && opts.logisticsNos.has(lnKey)) {
    return true;
  }

  const shop = rowShopPrefix({
    shopCell: opts.shopCell,
    boxNo: opts.boxNo,
    partnerSku: opts.partnerSku,
  });
  if (shop && shop !== opts.shopPrefix.toUpperCase()) return false;

  // 物流列为空时：票号 + 店码兜底（避免同票其它物流号被误写）
  if (opts.logisticsCell.trim()) return false;

  const ticket = opts.ticketCell.trim();
  const ticketOk =
    ticket === opts.ticketPrefix || ticket.startsWith(opts.ticketPrefix);
  if (!ticketOk) return false;

  return shop === opts.shopPrefix.toUpperCase();
}

function ticketBelongs(ticketPrefix: string, ticketCell: string, logisticsCell: string) {
  const ticket = ticketCell.trim();
  if (ticket === ticketPrefix || ticket.startsWith(ticketPrefix)) return true;
  return logisticsCell.includes(ticketPrefix);
}

export function planSheetPatches(opts: {
  target: PackingSheetWriteTarget;
  title: string;
  sheetId: string;
  values: unknown[][];
  ticketPrefix: string;
  shopPrefix: string;
  logisticsNos: string[];
  asnId: string;
  arriveAtSheet: string;
  /** 同票包装盒物流号（箱表无 PSKU 时靠此识别，只填送仓不填 ASN） */
  packagingLogisticsNos?: string[];
}): PackingSheetPlan {
  const headerRow = opts.values[0] ?? [];
  const headers = headerMapLoose(headerRow);
  const colAsn = findHeaderCol(headers, ASN_HEADER_ALIASES);
  const colArrive = findHeaderCol(headers, ARRIVE_HEADER_ALIASES);
  const colStatus = findHeaderCol(headers, STATUS_HEADER_ALIASES);
  const colTicket = findHeaderCol(headers, TICKET_HEADER_ALIASES);
  const colLogistics = findHeaderCol(headers, LOGISTICS_HEADER_ALIASES);
  const colBox = findHeaderCol(headers, BOX_HEADER_ALIASES);
  const colShop = findHeaderCol(headers, SHOP_HEADER_ALIASES);
  const colPsku = findHeaderCol(headers, PSKU_HEADER_ALIASES);
  const colName = findHeaderCol(headers, NAME_HEADER_ALIASES);

  if (colAsn == null && colArrive == null) {
    return {
      target: opts.target,
      title: opts.title,
      sheetId: opts.sheetId,
      matchedRows: [],
      patches: [],
    };
  }

  const logisticsKeys = new Set(
    opts.logisticsNos
      .map((ln) => normalizeLogisticsKey(ln, opts.ticketPrefix))
      .filter(Boolean),
  );
  const packagingLogisticsKeys = new Set(
    (opts.packagingLogisticsNos || [])
      .map((ln) => normalizeLogisticsKey(ln, opts.ticketPrefix))
      .filter(Boolean),
  );
  const matchedRows: number[] = [];
  const patches: PackingSheetCellPatch[] = [];

  for (let r = 1; r < opts.values.length; r++) {
    const row = opts.values[r] ?? [];
    const ticketCell = colTicket != null ? cellText(row[colTicket]) : "";
    const logisticsCell =
      colLogistics != null ? cellText(row[colLogistics]) : "";
    const shopCell = colShop != null ? cellText(row[colShop]) : "";
    const boxNo = colBox != null ? cellText(row[colBox]) : "";
    const partnerSku = colPsku != null ? cellText(row[colPsku]) : "";
    const name = colName != null ? cellText(row[colName]) : "";

    // 空行跳过
    if (!ticketCell && !logisticsCell && !boxNo) continue;

    const lnKey = normalizeLogisticsKey(logisticsCell, opts.ticketPrefix);
    const packagingOnly =
      isPackagingOnlyRow(partnerSku, name) ||
      (Boolean(lnKey) && packagingLogisticsKeys.has(lnKey));

    const shopMatched = rowMatchesBookingShop({
      ticketPrefix: opts.ticketPrefix,
      shopPrefix: opts.shopPrefix,
      logisticsNos: logisticsKeys,
      ticketCell,
      logisticsCell,
      shopCell,
      boxNo,
      partnerSku,
    });
    // 同票包装盒：不跟店 ASN，但仍回填送仓时间等同批信息
    const packagingMatched =
      packagingOnly &&
      ticketBelongs(opts.ticketPrefix, ticketCell, logisticsCell);

    if (!shopMatched && !packagingMatched) continue;

    const sheetRow = r + 1; // 1-based
    matchedRows.push(sheetRow);

    if (colAsn != null && !packagingOnly) {
      const prev = cellText(row[colAsn]);
      if (prev !== opts.asnId) {
        patches.push({
          sheetRow,
          col: colAsn,
          value: opts.asnId,
          field: "asn",
        });
      }
    }
    if (colArrive != null) {
      const prev = cellText(row[colArrive]);
      // 已有相同日期（忽略时分与分隔符）则跳过
      const prevNorm = formatArriveAtForSheet(prev);
      if (prevNorm !== opts.arriveAtSheet) {
        patches.push({
          sheetRow,
          col: colArrive,
          value: opts.arriveAtSheet,
          field: "arriveAt",
        });
      }
    }
    // 仅明细写「已入库」；箱表到仓情况是公式，禁止碰
    if (opts.target === "detail" && colStatus != null) {
      const prev = cellText(row[colStatus]);
      if (prev !== "已入库") {
        patches.push({
          sheetRow,
          col: colStatus,
          value: "已入库",
          field: "status",
        });
      }
    }
  }

  return {
    target: opts.target,
    title: opts.title,
    sheetId: opts.sheetId,
    matchedRows,
    patches,
  };
}

function resolveTargetShop(
  session: WarehouseBookingSession,
  shopPrefix?: string | null,
): BookingShopBucket {
  const byCaptureAsn = session.capture?.asnId
    ? session.shops.find((s) => s.asnId === session.capture!.asnId)
    : null;
  const prefix =
    shopPrefix ||
    byCaptureAsn?.shopPrefix ||
    session.activeShopPrefix ||
    session.shops[0]?.shopPrefix;
  const shop = session.shops.find((s) => s.shopPrefix === prefix);
  if (!shop) {
    throw new Error(
      `会话中找不到店 ${prefix || "?"}，无法回填装箱表（请先对齐票号）`,
    );
  }
  return shop;
}

async function applyPatches(
  token: string,
  spreadsheetToken: string,
  plan: PackingSheetPlan,
): Promise<number> {
  let n = 0;
  for (const p of plan.patches) {
    const letter = colIndexToLetter(p.col + 1);
    const range = `${plan.sheetId}!${letter}${p.sheetRow}:${letter}${p.sheetRow}`;
    await updateSheetRow(token, spreadsheetToken, range, [[p.value]]);
    n += 1;
  }
  return n;
}

export async function syncBookingCaptureToPackingSheet(
  session: WarehouseBookingSession,
  opts?: {
    shopPrefix?: string | null;
    dryRun?: boolean;
    /** 写完后拉一次 packing 快照，默认 true */
    refreshSnapshot?: boolean;
  },
): Promise<PackingSheetSyncResult> {
  const dryRun = Boolean(opts?.dryRun);
  const refreshSnapshot = opts?.refreshSnapshot !== false && !dryRun;
  const shop = resolveTargetShop(session, opts?.shopPrefix);
  const capture = session.capture;
  // 必须以本店 ASN 为准，禁止拿另一店的 capture 串写
  const asnId = (shop.asnId || "").trim().replace(/^=+/, "");
  if (!asnId) {
    throw new Error(`店 ${shop.shopPrefix} 尚无 ASN，无法回填装箱表`);
  }
  if (!capture?.scheduledDate || !capture.asnId) {
    throw new Error("尚无约仓送仓时间（请先约仓成功或手动 capture）");
  }
  const captureAsn = capture.asnId.trim().replace(/^=+/, "");
  if (captureAsn !== asnId) {
    throw new Error(
      `当前约仓结果 ASN=${captureAsn} 属于其他店，与 ${shop.shopPrefix}=${asnId} 不一致；请切换到对应店后再回填`,
    );
  }

  const arriveAtSheet = formatArriveAtForSheet(capture.scheduledDate);
  const logisticsNos = shop.boxes.map((b) => b.logisticsNo).filter(Boolean);
  if (!logisticsNos.length) {
    throw new Error(`店 ${shop.shopPrefix} 没有可回填的物流编号`);
  }
  // 同票包装盒物流号（箱表无 PSKU 时靠此识别）
  const packagingLogisticsNos = session.shops.flatMap((s) =>
    s.boxes
      .filter(
        (b) =>
          b.items.length > 0 &&
          b.items.every((it) => isPackagingOnlyRow(it.partnerSku, it.name)),
      )
      .map((b) => b.logisticsNo),
  );

  const doc = resolvePackingDoc();
  const cred = readFeishuCredentials();
  const client = createFeishuHttpClient(cred);
  const token = await client.getToken();
  const spreadsheetToken = doc.spreadsheetToken!;
  const sheets = await listSpreadsheetSheets(token, spreadsheetToken);

  const boxMeta = findSheetMeta(sheets, ["箱表", "箱规"]);
  const detailMeta = findSheetMeta(sheets, ["装箱明细", "箱单明细"]);

  const sheetResults: PackingSheetSyncSheetResult[] = [];

  const runOne = async (
    target: PackingSheetWriteTarget,
    meta: FeishuSheetMeta | undefined,
    titles: string,
  ) => {
    if (!meta) {
      sheetResults.push({
        title: titles,
        target,
        matchedRows: 0,
        updatedCells: 0,
        skipped: true,
        skipReason: `装箱表中找不到子表「${titles}」`,
      });
      return;
    }
    const values = await readSheetValues(token, spreadsheetToken, meta);
    const plan = planSheetPatches({
      target,
      title: meta.title,
      sheetId: meta.sheetId,
      values,
      ticketPrefix: session.ticketPrefix,
      shopPrefix: shop.shopPrefix,
      logisticsNos,
      asnId,
      arriveAtSheet,
      packagingLogisticsNos,
    });
    if (!plan.matchedRows.length) {
      sheetResults.push({
        title: meta.title,
        target,
        matchedRows: 0,
        updatedCells: 0,
        skipped: true,
        skipReason: `未匹配到 ${shop.shopPrefix} / 票 ${session.ticketPrefix} 的行`,
      });
      return;
    }
    let updatedCells = 0;
    if (!dryRun && plan.patches.length) {
      try {
        updatedCells = await applyPatches(token, spreadsheetToken, plan);
      } catch (e) {
        if (e instanceof FeishuError) {
          throw new FeishuError(
            e.message,
            e.code,
            e.stage,
            e.detail,
            e.hint || FEISHU_PACKING_WRITE_PERM_HINT,
          );
        }
        throw e;
      }
    } else {
      updatedCells = plan.patches.length;
    }
    sheetResults.push({
      title: meta.title,
      target,
      matchedRows: plan.matchedRows.length,
      updatedCells,
      skipped: false,
    });
  };

  await runOne("box", boxMeta, "箱表");
  await runOne("detail", detailMeta, "装箱明细");

  let refreshedSnapshot = false;
  if (refreshSnapshot) {
    try {
      const cfg = loadFeishuDocsConfig();
      await pullFeishuRaw(cfg, { docIds: ["packing"] });
      clearPackingLinesCache();
      refreshedSnapshot = true;
    } catch {
      refreshedSnapshot = false;
    }
  }

  return {
    shopPrefix: shop.shopPrefix,
    asnId,
    arriveAtSheet,
    scheduledDisplay: formatScheduledDisplay(capture),
    logisticsNos,
    sheets: sheetResults,
    refreshedSnapshot,
    dryRun,
  };
}
