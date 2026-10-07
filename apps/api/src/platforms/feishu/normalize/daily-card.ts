/**
 * 日报简报 → 飞书 interactive 卡片。
 * 原则：版式直观 + 颜色分级；内容保留模型 judgment 全量。
 *
 * 飞书 lark_md 颜色：red / orange / green / blue / grey 等
 */
import type { DailyBriefFiltered } from "./daily-rules.js";
import type {
  DailyBriefAction,
  DailyBriefItem,
  DailyBriefLlmJudgment,
} from "./daily-llm.js";

type CardElement = Record<string, unknown>;
type FontColor = "red" | "orange" | "green" | "blue" | "grey";

export type DailyBriefCardInput = {
  judgment: DailyBriefLlmJudgment;
  filtered: Pick<
    DailyBriefFiltered,
    "currentSheet" | "previousSheet" | "overview" | "deltaCounts"
  >;
};

function font(color: FontColor, text: string): string {
  // 飞书卡片 lark_md：<font color='red'>…</font>
  return `<font color='${color}'>${text}</font>`;
}

function displayName(name: string, max = 40): string {
  const t = name.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function extractDeltaSales(evidence: string, point: string): number | null {
  const m = `${evidence} ${point}`.match(/dSales\s*=\s*([+-]?\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function formatDeltaBadge(tone: "up" | "down", dSales: number | null): string {
  if (dSales != null) {
    if (dSales > 0) return font("green", `↑${dSales}`);
    if (dSales < 0) return font("red", `↓${Math.abs(dSales)}`);
    return font("grey", "→0");
  }
  return tone === "up" ? font("green", "↑") : font("red", "↓");
}

/** 保留 point + evidence 全文，标题行按升降着色 */
function formatItemBlock(item: DailyBriefItem, tone: "up" | "down"): string {
  const dSales = extractDeltaSales(item.evidence, item.point);
  const badge = formatDeltaBadge(tone, dSales);
  const name = displayName(item.productName);
  const nameColored =
    tone === "up" ? font("green", name) : font("red", name);
  const point = item.point.trim();
  const evidence = item.evidence.trim();
  const lines = [
    `**${badge} ${nameColored}**（\`${item.partnerSku}\`）`,
    point ? `　${point}` : "",
    evidence ? `　${font("grey", evidence)}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function priorityColor(p: DailyBriefAction["priority"]): FontColor {
  if (p === "P0") return "red";
  if (p === "P1") return "orange";
  return "blue";
}

function formatActionBlock(a: DailyBriefAction): string {
  const name = displayName(a.productName);
  const color = priorityColor(a.priority);
  const tag = font(color, `[${a.priority}]`);
  const nameColored = font(color, name);
  const lines = [
    `**${tag} ${nameColored}**（\`${a.partnerSku}\`）`,
    a.action.trim() ? `　${a.action.trim()}` : "",
    a.why.trim() ? `　${font("grey", a.why.trim())}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function mdDiv(content: string): CardElement {
  return {
    tag: "div",
    text: { tag: "lark_md", content },
  };
}

function hr(): CardElement {
  return { tag: "hr" };
}

function field(
  label: string,
  value: string | number,
  valueColor?: FontColor,
): CardElement {
  const v =
    valueColor != null ? font(valueColor, String(value)) : String(value);
  return {
    is_short: true,
    text: {
      tag: "lark_md",
      content: `**${label}**\n${v}`,
    },
  };
}

function sectionItems(
  title: string,
  titleColor: FontColor,
  items: DailyBriefItem[],
  tone: "up" | "down",
): CardElement[] {
  const out: CardElement[] = [
    mdDiv(`**${font(titleColor, title)}**（${items.length}）`),
  ];
  if (!items.length) {
    out.push(mdDiv(font("grey", "暂无")));
    return out;
  }
  for (const item of items) {
    out.push(mdDiv(formatItemBlock(item, tone)));
  }
  return out;
}

/**
 * 构建飞书消息卡片 JSON（msg_type=interactive 的 content 对象）。
 */
export function buildDailyBriefCard(input: DailyBriefCardInput): Record<string, unknown> {
  const { judgment, filtered } = input;
  const titleSheet = filtered.previousSheet
    ? `${filtered.currentSheet} vs ${filtered.previousSheet}`
    : filtered.currentSheet;

  const needHandle = filtered.overview.clearPriority["需处理"] ?? 0;
  const confLabel =
    judgment.confidence === "high"
      ? "高"
      : judgment.confidence === "low"
        ? "低"
        : "中";
  const confColor: FontColor =
    judgment.confidence === "high"
      ? "green"
      : judgment.confidence === "low"
        ? "orange"
        : "blue";

  const actions = [...judgment.actions].sort((a, b) =>
    a.priority.localeCompare(b.priority),
  );

  const elements: CardElement[] = [];

  elements.push(
    mdDiv(
      `**${judgment.headline}**\n置信度：${font(confColor, confLabel)}`,
    ),
    hr(),
    {
      tag: "div",
      fields: [
        field("SKU", filtered.overview.skuCount),
        field("在线", filtered.overview.online, "green"),
        field("等级变", filtered.deltaCounts.grade, "orange"),
        field(
          "清货需处理",
          needHandle,
          needHandle > 0 ? "red" : "grey",
        ),
        field(
          "销量波动",
          filtered.deltaCounts.salesDeltaAbsGeMin,
          "orange",
        ),
        field("广告标签变", filtered.deltaCounts.adLoss, "orange"),
      ],
    },
    hr(),
  );

  elements.push(
    ...sectionItems("亮点", "green", judgment.highlights, "up"),
  );
  elements.push(hr());
  elements.push(...sectionItems("风险", "red", judgment.risks, "down"));
  elements.push(hr());

  elements.push(
    mdDiv(
      `**${font("orange", "今日建议跟进")}**（${actions.length}）　` +
        `${font("red", "P0")} / ${font("orange", "P1")} / ${font("blue", "P2")}`,
    ),
  );
  if (!actions.length) {
    elements.push(mdDiv(font("grey", "暂无")));
  } else {
    for (const a of actions) {
      elements.push(mdDiv(formatActionBlock(a)));
    }
  }

  elements.push(hr());
  elements.push(
    mdDiv(`**${font("grey", "数据说明")}**（${judgment.caveats.length}）`),
  );
  if (!judgment.caveats.length) {
    elements.push(mdDiv(font("grey", "无额外缺口说明")));
  } else {
    elements.push(
      mdDiv(
        judgment.caveats
          .map((c) => `• ${font("grey", c)}`)
          .join("\n"),
      ),
    );
  }

  elements.push(
    hr(),
    mdDiv(font("grey", "本地导出规则包生成 · 未修改飞书源表")),
  );

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: `运营日报 · ${titleSheet}`,
      },
    },
    elements,
  };
}
