/**
 * 从 catalog 渲染 L0 preload 与 L1 全图。
 */
import {
  OUTPOST_SYSTEM_CATALOG,
  type SystemCatalog,
} from "./catalog.js";

export type SystemPreloadCard = {
  version: 1;
  title: string;
  principle: string;
  charCount: number;
  markdown: string;
};

export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 2.5);
}

export function buildSystemPreload(
  catalog: SystemCatalog = OUTPOST_SYSTEM_CATALOG,
): SystemPreloadCard {
  const lines: string[] = [
    `# ${catalog.title} · Preload`,
    "",
    catalog.principle,
    "",
    "## Layers",
    ...catalog.layers.map(
      (l) => `- **${l.label}** (\`${l.where}\`): ${l.role}`,
    ),
    "",
    "## Data pipeline",
    ...catalog.pipeline.map((p, i) => `${i + 1}. ${p}`),
    "",
    "## Domains",
    ...catalog.domains.map(
      (d) => `- **${d.label}** \`${d.api}\` — ${d.code} — ${d.note}`,
    ),
    "",
    "## Read order",
    ...catalog.readOrder.map((p, i) => `${i + 1}. ${p}`),
    "",
    "## Entry files",
    ...catalog.entryFiles.map((f) => `- \`${f.path}\` — ${f.why}`),
    "",
    "## Constraints",
    ...catalog.constraints.map((c) => `- ${c}`),
    "",
    "## Boundaries",
    ...catalog.boundaries.map((b) => `- ${b}`),
    "",
    "深挖：`GET /api/system-map`（全挂载、UI、RPA、易错点）。",
  ];
  const markdown = lines.join("\n");
  return {
    version: 1,
    title: catalog.title,
    principle: catalog.principle,
    charCount: markdown.length,
    markdown,
  };
}

export function buildSystemMapMarkdown(
  catalog: SystemCatalog = OUTPOST_SYSTEM_CATALOG,
): string {
  const preload = buildSystemPreload(catalog);
  const lines: string[] = [
    preload.markdown,
    "",
    "## API mounts",
    ...catalog.apiMounts.map((m) => `- \`${m.path}\` — ${m.role}`),
    "",
    "## UI groups",
    ...catalog.uiGroups.map(
      (g) => `- **${g.group}**: ${g.modules.join(" · ")}`,
    ),
    "",
    "## Automation",
    ...catalog.automation.map(
      (a) => `- **${a.id}** (\`${a.where}\`): ${a.role}`,
    ),
    "",
    "## Pitfalls",
    ...catalog.pitfalls.map((p) => `- ${p}`),
  ];
  return lines.join("\n");
}
