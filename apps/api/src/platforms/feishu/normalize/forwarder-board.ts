/**
 * 装箱表「箱表」→ 货代物流清洗与汇总。
 * 只读最新 packing raw 快照；不写状态、不调飞书。
 *
 * 运费口径：
 * - 实收跨境费：箱级分摊，可直接加总
 * - 整票跨境实付：整票费用，按票号去重后加总（避免同票多箱重复）
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getFeishuRawDir } from "../config.js";
import { cellText, headerIndexMap, parseNumber, pickCol } from "./cells.js";
import {
  buildFreightRatesPayload,
  type FreightRatesPayload,
} from "./freight-rates.js";
import { canonicalizeForwarderName } from "./forwarder-names.js";

export type ShipMode = "air" | "sea" | "single" | "other";

export type PackingBoxRow = {
  boxNo: string;
  ticketNo: string;
  logisticsNo: string;
  forwarder: string;
  mode: ShipMode;
  modeRaw: string;
  pcs: number;
  asn: string;
  shipAt: string | null;
  arriveAt: string | null;
  transitDays: number | null;
  warehouseStatus: string;
  domesticFreight: number | null;
  /** 整票跨境实付（同票多箱会重复出现） */
  ticketCrossFreight: number | null;
  /** 实收跨境费（箱级） */
  boxCrossFreight: number | null;
  weightKg: number | null;
  cbm: number | null;
  /** 箱体外寸 cm（体积重用） */
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  settled: string;
};

export type ForwarderModeStats = {
  boxes: number;
  pcs: number;
  weightKg: number;
  cbm: number;
  boxFreight: number;
  ticketFreight: number;
  ticketCount: number;
  withTransit: number;
  transitDaysSum: number;
};

export type ForwarderAgg = {
  forwarder: string;
  boxes: number;
  tickets: number;
  pcs: number;
  weightKg: number;
  cbm: number;
  boxFreightSum: number;
  ticketFreightSum: number;
  domesticFreightSum: number;
  inTransitBoxes: number;
  deliveredBoxes: number;
  withTransit: number;
  avgTransitDays: number | null;
  rmbPerKg: number | null;
  rmbPerCbm: number | null;
  byMode: Record<ShipMode, ForwarderModeStats>;
};

export type ForwarderBoardPayload = {
  source: {
    snapshotPath: string | null;
    pulledAt: string | null;
    sheetTitle: string;
    boxRows: number;
    forwarderCount: number;
  };
  freightRates: FreightRatesPayload["source"] & {
    forwarderCount: number;
  };
  forwarders: ForwarderAgg[];
  /** 确定性性价比排名（分数越高越划算） */
  ranking: Array<{
    rank: number;
    forwarder: string;
    score: number;
    reasons: string[];
    quoteAirMid?: number | null;
    quoteSeaMid?: number | null;
  }>;
  quotes: FreightRatesPayload["byForwarder"];
  inTransit: Array<{
    boxNo: string;
    ticketNo: string;
    forwarder: string;
    modeRaw: string;
    pcs: number;
    shipAt: string | null;
    asn: string;
    logisticsNo: string;
  }>;
  deliveredSample: Array<{
    boxNo: string;
    forwarder: string;
    modeRaw: string;
    pcs: number;
    shipAt: string | null;
    arriveAt: string | null;
    transitDays: number | null;
    boxCrossFreight: number | null;
  }>;
};

type Cache = { key: string; payload: ForwarderBoardPayload };
let cache: Cache | null = null;

function emptyModeStats(): ForwarderModeStats {
  return {
    boxes: 0,
    pcs: 0,
    weightKg: 0,
    cbm: 0,
    boxFreight: 0,
    ticketFreight: 0,
    ticketCount: 0,
    withTransit: 0,
    transitDaysSum: 0,
  };
}

export function classifyShipMode(raw: unknown): ShipMode {
  const s = cellText(raw);
  if (s.includes("空运")) return "air";
  if (s.includes("海运")) return "sea";
  if (s.includes("单品")) return "single";
  return "other";
}

