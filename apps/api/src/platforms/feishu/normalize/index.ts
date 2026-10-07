/**
 * M3 编排：读 raw run → 规范化 → 写 feishu-normalized
 * 禁止：调飞书 API、写 portal-imports、改 AppState
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { getFeishuRawDir } from "../config.js";
import { FeishuError, formatFeishuError, isFeishuError } from "../errors.js";
import type { FeishuPullRunManifest, FeishuRawSnapshot } from "../types.js";
import { toCsv } from "./cells.js";
import { normalizePackingSnapshot } from "./packing.js";
import { normalizeProductSnapshot } from "./product.js";
import type {
  NormalizeDocResult,
  NormalizeRunManifest,
  NormalizedDimsRow,
  NormalizedLocalCostRow,
} from "./types.js";

export function getFeishuNormalizedDir(): string {
  const fromEnv = process.env.OUTPOST_FEISHU_NORMALIZED_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(getFeishuRawDir(), "..", "feishu-normalized");
}

export function resolveRawRunId(runId?: string): string {
  const rawDir = getFeishuRawDir();
  if (runId && runId !== "last") return runId;
  const lastPath = join(rawDir, "last-run.json");
  if (!existsSync(lastPath)) {
    throw new FeishuError(
      "没有 last-run.json，无法 normalize",
      "SNAPSHOT_MISSING",
      "normalize",
      { lastPath },
      "先运行 feishu-pull-raw.ts",
    );
  }
  const last = JSON.parse(readFileSync(lastPath, "utf8")) as { runId?: string };
  if (!last.runId) {
    throw new FeishuError(
      "last-run.json 缺少 runId",
      "SNAPSHOT_INVALID",
      "normalize",
      { lastPath },
    );
  }
  return last.runId;
}

function loadSnapshot(rawRunDir: string, docId: string): FeishuRawSnapshot {
  const path = join(rawRunDir, docId, "snapshot.json");
  if (!existsSync(path)) {
    throw new FeishuError(
      `缺少 raw 快照: ${docId}`,
      "SNAPSHOT_MISSING",
      "normalize",
      { path, docId },
      "确认 Puller 已成功拉取该 doc，或检查 manifest.results",
    );
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FeishuRawSnapshot;
  } catch (e) {
    throw new FeishuError(
      `snapshot JSON 损坏: ${docId}`,
      "SNAPSHOT_INVALID",
      "normalize",
      { path, cause: e instanceof Error ? e.message : String(e) },
    );
  }
}

function writeText(path: string, body: string) {
  try {
    writeFileSync(path, body, "utf8");
  } catch (e) {
    throw new FeishuError(
      "写入 normalized 失败",
      "NORMALIZE_WRITE_FAILED",
      "normalize",
      { path, cause: e instanceof Error ? e.message : String(e) },
    );
  }
}

function errorPayload(e: unknown): NormalizeDocResult["error"] {
  if (isFeishuError(e)) {
    const j = e.toJSON();
    return {
      code: j.code,
      stage: j.stage,
      message: j.message,
      hint: j.hint,
      detail: j.detail,
    };
  }
  return {
    code: "NORMALIZE_EMPTY",
    stage: "normalize",
    message: e instanceof Error ? e.message : String(e),
    detail: { formatted: formatFeishuError(e) },
  };
}

/** 行数骤降守卫：相对上次成功 normalize 的 acceptedCost */
function rowDropGuard(
  docId: string,
  accepted: number,
  prevAccepted: number | null,
  threshold = 0.8,
): { ok: boolean; message: string } {
  if (prevAccepted == null || prevAccepted <= 0) {
    return { ok: true, message: "无历史基线，跳过行数守卫" };
  }
  if (accepted >= Math.floor(prevAccepted * threshold)) {
    return {
      ok: true,
      message: `accepted=${accepted} >= ${threshold}*prev(${prevAccepted})`,
    };
  }
  return {
    ok: false,
    message: `行数骤降：accepted=${accepted} < ${threshold}*prev(${prevAccepted})，CSV 仍写出但标记 guard 失败`,
  };
}

function readPrevAccepted(normalizedRoot: string, docId: string): number | null {
  const lastPath = join(normalizedRoot, "last-normalize.json");
  if (!existsSync(lastPath)) return null;
  try {
    const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
      results?: NormalizeDocResult[];
    };
    const hit = last.results?.find((r) => r.docId === docId && r.ok);
    return hit?.acceptedCost ?? null;
  } catch {
    return null;
  }
}

/**
 * 规范化指定 raw run（product → local_cost + dims；packing → dims 补缺）
 */
