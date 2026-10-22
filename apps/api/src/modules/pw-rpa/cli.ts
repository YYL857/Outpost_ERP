/**
 * 统一 spawn：python noon-pw-platform/main.py <job> <cmd>
 * 生产路径不再调用影刀 CLI。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { loadRegistry } from "../../shops/registry.js";
import { ingestPortalAfterPwJob } from "./ingest-after.js";
import {
  resolveAdsRange,
  type AdsRangeMode,
  type AdsRangeResolved,
} from "./ads-range.js";
import { isExportJob, upsertRunLog } from "./run-log.js";
import {
  clearStaleChromiumProfileLocks,
  countShopsFromEnvOrList,
  defaultAdsProfileDir,
  defaultSellerProfileDir,
  isPidAlive,
  killProcessTree,
  resolveJobTimeoutMs,
} from "./job-lifecycle.js";

export const PW_JOBS = ["ads", "sales", "keepalive", "ads-budget"] as const;
export type PwJobName = (typeof PW_JOBS)[number];

export type PwJobOpts = {
  shopIds?: string[];
  range?: AdsRangeMode;
  days?: number;
  fromDate?: string;
  toDate?: string;
  cmd?: "ui" | "login" | "probe" | "apply" | "sync";
  /** ads-budget apply 用：peak / offpeak / auto */
  mode?: "auto" | "offpeak" | "peak" | "idle";
  dryRun?: boolean;
  /** ads-budget sync 时覆盖 baseline */
  refreshBaseline?: boolean;
  extraEnv?: Record<string, string>;
  trigger?: "manual" | "schedule";
};

export type PwJobRun = {
  job: PwJobName;
  status: "idle" | "starting" | "running" | "ok" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  pid: number | null;
  exitCode: number | null;
  message: string | null;
  runId: string | null;
  opts: PwJobOpts | null;
  /** 最近一次 stdout/stderr 输出；reaper/巡检区分「在跑」与「假在跑」 */
  lastHeartbeatAt: string | null;
};

const lastByJob = new Map<PwJobName, PwJobRun>();

function emptyRun(job: PwJobName): PwJobRun {
  return {
    job,
    status: "idle",
    startedAt: null,
    finishedAt: null,
    pid: null,
    exitCode: null,
    message: null,
    runId: null,
    opts: null,
    lastHeartbeatAt: null,
  };
}

function clone(run: PwJobRun): PwJobRun {
  return { ...run, opts: run.opts ? { ...run.opts } : null };
}

export function isPwJobName(s: string): s is PwJobName {
  return (PW_JOBS as readonly string[]).includes(s);
}

export function getPwJobStatus(job: PwJobName): PwJobRun {
  return clone(lastByJob.get(job) ?? emptyRun(job));
}

export function listPwJobStatus(): PwJobRun[] {
  return PW_JOBS.map((j) => getPwJobStatus(j));
}

/** Chromium user-data-dir 短名；与 runtime.py ADS_PROFILE / SELLER_PROFILE 目录名对齐 */
export const PW_PROFILE_ADS = "noon-ads-pw";
export const PW_PROFILE_SELLER = "noon-seller-pw";

/**
 * 每个 job 实际占用的 profile。互斥按 profile 走，不按 job 全局互斥。
 * keepalive 两边都碰，故两个 key 都占。
 */
export function profilesForJob(job: PwJobName): readonly string[] {
  switch (job) {
    case "ads":
    case "ads-budget":
      return [PW_PROFILE_ADS];
    case "sales":
      return [PW_PROFILE_SELLER];
    case "keepalive":
      return [PW_PROFILE_ADS, PW_PROFILE_SELLER];
  }
}

export function profilesOverlap(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.some((k) => b.includes(k));
}

