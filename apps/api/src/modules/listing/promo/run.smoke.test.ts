/**
 * 无 Cursor 密钥时：创建 job → 手写 out 图 → ingest → approve
 * 运行: npx tsx src/modules/listing/promo/run.smoke.test.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createEmptyDraft } from "../types.js";
import { saveDraft, deleteDraft, loadDraft } from "../store.js";
import { draftImagesDir, promoJobOutDir } from "../paths.js";
import {
  createPromoJob,
  ingestPromoJob,
  approvePromoJob,
  patchPromoBrief,
} from "./run.js";
import { expectedFilenames } from "./ingest.js";

// minimal 2x2 JPEG (valid SOFn)
const TINY_JPG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//Z",
  "base64",
);

const draftId = `ld-promo-smoke-${Date.now()}`;

try {
  const draft = createEmptyDraft({ id: draftId, notes: "smoke promo" });
  mkdirSync(draftImagesDir(draftId), { recursive: true });
  const imgName = `img-smoke-ref.jpg`;
  writeFileSync(join(draftImagesDir(draftId), imgName), TINY_JPG);
  draft.ours.images.push({
    id: "img-smoke",
    filename: "ref.jpg",
    mimeType: "image/jpeg",
    relativePath: `drafts/${draftId}/images/${imgName}`,
    sizeBytes: TINY_JPG.length,
    createdAt: new Date().toISOString(),
  });
  saveDraft(draft);

  patchPromoBrief(draftId, {
    productName: "Smoke Insole",
    skuLock: {
      colorOnly: "Black",
      forbidColors: "Pink",
      specOnly: "4-layer",
      forbidSpecs: "2-layer",
      sizeFit: "35-45",
      effectNumber: "6cm",
    },
  });

  const created = createPromoJob(draftId);
  assert.ok(created);
  const jobId = created.job.id;
  assert.ok(existsSync(join(promoJobOutDir(draftId, jobId), "..", "prompt.md")));

  // wait a tick so async execute may set awaiting_manual
  await new Promise((r) => setTimeout(r, 800));

  const out = promoJobOutDir(draftId, jobId);
  for (const name of expectedFilenames(9)) {
    writeFileSync(join(out, name), TINY_JPG);
  }

  const ingested = ingestPromoJob(draftId, jobId);
  assert.ok(ingested);
  const job = ingested.promo.jobs.find((j) => j.id === jobId);
  assert.ok(job);
  assert.equal(job.images.length, 9);
  assert.equal(job.status, "needs_review");

  const approved = approvePromoJob(draftId, jobId);
  assert.ok(approved);
  assert.equal(
    approved.promo.jobs.find((j) => j.id === jobId)?.status,
    "approved",
  );

  console.log("listing promo run smoke: ok", { draftId, jobId });
} finally {
  if (loadDraft(draftId)) deleteDraft(draftId);
  // also remove if only dirs left
  try {
    rmSync(join(draftImagesDir(draftId), ".."), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
