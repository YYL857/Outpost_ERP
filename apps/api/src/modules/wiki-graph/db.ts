/**
 * sql.js 持久化封装：内存库 + 写后落盘 outpost.sqlite
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { wikiGraphDbPath, wikiGraphDir } from "./paths.js";
import { applySchema } from "./schema.js";

const require = createRequire(import.meta.url);

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let dirty = false;

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  const wasmPath = join(
    dirname(require.resolve("sql.js")),
    "sql-wasm.wasm",
  );
  SQL = await initSqlJs({ locateFile: () => wasmPath });
  return SQL;
}

export async function getWikiDb(): Promise<Database> {
  if (db) return db;
  wikiGraphDir();
  const engine = await loadSqlJs();
  const path = wikiGraphDbPath();
  if (existsSync(path)) {
    db = new engine.Database(new Uint8Array(readFileSync(path)));
  } else {
    db = new engine.Database();
  }
  applySchema(db);
  dirty = false;
  return db;
}

export function markWikiDbDirty(): void {
  dirty = true;
}

export function persistWikiDb(): void {
  if (!db || !dirty) return;
  const path = wikiGraphDbPath();
  writeFileSync(path, Buffer.from(db.export()));
  dirty = false;
}

/** 测试 / 重建前关闭句柄 */
export function closeWikiDb(): void {
  if (db && dirty) {
    writeFileSync(wikiGraphDbPath(), Buffer.from(db.export()));
    dirty = false;
  }
  db?.close();
  db = null;
}

export function getMeta(database: Database, key: string): string | null {
  const stmt = database.prepare("SELECT value FROM meta WHERE key = ?");
  stmt.bind([key]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject() as { value?: string };
  stmt.free();
  return row.value ?? null;
}

export function setMeta(database: Database, key: string, value: string): void {
  database.run(
    "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
    [key, value],
  );
  markWikiDbDirty();
}
