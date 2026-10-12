/**
 * 仅本品图片视觉理解 → 写入 ours.visionNotes。
 * 禁止用本模块生成 Listing 或写入 competitors。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deepseekConfig } from "../market-intel/brand-intel/deepseek.js";
import { listingVisionModel, parseJsonObject } from "./llm.js";
import { listingPaths } from "./paths.js";
import type { DraftImage, OursVisionNotes } from "./types.js";

const VISION_SYSTEM = `你是电商选品视觉分析助手。只根据图片可见信息输出 JSON，禁止编造看不见的参数/认证/功效。
输出严格 JSON：
{
  "appearance": string[],
  "features": string[],
  "packaging": string[],
  "visibleText": string[],
  "caveats": string[]
}
规则：
1. 只描述图中可见内容；不确定写入 caveats。
2. 不要输出 Listing 文案、不要输出阿拉伯语标题、不要提及竞争对手。
3. 每项短句，中文或英文均可，≤12 条/类。`;

function clipList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x || "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, max)
    .map((s) => (s.length > 120 ? s.slice(0, 120) : s));
}

function clampVision(parsed: unknown, model: string): OursVisionNotes {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  return {
    appearance: clipList(o.appearance, 12),
    features: clipList(o.features, 12),
    packaging: clipList(o.packaging, 8),
    visibleText: clipList(o.visibleText, 8),
    caveats: clipList(o.caveats, 8),
    model,
    builtAt: new Date().toISOString(),
  };
}

export async function runOursVision(images: DraftImage[]): Promise<OursVisionNotes> {
  const cfg = deepseekConfig();
  if (!cfg.apiKey) {
    throw new Error("DEEPSEEK_API_KEY 未配置（环境变量或仓库根 DS-key.txt）");
  }
  if (!images.length) {
    throw new Error("请先上传本品图片再做视觉理解");
  }

  const model = listingVisionModel();
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: "请分析下列本品图片，只输出视觉要点 JSON（appearance/features/packaging/visibleText/caveats）。",
    },
  ];

  const root = listingPaths().root;
  for (const img of images.slice(0, 6)) {
    const abs = join(root, img.relativePath);
    const buf = readFileSync(abs);
    const b64 = buf.toString("base64");
    const mime = img.mimeType || "image/jpeg";
    content.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${b64}` },
    });
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: VISION_SYSTEM },
        { role: "user", content },
      ],
    }),
  });
  const rawBody = await res.text();
  if (!res.ok) {
    throw new Error(`DeepSeek vision HTTP ${res.status}: ${rawBody.slice(0, 300)}`);
  }
  let text = "";
  try {
    const envelope = JSON.parse(rawBody) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    text = envelope.choices?.[0]?.message?.content ?? "";
  } catch {
    text = rawBody;
  }
  return clampVision(parseJsonObject(text), model);
}
