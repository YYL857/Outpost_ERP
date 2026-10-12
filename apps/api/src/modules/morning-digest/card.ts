/**
 * 晨报 → 飞书 interactive 卡片（店内 / 情报两套标题，结构相同）。
 */
import type { DigestAction, DigestItem, DigestJudgment } from "./llm.js";

type CardElement = Record<string, unknown>;
type FontColor = "red" | "orange" | "green" | "blue" | "grey";

function font(color: FontColor, text: string): string {
  return `<font color='${color}'>${text}</font>`;
}

function displayName(name: string, max = 40): string {
  const t = name.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function mdDiv(content: string): CardElement {
  return { tag: "div", text: { tag: "lark_md", content } };
}

function hr(): CardElement {
  return { tag: "hr" };
}

function formatItem(item: DigestItem, tone: "up" | "down"): string {
  const name =
    tone === "up"
      ? font("green", displayName(item.name))
      : font("red", displayName(item.name));
  const badge = tone === "up" ? font("green", "↑") : font("red", "⚠");
  return [
    `**${badge} ${name}**（\`${item.id}\`）`,
    item.point ? `　${item.point}` : "",
    item.evidence ? `　${font("grey", item.evidence)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatAction(a: DigestAction): string {
  const color: FontColor =
    a.priority === "P0" ? "red" : a.priority === "P1" ? "orange" : "blue";
  return [
    `**${font(color, `[${a.priority}]`)} ${font(color, displayName(a.name))}**（\`${a.id}\`）`,
    a.action ? `　${a.action}` : "",
    a.why ? `　${font("grey", a.why)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDigestCard(input: {
  channel: "store" | "market-intel";
  titleDay: string;
  shopOrMarket: string;
  judgment: DigestJudgment;
  softNotes?: string[];
  degraded?: boolean;
}): Record<string, unknown> {
  const isStore = input.channel === "store";
  const headerTitle = isStore
    ? `店内晨报 · ${input.shopOrMarket}`
    : `市场情报晨报 · ${input.shopOrMarket}`;
  const template = input.degraded ? "orange" : isStore ? "blue" : "turquoise";

  const elements: CardElement[] = [];
  elements.push(
    mdDiv(
      `**${input.judgment.headline}**\n${font("grey", `${input.titleDay} · 置信 ${input.judgment.confidence}`)}`,
    ),
  );
  elements.push(hr());

  elements.push(mdDiv(`**亮点**`));
  if (!input.judgment.highlights.length) {
    elements.push(mdDiv(font("grey", "（无）")));
  } else {
    for (const h of input.judgment.highlights) {
      elements.push(mdDiv(formatItem(h, "up")));
    }
  }
  elements.push(hr());

  elements.push(mdDiv(`**风险**`));
  if (!input.judgment.risks.length) {
    elements.push(mdDiv(font("grey", "（无）")));
  } else {
    for (const r of input.judgment.risks) {
      elements.push(mdDiv(formatItem(r, "down")));
    }
  }
  elements.push(hr());

  elements.push(mdDiv(`**建议跟进**`));
  if (!input.judgment.actions.length) {
    elements.push(mdDiv(font("grey", "（无）")));
  } else {
    for (const a of input.judgment.actions) {
      elements.push(mdDiv(formatAction(a)));
    }
  }

  const caveats = [
    ...(input.softNotes ?? []),
    ...input.judgment.caveats,
  ].filter(Boolean);
  if (caveats.length) {
    elements.push(hr());
    elements.push(
      mdDiv(
        `**数据说明**\n${caveats.map((c) => `· ${c}`).join("\n")}`,
      ),
    );
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: headerTitle.slice(0, 50) },
      template,
    },
    elements,
  };
}
