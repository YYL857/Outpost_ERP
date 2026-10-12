import assert from "node:assert/strict";
import { readImageSize, expectedFilenames } from "./ingest.js";

// minimal 1x1 PNG
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const dim = readImageSize(PNG_1X1);
assert.ok(dim);
assert.equal(dim.width, 1);
assert.equal(dim.height, 1);
assert.equal(expectedFilenames(9).length, 9);
assert.equal(expectedFilenames(3).length, 3);
console.log("listing promo ingest: ok");
