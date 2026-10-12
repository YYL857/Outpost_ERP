/**
 * 从本地装箱「箱表」快照取亦邦物流编号（只读 feishu-raw，不调飞书）。
 */
import {
  extractPackingBoxRows,
  type PackingBoxRow,
} from "../feishu/normalize/forwarder-board.js";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function rawDirCandidates(): string[] {
  const root =
    process.env.OUTPOST_ROOT?.trim() ||
    process.env.OUTPOST_DATA_DIR?.trim() ||
    "D:\\outpost-data";
  return [...new Set([resolve(root, "feishu-raw")])];
}

function loadLatestPackingSheet(): {
  path: string;
  pulledAt: string | null;
  values: unknown[][];
} | null {
  for (const dir of rawDirCandidates()) {
    const runsDir = join(dir, "runs");
    if (!existsSync(runsDir)) continue;
    const runs = readdirSync(runsDir)
      .map((name) => {
        const path = join(runsDir, name, "packing", "snapshot.json");
        if (!existsSync(path)) return null;
        return { path, mtime: statSync(path).mtimeMs };
      })
      .filter(Boolean) as Array<{ path: string; mtime: number }>;
    runs.sort((a, b) => b.mtime - a.mtime);
    const hit = runs[0];
    if (!hit) continue;
    try {
      const snap = JSON.parse(readFileSync(hit.path, "utf8")) as {
        pulledAt?: string;
        sheets?: Array<{ title?: string; values?: unknown[][] }>;
      };
      const sheet =
        snap.sheets?.find((s) => s.title === "箱表") ??
        snap.sheets?.find((s) => (s.title ?? "").includes("箱"));
      if (!sheet?.values) continue;
      return {
        path: hit.path,
        pulledAt: snap.pulledAt ?? null,
        values: sheet.values,
      };
    } catch {
      /* next */
    }
  }
  return null;
}

export type YibangPackingTrackKey = {
  logisticsNo: string;
  ticketNo: string;
  boxNo: string;
  warehouseStatus: string;
  forwarder: string;
};

export type FeitanPackingTrackKey = {
  ticketNo: string;
  logisticsNo: string;
  boxNo: string;
  modeRaw: string;
  warehouseStatus: string;
  forwarder: string;
};

/** 亦邦查件键：只用「物流编号」（用户验证） */
export function listYibangLogisticsNos(): {
  sourcePath: string | null;
  pulledAt: string | null;
  keys: YibangPackingTrackKey[];
} {
  const snap = loadLatestPackingSheet();
  if (!snap) {
    return { sourcePath: null, pulledAt: null, keys: [] };
  }
  const rows: PackingBoxRow[] = extractPackingBoxRows(snap.values);
  const keys = rows
    .filter((r) => r.forwarder.includes("亦邦") && r.logisticsNo.trim())
    .map((r) => ({
      logisticsNo: r.logisticsNo.trim(),
      ticketNo: r.ticketNo,
      boxNo: r.boxNo,
      warehouseStatus: r.warehouseStatus,
      forwarder: r.forwarder,
    }));
  // 同物流编号去重，保留首行
  const seen = new Set<string>();
  const unique: YibangPackingTrackKey[] = [];
  for (const k of keys) {
    if (seen.has(k.logisticsNo)) continue;
    seen.add(k.logisticsNo);
    unique.push(k);
  }
  return {
    sourcePath: snap.path,
    pulledAt: snap.pulledAt,
    keys: unique,
  };
}

/** 飞坦查件键：海运/空运都用「票号」（用户验证） */
export function listFeitanTicketNos(): {
  sourcePath: string | null;
  pulledAt: string | null;
  keys: FeitanPackingTrackKey[];
} {
  const snap = loadLatestPackingSheet();
  if (!snap) {
    return { sourcePath: null, pulledAt: null, keys: [] };
  }
  const rows: PackingBoxRow[] = extractPackingBoxRows(snap.values);
  const keys = rows
    .filter((r) => r.forwarder.includes("飞坦") && r.ticketNo.trim())
    .map((r) => ({
      ticketNo: r.ticketNo.trim(),
      logisticsNo: r.logisticsNo,
      boxNo: r.boxNo,
      modeRaw: r.modeRaw,
      warehouseStatus: r.warehouseStatus,
      forwarder: r.forwarder,
    }));
  const seen = new Set<string>();
  const unique: FeitanPackingTrackKey[] = [];
  for (const k of keys) {
    if (seen.has(k.ticketNo)) continue;
    seen.add(k.ticketNo);
    unique.push(k);
  }
  return {
    sourcePath: snap.path,
    pulledAt: snap.pulledAt,
    keys: unique,
  };
}

