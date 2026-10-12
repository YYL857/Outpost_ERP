/**
 * 只读飞书 raw 最新快照路径；不调飞书 API。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getFeishuRawDir } from "../../platforms/feishu/config.js";
import type { FeishuRawSnapshot } from "../../platforms/feishu/types.js";

export type SnapshotHit = {
  path: string;
  snap: FeishuRawSnapshot;
};

function rawDirCandidates(): string[] {
  const primary = getFeishuRawDir();
  const shared = resolve(
    process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data",
    "feishu-raw",
  );
  const fromShop = resolve(primary, "..", "..", "..", "feishu-raw");
  return [...new Set([primary, shared, fromShop])];
}

export function findLatestSnapshotPath(docId: string): string | null {
  for (const dir of rawDirCandidates()) {
    const lastPath = join(dir, "last-run.json");
    if (existsSync(lastPath)) {
      try {
        const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
          runId?: string;
        };
        if (last.runId) {
          const path = join(dir, "runs", last.runId, docId, "snapshot.json");
          if (existsSync(path)) return path;
        }
      } catch {
        /* next */
      }
    }
    const runsDir = join(dir, "runs");
    if (!existsSync(runsDir)) continue;
    try {
      const runs = readdirSync(runsDir)
        .map((name) => {
          const path = join(runsDir, name, docId, "snapshot.json");
          if (!existsSync(path)) return null;
          return { path, mtime: statSync(path).mtimeMs };
        })
        .filter(Boolean) as Array<{ path: string; mtime: number }>;
      runs.sort((a, b) => b.mtime - a.mtime);
      if (runs[0]) return runs[0].path;
    } catch {
      /* next */
    }
  }
  return null;
}

export function loadSnapshot(docId: string): SnapshotHit | null {
  const path = findLatestSnapshotPath(docId);
  if (!path) return null;
  try {
    const snap = JSON.parse(readFileSync(path, "utf8")) as FeishuRawSnapshot;
    return { path, snap };
  } catch {
    return null;
  }
}
