import assert from "node:assert/strict";
import { isPwJobName, PW_JOBS } from "./cli.js";

assert.equal(isPwJobName("ads"), true);
assert.equal(isPwJobName("sales"), true);
assert.equal(isPwJobName("keepalive"), true);
assert.equal(isPwJobName("ads-export"), false);
assert.deepEqual([...PW_JOBS], ["ads", "sales", "keepalive"]);
console.log("pw-rpa cli ok");
