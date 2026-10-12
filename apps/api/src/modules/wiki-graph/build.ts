import type { Database } from "sql.js";
import { getMeta, getWikiDb, persistWikiDb, setMeta } from "./db.js";
import { buildAccountsPurchaseIntoDb } from "./builders/accounts.js";
import { buildFreightRatesIntoDb } from "./builders/freight-rates.js";
import { buildPackingIntoDb } from "./builders/packing.js";
import { buildSchemaMapIntoDb } from "./builders/schema-map.js";
import { wikiGraphDbPath } from "./paths.js";
import type { BuildReport, WikiGraphStats } from "./types.js";

export type WikiBuildSource =
  | "schema"
  | "packing"
  | "accounts"
  | "freight";

const ALL_SOURCES: WikiBuildSource[] = [
  "schema",
  "packing",
  "accounts",
  "freight",
];

export async function rebuildWikiGraph(opts?: {
  sources?: WikiBuildSource[];
}): Promise<BuildReport> {
  const started = Date.now();
  const sources = opts?.sources?.length ? opts.sources : ALL_SOURCES;
  try {
    const db = await getWikiDb();
    let nodesUpserted = 0;
    let edgesUpserted = 0;
    let lookupsUpserted = 0;
    let snapshotPath: string | null = null;
    const done: string[] = [];

    // 顺序：schema → packing → accounts → freight（共享节点后写合并）
    for (const src of ALL_SOURCES) {
      if (!sources.includes(src)) continue;
      if (src === "schema") {
        const r = buildSchemaMapIntoDb(db);
        nodesUpserted += r.nodes;
        edgesUpserted += r.edges;
        done.push("schema");
      } else if (src === "packing") {
        const r = buildPackingIntoDb(db);
        nodesUpserted += r.nodes;
        edgesUpserted += r.edges;
        lookupsUpserted += r.lookups;
        snapshotPath = r.snapshotPath;
        done.push("packing");
      } else if (src === "accounts") {
        const r = buildAccountsPurchaseIntoDb(db);
        nodesUpserted += r.nodes;
        edgesUpserted += r.edges;
        lookupsUpserted += r.lookups;
        if (r.snapshotPath) snapshotPath = snapshotPath ?? r.snapshotPath;
        done.push("accounts");
      } else if (src === "freight") {
        const r = buildFreightRatesIntoDb(db);
        nodesUpserted += r.nodes;
        edgesUpserted += r.edges;
        lookupsUpserted += r.lookups;
        if (r.snapshotPath) snapshotPath = snapshotPath ?? r.snapshotPath;
        done.push("freight");
      }
    }

    const now = new Date().toISOString();
    setMeta(db, "last_build_at", now);
    setMeta(db, "last_build_sources", JSON.stringify(done));
    if (snapshotPath) setMeta(db, "last_packing_snapshot", snapshotPath);
    persistWikiDb();

    return {
      ok: true,
      sources: done,
      nodesUpserted,
      edgesUpserted,
      lookupsUpserted,
      snapshotPath,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      sources: [],
      nodesUpserted: 0,
      edgesUpserted: 0,
      lookupsUpserted: 0,
      snapshotPath: null,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function countTable(db: Database, table: string): number {
  const stmt = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`);
  stmt.step();
  const row = stmt.getAsObject() as { c?: number };
  stmt.free();
  return Number(row.c ?? 0);
}

export async function wikiGraphStats(): Promise<WikiGraphStats> {
  const db = await getWikiDb();
  const lastBuildAt = getMeta(db, "last_build_at");
  let lastBuildSources: string[] = [];
  try {
    lastBuildSources = JSON.parse(
      getMeta(db, "last_build_sources") ?? "[]",
    ) as string[];
  } catch {
    lastBuildSources = [];
  }
  return {
    dbPath: wikiGraphDbPath(),
    nodes: countTable(db, "nodes"),
    edges: countTable(db, "edges"),
    lookups: countTable(db, "lookup"),
    lastBuildAt,
    lastBuildSources,
  };
}
