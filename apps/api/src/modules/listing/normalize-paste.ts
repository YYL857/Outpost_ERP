/**
 * 将整段粘贴文案拆成对手字段（纯文本 LLM，不看图）
 */
import { callListingTextLlm } from "./llm.js";
import type { CompetitorInput } from "./types.js";

const SYSTEM = `你是电商对手信息结构化助手。把用户从 Noon 商品页复制的杂乱文本整理成 JSON：
{
  "pastedTitle": string,
  "pastedPrice": string,
  "pastedBullets": string,
  "pastedDescription": string,
  "brand": string
}
规则：
1. pastedBullets 用换行分隔每条卖点，不要编号前缀以外的装饰。
2. 只整理对手页内容，不要改写成我方 Listing，不要翻译成阿语。
3. 找不到的字段用空字符串。`;

function clip(s: string, n: number) {
  const t = String(s || "").trim();
  return t.length <= n ? t : t.slice(0, n);
}

export async function normalizeCompetitorPaste(input: {
  url?: string;
  rawText: string;
}): Promise<Pick<
  CompetitorInput,
  "pastedTitle" | "pastedPrice" | "pastedBullets" | "pastedDescription"
> & { brand: string }> {
  const raw = input.rawText.trim();
  if (!raw) {
    throw new Error("粘贴内容为空");
  }
  const { parsed } = await callListingTextLlm({
    system: SYSTEM,
    user: [
      input.url ? `对手 URL: ${input.url}` : "",
      "请结构化下列粘贴文本：",
      "```",
      raw.slice(0, 8000),
      "```",
    ]
      .filter(Boolean)
      .join("\n"),
    temperature: 0.1,
  });
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  return {
    pastedTitle: clip(String(o.pastedTitle || ""), 200),
    pastedPrice: clip(String(o.pastedPrice || ""), 40),
    pastedBullets: clip(String(o.pastedBullets || ""), 4000),
    pastedDescription: clip(String(o.pastedDescription || ""), 4000),
    brand: clip(String(o.brand || ""), 80),
  };
}
