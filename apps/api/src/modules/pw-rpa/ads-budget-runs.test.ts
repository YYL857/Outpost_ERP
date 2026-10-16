/**
 * tsx src/modules/pw-rpa/ads-budget-runs.test.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listAdsBudgetRuns } from "./ads-budget-runs.js";

const root = mkdtempSync(join(tmpdir(), "ads-budget-runs-"));
const prev = process.env.OUTPOST_DATA_ROOT;
process.env.OUTPOST_DATA_ROOT = root;

try {
  const dir = join(root, "pw-rpa");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "ads-budget-runs.jsonl");
  writeFileSync(
    p,
    [
      JSON.stringify({
        finishedAtCst: "2026-10-15 00:10:53 CST",
        ok: true,
        cmd: "apply",
        mode: "peak",
        shops: ["PRJ488078"],
        trigger: "schedule:peak",
        applyOk: 2,
        applyFailed: 0,
      }),
      JSON.stringify({
        finishedAtCst: "2026-10-15 09:10:47 CST",
        ok: false,
        cmd: "apply",
        mode: "offpeak",
        shops: ["PRJ488078"],
        trigger: "schedule:offpeak",
        error: "login",
      }),
      JSON.stringify({
        finishedAtCst: "2026-10-14 18:00:00 CST",
        ok: true,
        cmd: "sync",
        mode: "peak",
        shops: ["PRJ396770"],
        trigger: "manual",
      }),
      "",
    ].join("\n"),
    "utf8",
  );

  const all = listAdsBudgetRuns({ limit: 10 });
  assert.equal(all.total, 3);
  // 倒序：最后写入的 sync 在前
  assert.equal(all.items[0]?.cmd, "sync");
  assert.equal(all.items[1]?.mode, "offpeak");
  assert.equal(all.items[1]?.ok, false);
  assert.equal(all.items[2]?.mode, "peak");
  assert.equal(all.items[2]?.ok, true);

  const filtered = listAdsBudgetRuns({ shopId: "PRJ488078", limit: 10 });
  assert.equal(filtered.total, 2);
  assert.ok(filtered.items.every((r) => r.shops?.includes("PRJ488078")));
  assert.equal(filtered.items[0]?.mode, "offpeak");

  const limited = listAdsBudgetRuns({ limit: 1 });
  assert.equal(limited.items.length, 1);
  assert.equal(limited.total, 3);

  console.log("ads-budget-runs ok");
} finally {
  if (prev === undefined) delete process.env.OUTPOST_DATA_ROOT;
  else process.env.OUTPOST_DATA_ROOT = prev;
  rmSync(root, { recursive: true, force: true });
}
