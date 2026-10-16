/**
 * 运行: npx tsx src/modules/listing/promo/pack-zip.test.ts
 */
import assert from "node:assert/strict";
import { zipStore } from "./pack-zip.js";

const zip = zipStore([
  { name: "prompt.md", data: Buffer.from("# hello\n", "utf8") },
  { name: "refs/a.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
  { name: "out/.keep", data: Buffer.from("") },
]);

assert.ok(zip.length > 40);
assert.equal(zip.readUInt32LE(0), 0x04034b50);
assert.ok(zip.includes(Buffer.from("prompt.md")));
assert.ok(zip.includes(Buffer.from("refs/a.jpg")));
console.log("listing promo pack-zip: ok", { bytes: zip.length });
