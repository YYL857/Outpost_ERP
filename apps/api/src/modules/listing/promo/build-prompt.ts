import type { ListingDraft } from "../types.js";
import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_FRAME_COUNT,
  framesTableMarkdown,
  PROMO_NEGATIVE_CONSTRAINTS,
} from "./standards.js";
import { emptyPromoBrief, type PromoBrief } from "./types.js";

export function mergeBriefFromDraft(
  draft: ListingDraft,
  patch?: Partial<PromoBrief>,
): PromoBrief {
  const base = draft.promo?.brief ?? emptyPromoBrief();
  const points =
    patch?.sellingPoints ??
    base.sellingPoints ??
    [];
  const fromContent = draft.ours.content
    ? draft.ours.content.featureBulletsEn.filter(Boolean).slice(0, 6)
    : [];
  return {
    platform: patch?.platform ?? base.platform ?? "Noon SA",
    language: patch?.language ?? base.language ?? "English only (no Chinese)",
    frameCount: patch?.frameCount ?? base.frameCount ?? DEFAULT_FRAME_COUNT,
    aspectRatio: patch?.aspectRatio ?? base.aspectRatio ?? DEFAULT_ASPECT_RATIO,
    productName:
      patch?.productName ||
      base.productName ||
      draft.ours.content?.titleEn ||
      draft.brandEn ||
      draft.notes.slice(0, 80) ||
      draft.id,
    sellingPoints: points.length ? points : fromContent,
    skuLock: {
      ...base.skuLock,
      ...Object.fromEntries(
        Object.entries(patch?.skuLock || {}).filter(
          ([, v]) => v !== undefined && v !== null,
        ),
      ),
    },
    extraNotes: patch?.extraNotes ?? base.extraNotes ?? draft.notes ?? "",
  };
}

export function buildPromoPromptPack(opts: {
  draft: ListingDraft;
  brief: PromoBrief;
  outDirAbs: string;
  reviseNote?: string;
  frameIndexes?: string[];
}): string {
  const { draft, brief, outDirAbs, reviseNote, frameIndexes } = opts;
  const lock = brief.skuLock;
  const skuLine = [
    lock.colorOnly ? `颜色 ONLY: ${lock.colorOnly}` : null,
    lock.forbidColors ? `禁止颜色: ${lock.forbidColors}` : null,
    lock.specOnly ? `规格 ONLY: ${lock.specOnly}` : null,
    lock.forbidSpecs ? `禁止规格: ${lock.forbidSpecs}` : null,
    lock.sizeFit ? `尺码/适配: ${lock.sizeFit}` : null,
    lock.effectNumber ? `效果数字: ${lock.effectNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const points = brief.sellingPoints.length
    ? brief.sellingPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")
    : "(none provided — infer only from references + SKU lock, do not invent stock variants)";

  const reviseBlock = reviseNote
    ? `
## REVISE REQUEST
User feedback (fix ONLY these issues; keep good frames):
${reviseNote}
${frameIndexes?.length ? `Focus frames: ${frameIndexes.join(", ")}` : "Focus frames: as implied by feedback"}
Overwrite the same filenames in the output directory.
`
    : "";

  return `# Outpost Listing · Promo image generation

You are generating cross-border e-commerce listing promo images for ${brief.platform}.

## HARD OUTPUT CONTRACT
- Write ALL images into this absolute directory (create if missing):
  \`${outDirAbs}\`
- Generate exactly **${brief.frameCount}** images, aspect ratio **${brief.aspectRatio}**.
- Filenames MUST be:
  \`01-main-hero-9x16.jpg\`
  \`02-spec-lock-9x16.jpg\`
  \`03-size-fit-9x16.jpg\`
  \`04-tech-feature-9x16.jpg\`
  \`05-effect-number-9x16.jpg\`
  \`06-in-use-scene-9x16.jpg\`
  \`07-variant-only-9x16.jpg\`
  \`08-comfort-detail-9x16.jpg\`
  \`09-feature-summary-9x16.jpg\`
  (If frameCount < 9, only create the first N of this list.)
- Copy finished files into that folder. Prefer GenerateImage (or equivalent) then save/copy to the path above.
- Do NOT edit unrelated Outpost source code. Touch only files under the output directory (and optional README.txt there).

## PRODUCT CARD
- Product name: ${brief.productName}
- Brand: ${draft.brandEn || draft.ours.content?.brandEn || "(n/a)"}
- Platform: ${brief.platform}
- Language on images: ${brief.language}
- Notes: ${brief.extraNotes || "(none)"}
- SKU lock: ${skuLine || "(incomplete — still avoid inventing extra colors/specs)"}

## SELLING POINTS
${points}

## FRAME ROLES (compositions MUST differ; never reuse the same layout with a new title)
${framesTableMarkdown()}

## NEGATIVE CONSTRAINTS
${PROMO_NEGATIVE_CONSTRAINTS}

## REFERENCE IMAGES
Reference product photos are attached to this message and/or live under the listing draft images folder.
Match product appearance exactly (color, structure, materials).

${reviseBlock}

## DONE CRITERIA
- ${brief.frameCount} files present in the output directory with the required names
- English text only on images (unless language says otherwise)
- SKU lock respected
- Reply briefly with the list of written filenames when finished.
`;
}