/** 支持 2025/08/19、2025-08-19、带时分 */
export function parseLooseDate(raw: unknown): Date | null {
  const s = cellText(raw);
  if (!s) return null;
  const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function transitDaysBetween(
  shipRaw: unknown,
  arriveRaw: unknown,
): number | null {
  const a = parseLooseDate(shipRaw);
  const b = parseLooseDate(arriveRaw);
  if (!a || !b) return null;
  const days = (b.getTime() - a.getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days < 0 || days > 365) return null;
  return Math.round(days * 10) / 10;
}

function isoDate(raw: unknown): string | null {
  const d = parseLooseDate(raw);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * 在途口径：装箱表「送仓时间」为空 → 在途；
 * 兼容表里已写「在途」但日期偶发有值的行。
 */
export function isPackingInTransit(
  arriveAt: string | null | undefined,
  warehouseStatus?: string | null,
): boolean {
  if (!arriveAt || !String(arriveAt).trim()) return true;
  const status = String(warehouseStatus ?? "");
  return status.includes("在途");
}

function round(n: number, digits = 2): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function headerMapLoose(headerRow: unknown[]): Map<string, number> {
  const map = headerIndexMap(headerRow);
  // 箱号列偶发前导空格
  for (const [k, i] of [...map.entries()]) {
    const t = k.trim();
    if (t && t !== k && !map.has(t)) map.set(t, i);
  }
  return map;
}

/** 箱表 values（含表头）→ 清洗行 */
export function extractPackingBoxRows(values: unknown[][]): PackingBoxRow[] {
  if (values.length < 2) return [];
  const headers = headerMapLoose(values[0] ?? []);
  const out: PackingBoxRow[] = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const forwarder = cellText(
      pickCol(row, headers, ["货代名称", "货代", "承运商"]),
    );
    const boxNo = cellText(pickCol(row, headers, ["箱号"]));
    const ticketNo = cellText(pickCol(row, headers, ["票号"]));
    if (!forwarder && !boxNo && !ticketNo) continue;

    const modeRaw = cellText(pickCol(row, headers, ["运输方式"]));
    const shipAtRaw = pickCol(row, headers, ["发货时间", "发货日期"]);
    const arriveAtRaw = pickCol(row, headers, ["送仓时间", "到仓时间", "入库时间"]);

    out.push({
      boxNo,
      ticketNo,
      logisticsNo: cellText(pickCol(row, headers, ["物流编号"])),
      forwarder: canonicalizeForwarderName(forwarder || "(未填货代)"),
      mode: classifyShipMode(modeRaw),
      modeRaw,
      pcs: parseNumber(pickCol(row, headers, ["产品PCS-箱级", "PCS", "数量"])) ?? 0,
      asn: cellText(pickCol(row, headers, ["FBA号/ASN号", "ASN号", "FBA号"])),
      shipAt: isoDate(shipAtRaw),
      arriveAt: isoDate(arriveAtRaw),
      transitDays: transitDaysBetween(shipAtRaw, arriveAtRaw),
      warehouseStatus: cellText(pickCol(row, headers, ["到仓情况", "状态"])),
      domesticFreight: parseNumber(
        pickCol(row, headers, [
          "整票国内运费",
          "国内运费",
          "头程国内运费",
        ]),
      ),
      ticketCrossFreight: parseNumber(
        pickCol(row, headers, ["整票跨境实付", "跨境实付"]),
      ),
      boxCrossFreight: parseNumber(
        pickCol(row, headers, [
          "实收跨境费",
          "箱跨境费",
          "实际物流总费用",
        ]),
      ),
      weightKg: parseNumber(
        pickCol(row, headers, ["货物重量", "实际重量", "重量"]),
      ),
      cbm: parseNumber(pickCol(row, headers, ["方数", "体积", "CBM"])),
      lengthCm: parseNumber(pickCol(row, headers, ["长", "长度", "长(cm)"])),
      widthCm: parseNumber(pickCol(row, headers, ["宽", "宽度", "宽(cm)"])),
      heightCm: parseNumber(pickCol(row, headers, ["高", "高度", "高(cm)"])),
      settled: cellText(pickCol(row, headers, ["结账与否", "结账"])),
    });
  }
  return out;
}

function ensureMode(
  byMode: Record<ShipMode, ForwarderModeStats>,
  mode: ShipMode,
): ForwarderModeStats {
  return byMode[mode] ?? (byMode[mode] = emptyModeStats());
}

export function aggregateForwarders(rows: PackingBoxRow[]): ForwarderAgg[] {
  type Acc = {
    boxes: number;
    pcs: number;
    weightKg: number;
    cbm: number;
    boxFreightSum: number;
    domesticFreightSum: number;
    inTransitBoxes: number;
    deliveredBoxes: number;
    withTransit: number;
    transitDaysSum: number;
    ticketFreightKeys: Set<string>;
    ticketFreightSum: number;
    modeTicketKeys: Record<ShipMode, Set<string>>;
    byMode: Record<ShipMode, ForwarderModeStats>;
  };

  const map = new Map<string, Acc>();

  for (const row of rows) {
    const acc =
      map.get(row.forwarder) ??
      ({
        boxes: 0,
        pcs: 0,
        weightKg: 0,
        cbm: 0,
        boxFreightSum: 0,
        domesticFreightSum: 0,
        inTransitBoxes: 0,
        deliveredBoxes: 0,
        withTransit: 0,
        transitDaysSum: 0,
        ticketFreightKeys: new Set<string>(),
        ticketFreightSum: 0,
        modeTicketKeys: {
          air: new Set(),
          sea: new Set(),
          single: new Set(),
          other: new Set(),
        },
        byMode: {
          air: emptyModeStats(),
          sea: emptyModeStats(),
          single: emptyModeStats(),
          other: emptyModeStats(),
        },
      } satisfies Acc);

    acc.boxes += 1;
    acc.pcs += row.pcs > 0 ? row.pcs : 0;
    if (row.weightKg != null && row.weightKg > 0) acc.weightKg += row.weightKg;
    if (row.cbm != null && row.cbm > 0) acc.cbm += row.cbm;
    if (row.boxCrossFreight != null && row.boxCrossFreight > 0) {
      acc.boxFreightSum += row.boxCrossFreight;
    }
    if (row.domesticFreight != null && row.domesticFreight > 0) {
      acc.domesticFreightSum += row.domesticFreight;
    }

    const status = row.warehouseStatus;
    if (isPackingInTransit(row.arriveAt, status)) acc.inTransitBoxes += 1;
    if (status.includes("入库") || status.includes("已到")) acc.deliveredBoxes += 1;
    if (row.transitDays != null) {
      acc.withTransit += 1;
      acc.transitDaysSum += row.transitDays;
    }

    const ticketKey = row.ticketNo || row.logisticsNo || row.boxNo || `row-${acc.boxes}`;
    if (
      row.ticketCrossFreight != null &&
      row.ticketCrossFreight > 0 &&
      !acc.ticketFreightKeys.has(ticketKey)
    ) {
      acc.ticketFreightKeys.add(ticketKey);
      acc.ticketFreightSum += row.ticketCrossFreight;
    }

    const ms = ensureMode(acc.byMode, row.mode);
    ms.boxes += 1;
    ms.pcs += row.pcs > 0 ? row.pcs : 0;
    if (row.weightKg != null && row.weightKg > 0) ms.weightKg += row.weightKg;
    if (row.cbm != null && row.cbm > 0) ms.cbm += row.cbm;
    if (row.boxCrossFreight != null && row.boxCrossFreight > 0) {
      ms.boxFreight += row.boxCrossFreight;
    }
    if (row.transitDays != null) {
      ms.withTransit += 1;
      ms.transitDaysSum += row.transitDays;
    }
    if (
      row.ticketCrossFreight != null &&
      row.ticketCrossFreight > 0 &&
      !acc.modeTicketKeys[row.mode].has(ticketKey)
    ) {
      acc.modeTicketKeys[row.mode].add(ticketKey);
      ms.ticketFreight += row.ticketCrossFreight;
      ms.ticketCount += 1;
    }

    map.set(row.forwarder, acc);
  }

  const list: ForwarderAgg[] = [];
  for (const [forwarder, acc] of map) {
    const freightForUnit =
      acc.boxFreightSum > 0 ? acc.boxFreightSum : acc.ticketFreightSum;
    list.push({
      forwarder,
      boxes: acc.boxes,
      tickets: acc.ticketFreightKeys.size,
      pcs: acc.pcs,
      weightKg: round(acc.weightKg, 2),
      cbm: round(acc.cbm, 4),
      boxFreightSum: round(acc.boxFreightSum, 2),
      ticketFreightSum: round(acc.ticketFreightSum, 2),
      domesticFreightSum: round(acc.domesticFreightSum, 2),
      inTransitBoxes: acc.inTransitBoxes,
      deliveredBoxes: acc.deliveredBoxes,
      withTransit: acc.withTransit,
      avgTransitDays:
        acc.withTransit > 0
          ? round(acc.transitDaysSum / acc.withTransit, 1)
          : null,
      rmbPerKg:
        acc.weightKg > 0 && freightForUnit > 0
          ? round(freightForUnit / acc.weightKg, 2)
          : null,
      rmbPerCbm:
        acc.cbm > 0 && freightForUnit > 0
          ? round(freightForUnit / acc.cbm, 2)
          : null,
      byMode: acc.byMode,
    });
  }

  return list.sort((a, b) => b.boxes - a.boxes);
}

/**
 * 确定性排名：装箱实付为主，货代大纲普货报价为辅。
 * 实收/箱过低视为费用未填全，降权。
 */
export function rankForwarders(
  aggs: ForwarderAgg[],
  quotes: FreightRatesPayload["byForwarder"] = [],
): ForwarderBoardPayload["ranking"] {
  const quoteOf = (name: string) => {
    const exact = quotes.find((q) => q.forwarder === name);
    if (exact) return exact;
    return (
      quotes.find(
        (q) => name.includes(q.forwarder) || q.forwarder.includes(name),
      ) ?? null
    );
  };

  const fromPacking = aggs.filter(
    (a) => a.boxes >= 3 && a.forwarder !== "(未填货代)",
  );
  const packingNames = new Set(fromPacking.map((a) => a.forwarder));
  const quoteOnlyNames = quotes
    .map((q) => q.forwarder)
    .filter(
      (name) =>
        !packingNames.has(name) &&
        !fromPacking.some(
          (a) => a.forwarder.includes(name) || name.includes(a.forwarder),
        ),
    );

  const emptyMode = (): ForwarderModeStats => ({
    boxes: 0,
    pcs: 0,
    weightKg: 0,
    cbm: 0,
    boxFreight: 0,
    ticketFreight: 0,
    ticketCount: 0,
    withTransit: 0,
    transitDaysSum: 0,
  });

  const quoteOnly: ForwarderAgg[] = quoteOnlyNames.map((forwarder) => ({
    forwarder,
    boxes: 0,
    tickets: 0,
    pcs: 0,
    weightKg: 0,
    cbm: 0,
    boxFreightSum: 0,
    ticketFreightSum: 0,
    domesticFreightSum: 0,
    inTransitBoxes: 0,
    deliveredBoxes: 0,
    withTransit: 0,
    avgTransitDays: null,
    rmbPerKg: null,
    rmbPerCbm: null,
    byMode: {
      air: emptyMode(),
      sea: emptyMode(),
      single: emptyMode(),
      other: emptyMode(),
    },
  }));

  const eligible = [...fromPacking, ...quoteOnly];
  if (eligible.length === 0) {
    return aggs.slice(0, 10).map((a, i) => ({
      rank: i + 1,
      forwarder: a.forwarder,
      score: 0,
      reasons: ["样本不足，仅按箱数展示"],
    }));
  }

  const feePerBox = (a: ForwarderAgg) =>
    a.boxes > 0 ? a.boxFreightSum / a.boxes : 0;
  const MIN_FEE_PER_BOX = 50;

  const airCosts = fromPacking
    .filter((a) => feePerBox(a) >= MIN_FEE_PER_BOX)
    .map((a) => a.byMode.air)
    .filter((m) => m.boxes >= 2 && m.weightKg > 0 && m.boxFreight > 0)
    .map((m) => m.boxFreight / m.weightKg);
  const seaCosts = fromPacking
    .filter((a) => feePerBox(a) >= MIN_FEE_PER_BOX)
    .map((a) => a.byMode.sea)
    .filter(
      (m) =>
        m.boxes >= 2 && m.cbm > 0 && (m.boxFreight > 0 || m.ticketFreight > 0),
    )
    .map((m) => (m.boxFreight > 0 ? m.boxFreight : m.ticketFreight) / m.cbm);

  const quoteAirMids = quotes
    .map((q) => q.generalAirMid)
    .filter((n): n is number => n != null && n > 0);
  const quoteSeaMids = quotes
    .map((q) => q.generalSeaMid)
    .filter((n): n is number => n != null && n > 0);

  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  const medAir = median(airCosts);
  const medSea = median(seaCosts);
  const medQuoteAir = median(quoteAirMids);
  const medQuoteSea = median(quoteSeaMids);

  const scored = eligible.map((a) => {
    const reasons: string[] = [];
    let score = a.boxes > 0 ? 50 : 40;
    const air = a.byMode.air;
    const sea = a.byMode.sea;
    const cov = feePerBox(a);
    const feeOk = a.boxes > 0 && cov >= MIN_FEE_PER_BOX;
    const q = quoteOf(a.forwarder);

    if (a.boxes > 0 && !feeOk) {
      score -= 30;
      reasons.push(
        `实收跨境均值仅 ${round(cov, 0)}/箱，费用可能未填全，已降权`,
      );
    }

    if (
      feeOk &&
      medAir &&
      air.boxes >= 2 &&
      air.weightKg > 0 &&
      air.boxFreight > 0
    ) {
      const unit = air.boxFreight / air.weightKg;
      const delta = (medAir - unit) / medAir;
      score += Math.max(-25, Math.min(25, delta * 40));
      reasons.push(
        `空运实收约 ${round(unit, 1)} RMB/kg（中位 ${round(medAir, 1)}）`,
      );
    }
    if (feeOk && medSea && sea.boxes >= 2 && sea.cbm > 0) {
      const fee = sea.boxFreight > 0 ? sea.boxFreight : sea.ticketFreight;
      if (fee > 0) {
        const unit = fee / sea.cbm;
        const delta = (medSea - unit) / medSea;
        score += Math.max(-25, Math.min(25, delta * 40));
        reasons.push(
          `海运约 ${round(unit, 0)} RMB/方（中位 ${round(medSea, 0)}）`,
        );
      }
    }

    if (q?.generalAirMid != null && medQuoteAir) {
      const delta = (medQuoteAir - q.generalAirMid) / medQuoteAir;
      score += Math.max(-15, Math.min(15, delta * 25));
      reasons.push(
        `大纲普货空运报价约 ${q.generalAirMid} RMB/kg（中位 ${round(medQuoteAir, 1)}）`,
      );
    }
    if (q?.generalSeaMid != null && medQuoteSea) {
      const delta = (medQuoteSea - q.generalSeaMid) / medQuoteSea;
      score += Math.max(-10, Math.min(10, delta * 20));
      reasons.push(
        `大纲普货海运报价约 ${q.generalSeaMid}（中位 ${round(medQuoteSea, 1)}）`,
      );
    }
    if (!q && quotes.length > 0) {
      reasons.push("货代大纲无同名报价行");
    }

    if (a.avgTransitDays != null && a.withTransit >= 3) {
      const target = sea.boxes >= air.boxes ? 35 : 14;
      score += Math.max(-15, Math.min(10, (target - a.avgTransitDays) * 0.4));
      reasons.push(`平均在途 ${a.avgTransitDays} 天（样本 ${a.withTransit}）`);
    } else if (a.boxes > 0) {
      reasons.push("有效送仓时效样本不足");
    } else {
      reasons.push("仅有大纲报价、尚无装箱实付样本");
    }
    if (a.boxes > 0) {
      reasons.push(
        `箱数 ${a.boxes} · 在途 ${a.inTransitBoxes} · 已入库 ${a.deliveredBoxes}`,
      );
    }

    return {
      forwarder: a.forwarder,
      score: round(score, 1),
      reasons,
      quoteAirMid: q?.generalAirMid ?? null,
      quoteSeaMid: q?.generalSeaMid ?? null,
    };
  });

  scored.sort(
    (a, b) => b.score - a.score || a.forwarder.localeCompare(b.forwarder),
  );
  return scored.map((s, i) => ({ rank: i + 1, ...s }));
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

function latestPackingSnapshot(): {
  path: string;
  pulledAt: string | null;
  values: unknown[][];
} | null {
  for (const dir of rawDirCandidates()) {
    const lastPath = join(dir, "last-run.json");
    if (!existsSync(lastPath)) continue;
    try {
      const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
        runId?: string;
      };
      // 优先 last-run；若该 run 无 packing，扫最近含 packing 的 run
      const tryPaths: string[] = [];
      if (last.runId) {
        tryPaths.push(join(dir, "runs", last.runId, "packing", "snapshot.json"));
      }
      const runsDir = join(dir, "runs");
      if (existsSync(runsDir)) {
        // 轻量：只试 last；找不到再找任意最新 packing（按目录 mtime 由调用方缓存）
      }
      for (const path of tryPaths) {
        if (!existsSync(path)) continue;
        const snap = JSON.parse(readFileSync(path, "utf8")) as {
          pulledAt?: string;
          sheets?: Array<{ title?: string; values?: unknown[][] }>;
        };
        const sheet =
          snap.sheets?.find((s) => s.title === "箱表") ??
          snap.sheets?.find((s) => (s.title ?? "").includes("箱"));
        if (!sheet?.values) continue;
        return {
          path,
          pulledAt: snap.pulledAt ?? null,
          values: sheet.values,
        };
      }
    } catch {
      /* next */
    }
  }

  // fallback：扫 runs/*/packing/snapshot.json 最新
  for (const dir of rawDirCandidates()) {
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
      const hit = runs[0];
      if (!hit) continue;
      const snap = JSON.parse(readFileSync(hit.path, "utf8")) as {
        pulledAt?: string;
        sheets?: Array<{ title?: string; values?: unknown[][] }>;
      };
      const sheet = snap.sheets?.find((s) => s.title === "箱表");
      if (!sheet?.values) continue;
      return { path: hit.path, pulledAt: snap.pulledAt ?? null, values: sheet.values };
    } catch {
      /* next */
    }
  }
  return null;
}

