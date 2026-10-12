/**
 * 沙特情报来源注册表（S0）：种子源 + 人工粘贴片段。
 * 不绑死社媒爬虫；先登记再试采评分。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ensureMarketDirs, marketPaths, stamp } from "./paths.js";
import type {
  ConfidenceTier,
  IntelSource,
  IntelSourceHow,
  IntelSourceStatus,
  IntelSourceTopic,
  IntelSourceType,
  SourceRegistryFile,
  SourceSnippet,
} from "./types.js";

function nowIso() {
  return new Date().toISOString();
}

function tierOf(confidence: number): ConfidenceTier {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.55) return "mid";
  return "low";
}

const SEED_SOURCES: Omit<IntelSource, "updatedAt">[] = [
  {
    sourceId: "noon-reviews",
    title: "Noon 商品评论 / Q&A",
    type: "marketplace",
    locale: "ar/en",
    howWeGet: "extension",
    topics: ["pain", "demand", "sentiment"],
    score: 0.9,
    status: "active",
    note: "买家原文；差评周报主信源",
  },
  {
    sourceId: "gtrends-sa",
    title: "Google Trends · Saudi Arabia",
    type: "search",
    locale: "-",
    howWeGet: "manual_paste",
    topics: ["demand"],
    score: 0.85,
    status: "active",
    note: "需求涨跌；可后接 API",
  },
  {
    sourceId: "noon-suggest",
    title: "Noon 搜索联想",
    type: "search",
    locale: "ar/en",
    howWeGet: "extension",
    topics: ["demand"],
    score: 0.8,
    status: "trial",
    note: "关键词矿一期",
  },
  {
    sourceId: "yt-unbox-ar",
    title: "YouTube 阿语开箱/评测",
    type: "video",
    locale: "ar",
    howWeGet: "manual_paste",
    topics: ["demand", "aesthetic", "pain"],
    score: 0.7,
    status: "trial",
  },
  {
    sourceId: "arab-news",
    title: "Arab News / 消费向新闻",
    type: "news",
    locale: "en",
    howWeGet: "rss",
    topics: ["taboo", "macro"],
    score: 0.75,
    status: "active",
    note: "节日/监管/宏观，不直接选 SKU",
  },
  {
    sourceId: "ig-creators",
    title: "Instagram 本地达人",
    type: "social",
    locale: "ar",
    howWeGet: "manual_paste",
    topics: ["aesthetic", "demand"],
    score: 0.55,
    status: "trial",
  },
  {
    sourceId: "tiktok-sa",
    title: "TikTok Saudi 话题",
    type: "social",
    locale: "ar",
    howWeGet: "manual_paste",
    topics: ["demand", "aesthetic"],
    score: 0.5,
    status: "trial",
  },
  {
    sourceId: "snap-retail",
    title: "Snapchat 种草（抽样）",
    type: "social",
    locale: "ar",
    howWeGet: "manual_paste",
    topics: ["demand", "aesthetic"],
    score: 0.45,
    status: "watch",
    note: "接口弱；报告+人工抽样",
  },
  {
    sourceId: "x-ksa-retail",
    title: "X · 沙特零售/客诉",
    type: "social",
    locale: "ar",
    howWeGet: "manual_paste",
    topics: ["sentiment", "pain"],
    score: 0.4,
    status: "watch",
  },
  {
    sourceId: "haraj-signals",
    title: "Haraj 等分类信息",
    type: "classified",
    locale: "ar",
    howWeGet: "manual_paste",
    topics: ["demand"],
    score: 0.45,
    status: "watch",
  },
];

function emptyRegistry(): SourceRegistryFile {
  const now = nowIso();
  return {
    version: 1,
    market: "sa",
    updatedAt: now,
    sources: SEED_SOURCES.map((s) => ({ ...s, updatedAt: now })),
  };
}

export function loadSourceRegistry(): SourceRegistryFile {
  ensureMarketDirs("sa");
  const path = marketPaths("sa").sourceRegistry;
  if (!existsSync(path)) {
    const fresh = emptyRegistry();
    writeFileSync(path, JSON.stringify(fresh, null, 2), "utf8");
    return fresh;
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as SourceRegistryFile;
  if (!Array.isArray(raw.sources)) raw.sources = [];
  return raw;
}

export function saveSourceRegistry(
  file: SourceRegistryFile,
): SourceRegistryFile {
  ensureMarketDirs("sa");
  const next = { ...file, updatedAt: nowIso() };
  writeFileSync(
    marketPaths("sa").sourceRegistry,
    JSON.stringify(next, null, 2),
    "utf8",
  );
  return next;
}

export function listIntelSources(): IntelSource[] {
  return loadSourceRegistry().sources;
}

export function upsertIntelSource(input: {
  sourceId: string;
  title: string;
  type: IntelSourceType;
  locale?: string;
  howWeGet: IntelSourceHow;
  topics?: IntelSourceTopic[];
  score?: number;
  status?: IntelSourceStatus;
  note?: string;
}): IntelSource {
  const reg = loadSourceRegistry();
  const id = input.sourceId.trim().toLowerCase().replace(/\s+/g, "-");
  if (!id) throw new Error("sourceId required");
  const idx = reg.sources.findIndex((s) => s.sourceId === id);
  const now = nowIso();
  const next: IntelSource = {
    sourceId: id,
    title: input.title.trim(),
    type: input.type,
    locale: input.locale ?? "-",
    howWeGet: input.howWeGet,
    topics: input.topics ?? ["demand"],
    score: Math.max(0, Math.min(1, input.score ?? 0.5)),
    status: input.status ?? "trial",
    note: input.note,
    updatedAt: now,
  };
  if (idx >= 0) reg.sources[idx] = { ...reg.sources[idx]!, ...next };
  else reg.sources.push(next);
  saveSourceRegistry(reg);
  return next;
}

export function setIntelSourceStatus(
  sourceId: string,
  status: IntelSourceStatus,
): IntelSource | null {
  const reg = loadSourceRegistry();
  const s = reg.sources.find((x) => x.sourceId === sourceId);
  if (!s) return null;
  s.status = status;
  s.updatedAt = nowIso();
  saveSourceRegistry(reg);
  return s;
}

function defaultConfidenceForSource(source: IntelSource | undefined): number {
  if (!source) return 0.4;
  if (source.howWeGet === "manual_paste") return Math.min(0.9, source.score + 0.1);
  if (source.type === "marketplace") return Math.max(0.7, source.score);
  if (source.type === "search" || source.type === "news") return source.score;
  if (source.type === "social") return Math.min(source.score, 0.6);
  return source.score;
}

export function pasteSourceSnippet(input: {
  sourceId: string;
  text: string;
  title?: string;
  url?: string;
  topics?: IntelSourceTopic[];
}): SourceSnippet {
  const text = input.text.trim();
  if (!text) throw new Error("text required");
  const sourceId = input.sourceId.trim();
  if (!sourceId) throw new Error("sourceId required");

  const reg = loadSourceRegistry();
  let source = reg.sources.find((s) => s.sourceId === sourceId);
  if (!source) {
    source = upsertIntelSource({
      sourceId,
      title: sourceId,
      type: "other",
      howWeGet: "manual_paste",
      status: "trial",
      score: 0.5,
    });
  }

  const confidence = defaultConfidenceForSource(source);
  const flags: string[] = [];
  if (source.status === "watch" || source.status === "retired") {
    flags.push(`source_${source.status}`);
  }
  if (source.type === "social") flags.push("hypothesis_only");

  const snippet: SourceSnippet = {
    id: `snip_${stamp()}`,
    sourceId: source.sourceId,
    title: input.title?.trim() || null,
    text,
    url: input.url?.trim() || null,
    topics: input.topics?.length ? input.topics : source.topics,
    confidence,
    tier: tierOf(confidence),
    capturedAt: nowIso(),
    flags,
  };

  ensureMarketDirs("sa");
  const dir = join(marketPaths("sa").sourceSnippets, source.sourceId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${stamp()}_${snippet.id}.json`),
    JSON.stringify(snippet, null, 2),
    "utf8",
  );
  return snippet;
}

export function listSourceSnippets(opts?: {
  sourceId?: string;
  limit?: number;
}): SourceSnippet[] {
  ensureMarketDirs("sa");
  const root = marketPaths("sa").sourceSnippets;
  if (!existsSync(root)) return [];
  const dirs = opts?.sourceId
    ? [opts.sourceId].filter((d) => existsSync(join(root, d)))
    : readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

  const files: { path: string; name: string }[] = [];
  for (const d of dirs) {
    const dir = join(root, d);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      files.push({ path: join(dir, f), name: f });
    }
  }
  files.sort((a, b) => b.name.localeCompare(a.name));
  const limit = opts?.limit ?? 40;
  const out: SourceSnippet[] = [];
  for (const f of files.slice(0, limit)) {
    try {
      out.push(JSON.parse(readFileSync(f.path, "utf8")) as SourceSnippet);
    } catch {
      /* skip */
    }
  }
  return out;
}

export function sourceRegistrySummary() {
  const sources = listIntelSources();
  return {
    total: sources.length,
    active: sources.filter((s) => s.status === "active").length,
    trial: sources.filter((s) => s.status === "trial").length,
    watch: sources.filter((s) => s.status === "watch").length,
  };
}
