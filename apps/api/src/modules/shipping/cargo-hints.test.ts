/**
 * pnpm exec tsx src/modules/shipping/cargo-hints.test.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cargoKindLabel,
  findCargoHint,
  listCargoHints,
  upsertCargoHint,
} from "./cargo-hints.js";

const root = mkdtempSync(join(tmpdir(), "outpost-cargo-hints-"));
process.env.OUTPOST_ROOT = root;

try {
  assert.equal(listCargoHints().length, 0);

  const row = upsertCargoHint({
    partnerSku: "N1-AAA",
    forwarder: "汉沙",
    cargoKind: "battery",
  });
  assert.ok(row);
  assert.equal(row!.cargoKind, "battery");
  assert.equal(cargoKindLabel(row!.cargoKind), "带电普货");

  const again = upsertCargoHint({
    partnerSku: "N1-AAA",
    forwarder: "汉沙",
    cargoKind: "sensitive",
  });
  assert.equal(again!.cargoKind, "sensitive");
  assert.equal(listCargoHints().length, 1);

  upsertCargoHint({
    partnerSku: "N1-AAA",
    forwarder: "飞旭",
    cargoKind: "general",
  });
  assert.equal(listCargoHints().length, 2);
  assert.equal(
    findCargoHint(listCargoHints(), "N1-AAA", "飞旭")?.cargoKind,
    "general",
  );

  upsertCargoHint({
    partnerSku: "N1-AAA",
    forwarder: "汉沙",
    cargoKind: "",
  });
  assert.equal(listCargoHints().length, 1);

  let threw = false;
  try {
    upsertCargoHint({
      partnerSku: "N1-AAA",
      forwarder: "汉沙",
      cargoKind: "not-a-kind",
    });
  } catch {
    threw = true;
  }
  assert.equal(threw, true);

  console.log("cargo-hints.test.ts: ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
