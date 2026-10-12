/**
 * 发货渠道历史参考：装箱明细 → 货代 × 空/海运汇总 + 按 SKU 查询。
 * 货性来自用户手工标注（cargo-hints），不自动推断。
 */
import { canonicalizeForwarderName } from "../../platforms/feishu/normalize/forwarder-names.js";
import {
  loadLatestPackingLines,
  type PackingLineRow,
} from "../../platforms/feishu/normalize/packing-lines.js";
import type { ShipMode } from "../../platforms/feishu/normalize/forwarder-board.js";
import {
  findCargoHint,
  listCargoHints,
  type ForwarderCargoHint,
} from "./cargo-hints.js";

export type { ForwarderCargoHint };

export type ChannelAgg = {
  forwarder: string;
  mode: ShipMode;
  boxes: number;
  pcs: number;
  distinctSku: number;
  lastShipAt: string | null;
  deliveredPcs: number;
};

export type ForwarderChannelRollup = {
  forwarder: string;
  boxes: number;
  pcs: number;
  distinctSku: number;
  lastShipAt: string | null;
  byMode: Record<
    ShipMode,
    { boxes: number; pcs: number; distinctSku: number; lastShipAt: string | null }
  >;
};

export type SkuChannelAgg = {
  forwarder: string;
  mode: ShipMode;
  pcs: number;
  boxCount: number;
  firstShipAt: string | null;
  lastShipAt: string | null;
  /** 占该 SKU 已发货件数的比例 0–1 */
  share: number;
  /** 该货代×PSKU 手工货性；未标注为 null */
  cargoKind: string | null;
};

export type SkuChannelSample = {
  boxNo: string;
  ticketNo: string;
  shipAt: string | null;
  forwarder: string;
  mode: ShipMode;
  qty: number;
};

export type SkuChannelHistory = {
  partnerSku: string;
  name: string;
  totalPcs: number;
  channels: SkuChannelAgg[];
  preferred: { forwarder: string; mode: ShipMode; pcs: number } | null;
  recentSamples: SkuChannelSample[];
};

export type ChannelHistoryPayload = {
  source: {
    lineCount: number;
    shippedLineCount: number;
    missingShipAtCount: number;
    shippedPcs: number;
    channelCount: number;
    forwarderCount: number;
  };
  channels: ChannelAgg[];
  forwarders: ForwarderChannelRollup[];
  /** 后期手工货性；本期恒 [] */
  cargoHints: ForwarderCargoHint[];
};

function emptyModeBucket(): ForwarderChannelRollup["byMode"][ShipMode] {
  return { boxes: 0, pcs: 0, distinctSku: 0, lastShipAt: null };
}

function emptyByMode(): ForwarderChannelRollup["byMode"] {
  return {
    air: emptyModeBucket(),
    sea: emptyModeBucket(),
    single: emptyModeBucket(),
    other: emptyModeBucket(),
  };
}

