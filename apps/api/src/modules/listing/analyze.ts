import { callListingTextLlm } from "./llm.js";
import { withListingPlaybook } from "./playbook.js";
import type {
  AnalysisEdge,
  AttackAngle,
  CompetitorInput,
  CompetitorNormalized,
  ListingAnalysis,
  OursVisionNotes,
} from "./types.js";

const ANALYZE_SYSTEM = `你是 Noon（中东）电商对标分析助手。输入分两区：competitors（对手）与 ours（本品）。输出严格 JSON，字段隔离：
{
  "competitorNormalized": {
    "<competitorId>": {
      "title": string,
      "price": string,
      "brand": string,
      "bullets": string[],
      "descriptionSummary": string,
      "strengths": string[]
    }
  },
  "competitorPoints": [
    { "competitorId": string, "points": string[], "strengths": string[] }
  ],
  "ourEdges": [
    {
      "id": string,
      "angle": "appearance"|"function"|"price"|"packaging"|"battery"|"other",
      "claim": string,
      "evidence": string,
      "source": "ours"|"competitor_gap"|"user_note"
    }
  ],
  "attackAngles": [
    { "angle": "...", "summary": string, "edgeIds": string[] }
  ],
  "risks": string[]
}
硬规则：
1. competitor* 字段只描述对手，禁止写入我方品牌/我方文案。
2. ourEdges 只描述本品可打点；evidence 必须能追溯到 ours.visionNotes / user notes / 对手缺口。
3. 禁止编造 GTIN、认证、医疗功效；不确定放 risks。
4. 面向沙特/海湾市场：标注文化/宗教/夸大风险到 risks。
5. 简体中文输出分析文案；id 用 edge-1, edge-2...`;

const ANGLES: AttackAngle[] = [
  "appearance",
  "function",
  "price",
  "packaging",
  "battery",
  "other",
];

function asAngle(v: unknown): AttackAngle {
  const s = String(v || "");
  return (ANGLES.includes(s as AttackAngle) ? s : "other") as AttackAngle;
}

function clip(s: string, n: number) {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, n);
}

function clipStrArr(raw: unknown, max: number, len: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => clip(String(x || ""), len))
    .filter(Boolean)
    .slice(0, max);
}

function clampNormalized(raw: unknown): CompetitorNormalized {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    title: clip(String(o.title || ""), 160),
    price: clip(String(o.price || ""), 40),
    brand: clip(String(o.brand || ""), 80),
    bullets: clipStrArr(o.bullets, 10, 160),
    descriptionSummary: clip(String(o.descriptionSummary || ""), 400),
    strengths: clipStrArr(o.strengths, 8, 120),
  };
}

function clampAnalysis(
  parsed: unknown,
  competitorIds: string[],
  model: string,
): {
  analysis: ListingAnalysis;
  competitorNormalized: Record<string, CompetitorNormalized>;
} {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  const idSet = new Set(competitorIds);
  const competitorNormalized: Record<string, CompetitorNormalized> = {};
  const rawNorm =
    o.competitorNormalized && typeof o.competitorNormalized === "object"
      ? (o.competitorNormalized as Record<string, unknown>)
      : {};
  for (const id of competitorIds) {
    if (rawNorm[id]) competitorNormalized[id] = clampNormalized(rawNorm[id]);
  }

  const competitorPoints: ListingAnalysis["competitorPoints"] = [];
  if (Array.isArray(o.competitorPoints)) {
    for (const row of o.competitorPoints.slice(0, 6)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const competitorId = String(r.competitorId || "");
      if (!idSet.has(competitorId)) continue;
      competitorPoints.push({
        competitorId,
        points: clipStrArr(r.points, 10, 160),
        strengths: clipStrArr(r.strengths, 8, 120),
      });
    }
  }

  const ourEdges: AnalysisEdge[] = [];
  if (Array.isArray(o.ourEdges)) {
    let i = 0;
    for (const row of o.ourEdges.slice(0, 12)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      i += 1;
      const sourceRaw = String(r.source || "ours");
      const source =
        sourceRaw === "competitor_gap" || sourceRaw === "user_note"
          ? sourceRaw
          : "ours";
      ourEdges.push({
        id: clip(String(r.id || `edge-${i}`), 32),
        angle: asAngle(r.angle),
        claim: clip(String(r.claim || ""), 160),
        evidence: clip(String(r.evidence || ""), 200),
        source,
        selected: true,
      });
    }
  }

  const edgeIdSet = new Set(ourEdges.map((e) => e.id));
  const attackAngles: ListingAnalysis["attackAngles"] = [];
  if (Array.isArray(o.attackAngles)) {
    for (const row of o.attackAngles.slice(0, 8)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const edgeIds = clipStrArr(r.edgeIds, 12, 32).filter((id) => edgeIdSet.has(id));
      attackAngles.push({
        angle: asAngle(r.angle),
        summary: clip(String(r.summary || ""), 200),
        edgeIds,
      });
    }
  }

  return {
    competitorNormalized,
    analysis: {
      competitorPoints,
      ourEdges,
      attackAngles,
      risks: clipStrArr(o.risks, 10, 200),
      model,
      builtAt: new Date().toISOString(),
    },
  };
}

export async function runCompetitorOursAnalysis(input: {
  competitors: CompetitorInput[];
  visionNotes: OursVisionNotes | null;
  notes: string;
  ourPrice: string;
  brandEn: string;
}): Promise<{
  analysis: ListingAnalysis;
  competitorNormalized: Record<string, CompetitorNormalized>;
}> {
  if (!input.competitors.length) {
    throw new Error("请至少粘贴一条对手 Noon 链接及要点");
  }
  const payload = {
    competitors: input.competitors.map((c) => ({
      id: c.id,
      url: c.url,
      pastedTitle: c.pastedTitle,
      pastedPrice: c.pastedPrice,
      pastedBullets: c.pastedBullets,
      pastedDescription: c.pastedDescription,
    })),
    ours: {
      visionNotes: input.visionNotes,
      notes: input.notes,
      ourPrice: input.ourPrice,
      brandEn: input.brandEn,
    },
  };
  const { model, parsed } = await callListingTextLlm({
    system: withListingPlaybook(ANALYZE_SYSTEM, "create"),
    user: [
      "请对下列 JSON 做对标分析。记住：competitors 与 ours 隔离，不要把对手卖点写成我方文案。",
      "```json",
      JSON.stringify(payload),
      "```",
    ].join("\n"),
    temperature: 0.2,
  });
  return clampAnalysis(
    parsed,
    input.competitors.map((c) => c.id),
    model,
  );
}
