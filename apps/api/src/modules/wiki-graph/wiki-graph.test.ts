/**
 * wiki-graph smoke + preload 体积断言
 * npx tsx src/modules/wiki-graph/wiki-graph.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAgentPreloadCard,
  estimateTokens,
} from "./agent-preload.js";
import { closeWikiDb, getWikiDb } from "./db.js";
import { rebuildWikiGraph, wikiGraphStats } from "./build.js";
import { buildContextPack, listNodesByType } from "./context-pack.js";
import { OUTPOST_SCHEMA_MAP, schemaMapToMarkdown } from "./schema-catalog.js";
import { wikiGraphDir } from "./paths.js";

async function main() {
  const preload = buildAgentPreloadCard();
  const fullMd = schemaMapToMarkdown(OUTPOST_SCHEMA_MAP);
  console.log("[wiki-graph] preload chars", preload.charCount, "~tokens", estimateTokens(preload.charCount));
  console.log("[wiki-graph] full schema-map md chars", fullMd.length);
  assert.ok(preload.charCount > 500, "preload not empty");
  assert.ok(
    preload.charCount < fullMd.length * 0.7,
    "preload should be leaner than full schema md",
  );
  assert.ok(
    preload.charCount < 6000,
    `preload should stay under ~6k chars, got ${preload.charCount}`,
  );
  assert.ok(estimateTokens(preload.charCount) < 2500, "approx tokens budget");

  const report = await rebuildWikiGraph();
  console.log("[wiki-graph] rebuild", report);
  assert.equal(report.ok, true);

  const dir = wikiGraphDir();
  assert.ok(existsSync(join(dir, "agent-preload.md")));
  assert.ok(existsSync(join(dir, "agent-preload.json")));
  assert.ok(existsSync(join(dir, "schema-map.md")));
  const diskPreload = readFileSync(join(dir, "agent-preload.md"), "utf8");
  assert.ok(diskPreload.includes("## Joins"));

  const stats = await wikiGraphStats();
  console.log("[wiki-graph] stats", stats);

  const db = await getWikiDb();
  const boxes = listNodesByType(db, "box", 1);
  if (boxes.length) {
    const boxNo = String(boxes[0]!.payload.boxNo ?? boxes[0]!.label);
    const pack = await buildContextPack({
      keyType: "boxNo",
      keyValue: boxNo,
      hops: 2,
    });
    assert.ok(pack);
    console.log("[wiki-graph] pack entities", pack!.entities.length);
  }

  closeWikiDb();
  console.log("[wiki-graph] preload+rebuild smoke ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
