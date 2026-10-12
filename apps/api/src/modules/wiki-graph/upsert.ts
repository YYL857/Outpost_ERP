import type { Database } from "sql.js";
import { markWikiDbDirty } from "./db.js";
import type { WikiEdge, WikiKeyType, WikiNode, WikiNodeType, WikiRel } from "./types.js";

export function nodeId(type: WikiNodeType, key: string): string {
  return `${type}:${key.trim()}`;
}

export function edgeId(fromId: string, rel: WikiRel, toId: string): string {
  return `${fromId}|${rel}|${toId}`;
}

export function upsertNode(db: Database, node: WikiNode): void {
  db.run(
    `INSERT INTO nodes(id, type, label, summary, source, source_ref, shop_id, payload_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type,
       label=excluded.label,
       summary=excluded.summary,
       source=excluded.source,
       source_ref=excluded.source_ref,
       shop_id=excluded.shop_id,
       payload_json=excluded.payload_json,
       updated_at=excluded.updated_at`,
    [
      node.id,
      node.type,
      node.label,
      node.summary.slice(0, 200),
      node.source,
      node.sourceRef,
      node.shopId,
      JSON.stringify(node.payload ?? {}),
      node.updatedAt,
    ],
  );
  markWikiDbDirty();
}

/** 节点已存在则只合并 payload，不覆盖 summary/source（共享枢纽用） */
export function upsertNodeKeepIfExists(
  db: Database,
  node: WikiNode,
): "inserted" | "merged" {
  const stmt = db.prepare(`SELECT payload_json FROM nodes WHERE id = ?`);
  stmt.bind([node.id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as { payload_json?: string };
    stmt.free();
    let prev: Record<string, unknown> = {};
    try {
      prev = JSON.parse(String(row.payload_json ?? "{}")) as Record<
        string,
        unknown
      >;
    } catch {
      prev = {};
    }
    const merged = { ...prev, ...node.payload };
    db.run(`UPDATE nodes SET payload_json = ?, updated_at = ? WHERE id = ?`, [
      JSON.stringify(merged),
      node.updatedAt,
      node.id,
    ]);
    markWikiDbDirty();
    return "merged";
  }
  stmt.free();
  upsertNode(db, node);
  return "inserted";
}

export function upsertEdge(db: Database, edge: WikiEdge): void {
  db.run(
    `INSERT INTO edges(id, from_id, to_id, rel, evidence, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       evidence=excluded.evidence,
       updated_at=excluded.updated_at`,
    [
      edge.id,
      edge.fromId,
      edge.toId,
      edge.rel,
      edge.evidence,
      edge.updatedAt,
    ],
  );
  markWikiDbDirty();
}

export function upsertLookup(
  db: Database,
  keyType: WikiKeyType,
  keyValue: string,
  nodeIdValue: string,
): void {
  const v = keyValue.trim();
  if (!v) return;
  db.run(
    `INSERT INTO lookup(key_type, key_value, node_id)
     VALUES (?, ?, ?)
     ON CONFLICT(key_type, key_value) DO UPDATE SET node_id=excluded.node_id`,
    [keyType, v, nodeIdValue],
  );
  markWikiDbDirty();
}

/** 清掉某 source 下的节点及其边、lookup */
export function purgeSource(db: Database, source: string): void {
  db.run(
    `DELETE FROM lookup WHERE node_id IN (SELECT id FROM nodes WHERE source = ?)`,
    [source],
  );
  db.run(
    `DELETE FROM edges WHERE from_id IN (SELECT id FROM nodes WHERE source = ?)
       OR to_id IN (SELECT id FROM nodes WHERE source = ?)`,
    [source, source],
  );
  db.run(`DELETE FROM nodes WHERE source = ?`, [source]);
  markWikiDbDirty();
}

/** 只清指定 type + source（共享 sku/forwarder 不要整源 purge） */
export function purgeSourceTypes(
  db: Database,
  source: string,
  types: WikiNodeType[],
): void {
  if (!types.length) return;
  const placeholders = types.map(() => "?").join(",");
  const params: Array<string> = [source, ...types];
  db.run(
    `DELETE FROM lookup WHERE node_id IN (
       SELECT id FROM nodes WHERE source = ? AND type IN (${placeholders})
     )`,
    params,
  );
  db.run(
    `DELETE FROM edges WHERE from_id IN (
       SELECT id FROM nodes WHERE source = ? AND type IN (${placeholders})
     ) OR to_id IN (
       SELECT id FROM nodes WHERE source = ? AND type IN (${placeholders})
     )`,
    [...params, ...params],
  );
  db.run(
    `DELETE FROM nodes WHERE source = ? AND type IN (${placeholders})`,
    params,
  );
  markWikiDbDirty();
}

export function rowToNode(row: Record<string, unknown>): WikiNode {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(String(row.payload_json ?? "{}")) as Record<
      string,
      unknown
    >;
  } catch {
    payload = {};
  }
  return {
    id: String(row.id),
    type: String(row.type) as WikiNodeType,
    label: String(row.label ?? ""),
    summary: String(row.summary ?? ""),
    source: String(row.source ?? ""),
    sourceRef: row.source_ref != null ? String(row.source_ref) : null,
    shopId: row.shop_id != null ? String(row.shop_id) : null,
    payload,
    updatedAt: String(row.updated_at ?? ""),
  };
}
