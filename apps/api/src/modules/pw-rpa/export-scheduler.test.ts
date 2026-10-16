/**
 * tsx src/modules/pw-rpa/export-scheduler.test.ts
 */
import assert from "node:assert/strict";
import { shouldFireWallClock, parseHhMm } from "../morning-digest/clock.js";
import { DEFAULT_EXPORT_SHOP_IDS } from "./export-scheduler.js";

assert.deepEqual(DEFAULT_EXPORT_SHOP_IDS, ["PRJ396770", "PRJ482387"]);

assert.equal(parseHhMm("17:00", "17:00"), 17 * 60);
assert.equal(parseHhMm("17:20", "17:20"), 17 * 60 + 20);

const fire = shouldFireWallClock({
  now: new Date("2026-10-13T17:02:00+08:00"),
  atMinuteOfDay: parseHhMm("17:00", "17:00"),
  lastScheduledDay: null,
  catchWindowMinutes: 25,
});
assert.equal(fire.fire, true);
assert.equal(fire.day, "2026-10-13");

const skip = shouldFireWallClock({
  now: new Date("2026-10-13T17:02:00+08:00"),
  atMinuteOfDay: parseHhMm("17:00", "17:00"),
  lastScheduledDay: "2026-10-13",
  catchWindowMinutes: 25,
});
assert.equal(skip.fire, false);

const salesLater = shouldFireWallClock({
  now: new Date("2026-10-13T17:02:00+08:00"),
  atMinuteOfDay: parseHhMm("17:20", "17:20"),
  lastScheduledDay: null,
  catchWindowMinutes: 25,
});
assert.equal(salesLater.fire, false);

console.log("export-scheduler clock ok");
