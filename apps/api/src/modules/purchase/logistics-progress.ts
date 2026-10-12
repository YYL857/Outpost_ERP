/**
 * 1688 物流分块查询进度（落盘，供前端轮询）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureAlibaba1688Dir } from "../../platforms/alibaba-1688/types.js";

export type LogisticsProgress = {
  status: "idle" | "running" | "done" | "error";
  updatedAt: string;
  batchIndex: number;
  batchTotal: number;
  orderDone: number;
  orderTotal: number;
  matchedLines: number;
  okOrders: number;
  message: string;
  error?: string;
  runId?: string;
};

let syncLocked = false;

export function is1688LogisticsSyncRunning(): boolean {
  return syncLocked;
}

export function tryAcquire1688LogisticsLock(): boolean {
  if (syncLocked) return false;
  syncLocked = true;
  return true;
}

export function release1688LogisticsLock(): void {
  syncLocked = false;
}

function progressPath(): string {
  const dir = ensureAlibaba1688Dir();
  mkdirSync(join(dir, "runs"), { recursive: true });
  return join(dir, "runs", "progress.json");
}

export function writeLogisticsProgress(
  patch: Partial<LogisticsProgress> & Pick<LogisticsProgress, "message">,
): LogisticsProgress {
  const prev = readLogisticsProgress();
  const next: LogisticsProgress = {
    status: patch.status ?? prev.status,
    updatedAt: new Date().toISOString(),
    batchIndex: patch.batchIndex ?? prev.batchIndex,
    batchTotal: patch.batchTotal ?? prev.batchTotal,
    orderDone: patch.orderDone ?? prev.orderDone,
    orderTotal: patch.orderTotal ?? prev.orderTotal,
    matchedLines: patch.matchedLines ?? prev.matchedLines,
    okOrders: patch.okOrders ?? prev.okOrders,
    message: patch.message,
    error: patch.error,
    runId: patch.runId ?? prev.runId,
  };
  writeFileSync(progressPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function readLogisticsProgress(): LogisticsProgress {
  const path = progressPath();
  if (!existsSync(path)) {
    return {
      status: "idle",
      updatedAt: new Date().toISOString(),
      batchIndex: 0,
      batchTotal: 0,
      orderDone: 0,
      orderTotal: 0,
      matchedLines: 0,
      okOrders: 0,
      message: "尚未开始",
    };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LogisticsProgress;
  } catch {
    return {
      status: "idle",
      updatedAt: new Date().toISOString(),
      batchIndex: 0,
      batchTotal: 0,
      orderDone: 0,
      orderTotal: 0,
      matchedLines: 0,
      okOrders: 0,
      message: "进度文件损坏",
    };
  }
}