function isDelivered(line: PackingLineRow): boolean {
  if (line.arriveAt) return true;
  const s = (line.warehouseStatus || "").trim();
  return s.includes("已入库") || s.includes("已送仓") || s.includes("已签收");
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function minDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function channelKey(forwarder: string, mode: ShipMode): string {
  return `${forwarder}\0${mode}`;
}

/** 纯函数：已发货行（有 shipAt）→ 渠道总览 */
export function aggregateChannelHistory(
  lines: PackingLineRow[],
): ChannelHistoryPayload {
  let missingShipAtCount = 0;
  const shipped: PackingLineRow[] = [];
  for (const line of lines) {
    if (!line.shipAt) {
      missingShipAtCount += 1;
      continue;
    }
    shipped.push(line);
  }

  type Acc = {
    forwarder: string;
    mode: ShipMode;
    boxes: Set<string>;
    skus: Set<string>;
    pcs: number;
    lastShipAt: string | null;
    deliveredPcs: number;
  };
  const byChannel = new Map<string, Acc>();

  for (const line of shipped) {
    const forwarder = canonicalizeForwarderName(
      line.forwarder?.trim() || "(未填货代)",
    );
    const mode = line.mode;
    const key = channelKey(forwarder, mode);
    let acc = byChannel.get(key);
    if (!acc) {
      acc = {
        forwarder,
        mode,
        boxes: new Set(),
        skus: new Set(),
        pcs: 0,
        lastShipAt: null,
        deliveredPcs: 0,
      };
      byChannel.set(key, acc);
    }
    acc.boxes.add(line.boxNo);
    if (line.partnerSku) acc.skus.add(line.partnerSku);
    acc.pcs += line.qty;
    acc.lastShipAt = maxDate(acc.lastShipAt, line.shipAt);
    if (isDelivered(line)) acc.deliveredPcs += line.qty;
  }

  const channels: ChannelAgg[] = [...byChannel.values()]
    .map((a) => ({
      forwarder: a.forwarder,
      mode: a.mode,
      boxes: a.boxes.size,
      pcs: a.pcs,
      distinctSku: a.skus.size,
      lastShipAt: a.lastShipAt,
      deliveredPcs: a.deliveredPcs,
    }))
    .sort(
      (a, b) =>
        b.pcs - a.pcs ||
        a.forwarder.localeCompare(b.forwarder, "zh") ||
        a.mode.localeCompare(b.mode),
    );

  type FAcc = {
    forwarder: string;
    boxes: Set<string>;
    skus: Set<string>;
    pcs: number;
    lastShipAt: string | null;
    byMode: Record<
      ShipMode,
      { boxes: Set<string>; skus: Set<string>; pcs: number; lastShipAt: string | null }
    >;
  };
  const byFwd = new Map<string, FAcc>();
  for (const line of shipped) {
    const forwarder = canonicalizeForwarderName(
      line.forwarder?.trim() || "(未填货代)",
    );
    let f = byFwd.get(forwarder);
    if (!f) {
      f = {
        forwarder,
        boxes: new Set(),
        skus: new Set(),
        pcs: 0,
        lastShipAt: null,
        byMode: {
          air: { boxes: new Set(), skus: new Set(), pcs: 0, lastShipAt: null },
          sea: { boxes: new Set(), skus: new Set(), pcs: 0, lastShipAt: null },
          single: { boxes: new Set(), skus: new Set(), pcs: 0, lastShipAt: null },
          other: { boxes: new Set(), skus: new Set(), pcs: 0, lastShipAt: null },
        },
      };
      byFwd.set(forwarder, f);
    }
    f.boxes.add(line.boxNo);
    if (line.partnerSku) f.skus.add(line.partnerSku);
    f.pcs += line.qty;
    f.lastShipAt = maxDate(f.lastShipAt, line.shipAt);
    const m = f.byMode[line.mode];
    m.boxes.add(line.boxNo);
    if (line.partnerSku) m.skus.add(line.partnerSku);
    m.pcs += line.qty;
    m.lastShipAt = maxDate(m.lastShipAt, line.shipAt);
  }

  const forwarders: ForwarderChannelRollup[] = [...byFwd.values()]
    .map((f) => {
      const byMode = emptyByMode();
      for (const mode of Object.keys(byMode) as ShipMode[]) {
        const m = f.byMode[mode];
        byMode[mode] = {
          boxes: m.boxes.size,
          pcs: m.pcs,
          distinctSku: m.skus.size,
          lastShipAt: m.lastShipAt,
        };
      }
      return {
        forwarder: f.forwarder,
        boxes: f.boxes.size,
        pcs: f.pcs,
        distinctSku: f.skus.size,
        lastShipAt: f.lastShipAt,
        byMode,
      };
    })
    .sort(
      (a, b) => b.pcs - a.pcs || a.forwarder.localeCompare(b.forwarder, "zh"),
    );

  const shippedPcs = shipped.reduce((s, l) => s + l.qty, 0);

  return {
    source: {
      lineCount: lines.length,
      shippedLineCount: shipped.length,
      missingShipAtCount,
      shippedPcs,
      channelCount: channels.length,
      forwarderCount: forwarders.length,
    },
    channels,
    forwarders,
    /** 由 buildChannelHistoryPayload 填入 store；纯聚合默认空 */
    cargoHints: [] as ForwarderCargoHint[],
  };
}

/** 纯函数：按 PSKU/品名模糊匹配，返回各 SKU 渠道史 */
export function querySkuChannelHistory(
  lines: PackingLineRow[],
  q: string,
  opts?: {
    limit?: number;
    sampleLimit?: number;
    hints?: ForwarderCargoHint[];
  },
): SkuChannelHistory[] {
  const hints = opts?.hints ?? [];
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const limit = opts?.limit ?? 30;
  const sampleLimit = opts?.sampleLimit ?? 8;

  const shipped = lines.filter((l) => l.shipAt && l.partnerSku);
  const matched = shipped.filter(
    (l) =>
      l.partnerSku.toLowerCase().includes(query) ||
      (l.name || "").toLowerCase().includes(query),
  );

  type ChAcc = {
    forwarder: string;
    mode: ShipMode;
    pcs: number;
    boxes: Set<string>;
    firstShipAt: string | null;
    lastShipAt: string | null;
  };
  type SkuAcc = {
    partnerSku: string;
    name: string;
    totalPcs: number;
    channels: Map<string, ChAcc>;
    samples: SkuChannelSample[];
  };
  const bySku = new Map<string, SkuAcc>();

  for (const line of matched) {
    let sku = bySku.get(line.partnerSku);
    if (!sku) {
      sku = {
        partnerSku: line.partnerSku,
        name: line.name || "",
        totalPcs: 0,
        channels: new Map(),
        samples: [],
      };
      bySku.set(line.partnerSku, sku);
    }
    if (line.name && !sku.name) sku.name = line.name;
    sku.totalPcs += line.qty;

    const forwarder = canonicalizeForwarderName(
      line.forwarder?.trim() || "(未填货代)",
    );
    const ck = channelKey(forwarder, line.mode);
    let ch = sku.channels.get(ck);
    if (!ch) {
      ch = {
        forwarder,
        mode: line.mode,
        pcs: 0,
        boxes: new Set(),
        firstShipAt: null,
        lastShipAt: null,
      };
      sku.channels.set(ck, ch);
    }
    ch.pcs += line.qty;
    ch.boxes.add(line.boxNo);
    ch.firstShipAt = minDate(ch.firstShipAt, line.shipAt);
    ch.lastShipAt = maxDate(ch.lastShipAt, line.shipAt);

    sku.samples.push({
      boxNo: line.boxNo,
      ticketNo: line.ticketNo || "",
      shipAt: line.shipAt,
      forwarder,
      mode: line.mode,
      qty: line.qty,
    });
  }

  const out: SkuChannelHistory[] = [...bySku.values()].map((sku) => {
    const channels: SkuChannelAgg[] = [...sku.channels.values()]
      .map((ch) => ({
        forwarder: ch.forwarder,
        mode: ch.mode,
        pcs: ch.pcs,
        boxCount: ch.boxes.size,
        firstShipAt: ch.firstShipAt,
        lastShipAt: ch.lastShipAt,
        share: sku.totalPcs > 0 ? Math.round((ch.pcs / sku.totalPcs) * 1000) / 1000 : 0,
        cargoKind:
          findCargoHint(hints, sku.partnerSku, ch.forwarder)?.cargoKind ?? null,
      }))
      .sort(
        (a, b) =>
          b.pcs - a.pcs ||
          (b.lastShipAt ?? "").localeCompare(a.lastShipAt ?? ""),
      );

    let preferred: SkuChannelHistory["preferred"] = null;
    if (channels[0]) {
      const topPcs = channels[0].pcs;
      const tied = channels.filter((c) => c.pcs === topPcs);
      tied.sort((a, b) => (b.lastShipAt ?? "").localeCompare(a.lastShipAt ?? ""));
      const best = tied[0]!;
      preferred = {
        forwarder: best.forwarder,
        mode: best.mode,
        pcs: best.pcs,
      };
    }

    const recentSamples = [...sku.samples]
      .sort((a, b) => (b.shipAt ?? "").localeCompare(a.shipAt ?? ""))
      .slice(0, sampleLimit);

    return {
      partnerSku: sku.partnerSku,
      name: sku.name,
      totalPcs: sku.totalPcs,
      channels,
      preferred,
      recentSamples,
    };
  });

  out.sort((a, b) => b.totalPcs - a.totalPcs || a.partnerSku.localeCompare(b.partnerSku));
  return out.slice(0, limit);
}

export function buildChannelHistoryPayload(): ChannelHistoryPayload {
  const payload = aggregateChannelHistory(loadLatestPackingLines());
  payload.cargoHints = listCargoHints();
  return payload;
}

export function searchSkuChannelHistory(q: string): {
  q: string;
  cargoHints: ForwarderCargoHint[];
  skus: SkuChannelHistory[];
} {
  const hints = listCargoHints();
  const skus = querySkuChannelHistory(loadLatestPackingLines(), q, { hints });
  const skuSet = new Set(skus.map((s) => s.partnerSku));
  return {
    q: q.trim(),
    cargoHints: hints.filter((h) => skuSet.has(h.partnerSku)),
    skus,
  };
}
