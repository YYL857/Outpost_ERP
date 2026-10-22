/**
 * PW job 生命周期：超时公式、杀进程树、pid 探活。
 * 与 cli.ts 的 lastByJob 状态机配合；getPwJobStatus 保持纯读。
 */
import { spawnSync } from "node:child_process";
import { listAdsBudgetRuns } from "./ads-budget-runs.js";

const MIN_ADS_BUDGET_MS = 15 * 60_000;
const DEFAULT_JOB_MS = 30 * 60_000;
const ADS_BUDGET_MARGIN_MS = 5 * 60_000;

/** 上次 apply 的 todo 近似：applyOk+applyFailed；无历史则 0 */
export function estimateLastAdsBudgetTodo(): number {
  try {
    const { items } = listAdsBudgetRuns({ limit: 10 });
    for (const row of items) {
      if (String(row.cmd || "").toLowerCase() !== "apply") continue;
      const ok = Number(row.applyOk) || 0;
      const fail = Number(row.applyFailed) || 0;
      if (ok + fail > 0) return ok + fail;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

export function countShopsFromEnvOrList(
  shopIds: string[] | undefined,
  shopsEnv: string | undefined,
): number {
  if (shopIds && shopIds.length > 0) return shopIds.length;
  const fromEnv = String(shopsEnv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Math.max(1, fromEnv.length || 1);
}

/**
 * wall-clock 超时。
 * - keepalive ui：沿用软探测短超时
 * - ads-budget：max(15min, 60s×店 + 3s×上次todo + 5min)，可 env 覆盖
 * - 其它：默认 30min，OUTPOST_PW_JOB_TIMEOUT_MS 覆盖
 */
export function resolveJobTimeoutMs(
  job: string,
  opts: {
    cmd?: string;
    shopCount: number;
    lastTodo?: number;
  },
): number {
  if (job === "keepalive" && (opts.cmd || "ui") === "ui") {
    return Math.max(
      20_000,
      Number(process.env.OUTPOST_PW_SOFT_PROBE_MS) || 80_000,
    );
  }
  if (job === "ads-budget") {
    const override = Number(process.env.OUTPOST_PW_ADS_BUDGET_TIMEOUT_MS);
    if (Number.isFinite(override) && override > 0) return Math.floor(override);
    const shops = Math.max(1, Math.floor(opts.shopCount) || 1);
    const lastTodo =
      opts.lastTodo !== undefined
        ? Math.max(0, Math.floor(opts.lastTodo))
        : estimateLastAdsBudgetTodo();
    const computed = shops * 60_000 + lastTodo * 3_000 + ADS_BUDGET_MARGIN_MS;
    return Math.max(MIN_ADS_BUDGET_MS, computed);
  }
  const override = Number(process.env.OUTPOST_PW_JOB_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  return DEFAULT_JOB_MS;
}

/**
 * Windows：taskkill /T /F 杀整棵树（含 Chromium），避免 profile 锁残留。
 * 其它平台：SIGKILL 目标 pid。
 */
export function killProcessTree(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 15_000,
      encoding: "utf8",
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

/** pid 是否仍存在；仅 ESRCH / 等价视为已死 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code === "ESRCH" || code === "ENOENT") return false;
    // EPERM 等：进程还在，只是无权发信号
    return true;
  }
}