/** 同 profile 已有 starting/running 则返回占坑的那条；不同 profile 可并行 */
function isProfileBusy(forJob: PwJobName): PwJobRun | null {
  const need = profilesForJob(forJob);
  for (const j of PW_JOBS) {
    const st = lastByJob.get(j);
    if (!st || (st.status !== "starting" && st.status !== "running")) continue;
    if (profilesOverlap(need, profilesForJob(j))) return clone(st);
  }
  return null;
}

function platformDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(join(here, "../../../scripts/noon-pw-platform"));
}

function pythonBin(): string {
  return process.env.OUTPOST_ADS_PW_PYTHON?.trim() || "python";
}

const HINT: Record<PwJobName, { starting: string; done: string }> = {
  ads: {
    starting: "正在启动 Playwright 广告导出…",
    done: "Playwright 广告导出已完成并入库",
  },
  sales: {
    starting: "正在启动 Playwright 销量导出…",
    done: "Playwright 销量导出已完成并入库",
  },
  keepalive: {
    starting: "正在检查 Noon 登录态…",
    done: "登录态检查已完成",
  },
  "ads-budget": {
    starting: "正在启动广告预算峰期切换…",
    done: "广告预算峰期切换已完成",
  },
};

export function startPwJob(job: PwJobName, opts: PwJobOpts = {}): PwJobRun {
  const trigger = opts.trigger === "schedule" ? "schedule" : "manual";
  const busy = isProfileBusy(job);
  if (busy) {
    if (busy.job === job) return getPwJobStatus(job);
    const failed: PwJobRun = {
      ...emptyRun(job),
      status: "failed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      runId: `pw-${job}-busy-${randomUUID().slice(0, 8)}`,
      message: `另一任务运行中：${busy.job}（runId=${busy.runId}）`,
      opts: { cmd: opts.cmd, trigger },
    };
    lastByJob.set(job, failed);
    if (isExportJob(job)) upsertRunLog(failed, { trigger });
    return clone(failed);
  }

  const dir = platformDir();
  const mainPy = join(dir, "main.py");
  if (!existsSync(mainPy)) {
    const failed: PwJobRun = {
      ...emptyRun(job),
      status: "failed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      message: `找不到 noon-pw-platform/main.py: ${mainPy}`,
      opts: { cmd: opts.cmd, trigger },
    };
    lastByJob.set(job, failed);
    if (isExportJob(job)) upsertRunLog(failed, { trigger });
    return clone(failed);
  }

  const shopIds = [
    ...new Set(
      (opts.shopIds ?? [])
        .map((s) => String(s || "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const cmdRaw = (opts.cmd || "ui").trim().toLowerCase();
  let cmd: PwJobOpts["cmd"] = "ui";
  if (cmdRaw === "login" || cmdRaw === "probe") cmd = cmdRaw;
  else if (job === "ads-budget" && (cmdRaw === "apply" || cmdRaw === "sync")) {
    cmd = cmdRaw;
  } else if (job === "ads-budget" && cmdRaw === "ui") {
    cmd = "probe";
  } else {
    cmd = "ui";
  }
  let adsResolved: AdsRangeResolved | null = null;
  if ((job === "ads" || job === "sales") && cmd === "ui") {
    try {
      adsResolved = resolveAdsRange({
        range: opts.range ?? (job === "sales" ? "last90" : "yesterday"),
        days: opts.days,
        fromDate: opts.fromDate,
        toDate: opts.toDate,
      });
    } catch (err) {
      const failed: PwJobRun = {
        ...emptyRun(job),
        status: "failed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        message: err instanceof Error ? err.message : String(err),
        runId: `pw-${job}-range-${randomUUID().slice(0, 8)}`,
        opts: { cmd, trigger },
      };
      lastByJob.set(job, failed);
      if (isExportJob(job)) upsertRunLog(failed, { trigger });
      return clone(failed);
    }
  }
  const range: AdsRangeMode =
    adsResolved?.range ?? (opts.range === "days" ? "days" : "yesterday");
  const days =
    adsResolved?.days ?? Math.max(1, Math.min(90, Math.floor(opts.days ?? 7)));
  const fromDate = adsResolved?.fromDate ?? opts.fromDate;
  const toDate = adsResolved?.toDate ?? opts.toDate;

  const runId = `pw-${job}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const run: PwJobRun = {
    job,
    status: "starting",
    startedAt,
    finishedAt: null,
    pid: null,
    exitCode: null,
    message: HINT[job].starting,
    runId,
    opts: {
      shopIds: shopIds.length ? shopIds : undefined,
      range,
      days,
      fromDate,
      toDate,
      cmd,
      mode: opts.mode,
      dryRun: opts.dryRun,
      trigger,
    },
    lastHeartbeatAt: startedAt,
  };
  lastByJob.set(job, run);
  if (isExportJob(job)) upsertRunLog(run, { trigger });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    ...(opts.extraEnv ?? {}),
  };
  if (shopIds.length) {
    env.OUTPOST_YD_ADS_SHOPS = shopIds.join(",");
    if (job === "ads-budget") {
      env.OUTPOST_ADS_BUDGET_SHOPS = shopIds.join(",");
    }
    const want = new Set(shopIds);
    const labels = loadRegistry()
      .shops.filter((s) => want.has(String(s.id || "").trim().toUpperCase()))
      .map((s) => `${String(s.id).trim().toUpperCase()}:${s.name || s.projectCode || s.id}`)
      .join(",");
    if (labels) env.OUTPOST_YD_ADS_SHOP_LABELS = labels;
  } else if (job === "ads-budget") {
    env.OUTPOST_ADS_BUDGET_SHOPS =
      process.env.OUTPOST_ADS_BUDGET_SHOPS?.trim() || "PRJ488078";
  }
  if (job === "ads") {
    env.OUTPOST_YD_ADS_RANGE = range;
    env.OUTPOST_YD_ADS_DAYS = String(days);
    if (fromDate) env.OUTPOST_YD_ADS_FROM = fromDate;
    if (toDate) env.OUTPOST_YD_ADS_TO = toDate;
  }
  if (job === "sales") {
    env.OUTPOST_YD_SALES_LOOKBACK_DAYS = String(
      Math.max(1, Math.min(400, Math.floor(days))),
    );
    if (fromDate) env.OUTPOST_YD_SALES_FROM = fromDate;
    if (toDate) env.OUTPOST_YD_SALES_TO = toDate;
  }
  const ka = opts.extraEnv?.OUTPOST_PW_KEEPALIVE_TARGETS;
  if (job === "keepalive" && ka) {
    env.OUTPOST_PW_KEEPALIVE_TARGETS = ka;
  }

  const pyArgs = ["main.py", job, cmd || "ui"];
  if (job === "ads-budget") {
    if (opts.mode && opts.mode !== "auto") {
      pyArgs.push("--mode", opts.mode);
    }
    if (opts.dryRun) pyArgs.push("--dry-run");
    if (opts.refreshBaseline) pyArgs.push("--refresh-baseline");
  }
  // 启动前清指向已死 pid 的 Chromium Singleton*；活锁不动
  for (const key of profilesForJob(job)) {
    const profileDir =
      key === PW_PROFILE_ADS
        ? defaultAdsProfileDir()
        : key === PW_PROFILE_SELLER
          ? defaultSellerProfileDir()
          : "";
    if (!profileDir) continue;
    const { cleared } = clearStaleChromiumProfileLocks(profileDir);
    if (cleared.length) {
      console.log(
        `[pw-rpa] cleared stale profile locks profile=${profileDir} files=${cleared.join(",")}`,
      );
    }
  }

  const child = spawn(pythonBin(), pyArgs, {
    cwd: dir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });

  run.status = "running";
  run.pid = child.pid ?? null;
  run.lastHeartbeatAt = new Date().toISOString();
  run.message =
    job === "keepalive" && cmd === "ui"
      ? `软探测进行中（pid=${run.pid ?? "?"}）：先查本地 cookie，再短时无头探 Noon…`
      : `已启动 Playwright ${job}（pid=${run.pid ?? "?"} · ${cmd}）`;
  if (isExportJob(job)) upsertRunLog(run, { trigger });

  let stdout = "";
  let stderr = "";
  /** 全 job 刷新心跳；keepalive 额外把末行写进 message（原行为） */
  const bumpProgress = (chunk: string) => {
    const cur = lastByJob.get(job);
    if (!cur || cur.runId !== runId || cur.status !== "running") return;
    const now = new Date().toISOString();
    if (job === "keepalive") {
      const lines = chunk
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const last = lines[lines.length - 1];
      lastByJob.set(job, {
        ...cur,
        lastHeartbeatAt: now,
        ...(last ? { message: last.slice(0, 220) } : {}),
      });
      return;
    }
    lastByJob.set(job, { ...cur, lastHeartbeatAt: now });
  };
  child.stdout?.on("data", (buf: Buffer) => {
    const text = buf.toString("utf8");
    stdout += text;
    bumpProgress(text);
  });
  child.stderr?.on("data", (buf: Buffer) => {
    const text = buf.toString("utf8");
    stderr += text;
    bumpProgress(text);
  });

  // wall-clock 超时：杀进程树（Windows taskkill /T），清掉 running，避免永久停摆
  const shopCount = countShopsFromEnvOrList(
    shopIds.length ? shopIds : undefined,
    env.OUTPOST_ADS_BUDGET_SHOPS,
  );
  const timeoutMs = resolveJobTimeoutMs(job, { cmd, shopCount });
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs > 0) {
    killTimer = setTimeout(() => {
      const cur = lastByJob.get(job);
      if (!cur || cur.runId !== runId) return;
      if (cur.status !== "running" && cur.status !== "starting") return;
      const pid = cur.pid ?? child.pid ?? null;
      if (pid) {
        try {
          killProcessTree(pid);
        } catch {
          /* ignore */
        }
      } else {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }
      const soft =
        job === "keepalive" && cmd === "ui"
          ? "软探测超时已强制结束（Noon 网络差时常见）。本地 cookie 可点「重新检查」；不必一直等。"
          : `超时强杀（wall-clock ${Math.round(timeoutMs / 1000)}s，已 taskkill /T）${
              pid ? ` pid=${pid}` : ""
            }`;
      const failed = {
        ...cur,
        status: "failed" as const,
        finishedAt: new Date().toISOString(),
        message: soft,
      };
      lastByJob.set(job, failed);
      if (isExportJob(job)) upsertRunLog(failed, { trigger });
    }, timeoutMs);
  }

  child.on("error", (err) => {
    if (killTimer) clearTimeout(killTimer);
    const cur = lastByJob.get(job);
    if (!cur || cur.runId !== runId) return;
    const failed = {
      ...cur,
      status: "failed" as const,
      finishedAt: new Date().toISOString(),
      message: err.message || String(err),
    };
    lastByJob.set(job, failed);
    if (isExportJob(job)) upsertRunLog(failed, { trigger, stdout });
  });

  child.on("close", (code) => {
    if (killTimer) clearTimeout(killTimer);
    const cur = lastByJob.get(job);
    if (!cur || cur.runId !== runId) return;
    // 已被超时逻辑标成 failed 则保留
    if (cur.status === "failed" && cur.finishedAt) return;
    const combined = `${stdout}\n${stderr}`.trim();
    const ok = code === 0;
    const warnLine = combined
      .split(/\r?\n/)
      .reverse()
      .find((l) => /warning|软探测|cookie|完成|FAIL|fatal/i.test(l));
    const done = {
      ...cur,
      status: (ok ? "ok" : "failed") as "ok" | "failed",
      finishedAt: new Date().toISOString(),
      exitCode: code,
      message: ok
        ? job === "keepalive" && cmd === "ui"
          ? warnLine?.includes("网络") || warnLine?.includes("抖动")
            ? `软探测完成（cookie 有效；网络探测不稳）· ${warnLine?.slice(0, 120) ?? ""}`
            : "软探测完成：本地 cookie 可用"
          : HINT[job].done
        : `Playwright ${job} 退出码 ${code}${combined ? `：${combined.slice(-400)}` : ""}`,
    };
    lastByJob.set(job, done);
    if (isExportJob(job)) upsertRunLog(done, { trigger, stdout: combined });
    if (cmd === "ui" && (job === "ads" || job === "sales")) {
      void ingestPortalAfterPwJob(job, shopIds, startedAt).then((note) => {
        const later = lastByJob.get(job);
        if (!later || later.runId !== runId) return;
        const base = later.message || (ok ? HINT[job].done : "失败");
        const withNote = {
          ...later,
          message: note ? `${base} · 入库 ${note}` : base,
        };
        lastByJob.set(job, withNote);
        upsertRunLog(withNote, { trigger, stdout: combined });
      });
    }
  });

  return getPwJobStatus(job);
}

let reaperTimer: ReturnType<typeof setInterval> | null = null;

/** 状态自愈：running/starting 但 pid 已死 → failed。不碰 hang（pid 仍活交给超时）。 */
export function reapDeadPwJobs(): number {
  let n = 0;
  for (const j of PW_JOBS) {
    const st = lastByJob.get(j);
    if (!st) continue;
    if (st.status !== "running" && st.status !== "starting") continue;
    const pid = st.pid;
    if (pid == null) continue;
    if (isPidAlive(pid)) continue;
    const failed: PwJobRun = {
      ...st,
      status: "failed",
      finishedAt: new Date().toISOString(),
      message: `进程已消失（疑似崩溃/被杀）pid=${pid}`,
    };
    lastByJob.set(j, failed);
    if (isExportJob(j)) {
      upsertRunLog(failed, {
        trigger: st.opts?.trigger === "schedule" ? "schedule" : "manual",
      });
    }
    n += 1;
    console.log(`[pw-rpa] reaper: ${j} runId=${st.runId} pid=${pid} → failed`);
  }
  return n;
}

export function startPwJobReaper(): void {
  if (reaperTimer) return;
  reaperTimer = setInterval(() => {
    try {
      reapDeadPwJobs();
    } catch (e) {
      console.log(`[pw-rpa] reaper error: ${e}`);
    }
  }, 30_000);
  reaperTimer.unref?.();
  console.log("[pw-rpa] job reaper started (30s)");
}

export function stopPwJobReaper(): void {
  if (!reaperTimer) return;
  clearInterval(reaperTimer);
  reaperTimer = null;
}

/** 测试用：写入一条 job 状态（勿用于生产路径） */
export function __setPwJobRunForTest(run: PwJobRun): void {
  lastByJob.set(run.job, { ...run, opts: run.opts ? { ...run.opts } : null });
}

export function mapPwRunToRequestStatus(
  job: PwJobName,
  runId: string,
): {
  requestId: string;
  status: "pending" | "done" | "failed" | "unknown";
  path: string | null;
  detail: string | null;
  finishedAt: string | null;
} {
  const st = getPwJobStatus(job);
  if (!st.runId || st.runId !== runId) {
    return {
      requestId: runId,
      status: "unknown",
      path: null,
      detail: null,
      finishedAt: null,
    };
  }
  if (st.status === "ok") {
    return {
      requestId: runId,
      status: "done",
      path: null,
      detail: st.message,
      finishedAt: st.finishedAt,
    };
  }
  if (st.status === "failed") {
    return {
      requestId: runId,
      status: "failed",
      path: null,
      detail: st.message,
      finishedAt: st.finishedAt,
    };
  }
  if (st.status === "starting" || st.status === "running") {
    return {
      requestId: runId,
      status: "pending",
      path: null,
      detail: st.message,
      finishedAt: null,
    };
  }
  return {
    requestId: runId,
    status: "unknown",
    path: null,
    detail: st.message,
    finishedAt: st.finishedAt,
  };
}
