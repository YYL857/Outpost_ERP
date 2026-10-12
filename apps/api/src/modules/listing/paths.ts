import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveWorkspaceUserId, userListingRoot } from "../../auth/workspace.js";

export function listingRoot(userId?: string) {
  return userListingRoot(resolveWorkspaceUserId(userId));
}

export function listingPaths(userId?: string) {
  const root = listingRoot(userId);
  return {
    root,
    index: join(root, "index.json"),
    drafts: join(root, "drafts"),
    competitorInbox: join(root, "competitor-inbox"),
    optimize: join(root, "optimize"),
  };
}

export function ensureListingDirs(userId?: string) {
  const p = listingPaths(userId);
  for (const dir of [p.root, p.drafts, p.competitorInbox, p.optimize]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return p;
}

export function draftDir(draftId: string, userId?: string) {
  return join(listingPaths(userId).drafts, draftId);
}

export function draftJsonPath(draftId: string, userId?: string) {
  return join(draftDir(draftId, userId), "draft.json");
}

export function draftImagesDir(draftId: string, userId?: string) {
  return join(draftDir(draftId, userId), "images");
}

export function draftPromoDir(draftId: string, userId?: string) {
  return join(draftDir(draftId, userId), "promo");
}

export function promoJobDir(draftId: string, jobId: string, userId?: string) {
  return join(draftPromoDir(draftId, userId), jobId);
}

export function promoJobOutDir(draftId: string, jobId: string, userId?: string) {
  return join(promoJobDir(draftId, jobId, userId), "out");
}

export function resolveListingPath(...parts: string[]) {
  return resolve(listingRoot(), ...parts);
}
