/**
 * 货代大纲 → forwarder 节点摘要（报价中值），供 forwarder 键跳转
 */
import type { Database } from "sql.js";
import { buildFreightRatesPayload } from "../../../platforms/feishu/normalize/freight-rates.js";
import { markWikiDbDirty } from "../db.js";
import {
  edgeId,
  nodeId,
  purgeSourceTypes,
  upsertEdge,
  upsertLookup,
  upsertNode,
  upsertNodeKeepIfExists,
} from "../upsert.js";

export const FREIGHT_SOURCE = "feishu:freight-rates";


export type FreightBuildResult = {
  snapshotPath: string | null;
  nodes: number;
  edges: number;
  lookups: number;
};

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

export function buildFreightRatesIntoDb(db: Database): FreightBuildResult {
  const now = new Date().toISOString();
  purgeSourceTypes(db, FREIGHT_SOURCE, ["doc_sheet"]);

  const payload = buildFreightRatesPayload();
  const snapshotPath = payload.source.snapshotPath;
  let nodes = 0;
  let edges = 0;
  let lookups = 0;

  const sheetId = nodeId("doc_sheet", "freight-rates");
  upsertNode(db, {
    id: sheetId,
    type: "doc_sheet",
    label: "货代大纲",
    summary: clip(
      `货代大纲 · ${payload.byForwarder.length} 家 · ${snapshotPath ?? "无快照"}`,
      120,
    ),
    source: FREIGHT_SOURCE,
    sourceRef: snapshotPath,
    shopId: null,
    payload: { rowCount: payload.source.rowCount },
    updatedAt: now,
  });
  nodes += 1;

  for (const q of payload.byForwarder) {
    if (!q.forwarder.trim()) continue;
    const fid = nodeId("forwarder", q.forwarder);
    const summary = clip(
      [
        q.forwarder,
        q.generalAirMid != null ? `空运~${q.generalAirMid}` : null,
        q.generalSeaMid != null ? `海运~${q.generalSeaMid}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      120,
    );
    const result = upsertNodeKeepIfExists(db, {
      id: fid,
      type: "forwarder",
      label: q.forwarder,
      summary,
      source: FREIGHT_SOURCE,
      sourceRef: snapshotPath,
      shopId: null,
      payload: {
        forwarder: q.forwarder,
        generalAirMid: q.generalAirMid,
        generalSeaMid: q.generalSeaMid,
        batteryAirMid: q.batteryAirMid,
        batterySeaMid: q.batterySeaMid,
        extra: q.extra,
        fromFreightRates: true,
      },
      updatedAt: now,
    });
    if (result === "inserted") {
      // keep summary as quote-rich
    } else {
      // 已有装箱货代节点：补报价摘要
      db.run(`UPDATE nodes SET summary = ?, updated_at = ? WHERE id = ?`, [
        summary,
        now,
        fid,
      ]);
      markWikiDbDirty();
    }
    nodes += 1;
    upsertLookup(db, "forwarder", q.forwarder, fid);
    lookups += 1;
    upsertEdge(db, {
      id: edgeId(fid, "quoted_by", sheetId),
      fromId: fid,
      toId: sheetId,
      rel: "quoted_by",
      evidence: null,
      updatedAt: now,
    });
    edges += 1;
  }

  return { snapshotPath, nodes, edges, lookups };
}