export type HanshaPackingTrackKey = {
  ticketNo: string;
  logisticsNo: string;
  boxNo: string;
  modeRaw: string;
  warehouseStatus: string;
  forwarder: string;
};

/** 汉沙查件键：装箱「票号」= nextsls 运单号（海运空运同一列表） */
export function listHanshaTicketNos(): {
  sourcePath: string | null;
  pulledAt: string | null;
  keys: HanshaPackingTrackKey[];
} {
  const snap = loadLatestPackingSheet();
  if (!snap) {
    return { sourcePath: null, pulledAt: null, keys: [] };
  }
  const rows: PackingBoxRow[] = extractPackingBoxRows(snap.values);
  const keys = rows
    .filter((r) => r.forwarder.includes("汉沙") && r.ticketNo.trim())
    .map((r) => ({
      ticketNo: r.ticketNo.trim(),
      logisticsNo: r.logisticsNo,
      boxNo: r.boxNo,
      modeRaw: r.modeRaw,
      warehouseStatus: r.warehouseStatus,
      forwarder: r.forwarder,
    }));
  const seen = new Set<string>();
  const unique: HanshaPackingTrackKey[] = [];
  for (const k of keys) {
    if (seen.has(k.ticketNo)) continue;
    seen.add(k.ticketNo);
    unique.push(k);
  }
  return {
    sourcePath: snap.path,
    pulledAt: snap.pulledAt,
    keys: unique,
  };
}

export type YayouhuiPackingTrackKey = {
  ticketNo: string;
  logisticsNo: string;
  boxNo: string;
  modeRaw: string;
  warehouseStatus: string;
  forwarder: string;
};

/** 亚优汇查件键：装箱「票号」= nextsls 运单号（与汉沙同 UI） */
export function listYayouhuiTicketNos(): {
  sourcePath: string | null;
  pulledAt: string | null;
  keys: YayouhuiPackingTrackKey[];
} {
  const snap = loadLatestPackingSheet();
  if (!snap) {
    return { sourcePath: null, pulledAt: null, keys: [] };
  }
  const rows: PackingBoxRow[] = extractPackingBoxRows(snap.values);
  const keys = rows
    .filter((r) => r.forwarder.includes("亚优汇") && r.ticketNo.trim())
    .map((r) => ({
      ticketNo: r.ticketNo.trim(),
      logisticsNo: r.logisticsNo,
      boxNo: r.boxNo,
      modeRaw: r.modeRaw,
      warehouseStatus: r.warehouseStatus,
      forwarder: r.forwarder,
    }));
  const seen = new Set<string>();
  const unique: YayouhuiPackingTrackKey[] = [];
  for (const k of keys) {
    if (seen.has(k.ticketNo)) continue;
    seen.add(k.ticketNo);
    unique.push(k);
  }
  return {
    sourcePath: snap.path,
    pulledAt: snap.pulledAt,
    keys: unique,
  };
}

export type YitePackingTrackKey = {
  /** 装箱原始物流编号（含 U 箱序，如 YT2604647454U002） */
  logisticsNo: string;
  /** 官网运单号：物流编号去掉 U 及之后（如 YT2604647454） */
  waybillNo: string;
  ticketNo: string;
  boxNo: string;
  modeRaw: string;
  warehouseStatus: string;
  forwarder: string;
};

/**
 * 义特：装箱「物流编号」→ 官网运单号。
 * 规则：去掉第一个 `U`（不区分大小写）及其后全部字符。
 * 例：YT2604647454U002 → YT2604647454
 */
export function yiteWaybillFromLogistics(logisticsNo: string): string {
  const raw = logisticsNo.trim();
  if (!raw) return "";
  const u = raw.search(/U/i);
  return (u >= 0 ? raw.slice(0, u) : raw).trim();
}

