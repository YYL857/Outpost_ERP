import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { toPlainLongDescription } from "./plain-text.js";
import type { ListingDraft } from "./types.js";
import { emptyListingPromo } from "./promo/types.js";
import {
  draftDir,
  draftImagesDir,
  draftJsonPath,
  ensureListingDirs,
  listingPaths,
} from "./paths.js";

function sanitizeDraftContent(draft: ListingDraft): ListingDraft {
  let next = draft;
  if (!next.promo) {
    next = { ...next, promo: emptyListingPromo() };
  }
  const c = next.ours?.content;
  if (!c) return next;
  const en = toPlainLongDescription(c.longDescriptionEn || "");
  const ar = toPlainLongDescription(c.longDescriptionAr || "");
  if (en === c.longDescriptionEn && ar === c.longDescriptionAr) return next;
  return {
    ...next,
    ours: {
      ...next.ours,
      content: { ...c, longDescriptionEn: en, longDescriptionAr: ar },
    },
  };
}

type DraftIndexEntry = {
  id: string;
  status: string;
  updatedAt: string;
  titleHint: string;
  competitorCount: number;
  imageCount: number;
};

function readIndex(): DraftIndexEntry[] {
  const p = listingPaths().index;
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { items?: DraftIndexEntry[] };
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

function writeIndex(items: DraftIndexEntry[]) {
  ensureListingDirs();
  writeFileSync(
    listingPaths().index,
    JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

function toIndexEntry(d: ListingDraft): DraftIndexEntry {
  return {
    id: d.id,
    status: d.status,
    updatedAt: d.updatedAt,
    titleHint:
      d.ours.content?.titleEn ||
      d.brandEn ||
      d.competitors[0]?.pastedTitle ||
      d.id,
    competitorCount: d.competitors.length,
    imageCount: d.ours.images.length,
  };
}

export function listDraftSummaries(): DraftIndexEntry[] {
  ensureListingDirs();
  const fromIndex = readIndex();
  if (fromIndex.length) return fromIndex.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const draftsRoot = listingPaths().drafts;
  if (!existsSync(draftsRoot)) return [];
  const rebuilt: DraftIndexEntry[] = [];
  for (const name of readdirSync(draftsRoot)) {
    const d = loadDraft(name);
    if (d) rebuilt.push(toIndexEntry(d));
  }
  writeIndex(rebuilt);
  return rebuilt.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function loadDraft(id: string): ListingDraft | null {
  const path = draftJsonPath(id);
  if (!existsSync(path)) return null;
  try {
    return sanitizeDraftContent(JSON.parse(readFileSync(path, "utf8")) as ListingDraft);
  } catch {
    return null;
  }
}

export function saveDraft(draft: ListingDraft): ListingDraft {
  ensureListingDirs();
  draft = sanitizeDraftContent(draft);
  const dir = draftDir(draft.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(draftImagesDir(draft.id))) {
    mkdirSync(draftImagesDir(draft.id), { recursive: true });
  }
  draft.updatedAt = new Date().toISOString();
  writeFileSync(draftJsonPath(draft.id), JSON.stringify(draft, null, 2), "utf8");

  const items = readIndex().filter((x) => x.id !== draft.id);
  items.unshift(toIndexEntry(draft));
  writeIndex(items);
  return draft;
}

export function deleteDraft(id: string): boolean {
  ensureListingDirs();
  const dir = draftDir(id);
  const inIndex = readIndex().some((x) => x.id === id);
  if (!existsSync(dir) && !inIndex) return false;
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  writeIndex(readIndex().filter((x) => x.id !== id));
  return true;
}

export function deleteDraftImageFile(relativePath: string) {
  const abs = join(listingPaths().root, relativePath);
  if (existsSync(abs)) unlinkSync(abs);
}