export function normalizeFeishuRun(opts?: {
  rawRunId?: string;
  docIds?: string[];
  now?: () => Date;
}): NormalizeRunManifest {
  const nowFn = opts?.now ?? (() => new Date());
  const startedAt = nowFn().toISOString();
  const sourceRawRunId = resolveRawRunId(opts?.rawRunId);
  const rawRunDir = join(getFeishuRawDir(), "runs", sourceRawRunId);
  if (!existsSync(rawRunDir)) {
    throw new FeishuError(
      "raw run 目录不存在",
      "SNAPSHOT_MISSING",
      "normalize",
      { rawRunDir, sourceRawRunId },
    );
  }

  const pullManifestPath = join(rawRunDir, "manifest.json");
  let pullDocIds: string[] = ["product"];
  if (existsSync(pullManifestPath)) {
    const pm = JSON.parse(
      readFileSync(pullManifestPath, "utf8"),
    ) as FeishuPullRunManifest;
    pullDocIds = pm.results.filter((r) => r.ok).map((r) => r.docId);
  }
  const supported = new Set(["product", "packing"]);
  const want = opts?.docIds?.length
    ? opts.docIds
    : pullDocIds.filter((id) => supported.has(id));

  const outRoot = getFeishuNormalizedDir();
  const runId = `norm_${startedAt.replace(/[:.]/g, "-")}`;
  const outDir = join(outRoot, "runs", runId);
  mkdirSync(outDir, { recursive: true });

  const dateStamp = startedAt.slice(0, 10);
  const allCosts: NormalizedLocalCostRow[] = [];
  const allDims: NormalizedDimsRow[] = [];
  const dimSeen = new Set<string>();
  const results: NormalizeDocResult[] = [];
  const guards: NormalizeRunManifest["guards"] = [];

  const pushDims = (rows: NormalizedDimsRow[]) => {
    for (const d of rows) {
      if (dimSeen.has(d.partnerSku)) continue;
      dimSeen.add(d.partnerSku);
      allDims.push(d);
    }
  };

  for (const docId of want) {
    if (!supported.has(docId)) {
      results.push({
        docId,
        ok: false,
        acceptedCost: 0,
        acceptedDims: 0,
        rejected: 0,
        error: {
          code: "CONFIG_INVALID",
          stage: "normalize",
          message: `M3 未实现 doc=${docId}`,
          hint: "当前支持 product / packing；daily/accounts 后续模块",
        },
      });
      continue;
    }

    try {
      const snap = loadSnapshot(rawRunDir, docId);
      const docDir = join(outDir, docId);
      mkdirSync(docDir, { recursive: true });

      if (docId === "product") {
        const built = normalizeProductSnapshot(snap, startedAt);
        const prev = readPrevAccepted(outRoot, docId);
        const guard = rowDropGuard(docId, built.costs.length, prev);
        guards.push({
          docId,
          kind: "row_drop",
          message: guard.message,
          ok: guard.ok,
        });

        const rejectsPath = join(docDir, "rejects.jsonl");
        writeText(
          rejectsPath,
          built.rejects.map((x) => JSON.stringify(x)).join("\n") +
            (built.rejects.length ? "\n" : ""),
        );

        allCosts.push(...built.costs);
        pushDims(built.dims);

        results.push({
          docId,
          ok: true,
          acceptedCost: built.costs.length,
          acceptedDims: built.dims.length,
          rejected: built.rejects.length,
          rejectsPath,
        });
      } else {
        // packing：仅 dims
        const built = normalizePackingSnapshot(snap, startedAt);
        const rejectsPath = join(docDir, "rejects.jsonl");
        writeText(
          rejectsPath,
          built.rejects.map((x) => JSON.stringify(x)).join("\n") +
            (built.rejects.length ? "\n" : ""),
        );

        const before = allDims.length;
        pushDims(built.dims);
        const acceptedDims = allDims.length - before;

        results.push({
          docId,
          ok: true,
          acceptedCost: 0,
          acceptedDims,
          rejected: built.rejects.length,
          rejectsPath,
        });
      }
    } catch (e) {
      results.push({
        docId,
        ok: false,
        acceptedCost: 0,
        acceptedDims: 0,
        rejected: 0,
        error: errorPayload(e),
      });
    }
  }

  const files: NormalizeRunManifest["files"] = {};
  if (allCosts.length) {
    const name = `feishu_local_cost_${dateStamp}.csv`;
    const path = join(outDir, name);
    writeText(
      path,
      toCsv(
        [
          "partnerSku",
          "purchaseCost",
          "headhaul",
          "preferAir",
          "cargoType",
          "updatedAt",
          "source",
        ],
        allCosts.map((r) => ({
          ...r,
          preferAir: r.preferAir ? "true" : "false",
        })),
      ),
    );
    files.localCost = path;
    for (const r of results.filter((x) => x.docId === "product" && x.ok)) {
      r.costPath = path;
    }
  }
  if (allDims.length) {
    const name = `feishu_dims_${dateStamp}.csv`;
    const path = join(outDir, name);
    writeText(
      path,
      toCsv(
        [
          "partnerSku",
          "lengthCm",
          "widthCm",
          "heightCm",
          "weightKg",
          "updatedAt",
          "source",
        ],
        allDims,
      ),
    );
    files.dims = path;
    for (const r of results.filter(
      (x) => (x.docId === "product" || x.docId === "packing") && x.ok,
    )) {
      r.dimsPath = path;
    }
  }

  const finishedAt = nowFn().toISOString();
  const manifest: NormalizeRunManifest = {
    version: 1,
    runId,
    sourceRawRunId,
    startedAt,
    finishedAt,
    outDir,
    files,
    results,
    guards,
  };
  writeText(join(outDir, "normalize-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeText(
    join(outRoot, "last-normalize.json"),
    JSON.stringify(
      {
        runId,
        sourceRawRunId,
        finishedAt,
        okCount: results.filter((r) => r.ok).length,
        failCount: results.filter((r) => !r.ok).length,
        files,
        results,
        manifestPath: join(outDir, "normalize-manifest.json"),
      },
      null,
      2,
    ) + "\n",
  );

  return manifest;
}
