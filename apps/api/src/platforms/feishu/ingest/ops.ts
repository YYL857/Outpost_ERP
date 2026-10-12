/**
 * 飞书日报 current sheet → AppState.feishuOpsSnapshots
 * 读 last-daily-brief.json → daily_brief_input.json.current.rows
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppState, FeishuOpsSnapshot } from "../../../common/types.js";
import { getFeishuNormalizedDir } from "../normalize/index.js";
import type { DailyBriefInput, DailyNormalizedRow } from "../normalize/daily.js";
import { FeishuError } from "../errors.js";

export type OpsIngestReport = {
  upserted: number;
  sheetTitle: string | null;
  sourceRawRunId?: string;
  briefPath?: string;
};

function n(v: number | null | undefined): number {
  return v != null && Number.isFinite(v) ? v : 0;
}

function rowToSnapshot(
  r: DailyNormalizedRow,
  sheetTitle: string,
  updatedAt: string,
): FeishuOpsSnapshot {
  return {
    partnerSku: r.partnerSku,
    sheetTitle,
    reportDate: r.reportDate,
    productName: r.productName ?? "",
    airInTransit: n(r.airInTransit),
    seaInTransit: n(r.seaInTransit),
    purchasedQty: n(r.purchasedQty),
    airReplenishPlan: n(r.airReplenishPlan),
    seaReplenishPlan: n(r.seaReplenishPlan),
    fbn: r.fbn,
    updatedAt,
    source: "feishu:daily",
  };
}

export function resolveLastDailyBriefPath(
  normalizedRoot = getFeishuNormalizedDir(),
): {
  briefPath: string;
  sourceRawRunId?: string;
  currentSheet?: string;
} {
  const lastPath = join(normalizedRoot, "last-daily-brief.json");
  if (!existsSync(lastPath)) {
    throw new FeishuError(
      "找不到 last-daily-brief.json",
      "SNAPSHOT_MISSING",
      "normalize",
      { lastPath },
      "先运行日报规范化 normalizeDailyBriefRun",
    );
  }
  const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
    briefPath?: string;
    sourceRawRunId?: string;
    currentSheet?: string;
  };
  if (!last.briefPath || !existsSync(last.briefPath)) {
    throw new FeishuError(
      "last-daily-brief 缺少有效 briefPath",
      "SNAPSHOT_INVALID",
      "normalize",
      { lastPath, briefPath: last.briefPath },
    );
  }
  return {
    briefPath: resolve(last.briefPath),
    sourceRawRunId: last.sourceRawRunId,
    currentSheet: last.currentSheet,
  };
}

/**
 * 将最近一次日报 current 行写入 AppState（按 partnerSku 覆盖）。
 */
export function ingestFeishuOpsIntoState(
  state: AppState,
  opts?: { briefPath?: string; dryRun?: boolean },
): OpsIngestReport {
  const normalizedRoot = getFeishuNormalizedDir();
  const meta = opts?.briefPath
    ? { briefPath: opts.briefPath, sourceRawRunId: undefined, currentSheet: undefined }
    : resolveLastDailyBriefPath(normalizedRoot);

  const brief = JSON.parse(readFileSync(meta.briefPath, "utf8")) as DailyBriefInput;
  const sheetTitle = brief.current?.meta?.title ?? meta.currentSheet ?? "";
  const updatedAt = brief.builtAt || new Date().toISOString();
  const rows = brief.current?.rows ?? [];

  let upserted = 0;
  if (!opts?.dryRun) {
    const map = new Map(
      (state.feishuOpsSnapshots ?? []).map((x) => [x.partnerSku, x] as const),
    );
    for (const r of rows) {
      if (!r.partnerSku) continue;
      map.set(r.partnerSku, rowToSnapshot(r, sheetTitle, updatedAt));
      upserted++;
    }
    state.feishuOpsSnapshots = [...map.values()];
  } else {
    upserted = rows.length;
  }

  return {
    upserted,
    sheetTitle: sheetTitle || null,
    sourceRawRunId: meta.sourceRawRunId ?? brief.sourceRawRunId,
    briefPath: meta.briefPath,
  };
}
