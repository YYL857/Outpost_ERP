/**
 * tsx src/modules/pw-rpa/ads-budget-scheduler.test.ts
 */
import assert from "node:assert/strict";
import { shouldFireWallClock, parseHhMm } from "../morning-digest/clock.js";
import {
  shouldCatchUpMissedSlot,
  slotDaysAfterFinish,
  shouldSkipRetryCooldown,
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

console.log("ads-budget-scheduler clock ok");
