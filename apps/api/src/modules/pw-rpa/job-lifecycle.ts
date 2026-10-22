/**
 * PW job 生命周期：超时公式、杀进程树、pid 探活、陈旧 profile 锁清理。
 * 与 cli.ts 的 lastByJob 状态机配合；getPwJobStatus 保持纯读。
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readlinkSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { listAdsBudgetRuns } from "./ads-budget-runs.js";

const MIN_ADS_BUDGET_MS = 15 * 60_000;
/** ads/sales 默认 90min（无历史最长耗时数据，30min 过紧） */
const DEFAULT_EXPORT_MS = 90 * 60_000;
const DEFAULT_JOB_MS = 30 * 60_000;
const ADS_BUDGET_MARGIN_MS = 5 * 60_000;

/** Windows Chromium 用独占打开加锁；Cookie/Socket/lockfile 是 POSIX 产物，先不动 */
const LOCK_NAMES = ["SingletonLock"] as const;

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
 * - ads / sales：默认 90min（OUTPOST_PW_EXPORT_TIMEOUT_MS 或 OUTPOST_PW_JOB_TIMEOUT_MS）
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
  if (job === "ads" || job === "sales") {
    const override = Number(
      process.env.OUTPOST_PW_EXPORT_TIMEOUT_MS ||
        process.env.OUTPOST_PW_JOB_TIMEOUT_MS,
    );
    if (Number.isFinite(override) && override > 0) return Math.floor(override);
    return DEFAULT_EXPORT_MS;
  }
  const override = Number(process.env.OUTPOST_PW_JOB_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  return DEFAULT_JOB_MS;
}

/**
 * Windows：异步 taskkill /T /F（不阻塞事件循环）。
 * 其它平台：SIGKILL 目标 pid。
 */
export function killProcessTree(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
        detached: true,
      });
      child.on("error", () => {
        /* ignore spawn failures */
      });
      child.unref();
    } catch {
      /* ignore */
    }
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

/** 从 Chromium SingletonLock 符号链接目标解析 pid（形如 HOST-12345） */
export function parsePidFromLockTarget(target: string): number | null {
  const m = String(target || "").trim().match(/-(\d+)\s*$/);
  if (!m) return null;
  const pid = Number(m[1]);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

/**
 * 清掉 profile 下指向已死 pid 的 SingletonLock。
 * Windows 上该文件通常是普通文件（非 symlink），解析不出 pid 时**跳过并打日志**，
 * 不赌 OS sharing violation；活锁更不能动。
 */
export function clearStaleChromiumProfileLocks(profileDir: string): {
  cleared: string[];
  skippedLive: string[];
  skippedUnknown: string[];
} {
  const cleared: string[] = [];
  const skippedLive: string[] = [];
  const skippedUnknown: string[] = [];
  if (!profileDir || !existsSync(profileDir)) {
    return { cleared, skippedLive, skippedUnknown };
  }
  for (const name of LOCK_NAMES) {
    const p = join(profileDir, name);
    if (!existsSync(p)) continue;
    let pid: number | null = null;
    try {
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        pid = parsePidFromLockTarget(readlinkSync(p));
      }
    } catch {
      /* 读链接失败 → 下方按 unknown 跳过 */
    }
    if (pid == null) {
      skippedUnknown.push(name);
      console.log(
        `[pw-rpa] skip profile lock (no pid; Windows SingletonLock is often a plain file): ${p}`,
      );
      continue;
    }
    if (isPidAlive(pid)) {
      skippedLive.push(name);
      continue;
    }
    try {
      unlinkSync(p);
      cleared.push(name);
    } catch {
      /* busy / permission — 下一轮再试 */
    }
  }
  return { cleared, skippedLive, skippedUnknown };
}

export function defaultAdsProfileDir(): string {
  return (
    process.env.OUTPOST_ADS_PW_PROFILE?.trim() ||
    "D:\\outpost-data\\browser-profiles\\noon-ads-pw"
  );
}

export function defaultSellerProfileDir(): string {
  return (
    process.env.OUTPOST_SELLER_PW_PROFILE?.trim() ||
    "D:\\outpost-data\\browser-profiles\\noon-seller-pw"
  );
}
