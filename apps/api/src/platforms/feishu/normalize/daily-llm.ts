/**
 * 日报简报 LLM：调用 DeepSeek → 校验钳制 → 渲染可读 Markdown。
 * 只读本地 filtered JSON / 规则包；不写飞书、不改云端表。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FeishuError } from "../errors.js";
import type { DailyBriefFiltered } from "./daily-rules.js";
import {
  DAILY_BRIEF_SYSTEM_PROMPT,
  buildDailyBriefUserPrompt,
  buildDailyLlmPayload,
  collectAllowedPartnerSkus,
  collectOfficialNames,
  type DailyLlmPayload,
} from "./daily-prompts.js";

export type DailyBriefItem = {
  partnerSku: string;
  productName: string;
  point: string;
  evidence: string;
};

export type DailyBriefAction = {
  partnerSku: string;
  productName: string;
  priority: "P0" | "P1" | "P2";
  action: string;
  why: string;
};

export type DailyBriefLlmJudgment = {
  headline: string;
  highlights: DailyBriefItem[];
  risks: DailyBriefItem[];
  actions: DailyBriefAction[];
  caveats: string[];
  confidence: "high" | "medium" | "low";
};

export type DailyBriefSummaryResult = {
  model: string;
  builtAt: string;
  payload: DailyLlmPayload;
  judgment: DailyBriefLlmJudgment;
  markdown: string;
  rawText: string;
  clampNotes: string[];
};

function monorepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
}

function resolveDeepseekApiKey(): string | null {
  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const keyFile = resolve(monorepoRoot(), "DS-key.txt");
  if (existsSync(keyFile)) {
    const raw = readFileSync(keyFile, "utf8").trim();
    if (raw) return raw;
  }
  return null;
}

export function dailyDeepseekConfig() {
  return {
    apiKey: resolveDeepseekApiKey(),
    baseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(
      /\/$/,
      "",
    ),
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  };
}

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, n);
}

function asPriority(v: unknown): "P0" | "P1" | "P2" {
  const s = String(v || "").toUpperCase();
  if (s === "P0" || s === "P1" || s === "P2") return s;
  return "P2";
}

function asConfidence(v: unknown): "high" | "medium" | "low" {
  const s = String(v || "").toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

function parseJsonObject(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]!);
      } catch {
        return {};
      }
    }
    return {};
  }
}

function scrubForbiddenGradeMentions(
  text: string,
  allowedGrades: Set<string>,
  notes: string[],
  where: string,
): string {
  let out = text;
  // 抓取「X+ 潜力新品」类片段；若不在白名单则替换
  const re =
    /\b([A-DX][+\-]?(?:\s|　)+[\u4e00-\u9fffA-Za-z0-9／/]{2,24})/g;
  const hits = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const label = m[1]!.trim();
    if (!allowedGrades.has(label)) hits.add(label);
  }
  // 也挡常见幻觉词
  for (const fake of ["S 核心利润款", "S级核心", "核心利润款", "爆款神品"]) {
    if (out.includes(fake) && !allowedGrades.has(fake)) hits.add(fake);
  }
  const ordered = [...hits].sort((a, b) => b.length - a.length);
  for (const h of ordered) {
    if (out.includes(h)) {
      notes.push(`清除疑似编造等级(${where}):${h}`);
      out = out.split(h).join("（等级见规则包）");
    }
  }
  // 清掉「S （等级见规则包）」这类残留
  out = out.replace(/S\s*（等级见规则包）/g, "（等级见规则包）");
  return out;
}

/**
 * 解析并钳制模型输出：丢掉未知 PSKU、纠正品名、截断条数与字数。
 */
