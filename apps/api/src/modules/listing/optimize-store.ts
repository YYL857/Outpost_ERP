import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  createEmptyOptimizeJob,
  type OptimizeJob,
} from "./optimize-types.js";
import { ensureListingDirs, listingPaths } from "./paths.js";

export type OptimizeJobSummary = {
  id: string;
  status: string;
  updatedAt: string;
  titleHint: string;
  partnerSku: string;
};

function optimizeRoot(userId?: string) {
  return listingPaths(userId).optimize;
}

function indexPath(userId?: string) {
  return join(optimizeRoot(userId), "index.json");
}

function jobDir(id: string, userId?: string) {
  return join(optimizeRoot(userId), id);
}

function jobJsonPath(id: string, userId?: string) {
  return join(jobDir(id, userId), "job.json");
}

function readIndex(userId?: string): OptimizeJobSummary[] {
  const p = indexPath(userId);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      items?: OptimizeJobSummary[];
    };
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

function writeIndex(items: OptimizeJobSummary[], userId?: string) {
  ensureListingDirs(userId);
  writeFileSync(
    indexPath(userId),
    JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

function toSummary(j: OptimizeJob): OptimizeJobSummary {
  return {
    id: j.id,
    status: j.status,
    updatedAt: j.updatedAt,
    titleHint:
      j.optimized?.titleEn ||
      j.current.title ||
      j.metrics?.catalogTitle ||
      j.partnerSku ||
      j.id,
    partnerSku: j.partnerSku,
  };
}

export function listOptimizeSummaries(userId?: string): OptimizeJobSummary[] {
  ensureListingDirs(userId);
  const fromIndex = readIndex(userId);
  if (fromIndex.length) {
    return fromIndex.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  const root = optimizeRoot(userId);
  if (!existsSync(root)) return [];
  const rebuilt: OptimizeJobSummary[] = [];
  for (const name of readdirSync(root)) {
    if (name === "index.json") continue;
    const j = loadOptimizeJob(name, userId);
    if (j) rebuilt.push(toSummary(j));
  }
  writeIndex(rebuilt, userId);
  return rebuilt.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function loadOptimizeJob(id: string, userId?: string): OptimizeJob | null {
  const p = jobJsonPath(id, userId);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as OptimizeJob;
    return createEmptyOptimizeJob({ ...raw, id: raw.id || id });
  } catch {
    return null;
  }
}

export function saveOptimizeJob(job: OptimizeJob, userId?: string) {
  ensureListingDirs(userId);
  const dir = jobDir(job.id, userId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  job.updatedAt = new Date().toISOString();
  writeFileSync(jobJsonPath(job.id, userId), JSON.stringify(job, null, 2), "utf8");

  const items = readIndex(userId).filter((x) => x.id !== job.id);
  items.unshift(toSummary(job));
  writeIndex(items.slice(0, 200), userId);
  return job;
}

export function deleteOptimizeJob(id: string, userId?: string): boolean {
  const dir = jobDir(id, userId);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  writeIndex(
    readIndex(userId).filter((x) => x.id !== id),
    userId,
  );
  return true;
}
