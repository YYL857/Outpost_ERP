/**
 * tsx src/modules/pw-rpa/ads-budget-scheduler.test.ts
 */
import assert from "node:assert/strict";
import { shouldFireWallClock, parseHhMm } from "../morning-digest/clock.js";
import {
  shouldCatchUpMissedSlot,
  slotDaysAfterFinish,
  shouldSkipRetryCooldown,
  dayClaimedForSlot,
  lastScheduledDayFromSlotRun,
  migrateSlotRunFromLastDays,
  reconcileStaleSlotRun,
  applySlotFinish,
  type AdsBudgetSlotRun,
  type AdsBudgetScheduleState,
} from "./ads-budget-scheduler.js";

assert.equal(parseHhMm("00:10", "00:10"), 10);
assert.equal(parseHhMm("09:10", "09:10"), 9 * 60 + 10);

const fire = shouldFireWallClock({
  now: new Date("2026-10-14T00:12:00+08:00"),
  atMinuteOfDay: parseHhMm("00:10", "00:10"),
  lastScheduledDay: null,
  catchWindowMinutes: 8,
});
assert.equal(fire.fire, true);
assert.equal(fire.day, "2026-10-14");

const skip = shouldFireWallClock({
  now: new Date("2026-10-14T00:12:00+08:00"),
  atMinuteOfDay: parseHhMm("00:10", "00:10"),
  lastScheduledDay: "2026-10-14",
  catchWindowMinutes: 8,
});
assert.equal(skip.fire, false);

// 短窗已过、离峰前：应补跑 peak（昨夜 API 没起来的场景）
const catchPeak = shouldCatchUpMissedSlot({
  now: new Date("2026-10-14T08:52:00+08:00"),
  atMinuteOfDay: parseHhMm("00:10", "00:10"),
  lastScheduledDay: null,
  catchUpUntilMinuteOfDay: parseHhMm("09:10", "09:10"),
});
assert.equal(catchPeak.fire, true);
assert.equal(catchPeak.reason, "missed_catchup");

// 已过 offpeak 墙钟：不再补 peak（该压低峰了）
const tooLatePeak = shouldCatchUpMissedSlot({
  now: new Date("2026-10-14T10:00:00+08:00"),
  atMinuteOfDay: parseHhMm("00:10", "00:10"),
  lastScheduledDay: null,
  catchUpUntilMinuteOfDay: parseHhMm("09:10", "09:10"),
});
assert.equal(tooLatePeak.fire, false);

// offpeak 漏跑：16:00 前可补
const catchOff = shouldCatchUpMissedSlot({
  now: new Date("2026-10-14T10:30:00+08:00"),
  atMinuteOfDay: parseHhMm("09:10", "09:10"),
  lastScheduledDay: null,
  catchUpUntilMinuteOfDay: parseHhMm("16:00", "16:00"),
});
assert.equal(catchOff.fire, true);

// 失败不占当日槽：last*Day 保持旧值 → catch-up 仍可再触发
const afterFail = slotDaysAfterFinish({
  slot: "offpeak",
  day: "2026-10-15",
  ok: false,
  lastPeakDay: "2026-10-15",
  lastOffpeakDay: "2026-10-14",
});
assert.equal(afterFail.lastOffpeakDay, "2026-10-14");
assert.equal(afterFail.lastPeakDay, "2026-10-15");

const afterOk = slotDaysAfterFinish({
  slot: "offpeak",
  day: "2026-10-15",
  ok: true,
  lastPeakDay: "2026-10-15",
  lastOffpeakDay: "2026-10-14",
});
assert.equal(afterOk.lastOffpeakDay, "2026-10-15");

// 失败后 lastOffpeakDay 仍是昨天 → 10:30 应能补跑
const retryOff = shouldCatchUpMissedSlot({
  now: new Date("2026-10-15T10:30:00+08:00"),
  atMinuteOfDay: parseHhMm("09:10", "09:10"),
  lastScheduledDay: afterFail.lastOffpeakDay,
  catchUpUntilMinuteOfDay: parseHhMm("16:00", "16:00"),
});
assert.equal(retryOff.fire, true);
assert.equal(retryOff.reason, "missed_catchup");

// 同槽刚失败：冷却期内不再 catch-up 叠开 Chrome
assert.equal(
  shouldSkipRetryCooldown({
    slot: "offpeak",
    lastSlot: "offpeak",
    lastOk: false,
    lastRunAt: "2026-10-15T01:29:20.000Z",
    cooldownMinutes: 30,
    now: new Date("2026-10-15T01:40:00.000Z"),
  }),
  true,
);
assert.equal(
  shouldSkipRetryCooldown({
    slot: "offpeak",
    lastSlot: "offpeak",
    lastOk: false,
    lastRunAt: "2026-10-15T01:29:20.000Z",
    cooldownMinutes: 30,
    now: new Date("2026-10-15T02:00:00.000Z"),
  }),
  false,
);