export function parseAndClampDailyJudgment(
  raw: unknown,
  allowedSkus: Set<string>,
  officialNames: Map<string, string>,
  allowedGrades?: Set<string>,
): { judgment: DailyBriefLlmJudgment; clampNotes: string[] } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const notes: string[] = [];
  const grades = allowedGrades ?? new Set<string>();

  const mapItem = (x: unknown, bag: string): DailyBriefItem | null => {
    if (!x || typeof x !== "object") return null;
    const r = x as Record<string, unknown>;
    const partnerSku = String(r.partnerSku || "").trim();
    if (!partnerSku || !allowedSkus.has(partnerSku)) {
      if (partnerSku) notes.push(`丢弃${bag}未知PSKU:${partnerSku}`);
      return null;
    }
    const official = officialNames.get(partnerSku);
    const productName = official || clip(String(r.productName || ""), 80);
    if (official && String(r.productName || "").trim() && String(r.productName).trim() !== official) {
      notes.push(`纠正品名:${partnerSku}`);
    }
    return {
      partnerSku,
      productName,
      point: scrubForbiddenGradeMentions(
        clip(String(r.point || ""), 80),
        grades,
        notes,
        bag,
      ),
      evidence: scrubForbiddenGradeMentions(
        clip(String(r.evidence || ""), 120),
        grades,
        notes,
        bag,
      ),
    };
  };

  const mapAction = (x: unknown): DailyBriefAction | null => {
    if (!x || typeof x !== "object") return null;
    const r = x as Record<string, unknown>;
    const partnerSku = String(r.partnerSku || "").trim();
    if (!partnerSku || !allowedSkus.has(partnerSku)) {
      if (partnerSku) notes.push(`丢弃action未知PSKU:${partnerSku}`);
      return null;
    }
    const official = officialNames.get(partnerSku);
    return {
      partnerSku,
      productName: official || clip(String(r.productName || ""), 80),
      priority: asPriority(r.priority),
      action: clip(String(r.action || ""), 60),
      why: scrubForbiddenGradeMentions(
        clip(String(r.why || ""), 100),
        grades,
        notes,
        "action",
      ),
    };
  };

  const highlights = (Array.isArray(o.highlights) ? o.highlights : [])
    .map((x) => mapItem(x, "highlight"))
    .filter((x): x is DailyBriefItem => Boolean(x))
    .slice(0, 5);

  const risks = (Array.isArray(o.risks) ? o.risks : [])
    .map((x) => mapItem(x, "risk"))
    .filter((x): x is DailyBriefItem => Boolean(x))
    .slice(0, 5);

  // 同 SKU 若同时出现在 highlights 与 risks，保留 risks
  const riskSkus = new Set(risks.map((r) => r.partnerSku));
  const highlightsDedup = highlights.filter((h) => {
    if (riskSkus.has(h.partnerSku)) {
      notes.push(`highlight让位于risk:${h.partnerSku}`);
      return false;
    }
    return true;
  });

  const actions = (Array.isArray(o.actions) ? o.actions : [])
    .map(mapAction)
    .filter((x): x is DailyBriefAction => Boolean(x))
    .sort((a, b) => a.priority.localeCompare(b.priority))
    .slice(0, 8);

  const caveats = (Array.isArray(o.caveats) ? o.caveats : [])
    .map((c) => clip(String(c || ""), 120))
    .filter(Boolean)
    .slice(0, 5);

  let confidence = asConfidence(o.confidence);
  if (!highlightsDedup.length && !risks.length && !actions.length) {
    confidence = "low";
    notes.push("模型未产出有效条目，confidence→low");
  }

  return {
    clampNotes: notes,
    judgment: {
      headline: scrubForbiddenGradeMentions(
        clip(String(o.headline || "日报简报（模型未给出总览）"), 120),
        grades,
        notes,
        "headline",
      ),
      highlights: highlightsDedup,
      risks,
      actions,
      caveats,
      confidence,
    },
  };
}

/** 统一可读 Markdown（推送/存档用；不依赖模型自由排版） */
export function renderDailyBriefMarkdown(
  judgment: DailyBriefLlmJudgment,
  meta: {
    currentSheet: string;
    previousSheet: string | null;
    confidence: string;
  },
): string {
  const lines: string[] = [];
  lines.push(`# 运营日报简报（${meta.currentSheet}${meta.previousSheet ? ` vs ${meta.previousSheet}` : ""}）`);
  lines.push("");
  lines.push(`> ${judgment.headline}`);
  lines.push("");
  lines.push(`置信度：${judgment.confidence}`);
  lines.push("");

  lines.push("## 亮点");
  if (!judgment.highlights.length) {
    lines.push("- （无）");
  } else {
    for (const h of judgment.highlights) {
      lines.push(
        `- **${h.productName}**（\`${h.partnerSku}\`）：${h.point} — _${h.evidence}_`,
      );
    }
  }
  lines.push("");

  lines.push("## 风险");
  if (!judgment.risks.length) {
    lines.push("- （无）");
  } else {
    for (const r of judgment.risks) {
      lines.push(
        `- **${r.productName}**（\`${r.partnerSku}\`）：${r.point} — _${r.evidence}_`,
      );
    }
  }
  lines.push("");

  lines.push("## 今日建议跟进");
  if (!judgment.actions.length) {
    lines.push("- （无）");
  } else {
    for (const a of judgment.actions) {
      lines.push(
        `- [${a.priority}] **${a.productName}**（\`${a.partnerSku}\`）：${a.action}（${a.why}）`,
      );
    }
  }
  lines.push("");

  lines.push("## 数据说明");
  if (!judgment.caveats.length) {
    lines.push("- （无额外缺口说明）");
  } else {
    for (const c of judgment.caveats) lines.push(`- ${c}`);
  }
  lines.push("");
  lines.push("_本简报仅基于本地导出的日报规则包生成，未修改飞书源表。_");
  lines.push("");
  return lines.join("\n");
}

