/**
 * 发货计划：导入、汇总、分批发货、货代×货性缺口。
 */
import { randomUUID } from "node:crypto";
import { canonicalizeForwarderName } from "../../../platforms/feishu/normalize/forwarder-names.js";
import {
  CARGO_KIND_OPTIONS,
  findCargoHint,
  listCargoHints,
  upsertCargoHint,
  type ManualCargoKind,
} from "../../shipping/cargo-hints.js";
import { searchSkuChannelHistory } from "../../shipping/channel-history.js";
import { parseShipPlanWorkbook } from "./parse-xlsx.js";
import {
  deleteShipPlanDoc,
  listShipPlanDocs,
  loadShipPlanDoc,
  saveShipPlanDoc,
} from "./store.js";
import type {
  ForwarderCargoGap,
  ForwarderRollup,
  ShipPlanDoc,
  ShipPlanLeg,
  ShipPlanLine,
  ShipPlanLineStatus,
  ShipPlanSummary,
  ShipModeLite,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function refreshLegStatus(leg: ShipPlanLeg): void {
  if (leg.status === "cancelled") return;
  if (leg.qty <= 0) {
    leg.status = "done";
    return;
  }
  if (leg.shippedQty <= 0) leg.status = "pending";
  else if (leg.shippedQty >= leg.qty) leg.status = "done";
  else leg.status = "partial";
}

export function lineStatus(line: ShipPlanLine): ShipPlanLineStatus {
  if (!line.include) return "skip";
  const active = line.legs.filter((l) => l.status !== "cancelled");
  if (active.length === 0) return "unassigned";
  const needFwd = active.some((l) => l.qty > 0 && !l.forwarder.trim());
  if (needFwd) return "unassigned";
  if (active.every((l) => l.status === "done" || l.qty <= 0)) return "done";
  if (active.some((l) => l.shippedQty > 0)) return "partial";
  return "pending";
}

export function summarizePlan(doc: ShipPlanDoc): ShipPlanSummary {
  const planDates = [
    ...new Set(
      doc.lines.map((l) => l.planDate).filter((d): d is string => !!d),
    ),
  ].sort();

  let includeCount = 0;
  let skipCount = 0;
  let pendingCount = 0;
  let partialCount = 0;
  let doneCount = 0;
  let unassignedCount = 0;
  let totalSuggestAir = 0;
  let totalSuggestSea = 0;
  let totalShipped = 0;
  let totalPlanned = 0;

  for (const line of doc.lines) {
    totalSuggestAir += line.suggestAir ?? 0;
    totalSuggestSea += line.suggestSea ?? 0;
    for (const leg of line.legs) {
      if (leg.status === "cancelled") continue;
      totalPlanned += leg.qty;
      totalShipped += Math.min(leg.shippedQty, leg.qty);
    }
    const st = lineStatus(line);
    if (st === "skip") skipCount++;
    else includeCount++;
    if (st === "pending") pendingCount++;
    else if (st === "partial") partialCount++;
    else if (st === "done") doneCount++;
    else if (st === "unassigned") unassignedCount++;
  }

  return {
    lineCount: doc.lines.length,
    includeCount,
    skipCount,
    pendingCount,
    partialCount,
    doneCount,
    unassignedCount,
    cargoGapCount: listCargoGaps(doc).filter((g) => !g.cargoKind).length,
    planDates,
    totalSuggestAir,
    totalSuggestSea,
    totalShipped,
    totalPlanned,
  };
}

function hydrateCargoKinds(doc: ShipPlanDoc): void {
  const hints = listCargoHints();
  for (const line of doc.lines) {
    for (const leg of line.legs) {
      if (!leg.forwarder.trim()) continue;
      const hit = findCargoHint(hints, line.partnerSku, leg.forwarder);
      if (hit) leg.cargoKind = hit.cargoKind;
    }
  }
}

export function listCargoGaps(doc: ShipPlanDoc): ForwarderCargoGap[] {
  const hints = listCargoHints();
  const map = new Map<string, ForwarderCargoGap>();
  for (const line of doc.lines) {
    if (!line.include) continue;
    for (const leg of line.legs) {
      if (leg.status === "cancelled" || leg.qty <= 0) continue;
      const fwd = canonicalizeForwarderName(leg.forwarder.trim());
      if (!fwd) continue;
      const key = `${line.partnerSku}\0${fwd}`;
      const existing = map.get(key);
      if (existing) {
        if (!existing.modes.includes(leg.mode)) existing.modes.push(leg.mode);
        existing.plannedQty += leg.qty;
      } else {
        const hit = findCargoHint(hints, line.partnerSku, fwd);
        map.set(key, {
          partnerSku: line.partnerSku,
          productName: line.productName,
          forwarder: fwd,
          modes: [leg.mode],
          plannedQty: leg.qty,
          cargoKind: hit?.cargoKind ?? null,
        });
      }
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      Number(!!a.cargoKind) - Number(!!b.cargoKind) ||
      a.partnerSku.localeCompare(b.partnerSku) ||
      a.forwarder.localeCompare(b.forwarder, "zh"),
  );
}

export function rollupByForwarder(doc: ShipPlanDoc): ForwarderRollup[] {
  const gaps = listCargoGaps(doc);
  const map = new Map<string, ForwarderRollup & { skus: Set<string> }>();

  for (const line of doc.lines) {
    if (!line.include) continue;
    for (const leg of line.legs) {
      if (leg.status === "cancelled" || !leg.forwarder.trim()) continue;
      const fwd = canonicalizeForwarderName(leg.forwarder);
      let row = map.get(fwd);
      if (!row) {
        row = {
          forwarder: fwd,
          airQty: 0,
          seaQty: 0,
          shippedQty: 0,
          skuCount: 0,
          withCargoKind: 0,
          missingCargoKind: 0,
          byCargoKind: {},
          skus: new Set(),
        };
        map.set(fwd, row);
      }
      row.skus.add(line.partnerSku);
      if (leg.mode === "air") row.airQty += leg.qty;
      else row.seaQty += leg.qty;
      row.shippedQty += Math.min(leg.shippedQty, leg.qty);
      const kind = leg.cargoKind || "未标注";
      row.byCargoKind[kind] = (row.byCargoKind[kind] ?? 0) + leg.qty;
    }
  }

  for (const g of gaps) {
    const row = map.get(g.forwarder);
    if (!row) continue;
    if (g.cargoKind) row.withCargoKind++;
    else row.missingCargoKind++;
  }

  return [...map.values()]
    .map(({ skus, ...rest }) => ({ ...rest, skuCount: skus.size }))
    .sort((a, b) => b.airQty + b.seaQty - (a.airQty + a.seaQty));
}

export function importShipPlanFromBuffer(input: {
  buffer: Buffer;
  filename?: string;
  name?: string;
  replaceId?: string;
}): { doc: ShipPlanDoc; warnings: string[]; summary: ShipPlanSummary } {
  const parsed = parseShipPlanWorkbook(input.buffer);
  const id =
    input.replaceId?.trim() ||
    `sp-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6)}`;

  if (input.replaceId) {
    const old = loadShipPlanDoc(input.replaceId);
    if (!old) throw new Error(`要覆盖的计划不存在：${input.replaceId}`);
  }

  const doc: ShipPlanDoc = {
    id,
    name:
      input.name?.trim() ||
      input.filename?.replace(/\.[^.]+$/, "") ||
      `补货发货计划 ${new Date().toISOString().slice(0, 10)}`,
    sourceFile: input.filename?.trim() || "upload.xlsx",
    importedAt: nowIso(),
    updatedAt: nowIso(),
    lines: parsed.lines,
  };

  hydrateCargoKinds(doc);
  saveShipPlanDoc(doc);
  return { doc, warnings: parsed.warnings, summary: summarizePlan(doc) };
}

export function listPlansBrief() {
  return listShipPlanDocs().map((d) => ({
    id: d.id,
    name: d.name,
    sourceFile: d.sourceFile,
    importedAt: d.importedAt,
    updatedAt: d.updatedAt,
    summary: summarizePlan(d),
  }));
}

export function getPlanDetail(id: string) {
  const doc = loadShipPlanDoc(id);
  if (!doc) return null;
  hydrateCargoKinds(doc);
  return {
    doc,
    summary: summarizePlan(doc),
    forwarderRollup: rollupByForwarder(doc),
    cargoGaps: listCargoGaps(doc),
    cargoKindOptions: CARGO_KIND_OPTIONS.map((o) => ({
      value: o.value,
      label: o.label,
    })),
  };
}

export function removePlan(id: string): boolean {
  return deleteShipPlanDoc(id);
}

function findLine(doc: ShipPlanDoc, lineId: string): ShipPlanLine {
  const line = doc.lines.find((l) => l.id === lineId);
  if (!line) throw new Error("行不存在");
  return line;
}

function findLeg(line: ShipPlanLine, legId: string): ShipPlanLeg {
  const leg = line.legs.find((l) => l.id === legId);
  if (!leg) throw new Error("发货腿不存在");
  return leg;
}

export function patchLine(
  planId: string,
  lineId: string,
  patch: {
    include?: boolean;
    note?: string;
    planDate?: string | null;
    productName?: string;
  },
): ShipPlanDoc {
  const doc = loadShipPlanDoc(planId);
  if (!doc) throw new Error("计划不存在");
  const line = findLine(doc, lineId);
  if (patch.include != null) line.include = !!patch.include;
  if (patch.note != null) line.note = String(patch.note);
  if (patch.planDate !== undefined) {
    line.planDate = patch.planDate ? String(patch.planDate).slice(0, 10) : null;
  }
  if (patch.productName != null) line.productName = String(patch.productName);
  line.updatedAt = nowIso();
  doc.updatedAt = nowIso();
  saveShipPlanDoc(doc);
  return doc;
}

export function upsertLeg(
  planId: string,
  lineId: string,
  input: {
    legId?: string;
    forwarder?: string;
    mode?: ShipModeLite;
    qty?: number;
    note?: string;
    cargoKind?: string;
    status?: "cancelled" | "pending";
  },
): { doc: ShipPlanDoc; leg: ShipPlanLeg } {
  const doc = loadShipPlanDoc(planId);
  if (!doc) throw new Error("计划不存在");
  const line = findLine(doc, lineId);
  if (!line.include) throw new Error("该行标记为不补货，请先改为纳入");

  let leg: ShipPlanLeg;
  if (input.legId) {
    leg = findLeg(line, input.legId);
  } else {
    leg = {
      id: `leg-${randomUUID().slice(0, 8)}`,
      forwarder: "",
      mode: input.mode === "sea" ? "sea" : "air",
      qty: 0,
      shippedQty: 0,
      cargoKind: "",
      note: "",
      status: "pending",
      updatedAt: nowIso(),
    };
    line.legs.push(leg);
  }

  if (input.forwarder != null) {
    leg.forwarder = canonicalizeForwarderName(String(input.forwarder).trim());
  }
  if (input.mode === "air" || input.mode === "sea") leg.mode = input.mode;
  if (input.qty != null) {
    const q = Math.max(0, Math.round(Number(input.qty)));
    if (!Number.isFinite(q)) throw new Error("qty 无效");
    leg.qty = q;
    if (leg.shippedQty > leg.qty) leg.shippedQty = leg.qty;
  }
  if (input.note != null) leg.note = String(input.note);
  if (input.status === "cancelled") leg.status = "cancelled";
  if (input.status === "pending" && leg.status === "cancelled") {
    leg.status = "pending";
  }

  if (input.cargoKind != null) {
    const kind = String(input.cargoKind).trim();
    if (!leg.forwarder) throw new Error("请先填写货代再标注货性");
    upsertCargoHint({
      partnerSku: line.partnerSku,
      forwarder: leg.forwarder,
      cargoKind: kind,
    });
    leg.cargoKind = (kind || "") as ManualCargoKind | "";
  } else if (leg.forwarder) {
    const hit = findCargoHint(
      listCargoHints(),
      line.partnerSku,
      leg.forwarder,
    );
    if (hit) leg.cargoKind = hit.cargoKind;
  }

  refreshLegStatus(leg);
  leg.updatedAt = nowIso();
  line.updatedAt = nowIso();
  doc.updatedAt = nowIso();
  saveShipPlanDoc(doc);
  return { doc, leg };
}

/** 登记发出数量（可分多次，支持一次发一部分） */
export function recordShipment(
  planId: string,
  lineId: string,
  legId: string,
  qty: number,
): { doc: ShipPlanDoc; leg: ShipPlanLeg; remaining: number } {
  const doc = loadShipPlanDoc(planId);
  if (!doc) throw new Error("计划不存在");
  const line = findLine(doc, lineId);
  const leg = findLeg(line, legId);
  if (leg.status === "cancelled") throw new Error("该腿已取消");
  if (!leg.forwarder.trim()) throw new Error("请先指定货代");

  const add = Math.round(Number(qty));
  if (!Number.isFinite(add) || add <= 0) throw new Error("发出数量须为正整数");

  const remainingBefore = Math.max(0, leg.qty - leg.shippedQty);
  if (add > remainingBefore) {
    throw new Error(`最多还可发 ${remainingBefore} 件（计划 ${leg.qty}，已发 ${leg.shippedQty}）`);
  }

  leg.shippedQty += add;
  refreshLegStatus(leg);
  leg.updatedAt = nowIso();
  line.updatedAt = nowIso();
  doc.updatedAt = nowIso();
  saveShipPlanDoc(doc);
  return {
    doc,
    leg,
    remaining: Math.max(0, leg.qty - leg.shippedQty),
  };
}

/** 按缺口批量写货性（写入 cargo-hints） */
export function fillCargoGaps(
  planId: string,
  items: Array<{ partnerSku: string; forwarder: string; cargoKind: string }>,
): { updated: number; doc: ShipPlanDoc } {
  const doc = loadShipPlanDoc(planId);
  if (!doc) throw new Error("计划不存在");
  let updated = 0;
  for (const it of items) {
    const sku = String(it.partnerSku ?? "").trim();
    const fwd = canonicalizeForwarderName(String(it.forwarder ?? "").trim());
    const kind = String(it.cargoKind ?? "").trim();
    if (!sku || !fwd || !kind) continue;
    upsertCargoHint({ partnerSku: sku, forwarder: fwd, cargoKind: kind });
    updated++;
    for (const line of doc.lines) {
      if (line.partnerSku !== sku) continue;
      for (const leg of line.legs) {
        if (canonicalizeForwarderName(leg.forwarder) === fwd) {
          leg.cargoKind = kind as ManualCargoKind;
          leg.updatedAt = nowIso();
        }
      }
    }
  }
  doc.updatedAt = nowIso();
  saveShipPlanDoc(doc);
  return { updated, doc };
}

/** 用历史渠道给未填货代的腿做建议（不自动写入） */
export function suggestChannelsForLine(partnerSku: string) {
  try {
    const { skus } = searchSkuChannelHistory(partnerSku);
    const hist =
      skus.find(
        (s) => s.partnerSku.toLowerCase() === partnerSku.trim().toLowerCase(),
      ) ?? skus[0];
    if (!hist) return null;
    return {
      preferred: hist.preferred,
      channels: hist.channels.slice(0, 6).map((c) => ({
        forwarder: c.forwarder,
        mode: c.mode,
        pcs: c.pcs,
        share: c.share,
        cargoKind: c.cargoKind,
      })),
    };
  } catch {
    return null;
  }
}