// —— slotRun 判定 ——
const runningPeak: AdsBudgetSlotRun = {
  slot: "peak",
  day: "2026-10-22",
  runId: "pw-ads-budget-aaa",
  status: "running",
  startedAt: "2026-10-21T16:10:00.000Z",
  finishedAt: null,
};
assert.equal(dayClaimedForSlot("peak", "2026-10-22", runningPeak), true);
assert.equal(dayClaimedForSlot("offpeak", "2026-10-22", runningPeak), false);
assert.equal(dayClaimedForSlot("peak", "2026-10-21", runningPeak), false);
assert.equal(
  lastScheduledDayFromSlotRun("peak", runningPeak),
  "2026-10-22",
);
assert.equal(lastScheduledDayFromSlotRun("offpeak", runningPeak), null);

const failedPeak: AdsBudgetSlotRun = {
  ...runningPeak,
  status: "failed",
  finishedAt: "2026-10-21T16:20:00.000Z",
};
assert.equal(dayClaimedForSlot("peak", "2026-10-22", failedPeak), false);
assert.equal(lastScheduledDayFromSlotRun("peak", failedPeak), null);

const donePeak: AdsBudgetSlotRun = {
  ...runningPeak,
  status: "done",
  finishedAt: "2026-10-21T16:20:00.000Z",
};
assert.equal(dayClaimedForSlot("peak", "2026-10-22", donePeak), true);

// 迁移：无 slotRun + lastPeakDay===today → peak done（避免部署日再跑）
const migPeak = migrateSlotRunFromLastDays({
  slotRun: null,
  lastPeakDay: "2026-10-22",
  lastOffpeakDay: null,
  lastRunAt: "2026-10-21T16:20:00.000Z",
  today: "2026-10-22",
});
assert.equal(migPeak?.slot, "peak");
assert.equal(migPeak?.status, "done");
assert.equal(migPeak?.runId, "migrated");

// 同日已跑过 offpeak：优先 offpeak done
const migOff = migrateSlotRunFromLastDays({
  slotRun: null,
  lastPeakDay: "2026-10-22",
  lastOffpeakDay: "2026-10-22",
  lastRunAt: "2026-10-22T01:15:00.000Z",
  today: "2026-10-22",
});
assert.equal(migOff?.slot, "offpeak");
assert.equal(migOff?.status, "done");

assert.equal(
  migrateSlotRunFromLastDays({
    slotRun: donePeak,
    lastPeakDay: "2026-10-22",
    lastOffpeakDay: null,
    lastRunAt: null,
    today: "2026-10-22",
  }),
  donePeak,
);

// reconcile：重启后内存无对应 runId → failed
const rec = reconcileStaleSlotRun({
  slotRun: runningPeak,
  memoryRunId: null,
  memoryStatus: "idle",
  nowIso: "2026-10-22T02:00:00.000Z",
});
assert.equal(rec.changed, true);
assert.equal(rec.slotRun?.status, "failed");
assert.equal(rec.message, "重启后遗留的 running");

const recAlive = reconcileStaleSlotRun({
  slotRun: runningPeak,
  memoryRunId: "pw-ads-budget-aaa",
  memoryStatus: "running",
});
assert.equal(recAlive.changed, false);

// —— applySlotFinish：匹配→done / 不匹配→原样 / 重复→幂等 ——
function baseState(slotRun: AdsBudgetSlotRun | null): AdsBudgetScheduleState {
  return {
    enabled: true,
    shopIds: ["PRJ488078"],
    peakAt: "00:10",
    offpeakAt: "09:10",
    catchWindowMinutes: 8,
    lastPeakDay: null,
    lastOffpeakDay: null,
    lastRunAt: null,
    lastMessage: null,
    lastOk: null,
    lastSlot: null,
    slotRun,
  };
}

const matchOk = applySlotFinish(baseState(runningPeak), {
  runId: "pw-ads-budget-aaa",
  status: "ok",
  finishedAt: "2026-10-21T16:25:00.000Z",
  message: "ok",
});
assert.equal(matchOk.applied, true);
assert.equal(matchOk.state.slotRun?.status, "done");
assert.equal(matchOk.state.lastPeakDay, "2026-10-22");
assert.equal(matchOk.state.lastOk, true);

const noMatch = applySlotFinish(baseState(runningPeak), {
  runId: "pw-ads-budget-other",
  status: "ok",
  finishedAt: "2026-10-21T16:25:00.000Z",
  message: "ok",
});
assert.equal(noMatch.applied, false);
assert.equal(noMatch.state.slotRun?.status, "running");
assert.equal(noMatch.state.lastPeakDay, null);

const alreadyDone = applySlotFinish(baseState(donePeak), {
  runId: "pw-ads-budget-aaa",
  status: "ok",
  finishedAt: "2026-10-21T16:30:00.000Z",
  message: "again",
});
assert.equal(alreadyDone.applied, false);
assert.equal(alreadyDone.state.slotRun?.finishedAt, donePeak.finishedAt);

const matchFail = applySlotFinish(baseState(runningPeak), {
  runId: "pw-ads-budget-aaa",
  status: "failed",
  finishedAt: "2026-10-21T16:25:00.000Z",
  message: "boom",
});
assert.equal(matchFail.applied, true);
assert.equal(matchFail.state.slotRun?.status, "failed");
assert.equal(matchFail.state.lastOk, false);
assert.equal(matchFail.state.lastPeakDay, null);

console.log("ads-budget-scheduler clock ok");