export async function summarizeDailyBriefWithLlm(
  filtered: DailyBriefFiltered,
  opts?: { watchlistMax?: number },
): Promise<DailyBriefSummaryResult> {
  const cfg = dailyDeepseekConfig();
  if (!cfg.apiKey) {
    throw new FeishuError(
      "DEEPSEEK_API_KEY 未配置",
      "CONFIG_MISSING",
      "normalize",
      {},
      "设置环境变量 DEEPSEEK_API_KEY 或仓库根 DS-key.txt",
    );
  }

  const payload = buildDailyLlmPayload(filtered, {
    watchlistMax: opts?.watchlistMax,
  });
  if (!payload.watchlist.length && !payload.deltas.salesUpTop.length) {
    throw new FeishuError(
      "规则包为空，拒绝调用模型",
      "NORMALIZE_EMPTY",
      "normalize",
      { currentSheet: filtered.currentSheet },
      "先确认 daily_brief_filtered.json 有 watchlist/deltas",
    );
  }

  const allowed = collectAllowedPartnerSkus(payload);
  const names = collectOfficialNames(payload);
  const allowedGrades = new Set(payload.allowedGradeLabels);

  const body = {
    model: cfg.model,
    temperature: 0.15,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: DAILY_BRIEF_SYSTEM_PROMPT },
      { role: "user", content: buildDailyBriefUserPrompt(payload) },
    ],
  };

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new FeishuError(
      `DeepSeek HTTP ${res.status}`,
      "API_HTTP",
      "normalize",
      { status: res.status, body: errText.slice(0, 240) },
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = data.choices?.[0]?.message?.content || "";
  const parsed = parseJsonObject(rawText);
  const { judgment, clampNotes } = parseAndClampDailyJudgment(
    parsed,
    allowed,
    names,
    allowedGrades,
  );

  // 缺 previous 时强制压低置信度
  if (!filtered.previousSheet && judgment.confidence === "high") {
    judgment.confidence = "medium";
    clampNotes.push("无previousSheet，confidence high→medium");
  }
  if (filtered.noiseStats.emptyReplenishPlan >= filtered.noiseStats.currentSkuTotal * 0.9) {
    const tip = "规则包显示补货计划字段几乎全空，勿据此安排补货";
    if (!judgment.caveats.some((c) => c.includes("补货"))) {
      judgment.caveats = [...judgment.caveats, tip].slice(0, 5);
    }
  }

  const builtAt = new Date().toISOString();
  const markdown = renderDailyBriefMarkdown(judgment, {
    currentSheet: filtered.currentSheet,
    previousSheet: filtered.previousSheet,
    confidence: judgment.confidence,
  });

  return {
    model: cfg.model,
    builtAt,
    payload,
    judgment,
    markdown,
    rawText,
    clampNotes,
  };
}

export function loadDailyBriefFiltered(path: string): DailyBriefFiltered {
  if (!existsSync(path)) {
    throw new FeishuError(
      "找不到 daily_brief_filtered.json",
      "SNAPSHOT_MISSING",
      "normalize",
      { path },
      "先运行 feishu-normalize-daily.ts",
    );
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DailyBriefFiltered;
  } catch (e) {
    throw new FeishuError(
      "daily_brief_filtered.json 损坏",
      "SNAPSHOT_INVALID",
      "normalize",
      { path, cause: e instanceof Error ? e.message : String(e) },
    );
  }
}

export function resolveLastDailyFilteredPath(): string {
  const fromEnv = process.env.OUTPOST_FEISHU_NORMALIZED_DIR?.trim();
  const root = fromEnv
    ? resolve(fromEnv)
    : resolve(
        process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data",
        "feishu-normalized",
      );
  const lastPath = join(root, "last-daily-brief.json");
  if (!existsSync(lastPath)) {
    throw new FeishuError(
      "没有 last-daily-brief.json",
      "SNAPSHOT_MISSING",
      "normalize",
      { lastPath },
      "先运行 feishu-normalize-daily.ts",
    );
  }
  const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
    filteredPath?: string;
  };
  if (!last.filteredPath) {
    throw new FeishuError(
      "last-daily-brief.json 缺少 filteredPath",
      "SNAPSHOT_INVALID",
      "normalize",
      { lastPath },
    );
  }
  return last.filteredPath;
}

export async function summarizeDailyBriefFromFile(opts?: {
  filteredPath?: string;
  watchlistMax?: number;
}): Promise<DailyBriefSummaryResult & { filteredPath: string; outPaths: {
  judgmentPath: string;
  markdownPath: string;
} }> {
  const filteredPath =
    opts?.filteredPath && opts.filteredPath !== "last"
      ? opts.filteredPath
      : resolveLastDailyFilteredPath();
  const filtered = loadDailyBriefFiltered(filteredPath);
  const result = await summarizeDailyBriefWithLlm(filtered, {
    watchlistMax: opts?.watchlistMax,
  });

  const outDir = dirname(filteredPath);
  mkdirSync(outDir, { recursive: true });
  const judgmentPath = join(outDir, "daily_brief_summary.json");
  const markdownPath = join(outDir, "daily_brief_summary.md");
  writeFileSync(
    judgmentPath,
    JSON.stringify(
      {
        version: 1,
        builtAt: result.builtAt,
        model: result.model,
        filteredPath,
        clampNotes: result.clampNotes,
        judgment: result.judgment,
        markdownPath,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  writeFileSync(markdownPath, result.markdown, "utf8");

  return {
    ...result,
    filteredPath,
    outPaths: { judgmentPath, markdownPath },
  };
}
