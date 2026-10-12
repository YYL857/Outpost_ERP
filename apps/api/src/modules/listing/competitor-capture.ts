/**
 * 扩展采集的对手 PDP 快照（与本品 ours 隔离，只进 competitors 输入）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureListingDirs, listingPaths } from "./paths.js";

export type CompetitorCapture = {
  url: string;
  pastedTitle: string;
  pastedPrice: string;
  pastedBullets: string;
  pastedDescription: string;
  brand?: string;
  source: "extension";
  capturedAt: string;
  pageUrl?: string;
};

function inboxDir() {
  return join(listingPaths().root, "competitor-inbox");
}

function latestPath() {
  return join(inboxDir(), "latest.json");
}

export function saveCompetitorCapture(capture: CompetitorCapture): CompetitorCapture {
  ensureListingDirs();
  const dir = inboxDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = capture.capturedAt.replace(/[:.]/g, "-");
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify(capture, null, 2), "utf8");
  writeFileSync(latestPath(), JSON.stringify(capture, null, 2), "utf8");
  return capture;
}

export function loadLatestCompetitorCapture(): CompetitorCapture | null {
  const p = latestPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CompetitorCapture;
  } catch {
    return null;
  }
}
