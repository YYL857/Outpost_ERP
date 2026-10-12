import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const tmpRoot = mkdtempSync(join(tmpdir(), "wb-asn-cap-"));
process.env.OUTPOST_ROOT = tmpRoot;

const {
  loadAsnCapture,
  normalizeAsnId,
  patchAsnCapture,
  saveAsnCapture,
} = await import("./asn-captures.js");

before(() => {
  process.env.OUTPOST_ROOT = tmpRoot;
});

after(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test("normalizeAsnId uppercases and strips junk", () => {
  assert.equal(normalizeAsnId(" a06327586pn "), "A06327586PN");
});

test("save and load by ASN", () => {
  const saved = saveAsnCapture(
    {
      asnId: "A06327586PN",
      warehouse: "RUH01S",
      scheduledDate: "2026-10-12",
      scheduleSlot: "18:00-20:00",
      region: "sa",
      pageUrl: null,
      capturedAt: "2026-10-09T01:00:00.000Z",
      source: "extension",
      flags: [],
    },
    { ticketPrefix: "10002160", sessionId: "sess-1" },
  );
  assert.equal(saved.asnId, "A06327586PN");
  const loaded = loadAsnCapture("a06327586pn");
  assert.ok(loaded);
  assert.equal(loaded!.scheduledDate, "2026-10-12");
  assert.equal(loaded!.scheduleSlot, "18:00-20:00");
  assert.equal(loaded!.ticketPrefix, "10002160");
});

test("patch keeps first capturedAt and marks user_edited", () => {
  const first = saveAsnCapture({
    asnId: "A111",
    warehouse: "RUH01S",
    scheduledDate: "2026-10-10",
    scheduleSlot: "14:00-16:00",
    region: null,
    pageUrl: null,
    capturedAt: "2026-10-09T00:00:00.000Z",
    source: "extension",
    flags: [],
  });
  const patched = patchAsnCapture("A111", {
    scheduledDate: "2026-10-12",
    scheduleSlot: "18:00-20:00",
  });
  assert.equal(patched.capturedAt, first.capturedAt);
  assert.equal(patched.scheduledDate, "2026-10-12");
  assert.ok(patched.flags.includes("user_edited"));
});
