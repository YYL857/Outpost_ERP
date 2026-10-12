import type { Database } from "sql.js";

const DDL = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  summary TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  shop_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  rel TEXT NOT NULL,
  evidence TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lookup (
  key_type TEXT NOT NULL,
  key_value TEXT NOT NULL,
  node_id TEXT NOT NULL,
  PRIMARY KEY (key_type, key_value)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_source ON nodes(source);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_lookup_node ON lookup(node_id);
`;

export function applySchema(db: Database): void {
  db.run(DDL);
}