/** 义特查件键：装箱「物流编号」去 U 后缀 = nextsls 运单号（与汉沙同 UI；走 WOS 非 oms） */
export function listYiteLogisticsNos(): {
  sourcePath: string | null;
  pulledAt: string | null;
  keys: YitePackingTrackKey[];
} {
  const snap = loadLatestPackingSheet();
  if (!snap) {
    return { sourcePath: null, pulledAt: null, keys: [] };
  }
  const rows: PackingBoxRow[] = extractPackingBoxRows(snap.values);
  const keys = rows
    .filter((r) => r.forwarder.includes("义特") && r.logisticsNo.trim())
    .map((r) => {
      const logisticsNo = r.logisticsNo.trim();
      return {
        logisticsNo,
        waybillNo: yiteWaybillFromLogistics(logisticsNo),
        ticketNo: r.ticketNo.trim(),
        boxNo: r.boxNo,
        modeRaw: r.modeRaw,
        warehouseStatus: r.warehouseStatus,
        forwarder: r.forwarder,
      };
    })
    .filter((k) => k.waybillNo);
  const seen = new Set<string>();
  const unique: YitePackingTrackKey[] = [];
  for (const k of keys) {
    if (seen.has(k.waybillNo)) continue;
    seen.add(k.waybillNo);
    unique.push(k);
  }
  return {
    sourcePath: snap.path,
    pulledAt: snap.pulledAt,
    keys: unique,
  };
}

/** @deprecated 用 listYiteLogisticsNos；保留别名避免旧引用断裂 */
export function listYiteTicketNos() {
  return listYiteLogisticsNos();
}

export type AnshidaPackingTrackKey = {
  ticketNo: string;
  logisticsNo: string;
  boxNo: string;
  modeRaw: string;
  warehouseStatus: string;
  forwarder: string;
};

/** 安时达查件键：装箱「票号」= 官网中国单「订单号」 */
export function listAnshidaTicketNos(): {
  sourcePath: string | null;
  pulledAt: string | null;
  keys: AnshidaPackingTrackKey[];
} {
  const snap = loadLatestPackingSheet();
  if (!snap) {
    return { sourcePath: null, pulledAt: null, keys: [] };
  }
  const rows: PackingBoxRow[] = extractPackingBoxRows(snap.values);
  const keys = rows
    .filter((r) => r.forwarder.includes("安时达") && r.ticketNo.trim())
    .map((r) => ({
      ticketNo: r.ticketNo.trim(),
      logisticsNo: r.logisticsNo,
      boxNo: r.boxNo,
      modeRaw: r.modeRaw,
      warehouseStatus: r.warehouseStatus,
      forwarder: r.forwarder,
    }));
  const seen = new Set<string>();
  const unique: AnshidaPackingTrackKey[] = [];
  for (const k of keys) {
    if (seen.has(k.ticketNo)) continue;
    seen.add(k.ticketNo);
    unique.push(k);
  }
  return {
    sourcePath: snap.path,
    pulledAt: snap.pulledAt,
    keys: unique,
  };
}

export type QikePackingTrackKey = {
  logisticsNo: string;
  ticketNo: string;
  boxNo: string;
  modeRaw: string;
  warehouseStatus: string;
  forwarder: string;
};

/** 起克查件键：装箱「物流编号」= B2B报表「入仓号」 */
export function listQikeLogisticsNos(): {
  sourcePath: string | null;
  pulledAt: string | null;
  keys: QikePackingTrackKey[];
} {
  const snap = loadLatestPackingSheet();
  if (!snap) {
    return { sourcePath: null, pulledAt: null, keys: [] };
  }
  const rows: PackingBoxRow[] = extractPackingBoxRows(snap.values);
  const keys = rows
    .filter((r) => r.forwarder.includes("起克") && r.logisticsNo.trim())
    .map((r) => ({
      logisticsNo: r.logisticsNo.trim(),
      ticketNo: r.ticketNo.trim(),
      boxNo: r.boxNo,
      modeRaw: r.modeRaw,
      warehouseStatus: r.warehouseStatus,
      forwarder: r.forwarder,
    }));
  const seen = new Set<string>();
  const unique: QikePackingTrackKey[] = [];
  for (const k of keys) {
    if (seen.has(k.logisticsNo)) continue;
    seen.add(k.logisticsNo);
    unique.push(k);
  }
  return {
    sourcePath: snap.path,
    pulledAt: snap.pulledAt,
    keys: unique,
  };
}
