/**
 * One-shot: enrich catalog images in OUTPOST_DATA_DIR state.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { enrichCatalogImages } from "../src/modules/catalog/enrich-images.js";
import type { AppState } from "../src/common/types.js";

process.env.OUTPOST_NOON_CREDENTIALS_FILE =
  process.env.OUTPOST_NOON_CREDENTIALS_FILE ||
  "D:\\noon_credentials_sensitive.json";
process.env.OUTPOST_DATA_DIR =
  process.env.OUTPOST_DATA_DIR || "D:\\outpost-data\\json";

async function main() {
  const statePath = resolve(process.env.OUTPOST_DATA_DIR!, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as AppState;
  console.log("catalog", state.catalog?.length ?? 0);
  const result = await enrichCatalogImages(state, {
    onlyMissing: true,
    concurrency: 8,
  });
  // enrichCatalogImages already saveState via store paths; also write this file
  // in case DATA_DIR differs from process cwd resolution
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  console.log(result);
  const withImage = state.catalog.filter((c) => c.imageUrl).length;
  console.log("withImage", withImage);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
