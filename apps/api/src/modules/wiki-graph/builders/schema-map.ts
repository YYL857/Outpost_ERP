/**
 * 把 Schema Map 写入 sqlite（table 节点 + joins_on 边）并落盘 JSON/MD，供 Agent 直读。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "sql.js";
import { buildAgentPreloadCard } from "../agent-preload.js";
import { wikiGraphDir } from "../paths.js";
import {
  OUTPOST_SCHEMA_MAP,
  schemaMapToMarkdown,
  type SchemaMap,
} from "../schema-catalog.js";
import {
  edgeId,
  nodeId,
  purgeSource,
  upsertEdge,
  upsertNode,
} from "../upsert.js";

export const SCHEMA_SOURCE = "wiki:schema-map";

export type SchemaBuildResult = {
  nodes: number;
  edges: number;
  lookups: number;
  jsonPath: string;
  mdPath: string;
  preloadJsonPath: string;
  preloadMdPath: string;
  preloadChars: number;
};

export function buildSchemaMapIntoDb(
  db: Database,
  map: SchemaMap = OUTPOST_SCHEMA_MAP,
): SchemaBuildResult {
  const now = new Date().toISOString();
  purgeSource(db, SCHEMA_SOURCE);

  let nodes = 0;
  let edges = 0;

  for (const t of map.tables) {
    const id = nodeId("table", t.id);
    const fieldNames = t.fields.map((f) => f.name).join("、");
    upsertNode(db, {
      id,
      type: "table",
      label: t.label,
      summary: `${t.label}：${t.purpose}｜焦点 ${t.agentFocus.join("/")}｜字段 ${fieldNames}`.slice(
        0,
        200,
      ),
      source: SCHEMA_SOURCE,
      sourceRef: t.source,
      shopId: null,
      payload: {
        tableId: t.id,
        kind: t.kind,
        purpose: t.purpose,
        agentFocus: t.agentFocus,
        fields: t.fields,
      },
      updatedAt: now,
    });
    nodes += 1;
  }

  for (const j of map.joins) {
    const fromId = nodeId("table", j.fromTable);
    const toId = nodeId("table", j.toTable);
    upsertEdge(db, {
      id: edgeId(fromId, "joins_on", toId) + `|${j.fromField}->${j.toField}`,
      fromId,
      toId,
      rel: "joins_on",
      evidence: `${j.fromField}→${j.toField}: ${j.yields}`,
      updatedAt: now,
    });
    edges += 1;
  }

  const dir = wikiGraphDir();
  const jsonPath = join(dir, "schema-map.json");
  const mdPath = join(dir, "schema-map.md");
  writeFileSync(jsonPath, JSON.stringify(map, null, 2), "utf8");
  writeFileSync(mdPath, schemaMapToMarkdown(map), "utf8");

  const preload = buildAgentPreloadCard(map);
  const preloadJsonPath = join(dir, "agent-preload.json");
  const preloadMdPath = join(dir, "agent-preload.md");
  writeFileSync(preloadJsonPath, JSON.stringify(preload, null, 2), "utf8");
  writeFileSync(preloadMdPath, preload.markdown, "utf8");

  return {
    nodes,
    edges,
    lookups: 0,
    jsonPath,
    mdPath,
    preloadJsonPath,
    preloadMdPath,
    preloadChars: preload.charCount,
  };
}

export function loadSchemaMapFile(): SchemaMap {
  return OUTPOST_SCHEMA_MAP;
}
