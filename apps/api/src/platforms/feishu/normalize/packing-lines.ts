/**
 * 装箱明细：按箱号解析行级 SKU（只读最新 packing raw 快照）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getFeishuRawDir } from "../config.js";
import {
  cellText,
  headerIndexMap,
  isValidPartnerSku,
  parseNumber,
  pickCol,
} from "./cells.js";
import {
  classifyShipMode,
  extractPackingBoxRows,
  isPackingInTransit,
  type ShipMode,
} from "./forwarder-board.js";

export type PackingLineRow = {
  boxNo: string;
  partnerSku: string;
  name: string;
  qty: number;
  unitWeightKg: number | null;
  totalWeightKg: number | null;
  logisticsNo: string;
  /** 票号（明细有则取；否则可由箱表补） */
  ticketNo: string;
  mode: ShipMode;
  modeRaw: string;
  /** 送仓时间 YYYY-MM-DD；空=在途（旧口径） */
  arriveAt: string | null;
  warehouseStatus: string;
  shipAt: string | null;
  forwarder: string;
  /** 箱表 FBA/ASN；空/缺省=未约仓在途（补货表口径） */
  asn?: string;
};

export type PackingInTransitSku = {
  partnerSku: string;
  name: string;
  qty: number;
  boxNos: string[];
  modes: string[];
};

export type PackingInTransitBoxDetail = {
  boxNo: string;
  ticketNo: string;
  logisticsNo: string;
  forwarder: string;
  modeRaw: string;
  shipAt: string | null;
  /** 本箱件数合计 */
  pcs: number;
  /** 本箱 SKU 行数 */
  skuCount: number;
  items: Array<{ partnerSku: string; name: string; qty: number }>;
};

export type PackingInTransitTicketDetail = {
  /** 聚合键：票号优先，否则物流单号 */
  ticketKey: string;
  ticketNo: string;
  logisticsNo: string;
  forwarder: string;
  modeRaw: string;
  shipAt: string | null;
  boxCount: number;
  pcs: number;
  boxes: PackingInTransitBoxDetail[];
};

type Cache = {
  key: string;
  lines: PackingLineRow[];
  /** 箱号 → 箱表票号/物流等 */
  boxMeta: Map<
    string,
    {
      ticketNo: string;
      logisticsNo: string;
      forwarder: string;
      modeRaw: string;
      shipAt: string | null;
      arriveAt: string | null;
      warehouseStatus: string;
      asn: string;
    }
  >;
};
let cache: Cache | null = null;

function headerMapLoose(headerRow: unknown[]): Map<string, number> {
  const map = headerIndexMap(headerRow);
  for (const [k, i] of [...map.entries()]) {
    const t = k.trim();
    if (t && t !== k && !map.has(t)) map.set(t, i);
  }
  return map;
}

/** 箱号后缀 K/H → 空运/海运（列为空时兜底） */
export function modeFromBoxNo(boxNo: string): ShipMode | null {
  const m = boxNo.trim().match(/-([KHkh])$/);
  if (!m) return null;
  return m[1]!.toUpperCase() === "K" ? "air" : "sea";
}

/** 箱号中的店前缀，如 2605-207-N1-H → N1 */
export function shopPrefixFromBoxNo(boxNo: string): string | null {
  const m = boxNo.trim().match(/-(N\d+)-/i);
  return m?.[1] ? m[1].toUpperCase() : null;
}

export function shopPrefixFromPartnerSku(partnerSku: string): string | null {
  const m = partnerSku.trim().match(/^(N\d+)/i);
  return m?.[1] ? m[1].toUpperCase() : null;
}

