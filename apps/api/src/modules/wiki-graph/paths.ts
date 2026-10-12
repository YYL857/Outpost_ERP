import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { OUTPOST_ROOT } from "../../shops/registry.js";

/** 图库根目录：OUTPOST_WIKI_GRAPH_DIR 或 {OUTPOST_ROOT}/wiki-graph */
export function wikiGraphDir(): string {
  const override = process.env.OUTPOST_WIKI_GRAPH_DIR?.trim();
  const dir = override
    ? resolve(override)
    : join(OUTPOST_ROOT, "wiki-graph");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function wikiGraphDbPath(): string {
  return join(wikiGraphDir(), "outpost.sqlite");
}
