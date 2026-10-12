import type { Database } from "sql.js";
import { getWikiDb } from "./db.js";
import { rowToNode } from "./upsert.js";
import type { WikiKeyType, WikiLookupHit, WikiNode } from "./types.js";

export async function lookupByKey(
  keyType: WikiKeyType,
  keyValue: string,
): Promise<WikiLookupHit | null> {
  const db = await getWikiDb();
  return lookupByKeyOn(db, keyType, keyValue);
}

export function lookupByKeyOn(
  db: Database,
  keyType: WikiKeyType,
  keyValue: string,
): WikiLookupHit | null {
  const v = keyValue.trim();
  if (!v) return null;
  const stmt = db.prepare(
    `SELECT n.* FROM lookup l
     JOIN nodes n ON n.id = l.node_id
     WHERE l.key_type = ? AND l.key_value = ?`,
  );
  stmt.bind([keyType, v]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return {
    keyType,
    keyValue: v,
    node: rowToNode(row),
  };
}

export function getNodeById(db: Database, id: string): WikiNode | null {
  const stmt = db.prepare(`SELECT * FROM nodes WHERE id = ?`);
  stmt.bind([id]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return rowToNode(row);
}
