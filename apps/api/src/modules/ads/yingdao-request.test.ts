/**
 * yingdao-request 自检：tsx src/modules/ads/yingdao-request.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAdsExportRequest,
  getAdsExportRequestStatus,
} from "./yingdao-request.js";

const dir = mkdtempSync(join(tmpdir(), "yd-req-"));
process.env.YINGDAO_REQUESTS_DIR = dir;

const req = createAdsExportRequest({
  shopIds: ["PRJ482387"],
  range: "days",
  days: 7,
});
assert.ok(req.requestId.startsWith("req-"));
const pendingPath = join(dir, "pending", `ads_export_PRJ482387_${req.requestId}.json`);
assert.ok(existsSync(pendingPath));
const disk = JSON.parse(readFileSync(pendingPath, "utf8"));
assert.equal(disk.range, "days");
assert.equal(disk.days, 7);

const st = getAdsExportRequestStatus(req.requestId);
assert.equal(st.status, "pending");

rmSync(dir, { recursive: true, force: true });
console.log("ads/yingdao-request.test.ts OK");
