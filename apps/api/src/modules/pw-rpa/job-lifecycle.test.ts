/**
 * tsx src/modules/pw-rpa/job-lifecycle.test.ts
 */
import assert from "node:assert/strict";
import {
  countShopsFromEnvOrList,
  isPidAlive,
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

// 其它 job 默认 30min
{
  const prev = process.env.OUTPOST_PW_JOB_TIMEOUT_MS;
  delete process.env.OUTPOST_PW_JOB_TIMEOUT_MS;
  assert.equal(
    resolveJobTimeoutMs("ads", { cmd: "ui", shopCount: 1 }),
    30 * 60_000,
  );
  if (prev === undefined) delete process.env.OUTPOST_PW_JOB_TIMEOUT_MS;
  else process.env.OUTPOST_PW_JOB_TIMEOUT_MS = prev;
}

assert.equal(isPidAlive(process.pid), true);
assert.equal(isPidAlive(0), false);
assert.equal(isPidAlive(-1), false);

console.log("pw-rpa job-lifecycle ok");
