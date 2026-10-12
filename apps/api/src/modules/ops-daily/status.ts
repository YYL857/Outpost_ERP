/**
 * ops_daily 产物目录状态（只读，供前端展示）。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadOpsDailySettings } from "./config.js";

export type OpsDailyArtifact = {
  name: string;
  kind: "panel" | "weekly" | "landed" | "other";
  path: string;
  sizeBytes: number;
  mtimeIso: string;
};

function classify(name: string): OpsDailyArtifact["kind"] {
  if (name.startsWith("运营面板_今天") && name.endsWith(".csv")) return "panel";
  if (name.includes("每周信息") && name.endsWith(".csv")) return "weekly";
  if (name.includes("到仓成本") && name.endsWith(".csv")) return "landed";
  return "other";
}

export function listOpsDailyArtifacts(shopRootDir: string): {
  dir: string;
  artifacts: OpsDailyArtifact[];
} {
  const dir = join(shopRootDir, "ops_daily");
  if (!existsSync(dir)) {
    return { dir, artifacts: [] };
  }
  const artifacts: OpsDailyArtifact[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".csv") && !name.endsWith(".json")) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      artifacts.push({
        name,
        kind: classify(name),
        path,
        sizeBytes: st.size,
        mtimeIso: new Date(st.mtimeMs).toISOString(),
      });
    } catch {
      /* skip */
    }
  }
  artifacts.sort((a, b) => b.mtimeIso.localeCompare(a.mtimeIso));
  return { dir, artifacts };
}

export function resolveArtifactPath(
  shopRootDir: string,
  kind: "panel" | "weekly" | "landed",
  asOf?: string | null,
): string | null {
  const settings = loadOpsDailySettings();
  const dir = join(shopRootDir, "ops_daily");
  if (kind === "weekly") {
    return join(dir, "landed_产品表每周信息.csv");
  }
  if (kind === "landed") {
    return join(dir, "landed_到仓成本.csv");
  }
  const day = (asOf ?? "").trim().slice(0, 10);
  if (day) {
    const dated = join(dir, `${settings.output_file_prefix}_${day}.csv`);
    if (existsSync(dated)) return dated;
  }
  const phase = join(
    dir,
    `${settings.output_file_prefix}_phase${settings.phase ?? 4}.csv`,
  );
  if (existsSync(phase)) return phase;
  const { artifacts } = listOpsDailyArtifacts(shopRootDir);
  const panel = artifacts.find((a) => a.kind === "panel");
  return panel?.path ?? null;
}
