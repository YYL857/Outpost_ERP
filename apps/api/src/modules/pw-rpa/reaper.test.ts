/**
 * tsx src/modules/pw-rpa/reaper.test.ts
 */
import assert from "node:assert/strict";
import {
  __setPwJobRunForTest,
  getPwJobStatus,
  reapDeadPwJobs,
  type PwJobRun,
} from "./cli.js";

const deadPid = 2_147_000_000; // 几乎不可能存活
assert.equal(
  (() => {
    try {
      process.kill(deadPid, 0);
      return true;
    } catch {
      return false;
    }
  })(),
  false,
  "test pid must be dead",
);

const seed: PwJobRun = {
  job: "ads",
  status: "running",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  pid: deadPid,
  exitCode: null,
  message: "fake running",
  runId: "pw-ads-reaper-test",
  opts: { cmd: "ui", trigger: "manual" },
  lastHeartbeatAt: new Date().toISOString(),
};
__setPwJobRunForTest(seed);

const n = reapDeadPwJobs();
assert.equal(n, 1);
const after = getPwJobStatus("ads");
assert.equal(after.status, "failed");
assert.match(after.message || "", /进程已消失/);
assert.equal(after.runId, "pw-ads-reaper-test");

console.log("pw-rpa reaper ok");
