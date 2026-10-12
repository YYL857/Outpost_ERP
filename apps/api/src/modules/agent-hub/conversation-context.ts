/**
 * 会话上下文：滑动窗口 + 较早轮次压缩。
 * 压缩刻意丢掉库存/金额等易腐数字，只保留业务键与话题脉络，供代词指代。
 */

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
  /** 上一轮已命中的业务键（如 partnerSku=xxx / boxNo=yyy） */
  keys?: string[];
};

export type ConversationContextConfig = {
  /** 客户端最多接受的历史条数（含 user+assistant） */
  maxAcceptedTurns: number;
  /** 最近保留的原文轮次数（滑动窗口） */
  recentTurns: number;
  /** 超过此条数才压缩较早部分；≤ 则全部原文 */
  compressAfter: number;
  /** 单条内容截断 */
  maxTurnChars: number;
  /** 压缩摘要最大字符 */
  maxSummaryChars: number;
};

export type PreparedConversationContext = {
  /** 插入 system 与当前 question 之间的 messages */
  prefixMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** 供调试/审计 */
  meta: {
    acceptedTurns: number;
    recentTurns: number;
    compressedTurns: number;
    keys: string[];
    compressed: boolean;
  };
};

const DEFAULT_CFG: ConversationContextConfig = {
  maxAcceptedTurns: 24,
  recentTurns: 6,
  compressAfter: 6,
  maxTurnChars: 500,
  maxSummaryChars: 900,
};

/** 从正文/键字段里抽可指代的业务键（确定性，不靠 LLM） */
export function extractBusinessKeys(text: string): string[] {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];
  const found = new Set<string>();

  for (const m of raw.matchAll(
    /\b(partnerSku|boxNo|ticketNo|logisticsNo|orderId|trackingNo|forwarder)\s*[=:：]\s*([^\s,;，；|]+)/gi,
  )) {
    found.add(`${m[1]}=${m[2]}`);
  }

  // 箱号形态：2508-01-N1-K / 2508-01-N1
  for (const m of raw.matchAll(/\b(\d{4}-\d{2}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)\b/g)) {
    found.add(`boxNo?=${m[1]}`);
  }

  // 正文里显式点名的 PSKU / 订单（避免扫到普通英文词）
  for (const m of raw.matchAll(
    /(?:PSKU|partnerSku|合伙人SKU|SKU)\s*[#:=：]?\s*([A-Za-z0-9][A-Za-z0-9_-]{3,31})/gi,
  )) {
    found.add(`partnerSku?=${m[1]}`);
  }
  for (const m of raw.matchAll(
    /(?:订单号|orderId|Order)\s*[#:=：]?\s*([A-Za-z0-9][A-Za-z0-9_-]{4,31})/gi,
  )) {
    found.add(`orderId?=${m[1]}`);
  }

  return [...found].slice(0, 30);
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function normalizeTurns(
  history: ConversationTurn[] | undefined,
  cfg: ConversationContextConfig,
): ConversationTurn[] {
  if (!Array.isArray(history) || !history.length) return [];
  const out: ConversationTurn[] = [];
  for (const raw of history) {
    if (!raw || (raw.role !== "user" && raw.role !== "assistant")) continue;
    const content = clip(String(raw.content ?? ""), cfg.maxTurnChars);
    if (!content) continue;
    const keys = [
      ...new Set([
        ...(Array.isArray(raw.keys)
          ? raw.keys.map((k) => String(k).trim()).filter(Boolean)
          : []),
        ...extractBusinessKeys(content),
      ]),
    ].slice(0, 12);
    out.push({ role: raw.role, content, keys: keys.length ? keys : undefined });
  }
  return out.slice(-cfg.maxAcceptedTurns);
}

function sanitizeTopic(text: string): string {
  return clip(
    text
      // 去掉金额/库存等易腐数字，只留问法骨架
      .replace(
        /(?:库存|金额|运费|销量|利润|营收|可售|数量)[^，。；;\n]{0,24}/gi,
        "",
      )
      .replace(/\b\d+(\.\d+)?\s*(SAR|AED|CNY|元|件|箱)?\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
    48,
  );
}

function compressOlderTurns(
  older: ConversationTurn[],
  cfg: ConversationContextConfig,
): string {
  const keys = new Set<string>();
  const topics: string[] = [];
  for (const t of older) {
    for (const k of t.keys ?? []) keys.add(k);
    for (const k of extractBusinessKeys(t.content)) keys.add(k);
    if (t.role === "user") {
      const topic = sanitizeTopic(t.content);
      if (topic) topics.push(topic);
    }
  }

  // 压缩摘要故意不带助手结论里的数字事实，降低上下文腐烂
  const lines = [
    "【较早会话压缩·仅供指代，不可当证据】",
    keys.size
      ? `提到的业务键：${[...keys].slice(0, 20).join("、")}`
      : "提到的业务键：无明确键",
    topics.length
      ? `话题脉络：${topics.slice(-6).join(" → ")}`
      : "",
    "规则：历史库存/金额/状态/销量一律视为过期；「这个/那个」优先映射到上述业务键，并重新调用工具核实。",
  ].filter(Boolean);

  return clip(lines.join("\n"), cfg.maxSummaryChars);
}

/**
 * 将客户端 history 变成可注入 LLM 的前缀消息。
 * 策略：较早轮次 → 压缩摘要；最近 recentTurns 条 → 原文滑动窗口。
 */
export function prepareConversationContext(
  history: ConversationTurn[] | undefined,
  opts?: Partial<ConversationContextConfig>,
): PreparedConversationContext {
  const cfg: ConversationContextConfig = { ...DEFAULT_CFG, ...opts };
  const turns = normalizeTurns(history, cfg);
  if (!turns.length) {
    return {
      prefixMessages: [],
      meta: {
        acceptedTurns: 0,
        recentTurns: 0,
        compressedTurns: 0,
        keys: [],
        compressed: false,
      },
    };
  }

  const shouldCompress = turns.length > cfg.compressAfter;
  const recentCount = Math.min(cfg.recentTurns, turns.length);
  const recent = shouldCompress
    ? turns.slice(-recentCount)
    : turns;
  const older = shouldCompress ? turns.slice(0, -recentCount) : [];

  const allKeys = [
    ...new Set(turns.flatMap((t) => t.keys ?? [])),
  ].slice(0, 24);

  const prefixMessages: PreparedConversationContext["prefixMessages"] = [];

  if (older.length) {
    prefixMessages.push({
      role: "system",
      content: compressOlderTurns(older, cfg),
    });
  } else if (allKeys.length) {
    // 短会话也注入键清单，方便「这个商品」指代
    prefixMessages.push({
      role: "system",
      content: [
        "【会话指代提示】",
        `近期业务键：${allKeys.join("、")}`,
        "用户说「这个/那个/该商品」时优先映射到上述键；库存/金额等数字必须重新查工具，勿沿用历史结论。",
      ].join("\n"),
    });
  }

  for (const t of recent) {
    prefixMessages.push({ role: t.role, content: t.content });
  }

  return {
    prefixMessages,
    meta: {
      acceptedTurns: turns.length,
      recentTurns: recent.length,
      compressedTurns: older.length,
      keys: allKeys,
      compressed: older.length > 0,
    },
  };
}

export function conversationContextDefaults(): ConversationContextConfig {
  return { ...DEFAULT_CFG };
}
