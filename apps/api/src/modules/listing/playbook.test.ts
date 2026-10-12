/**
 * playbook 自检：tsx src/modules/listing/playbook.test.ts
 */
import {
  listingPlaybookCore,
  withListingPlaybook,
} from "./playbook.js";

const core = listingPlaybookCore();
if (!core.includes("漏斗") || !core.includes("CTR")) {
  throw new Error("core missing funnel/CTR");
}
if (!core.includes("前 20") || !core.includes("60–130") || !core.includes("900")) {
  throw new Error("core missing title/bullet/desc hard rules");
}

for (const mode of ["diagnose", "rewrite", "create"] as const) {
  const s = withListingPlaybook("BASE_SYSTEM", mode);
  if (!s.startsWith("BASE_SYSTEM")) throw new Error(`${mode}: missing base`);
  if (!s.includes("Listing 决策手册")) throw new Error(`${mode}: missing core`);
  if (!s.includes("本轮任务")) throw new Error(`${mode}: missing mode hint`);
}

const d = withListingPlaybook("X", "diagnose");
if (!d.includes("诊断")) throw new Error("diagnose hint broken");
const r = withListingPlaybook("X", "rewrite");
if (!r.includes("改写")) throw new Error("rewrite hint broken");
const c = withListingPlaybook("X", "create");
if (!c.includes("新建")) throw new Error("create hint broken");

console.log("listing/playbook.test.ts OK");
