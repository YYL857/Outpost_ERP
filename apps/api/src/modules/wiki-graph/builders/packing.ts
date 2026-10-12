/**
 * 装箱表 → wiki-graph：箱表 + 装箱明细
 * 只读最新 packing raw 快照；不改飞书 normalize。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Database } from "sql.js";
import { getFeishuRawDir } from "../../../platforms/feishu/config.js";
import {
  extractPackingBoxRows,
  type PackingBoxRow,
} from "../../../platforms/feishu/normalize/forwarder-board.js";
import {
  extractPackingLines,
  type PackingLineRow,
} from "../../../platforms/feishu/normalize/packing-lines.js";
import {
  edgeId,
  nodeId,
  purgeSource,
  upsertEdge,
  upsertLookup,
  upsertNode,
} from "../upsert.js";

export const PACKING_SOURCE = "feishu:packing";

function rawDirCandidates(): string[] {
  const primary = getFeishuRawDir();
  const shared = resolve(
    process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data",
    "feishu-raw",
  );
  const fromShop = resolve(primary, "..", "..", "..", "feishu-raw");
  return [...new Set([primary, shared, fromShop])];
}

function latestPackingSnapshotPath(): string | null {
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

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function boxSummary(b: PackingBoxRow): string {
  const parts = [
    b.boxNo,
    b.forwarder && b.forwarder !== "(未填货代)" ? b.forwarder : null,
    b.modeRaw || b.mode,
    b.warehouseStatus || null,
    b.pcs > 0 ? `${b.pcs}pcs` : null,
    b.ticketNo ? `票${b.ticketNo}` : null,
    b.logisticsNo ? `物流${b.logisticsNo}` : null,
  ].filter(Boolean);
  return clip(parts.join(" · "), 120);
}

export type PackingBuildResult = {
  snapshotPath: string | null;
  nodes: number;
  edges: number;
  lookups: number;
};

export function buildPackingIntoDb(db: Database): PackingBuildResult {
  const now = new Date().toISOString();
  const snapshotPath = latestPackingSnapshotPath();
  purgeSource(db, PACKING_SOURCE);

  if (!snapshotPath) {
    return { snapshotPath: null, nodes: 0, edges: 0, lookups: 0 };
  }

  const snap = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
    sheets?: Array<{ title?: string; values?: unknown[][] }>;
  };
  const boxSheet = snap.sheets?.find((s) => s.title === "箱表");
  const lineSheet = snap.sheets?.find((s) => s.title === "装箱明细");
  const boxes: PackingBoxRow[] = extractPackingBoxRows(boxSheet?.values ?? []);
  const lines: PackingLineRow[] = extractPackingLines(lineSheet?.values ?? []);

  let nodes = 0;
  let edges = 0;
  let lookups = 0;

  const sheetBoxId = nodeId("doc_sheet", "packing/箱表");
  const sheetLineId = nodeId("doc_sheet", "packing/装箱明细");
  upsertNode(db, {
    id: sheetBoxId,
    type: "doc_sheet",
    label: "装箱表·箱表",
    summary: `飞书装箱「箱表」· ${boxes.length} 箱 · 源 ${snapshotPath}`,
    source: PACKING_SOURCE,
    sourceRef: snapshotPath,
    shopId: null,
    payload: { sheet: "箱表", boxRows: boxes.length },
    updatedAt: now,
  });
  nodes += 1;
  upsertNode(db, {
    id: sheetLineId,
    type: "doc_sheet",
    label: "装箱表·装箱明细",
    summary: `飞书装箱「装箱明细」· ${lines.length} 行`,
    source: PACKING_SOURCE,
    sourceRef: snapshotPath,
    shopId: null,
    payload: { sheet: "装箱明细", lineRows: lines.length },
    updatedAt: now,
  });
  nodes += 1;

  for (const b of boxes) {
    if (!b.boxNo.trim()) continue;
    const bid = nodeId("box", b.boxNo);
    upsertNode(db, {
      id: bid,
      type: "box",
      label: b.boxNo,
      summary: boxSummary(b),
      source: PACKING_SOURCE,
      sourceRef: snapshotPath,
      shopId: null,
      payload: {
        boxNo: b.boxNo,
        ticketNo: b.ticketNo,
        logisticsNo: b.logisticsNo,
        forwarder: b.forwarder,
        mode: b.mode,
        modeRaw: b.modeRaw,
        pcs: b.pcs,
        asn: b.asn,
        warehouseStatus: b.warehouseStatus,
        shipAt: b.shipAt,
        arriveAt: b.arriveAt,
      },
      updatedAt: now,
    });
    nodes += 1;
    upsertLookup(db, "boxNo", b.boxNo, bid);
    lookups += 1;

    upsertEdge(db, {
      id: edgeId(bid, "from_sheet", sheetBoxId),
      fromId: bid,
      toId: sheetBoxId,
      rel: "from_sheet",
      evidence: null,
      updatedAt: now,
    });
    edges += 1;

    if (b.ticketNo.trim()) {
      const tid = nodeId("ticket", b.ticketNo);
      upsertNode(db, {
        id: tid,
        type: "ticket",
        label: b.ticketNo,
        summary: clip(`票号 ${b.ticketNo} · 货代 ${b.forwarder}`, 120),
        source: PACKING_SOURCE,
        sourceRef: snapshotPath,
        shopId: null,
        payload: { ticketNo: b.ticketNo, forwarder: b.forwarder },
        updatedAt: now,
      });
      nodes += 1;
      upsertLookup(db, "ticketNo", b.ticketNo, tid);
      lookups += 1;
      upsertEdge(db, {
        id: edgeId(bid, "has_ticket", tid),
        fromId: bid,
        toId: tid,
        rel: "has_ticket",
        evidence: null,
        updatedAt: now,
      });
      edges += 1;
    }

    if (b.logisticsNo.trim()) {
      const lid = nodeId("logistics", b.logisticsNo);
      upsertNode(db, {
        id: lid,
        type: "logistics",
        label: b.logisticsNo,
        summary: clip(`物流编号 ${b.logisticsNo} · ${b.forwarder}`, 120),
        source: PACKING_SOURCE,
        sourceRef: snapshotPath,
        shopId: null,
        payload: { logisticsNo: b.logisticsNo, forwarder: b.forwarder },
        updatedAt: now,
      });
      nodes += 1;
      upsertLookup(db, "logisticsNo", b.logisticsNo, lid);
      lookups += 1;
      upsertEdge(db, {
        id: edgeId(bid, "tracked_by", lid),
        fromId: bid,
        toId: lid,
        rel: "tracked_by",
        evidence: null,
        updatedAt: now,
      });
      edges += 1;
    }

    if (b.forwarder.trim() && b.forwarder !== "(未填货代)") {
      const fid = nodeId("forwarder", b.forwarder);
      upsertNode(db, {
        id: fid,
        type: "forwarder",
        label: b.forwarder,
        summary: clip(`货代 ${b.forwarder}`, 120),
        source: PACKING_SOURCE,
        sourceRef: snapshotPath,
        shopId: null,
        payload: { forwarder: b.forwarder },
        updatedAt: now,
      });
      nodes += 1;
      upsertLookup(db, "forwarder", b.forwarder, fid);
      lookups += 1;
      upsertEdge(db, {
        id: edgeId(bid, "shipped_via", fid),
        fromId: bid,
        toId: fid,
        rel: "shipped_via",
        evidence: null,
        updatedAt: now,
      });
      edges += 1;
    }
  }

  const knownBoxes = new Set(
    boxes.map((b) => b.boxNo.trim()).filter(Boolean),
  );

  for (const line of lines) {
    if (!line.boxNo.trim() || !line.partnerSku.trim()) continue;
    const bid = nodeId("box", line.boxNo);
    const sid = nodeId("sku", line.partnerSku);

    // 箱只出现在明细时补最小节点；已有箱表节点则不覆盖
    if (!knownBoxes.has(line.boxNo.trim())) {
      upsertNode(db, {
        id: bid,
        type: "box",
        label: line.boxNo,
        summary: clip(`箱 ${line.boxNo}（明细）`, 120),
        source: PACKING_SOURCE,
        sourceRef: snapshotPath,
        shopId: null,
        payload: { boxNo: line.boxNo, from: "装箱明细" },
        updatedAt: now,
      });
      nodes += 1;
      upsertLookup(db, "boxNo", line.boxNo, bid);
      lookups += 1;
      knownBoxes.add(line.boxNo.trim());
    }

    upsertNode(db, {
      id: sid,
      type: "sku",
      label: line.partnerSku,
      summary: clip(
        [
          line.partnerSku,
          line.name || null,
          line.qty > 0 ? `×${line.qty}` : null,
          line.boxNo ? `箱${line.boxNo}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        120,
      ),
      source: PACKING_SOURCE,
      sourceRef: snapshotPath,
      shopId: null,
      payload: {
        partnerSku: line.partnerSku,
        name: line.name,
        qty: line.qty,
        boxNo: line.boxNo,
        logisticsNo: line.logisticsNo,
        mode: line.mode,
      },
      updatedAt: now,
    });
    nodes += 1;
    upsertLookup(db, "partnerSku", line.partnerSku, sid);
    lookups += 1;

    upsertEdge(db, {
      id: edgeId(sid, "in_box", bid),
      fromId: sid,
      toId: bid,
      rel: "in_box",
      evidence: `qty=${line.qty}`,
      updatedAt: now,
    });
    edges += 1;

    upsertEdge(db, {
      id: edgeId(sid, "from_sheet", sheetLineId),
      fromId: sid,
      toId: sheetLineId,
      rel: "from_sheet",
      evidence: null,
      updatedAt: now,
    });
    edges += 1;

    if (line.logisticsNo.trim()) {
      const lid = nodeId("logistics", line.logisticsNo);
      upsertNode(db, {
        id: lid,
        type: "logistics",
        label: line.logisticsNo,
        summary: clip(`物流编号 ${line.logisticsNo}`, 120),
        source: PACKING_SOURCE,
        sourceRef: snapshotPath,
        shopId: null,
        payload: { logisticsNo: line.logisticsNo },
        updatedAt: now,
      });
      nodes += 1;
      upsertLookup(db, "logisticsNo", line.logisticsNo, lid);
      lookups += 1;
      upsertEdge(db, {
        id: edgeId(bid, "tracked_by", lid),
        fromId: bid,
        toId: lid,
        rel: "tracked_by",
        evidence: "from_line",
        updatedAt: now,
      });
      edges += 1;
    }
  }

  return { snapshotPath, nodes, edges, lookups };
}
