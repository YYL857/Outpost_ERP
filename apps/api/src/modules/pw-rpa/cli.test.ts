import assert from "node:assert/strict";
import {
  isPwJobName,
  PW_JOBS,
  PW_PROFILE_ADS,
  PW_PROFILE_SELLER,
  profilesForJob,
  profilesOverlap,
} from "./cli.js";

assert.equal(isPwJobName("ads"), true);
assert.equal(isPwJobName("sales"), true);
assert.equal(isPwJobName("keepalive"), true);
assert.equal(isPwJobName("ads-budget"), true);
assert.equal(isPwJobName("ads-export"), false);
assert.deepEqual([...PW_JOBS], ["ads", "sales", "keepalive", "ads-budget"]);

assert.deepEqual([...profilesForJob("ads")], [PW_PROFILE_ADS]);
assert.deepEqual([...profilesForJob("ads-budget")], [PW_PROFILE_ADS]);
assert.deepEqual([...profilesForJob("sales")], [PW_PROFILE_SELLER]);
assert.deepEqual(
  [...profilesForJob("keepalive")],
  [PW_PROFILE_ADS, PW_PROFILE_SELLER],
);

// 同 profile 互斥
assert.equal(
  profilesOverlap(profilesForJob("ads"), profilesForJob("ads-budget")),
  true,
);
assert.equal(
  profilesOverlap(profilesForJob("ads"), profilesForJob("keepalive")),
  true,
);
assert.equal(
  profilesOverlap(profilesForJob("sales"), profilesForJob("keepalive")),
  true,
);
// 不同 profile 可并行（修正旧 anyRunning 全局互斥）
assert.equal(
  profilesOverlap(profilesForJob("ads"), profilesForJob("sales")),
  false,
);
assert.equal(
  profilesOverlap(profilesForJob("ads-budget"), profilesForJob("sales")),
  false,
);

console.log("pw-rpa cli ok");
