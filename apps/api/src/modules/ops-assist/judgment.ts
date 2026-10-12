/** 解读结果形状与晨报一致，但文案不叫晨报。 */

export type OpsItem = {
  id: string;
  name: string;
  point: string;
  evidence: string;
};

export type OpsAction = {
  id: string;
  name: string;
  priority: "P0" | "P1" | "P2";
  action: string;
  why: string;
};

export type OpsJudgment = {
  headline: string;
  highlights: OpsItem[];
  risks: OpsItem[];
  actions: OpsAction[];
  caveats: string[];
  confidence: "high" | "medium" | "low";
};

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

function parseItems(raw: unknown, max: number): OpsItem[] {
  if (!Array.isArray(raw)) return [];
  const out: OpsItem[] = [];
  for (const row of raw.slice(0, max)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = clip(String(o.id || ""), 64);
    if (!id) continue;
    out.push({
      id,
      name: clip(String(o.name || id), 80),
      point: clip(String(o.point || ""), 160),
      evidence: clip(String(o.evidence || ""), 160),
    });
  }
  return out;
}

function parseActions(raw: unknown, max: number): OpsAction[] {
  if (!Array.isArray(raw)) return [];
  const out: OpsAction[] = [];
  for (const row of raw.slice(0, max)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = clip(String(o.id || ""), 64);
    if (!id) continue;
    out.push({
      id,
      name: clip(String(o.name || id), 80),
      priority: asPriority(o.priority),
      action: clip(String(o.action || ""), 160),
      why: clip(String(o.why || ""), 160),
    });
  }
  return out;
}

export function clampOpsJudgment(raw: unknown): OpsJudgment {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const caveats = Array.isArray(o.caveats)
    ? o.caveats
        .map((c) => clip(String(c || ""), 200))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  return {
    headline: clip(String(o.headline || "暂无总览"), 120),
    highlights: parseItems(o.highlights, 5),
    risks: parseItems(o.risks, 5),
    actions: parseActions(o.actions, 5),
    caveats,
    confidence: asConfidence(o.confidence),
  };
}

/** 数据缺口必须出现在 caveats，即使模型漏写。 */
export function unionCaveats(judgment: OpsJudgment, notes: string[]): OpsJudgment {
  const caveats = [...judgment.caveats];
  for (const note of notes) {
    const text = clip(note, 200);
    if (!text) continue;
    const key = text.slice(0, 24);
    if (caveats.some((c) => c.includes(key))) continue;
    caveats.push(text);
  }
  return { ...judgment, caveats: caveats.slice(0, 8) };
}

export function emptyJudgment(headline: string, caveats: string[]): OpsJudgment {
  return {
    headline,
    highlights: [],
    risks: [],
    actions: [],
    caveats,
    confidence: "low",
  };
}