function parseLooseYmd(raw: unknown): string | null {
  const t = cellText(raw).trim();
  if (!t) return null;
  const m = t.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 装箱明细 values（含表头）→ 行 */
export function extractPackingLines(values: unknown[][]): PackingLineRow[] {
  if (values.length < 2) return [];
  const headers = headerMapLoose(values[0] ?? []);
  const out: PackingLineRow[] = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const partnerSku = cellText(
      pickCol(row, headers, ["PSKU", "psku", "Partner SKU"]),
    );
    const boxNo = cellText(pickCol(row, headers, ["箱号"])).trim();
    if (!boxNo) continue;
    if (partnerSku && !isValidPartnerSku(partnerSku)) continue;

    const qty = parseNumber(pickCol(row, headers, ["数量", "件数", "PCS"]));
    if (qty == null || qty <= 0) continue;

    const modeRaw = cellText(pickCol(row, headers, ["运输方式"]));
    let mode = classifyShipMode(modeRaw);
    if (mode === "other") {
      const fromNo = modeFromBoxNo(boxNo);
      if (fromNo) mode = fromNo;
    }

    const unitWeightKg = parseNumber(
      pickCol(row, headers, ["产品单重", "单重", "单位重量"]),
    );
    let totalWeightKg = parseNumber(
      pickCol(row, headers, ["产品重量合计", "总重", "重量合计", "产品单重合计"]),
    );
    if (totalWeightKg == null && unitWeightKg != null) {
      totalWeightKg = unitWeightKg * qty;
    }

    out.push({
      boxNo,
      partnerSku: partnerSku || "",
      name: cellText(pickCol(row, headers, ["名称", "品名", "商品名称"])),
      qty,
      unitWeightKg,
      totalWeightKg,
      logisticsNo: cellText(
        pickCol(row, headers, ["物流编号", "物流单号"]),
      ),
      ticketNo: cellText(pickCol(row, headers, ["票号"])),
      mode,
      modeRaw: modeRaw || (mode === "air" ? "空运" : mode === "sea" ? "海运" : ""),
      arriveAt: parseLooseYmd(
        pickCol(row, headers, ["送仓时间", "到仓时间", "入库时间"]),
      ),
      warehouseStatus: cellText(pickCol(row, headers, ["到仓情况", "状态"])),
      shipAt: parseLooseYmd(pickCol(row, headers, ["发货时间", "发货日期"])),
      forwarder: cellText(pickCol(row, headers, ["货代名称", "货代", "承运商"])),
      asn: cellText(
        pickCol(row, headers, ["FBA号/ASN号", "ASN号", "FBA号", "FBA单/ASN号"]),
      ),
    });
  }
  return out;
}

function rawDirCandidates(): string[] {
  const primary = getFeishuRawDir();
  const shared = resolve(
    process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data",
    "feishu-raw",
  );
  const fromShop = resolve(primary, "..", "..", "..", "feishu-raw");
  return [...new Set([primary, shared, fromShop])];
}

function packingSnapshotPath(): string | null {
  for (const dir of rawDirCandidates()) {
    const lastPath = join(dir, "last-run.json");
    if (existsSync(lastPath)) {
      try {
        const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
          runId?: string;
        };
        if (last.runId) {
          const path = join(
            dir,
            "runs",
            last.runId,
            "packing",
            "snapshot.json",
          );
          if (existsSync(path)) return path;
        }
      } catch {
        /* next */
      }
    }
    const runsDir = join(dir, "runs");
    if (!existsSync(runsDir)) continue;
    try {
      const runs = readdirSync(runsDir)
        .map((name) => {
          const path = join(runsDir, name, "packing", "snapshot.json");
          if (!existsSync(path)) return null;
          return { path, mtime: statSync(path).mtimeMs };
        })
        .filter(Boolean) as Array<{ path: string; mtime: number }>;
      runs.sort((a, b) => b.mtime - a.mtime);
      if (runs[0]) return runs[0].path;
    } catch {
      /* next */
    }
  }
  return null;
}

/** 最新装箱快照明细行；无快照时空数组 */
export function loadLatestPackingLines(): PackingLineRow[] {
  return loadLatestPackingBundle().lines;
}

function loadLatestPackingBundle(): {
  lines: PackingLineRow[];
  boxMeta: Cache["boxMeta"];
} {
  const path = packingSnapshotPath();
  if (!path) return { lines: [], boxMeta: new Map() };
  const key = `${path}:${statSync(path).mtimeMs}`;
  if (cache?.key === key) return { lines: cache.lines, boxMeta: cache.boxMeta };
  try {
    const snap = JSON.parse(readFileSync(path, "utf8")) as {
      sheets?: Array<{ title?: string; values?: unknown[][] }>;
    };
    const lineSheet = snap.sheets?.find((s) => s.title === "装箱明细");
    const boxSheet = snap.sheets?.find((s) => s.title === "箱表");
    let lines = extractPackingLines(lineSheet?.values ?? []);
    const boxMeta: Cache["boxMeta"] = new Map();
    for (const b of extractPackingBoxRows(boxSheet?.values ?? [])) {
      if (!b.boxNo) continue;
      boxMeta.set(b.boxNo, {
        ticketNo: b.ticketNo,
        logisticsNo: b.logisticsNo,
        forwarder: b.forwarder,
        modeRaw: b.modeRaw,
        shipAt: b.shipAt,
        arriveAt: b.arriveAt,
        warehouseStatus: b.warehouseStatus,
        asn: b.asn,
      });
    }
    // 用箱表补票号 / ASN / 在途判定字段
    lines = lines.map((line) => {
      const meta = boxMeta.get(line.boxNo);
      if (!meta) return line;
      return {
        ...line,
        ticketNo: line.ticketNo || meta.ticketNo,
        logisticsNo: line.logisticsNo || meta.logisticsNo,
        forwarder: line.forwarder || meta.forwarder,
        modeRaw: line.modeRaw || meta.modeRaw,
        shipAt: line.shipAt ?? meta.shipAt,
        // 明细无送仓时间时，以箱表为准（同箱一致）
        arriveAt: line.arriveAt ?? meta.arriveAt,
        warehouseStatus: line.warehouseStatus || meta.warehouseStatus,
        // ASN 以箱表为准（约仓回填写在箱表）
        asn: (meta.asn || line.asn || "").trim(),
      };
    });
    cache = { key, lines, boxMeta };
    return { lines, boxMeta };
  } catch {
    return { lines: [], boxMeta: new Map() };
  }
}