export function buildForwarderBoard(): ForwarderBoardPayload {
  const snap = latestPackingSnapshot();
  const rates = buildFreightRatesPayload();
  const packKey = snap
    ? `${snap.path}:${statSync(snap.path).mtimeMs}`
    : "empty-pack";
  const ratesKey = rates.source.snapshotPath
    ? `${rates.source.snapshotPath}:${rates.source.pulledAt ?? ""}`
    : "empty-rates";
  const key = `${packKey}|${ratesKey}`;
  if (cache?.key === key) return cache.payload;

  const rows = snap ? extractPackingBoxRows(snap.values) : [];
  const forwarders = aggregateForwarders(rows);
  const ranking = rankForwarders(forwarders, rates.byForwarder);

  const inTransit = rows
    .filter((r) => isPackingInTransit(r.arriveAt, r.warehouseStatus))
    .map((r) => ({
      boxNo: r.boxNo,
      ticketNo: r.ticketNo,
      forwarder: r.forwarder,
      modeRaw: r.modeRaw,
      pcs: r.pcs,
      shipAt: r.shipAt,
      asn: r.asn,
      logisticsNo: r.logisticsNo,
    }))
    .sort((a, b) => (b.shipAt ?? "").localeCompare(a.shipAt ?? ""))
    .slice(0, 300);

  const deliveredSample = rows
    .filter(
      (r) =>
        r.warehouseStatus.includes("入库") || r.warehouseStatus.includes("已到"),
    )
    .map((r) => ({
      boxNo: r.boxNo,
      forwarder: r.forwarder,
      modeRaw: r.modeRaw,
      pcs: r.pcs,
      shipAt: r.shipAt,
      arriveAt: r.arriveAt,
      transitDays: r.transitDays,
      boxCrossFreight: r.boxCrossFreight,
    }))
    .sort((a, b) => (b.arriveAt ?? "").localeCompare(a.arriveAt ?? ""))
    .slice(0, 100);

  const payload: ForwarderBoardPayload = {
    source: {
      snapshotPath: snap?.path ?? null,
      pulledAt: snap?.pulledAt ?? null,
      sheetTitle: "箱表",
      boxRows: rows.length,
      forwarderCount: forwarders.length,
    },
    freightRates: {
      ...rates.source,
      forwarderCount: rates.byForwarder.length,
    },
    forwarders,
    ranking,
    quotes: rates.byForwarder,
    inTransit,
    deliveredSample,
  };
  cache = { key, payload };
  return payload;
}

export function clearForwarderBoardCache() {
  cache = null;
}

