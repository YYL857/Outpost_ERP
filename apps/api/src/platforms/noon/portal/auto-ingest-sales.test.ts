import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickLatestSalesExportFile } from "./auto-ingest.js";

const dir = mkdtempSync(join(tmpdir(), "pw-sales-ingest-"));
writeFileSync(join(dir, "sales_export_2026-07-02_2026-09-29.csv"), "a");
writeFileSync(join(dir, "sales_export_2026-07-09_2026-10-06.csv"), "b");

const picked = pickLatestSalesExportFile(dir);
assert.ok(picked);
assert.equal(picked.fileName, "sales_export_2026-07-09_2026-10-06.csv");
assert.equal(picked.reportFrom, "2026-07-09");
assert.equal(picked.reportTo, "2026-10-06");
console.log("pickLatestSalesExportFile ok");
