/**
 * 票级实付样本：从最新装箱箱表抽取（按票去重实付），并用 cargo-hints 标货性。
 * 只读快照 + hints，结果可缓存到本机 JSON 供 Phase 2 估价用。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  extractPackingBoxRows,
  type PackingBoxRow,
  type ShipMode,
} from "../../platforms/feishu/normalize/forwarder-board.js";
import { canonicalizeForwarderName } from "../../platforms/feishu/normalize/forwarder-names.js";
import {
  findCargoHint,
  listCargoHints,
  type ManualCargoKind,
} from "./cargo-hints.js";
import {
  loadLatestPackingLines,
  type PackingLineRow,
} from "../../platforms/feishu/normalize/packing-lines.js";

export type RateSample = {
  ticketNo: string;
  forwarder: string;
  mode: ShipMode;
  modeRaw: string;
  shipAt: string | null;
  /** 整票跨境实付 */
  paidCny: number;
  weightKg: number | null;
  cbm: number | null;
  boxCount: number;
  pcs: number;
  /** 票内 hints 一致时的货性；否则 null */
  cargoKind: ManualCargoKind | null;
  cargoKindNote: string;
  rmbPerKg: number | null;
  rmbPerCbm: number | null;
};

export type RateSamplesFile = {
  updatedAt: string;
  sourceNote: string;
  samples: RateSample[];
  /** 货代 × 货性 × 模式 聚合 */
  rollup: RateRollup[];
};

export type RateRollup = {
  forwarder: string;
  cargoKind: string;
  mode: ShipMode;
  ticketCount: number;
  paidSum: number;
  weightSum: number;
  cbmSum: number;
  medianRmbPerKg: number | null;
  medianRmbPerCbm: number | null;
};

