/**
 * 晨报门禁 / 墙钟自测：node --import tsx src/modules/morning-digest/readiness.test.ts
 */
import {
  formatMinuteOfDay,
  parseHhMm,
  shanghaiParts,
  shanghaiYesterday,
  shouldFireWallClock,
} from "./clock.js";
import { clampDigestJudgment } from "./llm.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

assert(parseHhMm("02:00", "03:30") === 120, "parse 02:00");
assert(parseHhMm("3:30", "02:00") === 210, "parse 3:30");
assert(formatMinuteOfDay(210) === "03:30", "format 03:30");

const day = shanghaiParts(new Date("2026-09-20T18:00:00.000Z")).day;
assert(Boolean(day), "shanghai day");
assert(shanghaiYesterday(new Date("2026-09-20T04:00:00.000Z")), "yesterday");

const fire = shouldFireWallClock({
  now: new Date("2026-09-19T18:02:00.000Z"), // 上海 02:02
  atMinuteOfDay: 2 * 60,
  lastScheduledDay: null,
  catchWindowMinutes: 5,
});
assert(fire.fire === true, "in window should fire");
assert(
  shouldFireWallClock({
    now: new Date("2026-09-19T18:02:00.000Z"),
    atMinuteOfDay: 2 * 60,
    lastScheduledDay: fire.day,
    catchWindowMinutes: 5,
  }).fire === false,
  "same day no double fire",
);

const j = clampDigestJudgment({
  headline: "测试",
  highlights: [{ id: "A", name: "品A", point: "涨", evidence: "dSales=3" }],
  risks: [],
  actions: [{ id: "A", name: "品A", priority: "P0", action: "补货", why: "断货风险" }],
  caveats: ["延迟"],
  confidence: "high",
});
assert(j.headline === "测试", "clamp headline");
assert(j.actions[0]?.priority === "P0", "clamp priority");

console.log("morning-digest readiness/clock tests OK");
