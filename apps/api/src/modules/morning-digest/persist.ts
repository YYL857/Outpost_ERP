/**
 * 晨报上次运行落盘。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type DigestChannel = "store" | "market-intel";

export type DigestLastRun = {
  channel: DigestChannel;
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  message: string;
  triggeredBy: "schedule" | "manual";
  /** 墙钟已消费的上海日，防同日重复 */
  scheduledDay?: string | null;
  degraded?: boolean;
  detail?: unknown;
};

function rootDir(): string {
  const fromEnv = process.env.OUTPOST_MORNING_DIGEST_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  const outpost = process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data";
  return resolve(outpost, "morning-digest");
}

function pathFor(channel: DigestChannel): string {
  return join(
    rootDir(),
    channel === "store" ? "last-store.json" : "last-mi.json",
  );
}

export function loadLastRun(channel: DigestChannel): DigestLastRun | null {
  const p = pathFor(channel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DigestLastRun;
  } catch {
    return null;
  }
}

export function saveLastRun(run: DigestLastRun): void {
  mkdirSync(rootDir(), { recursive: true });
  writeFileSync(pathFor(run.channel), JSON.stringify(run, null, 2) + "\n", "utf8");
}

export function morningDigestDir(): string {
  return rootDir();
}
