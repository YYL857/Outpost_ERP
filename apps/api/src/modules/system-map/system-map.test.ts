/**
 * system-map：preload 体积 + index.ts API 挂载漂移
 * npx tsx src/modules/system-map/system-map.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredApiPaths } from "./catalog.js";
import { persistSystemMap } from "./persist.js";
import {
  buildSystemMapMarkdown,
  buildSystemPreload,
  estimateTokens,
} from "./render.js";

function mountsInIndex(source: string): string[] {
  const found = new Set<string>();
  const re = /app\.use\(\s*"(\/api\/[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) found.add(m[1]!);
  return [...found].sort();
}

function main() {
  const preload = buildSystemPreload();
  const full = buildSystemMapMarkdown();
  console.log(
    "[system-map] preload chars",
    preload.charCount,
    "~tokens",
    estimateTokens(preload.charCount),
  );
  console.log("[system-map] full md chars", full.length);
  assert.ok(preload.charCount > 800, "preload not empty");
  assert.ok(preload.charCount < 6500, `preload over budget: ${preload.charCount}`);
  assert.ok(estimateTokens(preload.charCount) < 2800, "token budget");
  assert.ok(full.length > preload.charCount, "L1 longer than L0");
  assert.ok(preload.markdown.includes("## Domains"));
  assert.ok(preload.markdown.includes("/api/wiki-graph"));
  assert.ok(full.includes("## API mounts"));
  assert.ok(full.includes("OUTPOST_DATA_DIR"));

  const indexPath = join(dirname(fileURLToPath(import.meta.url)), "../../index.ts");
  const indexSrc = readFileSync(indexPath, "utf8");
  const mounted = mountsInIndex(indexSrc);
  const declared = new Set(declaredApiPaths());
  const missing = mounted.filter((p) => !declared.has(p));
  console.log("[system-map] mounted", mounted.length, "declared", declared.size);
  assert.deepEqual(missing, [], `index.ts mounts missing from catalog: ${missing.join(", ")}`);

  const written = persistSystemMap();
  const skill = readFileSync(written.skillMd, "utf8");
  assert.equal(skill, preload.markdown);
  console.log("[system-map] persisted", written.diskMd);
  console.log("[system-map] ok");
}

main();