export function clearPackingLinesCache(): void {
  cache = null;
}

/** 物流编号 → 箱表 ASN / 货代（约仓会话自动回填） */
export function loadLogisticsBoxHints(): Map<
  string,
  { asn: string; forwarder: string; arriveAt: string | null }
> {
  const { boxMeta } = loadLatestPackingBundle();
  const map = new Map<
    string,
    { asn: string; forwarder: string; arriveAt: string | null }
  >();
  for (const meta of boxMeta.values()) {
    const ln = (meta.logisticsNo || "").trim();
    if (!ln) continue;
    const prev = map.get(ln);
    const asn = (meta.asn || "").trim();
    if (!prev) {
      map.set(ln, {
        asn,
        forwarder: meta.forwarder || "",
        arriveAt: meta.arriveAt,
      });
      continue;
    }
    if (!prev.asn && asn) prev.asn = asn;
    if (!prev.forwarder && meta.forwarder) prev.forwarder = meta.forwarder;
    if (!prev.arriveAt && meta.arriveAt) prev.arriveAt = meta.arriveAt;
  }
  return map;
}

/** 按箱号分组 */
export function groupPackingLinesByBox(
  lines: PackingLineRow[],
): Map<string, PackingLineRow[]> {
  const map = new Map<string, PackingLineRow[]>();
  for (const line of lines) {
    const list = map.get(line.boxNo) ?? [];
    list.push(line);
    map.set(line.boxNo, list);
  }
  return map;
}

function lineBelongsToPrefixes(
  line: PackingLineRow,
  prefixes: string[],
): boolean {
  if (!prefixes.length) return true;
  const fromSku = shopPrefixFromPartnerSku(line.partnerSku);
  if (fromSku && prefixes.includes(fromSku)) return true;
  const fromBox = shopPrefixFromBoxNo(line.boxNo);
  if (fromBox && prefixes.includes(fromBox)) return true;
  return false;
}

/** 送仓时间为空（或状态含在途）的明细行 */
export function filterInTransitPackingLines(
  lines: PackingLineRow[],
): PackingLineRow[] {
  return lines.filter((l) => isPackingInTransit(l.arriveAt, l.warehouseStatus));
}

/**
 * 按店前缀汇总在途件数与 SKU 明细。
 * prefixes 空 → 全表；否则用 PSKU / 箱号里的 N1、N2…
 */
export function summarizePackingInTransit(
  lines: PackingLineRow[],
  prefixes: string[] = [],
): {
  qty: number;
  skuCount: number;
  boxCount: number;
  ticketCount: number;
  bySku: PackingInTransitSku[];
  byTicket: PackingInTransitTicketDetail[];
} {
  const transit = filterInTransitPackingLines(lines).filter((l) =>
    lineBelongsToPrefixes(l, prefixes),
  );
  const map = new Map<string, PackingInTransitSku>();
  let qty = 0;
  for (const line of transit) {
    qty += line.qty;
    const key = line.partnerSku || `box:${line.boxNo}`;
    const row = map.get(key) ?? {
      partnerSku: line.partnerSku || key,
      name: line.name,
      qty: 0,
      boxNos: [],
      modes: [],
    };
    row.qty += line.qty;
    if (line.name && !row.name) row.name = line.name;
    if (line.boxNo && !row.boxNos.includes(line.boxNo)) {
      row.boxNos.push(line.boxNo);
    }
    const modeLabel =
      line.modeRaw ||
      (line.mode === "air" ? "空运" : line.mode === "sea" ? "海运" : line.mode);
    if (modeLabel && !row.modes.includes(modeLabel)) row.modes.push(modeLabel);
    map.set(key, row);
  }
  const bySku = [...map.values()].sort((a, b) => b.qty - a.qty);
  const byTicket = buildInTransitTicketTree(transit);
  return {
    qty,
    skuCount: bySku.length,
    boxCount: byTicket.reduce((s, t) => s + t.boxCount, 0),
    ticketCount: byTicket.length,
    bySku,
    byTicket,
  };
}