function outpostRoot(): string {
  return resolve(process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data");
}

export function rateSamplesPath(): string {
  return join(outpostRoot(), "shipping", "rate-samples.json");
}

function ensureDir(): void {
  const dir = join(outpostRoot(), "shipping");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

function packingSnapshotBoxValues(): unknown[][] | null {
  const shared = resolve(outpostRoot(), "feishu-raw");
  const lastPath = join(shared, "last-run.json");
  let snapPath: string | null = null;
  if (existsSync(lastPath)) {
    try {
      const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
        runId?: string;
      };
      if (last.runId) {
        const p = join(shared, "runs", last.runId, "packing", "snapshot.json");
        if (existsSync(p)) snapPath = p;
      }
    } catch {
      /* fall through */
    }
  }
  if (!snapPath) {
    const runsDir = join(shared, "runs");
    if (existsSync(runsDir)) {
      const runs = readdirSync(runsDir)
        .map((name) => {
          const path = join(runsDir, name, "packing", "snapshot.json");
          if (!existsSync(path)) return null;
          return { path, mtime: statSync(path).mtimeMs };
        })
        .filter(Boolean) as Array<{ path: string; mtime: number }>;
      runs.sort((a, b) => b.mtime - a.mtime);
      snapPath = runs[0]?.path ?? null;
    }
  }
  if (!snapPath) return null;
  try {
    const snap = JSON.parse(readFileSync(snapPath, "utf8")) as {
      sheets?: Array<{ title?: string; values?: unknown[][] }>;
    };
    const box = snap.sheets?.find((s) => s.title === "箱表");
    return box?.values ?? null;
  } catch {
    return null;
  }
}

function ticketCargoKind(
  lines: PackingLineRow[],
  forwarder: string,
): { kind: ManualCargoKind | null; note: string } {
  const hints = listCargoHints();
  const kinds = new Set<string>();
  let labeled = 0;
  let total = 0;
  for (const line of lines) {
    if (!line.partnerSku) continue;
    total += 1;
    const hit = findCargoHint(hints, line.partnerSku, forwarder);
    if (hit) {
      labeled += 1;
      kinds.add(hit.cargoKind);
    }
  }
  if (!total) return { kind: null, note: "无明细SKU" };
  if (labeled === 0) return { kind: null, note: "票内SKU均未标注货性" };
  if (kinds.size === 1) {
    const k = [...kinds][0] as ManualCargoKind;
    return {
      kind: k,
      note: labeled < total ? `部分标注(${labeled}/${total})一致` : "全部标注一致",
    };
  }
  return {
    kind: null,
    note: `票内货性不一致: ${[...kinds].join("+")} (${labeled}/${total})`,
  };
}

/** 从最新装箱快照构建样本（不写盘） */
export function buildRateSamplesFromPacking(): RateSamplesFile {
  const values = packingSnapshotBoxValues();
  const boxes: PackingBoxRow[] = values ? extractPackingBoxRows(values) : [];
  const allLines = loadLatestPackingLines();
  const linesByBox = new Map<string, PackingLineRow[]>();
  for (const line of allLines) {
    const list = linesByBox.get(line.boxNo) ?? [];
    list.push(line);
    linesByBox.set(line.boxNo, list);
  }

  type Acc = {
    forwarder: string;
    mode: ShipMode;
    modeRaw: string;
    shipAt: string | null;
    paidCny: number | null;
    weightKg: number;
    cbm: number;
    boxCount: number;
    pcs: number;
    boxNos: string[];
  };
  const byTicket = new Map<string, Acc>();

  for (const b of boxes) {
    const fwd = canonicalizeForwarderName(b.forwarder || "");
    if (!fwd || !b.shipAt) continue;
    const key = (b.ticketNo || b.logisticsNo || b.boxNo).trim();
    if (!key) continue;
    let acc = byTicket.get(key);
    if (!acc) {
      acc = {
        forwarder: fwd,
        mode: b.mode,
        modeRaw: b.modeRaw,
        shipAt: b.shipAt,
        paidCny: b.ticketCrossFreight,
        weightKg: 0,
        cbm: 0,
        boxCount: 0,
        pcs: 0,
        boxNos: [],
      };
      byTicket.set(key, acc);
    }
    acc.boxCount += 1;
    acc.pcs += b.pcs || 0;
    if (b.weightKg != null) acc.weightKg += b.weightKg;
    if (b.cbm != null) acc.cbm += b.cbm;
    acc.boxNos.push(b.boxNo);
    if (acc.paidCny == null && b.ticketCrossFreight != null) {
      acc.paidCny = b.ticketCrossFreight;
    }
    if (!acc.shipAt && b.shipAt) acc.shipAt = b.shipAt;
  }

  const samples: RateSample[] = [];
  for (const [ticketNo, acc] of byTicket) {
    if (acc.paidCny == null || !(acc.paidCny > 0)) continue;
    const ticketLines: PackingLineRow[] = [];
    for (const boxNo of acc.boxNos) {
      ticketLines.push(...(linesByBox.get(boxNo) ?? []));
    }
    const { kind, note } = ticketCargoKind(ticketLines, acc.forwarder);
    const w = acc.weightKg > 0 ? acc.weightKg : null;
    const c = acc.cbm > 0 ? acc.cbm : null;
    samples.push({
      ticketNo,
      forwarder: acc.forwarder,
      mode: acc.mode,
      modeRaw: acc.modeRaw,
      shipAt: acc.shipAt,
      paidCny: acc.paidCny,
      weightKg: w,
      cbm: c,
      boxCount: acc.boxCount,
      pcs: acc.pcs,
      cargoKind: kind,
      cargoKindNote: note,
      rmbPerKg: w && w > 0 ? acc.paidCny / w : null,
      rmbPerCbm: c && c > 0 ? acc.paidCny / c : null,
    });
  }

  samples.sort((a, b) => {
    const da = a.shipAt || "";
    const db = b.shipAt || "";
    return db.localeCompare(da) || a.forwarder.localeCompare(b.forwarder, "zh");
  });

  const bucket = new Map<string, RateSample[]>();
  for (const s of samples) {
    const ck = s.cargoKind || "unlabeled";
    const k = `${s.forwarder}\0${ck}\0${s.mode}`;
    const list = bucket.get(k) ?? [];
    list.push(s);
    bucket.set(k, list);
  }
  const rollup: RateRollup[] = [];
  for (const [k, list] of bucket) {
    const [forwarder, cargoKind, mode] = k.split("\0") as [
      string,
      string,
      ShipMode,
    ];
    const perKg = list
      .map((s) => s.rmbPerKg)
      .filter((n): n is number => n != null && Number.isFinite(n));
    const perCbm = list
      .map((s) => s.rmbPerCbm)
      .filter((n): n is number => n != null && Number.isFinite(n));
    rollup.push({
      forwarder,
      cargoKind,
      mode,
      ticketCount: list.length,
      paidSum: list.reduce((a, s) => a + s.paidCny, 0),
      weightSum: list.reduce((a, s) => a + (s.weightKg || 0), 0),
      cbmSum: list.reduce((a, s) => a + (s.cbm || 0), 0),
      medianRmbPerKg: median(perKg),
      medianRmbPerCbm: median(perCbm),
    });
  }
  rollup.sort(
    (a, b) =>
      b.ticketCount - a.ticketCount ||
      a.forwarder.localeCompare(b.forwarder, "zh"),
  );

  return {
    updatedAt: nowIso(),
    sourceNote: `箱表票级实付×${samples.length}；hints用于货性`,
    samples,
    rollup,
  };
}

export function rebuildAndSaveRateSamples(): RateSamplesFile {
  const file = buildRateSamplesFromPacking();
  ensureDir();
  writeFileSync(rateSamplesPath(), JSON.stringify(file, null, 2), "utf8");
  return file;
}

export function loadRateSamplesFile(): RateSamplesFile | null {
  const path = rateSamplesPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RateSamplesFile;
  } catch {
    return null;
  }
}

export function getRateSamples(opts?: { rebuild?: boolean }): RateSamplesFile {
  if (opts?.rebuild) return rebuildAndSaveRateSamples();
  return loadRateSamplesFile() ?? rebuildAndSaveRateSamples();
}
