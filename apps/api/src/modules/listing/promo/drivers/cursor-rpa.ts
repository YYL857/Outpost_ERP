/**
 * 本机键鼠唤起 Cursor（不用 SDK/API）。
 * 在 folder 投递之后调用：打开任务目录 → Ctrl+I → 粘贴 prompt → 发送。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PromoDriver, PromoHandoffPayload } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** apps/api/scripts/listing-promo-cursor-rpa/run.ps1 */
export function rpaScriptPath(): string {
  // drivers -> promo -> listing -> modules -> src -> api
  return join(
    __dirname,
    "../../../../../scripts/listing-promo-cursor-rpa/run.ps1",
  );
}

/** 键鼠全局互斥：同时只能有一个任务抢焦点 */
let rpaLock: Promise<void> = Promise.resolve();

export function isRpaEnabled(): boolean {
  const v = (process.env.LISTING_PROMO_RPA || "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

function runPowershell(
  script: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        ...args,
      ],
      {
        windowsHide: false,
        env: { ...process.env },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    const t = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({
        code: null,
        stdout,
        stderr: stderr + "\nRPA timeout",
      });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });
}

function parseResultJson(stdout: string): {
  ok?: boolean;
  message?: string;
  error?: string;
} | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
    } catch {
      /* try previous */
    }
  }
  return null;
}

/**
 * 对已落盘的任务目录执行键鼠 RPA。
 * @param workspaceDirAbs 建议用 draft 的 jobDir（含 prompt.md / refs / out）
 */
export async function invokeCursorRpa(opts: {
  workspaceDirAbs: string;
  promptPathAbs?: string;
}): Promise<{ ok: boolean; message?: string; error?: string }> {
  if (!isRpaEnabled()) {
    return {
      ok: false,
      error: "LISTING_PROMO_RPA=0，已跳过键鼠唤起",
    };
  }
  if (process.platform !== "win32") {
    return {
      ok: false,
      error: "键鼠 RPA 仅支持 Windows",
    };
  }
  const script = rpaScriptPath();
  if (!existsSync(script)) {
    return { ok: false, error: `找不到 RPA 脚本: ${script}` };
  }
  if (!existsSync(opts.workspaceDirAbs)) {
    return {
      ok: false,
      error: `任务目录不存在: ${opts.workspaceDirAbs}`,
    };
  }

  const timeoutMs = Number(
    process.env.LISTING_PROMO_RPA_TIMEOUT_MS || 120_000,
  );

  const prev = rpaLock;
  let release!: () => void;
  rpaLock = new Promise<void>((r) => {
    release = r;
  });
  await prev;

  try {
    const args = ["-JobDir", opts.workspaceDirAbs];
    if (opts.promptPathAbs) {
      args.push("-PromptPath", opts.promptPathAbs);
    }
    const { code, stdout, stderr } = await runPowershell(
      script,
      args,
      timeoutMs,
    );
    const parsed = parseResultJson(stdout);
    if (parsed?.ok) {
      return {
        ok: true,
        message: parsed.message || "已向本机 Cursor 发送提示词",
      };
    }
    const err =
      parsed?.error ||
      stderr.trim() ||
      stdout.trim() ||
      (code === null ? "RPA 超时" : `RPA 退出码 ${code}`);
    return { ok: false, error: err, message: parsed?.message };
  } finally {
    release();
  }
}

/** 驱动入口：假定 folder 已写好盘；此处只做键鼠 */
export const cursorRpaDriver: PromoDriver = {
  id: "rpa",
  async dispatch(payload: PromoHandoffPayload) {
    return invokeCursorRpa({
      workspaceDirAbs: payload.jobDirAbs,
      promptPathAbs: payload.promptPathAbs,
    });
  },
};
