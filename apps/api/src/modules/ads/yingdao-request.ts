/**
 * 慧运营 → 影刀：广告导出请求文件协议（不直接启动影刀进程）。
 *
 * D:\YingDao\Requests\
 *   pending\ads_export_{shopId}_{requestId}.json
 *   done\...
 *   failed\...
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type AdsExportRequest = {
  type: "ads_export";
  requestId: string;
  shopIds: string[];
  range: "yesterday" | "days";
  days: number;
  requestedAt: string;
  source?: string;
};

export type AdsExportRequestStatus = {
  requestId: string;
  status: "pending" | "done" | "failed" | "unknown";
  path: string | null;
  payload: AdsExportRequest | null;
  detail: string | null;
  finishedAt: string | null;
};

function requestsRoot() {
  const explicit = process.env.YINGDAO_REQUESTS_DIR?.trim();
  if (explicit) return resolve(explicit);
  const yd = process.env.YINGDAO_ROOT?.trim();
  if (yd) return resolve(join(yd, "Requests"));
  return resolve("D:\\YingDao\\Requests");
}

function ensureRequestDirs() {
  const root = requestsRoot();
  for (const sub of ["pending", "done", "failed"]) {
    const d = join(root, sub);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
  return root;
}

function fileName(shopKey: string, requestId: string) {
  return `ads_export_${shopKey}_${requestId}.json`;
}

export function createAdsExportRequest(input: {
  shopIds: string[];
  range?: "yesterday" | "days";
  days?: number;
  source?: string;
}): AdsExportRequest {
  const shopIds = [
    ...new Set(
      input.shopIds.map((s) => s.trim().toUpperCase()).filter(Boolean),
    ),
  ];
  if (!shopIds.length) {
    throw new Error("shopIds 不能为空");
  }
  const range = input.range === "yesterday" ? "yesterday" : "days";
  const days =
    range === "yesterday"
      ? 1
      : Math.max(1, Math.min(30, Math.floor(input.days ?? 7)));
  const requestId = `req-${randomUUID().slice(0, 8)}`;
  const payload: AdsExportRequest = {
    type: "ads_export",
    requestId,
    shopIds,
    range,
    days,
    requestedAt: new Date().toISOString(),
    source: input.source || "outpost",
  };

  const root = ensureRequestDirs();
  const shopKey = shopIds.length === 1 ? shopIds[0]! : "MULTI";
  const dest = join(root, "pending", fileName(shopKey, requestId));
  writeFileSync(dest, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function tryRead(path: string): AdsExportRequest | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as AdsExportRequest;
    if (!raw?.requestId) return null;
    return raw;
  } catch {
    return null;
  }
}

function findInDir(
  dir: string,
  requestId: string,
): { path: string; payload: AdsExportRequest | null } | null {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    if (!name.includes(requestId) || !name.endsWith(".json")) continue;
    const path = join(dir, name);
    return { path, payload: tryRead(path) };
  }
  return null;
}

export function getAdsExportRequestStatus(
  requestId: string,
): AdsExportRequestStatus {
  const id = String(requestId || "").trim();
  if (!id) {
    return {
      requestId: "",
      status: "unknown",
      path: null,
      payload: null,
      detail: "requestId 为空",
      finishedAt: null,
    };
  }
  const root = ensureRequestDirs();
  const pending = findInDir(join(root, "pending"), id);
  if (pending) {
    return {
      requestId: id,
      status: "pending",
      path: pending.path,
      payload: pending.payload,
      detail:
        "已写入影刀请求队列；请确认本机影刀 watcher（outpost_ads_export_watcher）在跑",
      finishedAt: null,
    };
  }
  const done = findInDir(join(root, "done"), id);
  if (done) {
    return {
      requestId: id,
      status: "done",
      path: done.path,
      payload: done.payload,
      detail: "影刀已处理完成，请汇总同步或扫目录入库后绑定指标",
      finishedAt: done.payload?.requestedAt ?? null,
    };
  }
  const failed = findInDir(join(root, "failed"), id);
  if (failed) {
    let detail = "影刀处理失败";
    try {
      const errPath = failed.path.replace(/\.json$/i, ".error.txt");
      if (existsSync(errPath)) {
        detail = readFileSync(errPath, "utf8").slice(0, 500);
      }
    } catch {
      /* ignore */
    }
    return {
      requestId: id,
      status: "failed",
      path: failed.path,
      payload: failed.payload,
      detail,
      finishedAt: null,
    };
  }
  return {
    requestId: id,
    status: "unknown",
    path: null,
    payload: null,
    detail: "未找到该请求（可能已清理或 requestId 错误）",
    finishedAt: null,
  };
}

export function yingdaoRequestsDir() {
  return ensureRequestDirs();
}
