/**
 * pnpm exec tsx src/modules/shipping/label-crop.test.ts
 */
import assert from "node:assert/strict";
import { PDFDocument, rgb } from "pdf-lib";
import {
  LabelCropError,
  cropAwbLabelPdf,
  croppedDownloadName,
  decodePdfBase64,
  detectLabelClip,
  isBorderRect,
  largestBorderCluster,
  parseFilledRects,
  unionRects,
} from "./label-crop.js";

assert.equal(croppedDownloadName("亚优汇-2026-10-05-空运.pdf"), "亚优汇-2026-10-05-空运-裁标.pdf");
assert.equal(croppedDownloadName("foo-裁标.pdf"), "foo-裁标.pdf");
assert.equal(croppedDownloadName("D:/a/b.pdf"), "b-裁标.pdf");

assert.throws(() => decodePdfBase64(""), /请上传/);
assert.throws(() => decodePdfBase64("aaaa"), /不是有效的 PDF/);

const u = unionRects([
  { x0: 1, y0: 2, x1: 3, y1: 4 },
  { x0: 0, y0: 5, x1: 8, y1: 6 },
]);
assert.deepEqual(u, { x0: 0, y0: 2, x1: 8, y1: 6 });

assert.equal(isBorderRect({ x0: 0, y0: 0, x1: 200, y1: 0.75 }), true);
assert.equal(isBorderRect({ x0: 0, y0: 0, x1: 80, y1: 80 }), false);

const cluster = largestBorderCluster([
  { x0: 10, y0: 10, x1: 110, y1: 10.75 },
  { x0: 10, y0: 10, x1: 10.75, y1: 90 },
  { x0: 400, y0: 400, x1: 420, y1: 400.5 },
]);
assert.ok(cluster);
assert.ok(cluster.x1 - cluster.x0 > 90);

const content = "q\n156.75 539.64 282.75 0.75 re\nf\n156.75 539.64 0.75 269.25 re\nf\nQ\n";
const parsed = parseFilledRects(content);
assert.equal(parsed.length, 2);
assert.ok(parsed[0]!.x0 > 150);

const pathContent =
  "q\n1 0 0 1 156.75 539.64 cm\n0 0 m\n0 0.75 l\n282.75 0.75 l\n282.75 0 l\nh\nf\nQ\n";
const pathParsed = parseFilledRects(pathContent);
assert.equal(pathParsed.length, 1);
assert.ok(Math.abs(pathParsed[0]!.x0 - 156.75) < 0.01);
assert.ok(Math.abs(pathParsed[0]!.x1 - (156.75 + 282.75)) < 0.01);

async function makeSample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  page.drawText("2026/10/5 16:03 header", { x: 24, y: 820, size: 8 });
  const x = 156.75;
  const y = 539.64;
  const w = 282.75;
  const h = 269.25;
  const t = 0.75;
  const black = rgb(0, 0, 0);
  page.drawRectangle({ x, y: y + h - t, width: w, height: t, color: black });
  page.drawRectangle({ x, y, width: w, height: t, color: black });
  page.drawRectangle({ x, y, width: t, height: h, color: black });
  page.drawRectangle({ x: x + w - t, y, width: t, height: h, color: black });
  page.drawRectangle({ x, y: y + 50, width: w, height: t, color: black });
  page.drawText("Made in China", { x: x + 40, y: y + 12, size: 16 });
  return doc.save();
}

const sample = await makeSample();
const src = await PDFDocument.load(sample);
const clip = detectLabelClip(src.getPages()[0]!);
assert.ok(Math.abs(clip.x0 - 156.75) < 2, `clip.x0=${clip.x0}`);
assert.ok(Math.abs(clip.x1 - (156.75 + 282.75)) < 2, `clip.x1=${clip.x1}`);
assert.ok(clip.y1 - clip.y0 > 200);

const cropped = await cropAwbLabelPdf(sample);
assert.equal(cropped.pageCount, 1);
assert.ok(Math.abs(cropped.widthPt - 282.75 - 1.5) < 3, `w=${cropped.widthPt}`);
assert.ok(cropped.heightPt > 250 && cropped.heightPt < 280, `h=${cropped.heightPt}`);

const twoDoc = await PDFDocument.load(sample);
const two = await PDFDocument.create();
const [p1] = await two.copyPages(twoDoc, [0]);
const [p2] = await two.copyPages(twoDoc, [0]);
two.addPage(p1);
two.addPage(p2);
const twoCrop = await cropAwbLabelPdf(await two.save());
assert.equal(twoCrop.pageCount, 2);

const emptyDoc = await PDFDocument.create();
emptyDoc.addPage([595, 842]);
const emptyBytes = await emptyDoc.save();
await assert.rejects(
  () => cropAwbLabelPdf(emptyBytes),
  (e: unknown) => e instanceof LabelCropError && /标签/.test((e as Error).message),
);

console.log("[label-crop] ok");
