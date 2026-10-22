/**
 * tsx src/modules/pw-rpa/job-lifecycle.test.ts
 */
import assert from "node:assert/strict";
import {
  countShopsFromEnvOrList,
  isPidAlive,
  parsePidFromLockTarget,
  resolveJobTimeoutMs,
} from "./job-lifecycle.js";

assert.equal(countShopsFromEnvOrList(["A", "B"], undefined), 2);
assert.equal(countShopsFromEnvOrList([], "PRJ1,PRJ2,PRJ3"), 3);
assert.equal(countShopsFromEnvOrList(undefined, ""), 1);

// keepalive 软探测短超时
{
  const prev = process.env.OUTPOST_PW_SOFT_PROBE_MS;
  delete process.env.OUTPOST_PW_SOFT_PROBE_MS;
  assert.equal(
    resolveJobTimeoutMs("keepalive", { cmd: "ui", shopCount: 1 }),
    80_000,
  );
  process.env.OUTPOST_PW_SOFT_PROBE_MS = "25000";
  assert.equal(
    resolveJobTimeoutMs("keepalive", { cmd: "ui", shopCount: 1 }),
    25_000,
  );
  if (prev === undefined) delete process.env.OUTPOST_PW_SOFT_PROBE_MS;
  else process.env.OUTPOST_PW_SOFT_PROBE_MS = prev;
}

// ads-budget：2 店 × todo 41 → 543s < 15min → 下限
{
  const prev = process.env.OUTPOST_PW_ADS_BUDGET_TIMEOUT_MS;
  delete process.env.OUTPOST_PW_ADS_BUDGET_TIMEOUT_MS;
  assert.equal(
    resolveJobTimeoutMs("ads-budget", {
      cmd: "apply",
      shopCount: 2,
      lastTodo: 41,
    }),
    15 * 60_000,
  );
  // 10 店 × todo 200 → 1500s
  assert.equal(
    resolveJobTimeoutMs("ads-budget", {
      cmd: "apply",
      shopCount: 10,
      lastTodo: 200,
    }),
    1_500_000,
  );
  process.env.OUTPOST_PW_ADS_BUDGET_TIMEOUT_MS = "900000";
  assert.equal(
    resolveJobTimeoutMs("ads-budget", {
      cmd: "apply",
      shopCount: 2,
      lastTodo: 41,
    }),
    900_000,
  );
  if (prev === undefined) delete process.env.OUTPOST_PW_ADS_BUDGET_TIMEOUT_MS;
  else process.env.OUTPOST_PW_ADS_BUDGET_TIMEOUT_MS = prev;
}

// ads/sales 默认 90min（无历史最长耗时，不用 30min）
{
  const prevExport = process.env.OUTPOST_PW_EXPORT_TIMEOUT_MS;
  const prevJob = process.env.OUTPOST_PW_JOB_TIMEOUT_MS;
  delete process.env.OUTPOST_PW_EXPORT_TIMEOUT_MS;
  delete process.env.OUTPOST_PW_JOB_TIMEOUT_MS;
  assert.equal(
    resolveJobTimeoutMs("ads", { cmd: "ui", shopCount: 1 }),
    90 * 60_000,
  );
  assert.equal(
    resolveJobTimeoutMs("sales", { cmd: "ui", shopCount: 1 }),
    90 * 60_000,
  );
  if (prevExport === undefined) delete process.env.OUTPOST_PW_EXPORT_TIMEOUT_MS;
  else process.env.OUTPOST_PW_EXPORT_TIMEOUT_MS = prevExport;
  if (prevJob === undefined) delete process.env.OUTPOST_PW_JOB_TIMEOUT_MS;
  else process.env.OUTPOST_PW_JOB_TIMEOUT_MS = prevJob;
}

assert.equal(isPidAlive(process.pid), true);
assert.equal(isPidAlive(0), false);
assert.equal(isPidAlive(-1), false);

assert.equal(parsePidFromLockTarget("DESKTOP-ABC-12345"), 12345);
assert.equal(parsePidFromLockTarget("nope"), null);

console.log("pw-rpa job-lifecycle ok");
