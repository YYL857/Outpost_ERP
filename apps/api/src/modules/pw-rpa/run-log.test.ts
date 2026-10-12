import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertRunLog, listRunLogs, getRunLog } from "./run-log.js";
import type { PwJobRun } from "./cli.js";

const dir = mkdtempSync(join(tmpdir(), "pw-rpa-logs-"));
process.env.OUTPOST_PW_RPA_LOG_DIR = dir;

const run = (over: Partial<PwJobRun>): PwJobRun => ({
  job: "ads",
  status: "ok",
  startedAt: "2026-10-06T04:00:00.000Z",
  finishedAt: "2026-10-06T04:05:00.000Z",
  pid: 1,
  exitCode: 0,
  message: "done",
  runId: "pw-ads-aaaa",
  opts: {
    range: "yesterday",
    fromDate: "2026-10-05",
    toDate: "2026-10-05",
    shopIds: ["PRJ482387"],
    cmd: "ui",
  },
  ...over,
});

upsertRunLog(run({}), { stdout: "hello log", trigger: "manual" });
upsertRunLog(
  run({
    job: "sales",
    runId: "pw-sales-bbbb",
    startedAt: "2026-10-06T05:00:00.000Z",
    finishedAt: "2026-10-06T05:10:00.000Z",
    opts: {
      range: "last90",
      fromDate: "2026-07-09",
      toDate: "2026-10-06",
      shopIds: ["PRJ396770"],
      cmd: "ui",
    },
  }),
  { trigger: "schedule" },
);

const listed = listRunLogs({ limit: 10 });
assert.equal(listed.items.length, 2);
assert.equal(listed.items[0]?.job, "sales");
assert.equal("stdout" in listed.items[0]!, false);

const one = getRunLog("pw-ads-aaaa");
assert.ok(one);
assert.equal(one.jobLabel, "广告导出");
assert.equal(one.口径.rangeLabel, "Yesterday");
assert.equal(one.stdout, "hello log");
assert.equal(one.status, "ok");

const filtered = listRunLogs({
  job: "ads",
  from: "2026-10-06T03:00:00.000Z",
  to: "2026-10-06T04:30:00.000Z",
});
assert.equal(filtered.items.length, 1);
assert.equal(filtered.items[0]?.runId, "pw-ads-aaaa");

rmSync(dir, { recursive: true, force: true });
console.log("pw-rpa run-log ok");
