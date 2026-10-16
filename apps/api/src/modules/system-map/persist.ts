import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTPOST_ROOT } from "../../shops/registry.js";
import { OUTPOST_SYSTEM_CATALOG } from "./catalog.js";
import { buildSystemMapMarkdown, buildSystemPreload } from "./render.js";

export function systemMapDiskDir(): string {
  const dir = join(OUTPOST_ROOT, "agent-hub");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** 仓库内 Skill 镜像：apps/api/src/modules/system-map → .cursor/skills/... */
export function skillPreloadPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../../../../.cursor/skills/outpost-system-map/preload.md");
}

export function persistSystemMap(): {
  diskMd: string;
  diskJson: string;
  skillMd: string;
  charCount: number;
} {
  const preload = buildSystemPreload();
  const fullMd = buildSystemMapMarkdown();
  const dir = systemMapDiskDir();
  const diskMd = join(dir, "system-preload.md");
  const diskJson = join(dir, "system-map.json");
  const skillMd = skillPreloadPath();
  writeFileSync(diskMd, preload.markdown, "utf8");
  writeFileSync(
    diskJson,
    JSON.stringify(
      { preload, catalog: OUTPOST_SYSTEM_CATALOG, fullMarkdown: fullMd },
      null,
      2,
    ),
    "utf8",
  );
  const skillDir = dirname(skillMd);
  if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillMd, preload.markdown, "utf8");
  return { diskMd, diskJson, skillMd, charCount: preload.charCount };
}