/** 票 → 箱 → 箱内货 */
export function buildInTransitTicketTree(
  transitLines: PackingLineRow[],
): PackingInTransitTicketDetail[] {
  type BoxAcc = {
    boxNo: string;
    ticketNo: string;
    logisticsNo: string;
    forwarder: string;
    modeRaw: string;
    shipAt: string | null;
    pcs: number;
    items: Map<string, { partnerSku: string; name: string; qty: number }>;
  };
  type TicketAcc = {
    ticketKey: string;
    ticketNo: string;
    logisticsNo: string;
    forwarder: string;
    modeRaw: string;
    shipAt: string | null;
    boxes: Map<string, BoxAcc>;
  };

  const tickets = new Map<string, TicketAcc>();

  for (const line of transitLines) {
    const ticketNo = line.ticketNo.trim();
    const logisticsNo = line.logisticsNo.trim();
    const ticketKey = ticketNo || logisticsNo || `box:${line.boxNo}`;
    let ticket = tickets.get(ticketKey);
    if (!ticket) {
      ticket = {
        ticketKey,
        ticketNo,
        logisticsNo,
        forwarder: line.forwarder,
        modeRaw: line.modeRaw,
        shipAt: line.shipAt,
        boxes: new Map(),
      };
      tickets.set(ticketKey, ticket);
    }
    if (!ticket.forwarder && line.forwarder) ticket.forwarder = line.forwarder;
    if (!ticket.modeRaw && line.modeRaw) ticket.modeRaw = line.modeRaw;
    if (!ticket.shipAt && line.shipAt) ticket.shipAt = line.shipAt;
    if (!ticket.ticketNo && ticketNo) ticket.ticketNo = ticketNo;
    if (!ticket.logisticsNo && logisticsNo) ticket.logisticsNo = logisticsNo;

    let box = ticket.boxes.get(line.boxNo);
    if (!box) {
      box = {
        boxNo: line.boxNo,
        ticketNo: ticketNo || ticket.ticketNo,
        logisticsNo: logisticsNo || ticket.logisticsNo,
        forwarder: line.forwarder || ticket.forwarder,
        modeRaw: line.modeRaw || ticket.modeRaw,
        shipAt: line.shipAt ?? ticket.shipAt,
        pcs: 0,
        items: new Map(),
      };
      ticket.boxes.set(line.boxNo, box);
    }
    box.pcs += line.qty;
    const skuKey = line.partnerSku || line.name || `row-${box.items.size}`;
    const item = box.items.get(skuKey) ?? {
      partnerSku: line.partnerSku || skuKey,
      name: line.name,
      qty: 0,
    };
    item.qty += line.qty;
    if (line.name && !item.name) item.name = line.name;
    box.items.set(skuKey, item);
  }

  const out: PackingInTransitTicketDetail[] = [];
  for (const t of tickets.values()) {
    const boxes: PackingInTransitBoxDetail[] = [...t.boxes.values()]
      .map((b) => ({
        boxNo: b.boxNo,
        ticketNo: b.ticketNo,
        logisticsNo: b.logisticsNo,
        forwarder: b.forwarder,
        modeRaw: b.modeRaw,
        shipAt: b.shipAt,
        pcs: b.pcs,
        skuCount: b.items.size,
        items: [...b.items.values()].sort((a, c) => c.qty - a.qty),
      }))
      .sort((a, b) => a.boxNo.localeCompare(b.boxNo));
    const pcs = boxes.reduce((s, b) => s + b.pcs, 0);
    out.push({
      ticketKey: t.ticketKey,
      ticketNo: t.ticketNo,
      logisticsNo: t.logisticsNo,
      forwarder: t.forwarder,
      modeRaw: t.modeRaw,
      shipAt: t.shipAt,
      boxCount: boxes.length,
      pcs,
      boxes,
    });
  }
  return out.sort((a, b) => {
    const da = a.shipAt ?? "";
    const db = b.shipAt ?? "";
    if (da !== db) return db.localeCompare(da);
    return b.pcs - a.pcs;
  });
}
