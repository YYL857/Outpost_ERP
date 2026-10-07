/**
 * Noon 商品标题 → 简体中文（运营对照阅读）。
 * 用 DeepSeek；结果写回 watchlist.titleZh，避免重复花钱。
 */
import { deepseekConfig } from "./brand-intel/deepseek.js";
import { loadWatchlist, saveWatchlist } from "./store.js";

export type TitleZhRow = {
  productKey: string;
  title: string;
  titleZh: string | null;
};

function looksMostlyChinese(s: string): boolean {
  const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  return zh >= Math.max(4, Math.floor(s.length * 0.35));
}

async function translateBatch(titles: string[]): Promise<string[]> {
  const cfg = deepseekConfig();
  if (!cfg.apiKey) {
    throw new Error("未配置 DeepSeek，无法翻译标题（DEEPSEEK_API_KEY 或 DS-key.txt）");
  }
  if (!titles.length) return [];

  const body = {
    model: cfg.model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你是跨境电商运营助手。把 Noon 沙特商品英文标题译成简体中文，保留品牌名与型号。" +
          "只输出 JSON：{\"translations\":[\"...\"]}，数组长度与输入完全一致，顺序一致。",
      },
      {
        role: "user",
        content: JSON.stringify({ titles }),
      },
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
    throw new Error(`DeepSeek HTTP ${res.status}: ${errText.slice(0, 240)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = data.choices?.[0]?.message?.content || "";
  let parsed: { translations?: unknown } = {};
  try {
    parsed = JSON.parse(rawText) as { translations?: unknown };
  } catch {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]!) as { translations?: unknown };
      } catch {
        parsed = {};
      }
    }
  }
  const arr = Array.isArray(parsed.translations) ? parsed.translations : [];
  return titles.map((t, i) => {
    const zh = typeof arr[i] === "string" ? String(arr[i]).trim() : "";
    return zh || t;
  });
}

/**
 * 为监控池条目补 titleZh（已有则跳过）。默认按 productKeys 或类目短名单。
 */
export async function ensureWatchlistTitleZh(opts: {
  productKeys?: string[];
  categoryId?: string;
  limit?: number;
  /** 忽略已有 titleZh，强制重译 */
  force?: boolean;
}): Promise<{
  translated: number;
  skipped: number;
  rows: TitleZhRow[];
  configured: boolean;
}> {
  const cfg = deepseekConfig();
  const configured = Boolean(cfg.apiKey);
  const wl = loadWatchlist();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 40);
  let targets = wl.items;

  if (opts.productKeys?.length) {
    const set = new Set(opts.productKeys);
    targets = targets.filter((i) => set.has(i.productKey));
  } else if (opts.categoryId) {
    targets = targets.filter((i) => i.categoryId === opts.categoryId);
  }

  const need: typeof targets = [];
  let skipped = 0;
  for (const item of targets) {
    if (!opts.force && item.titleZh && item.titleZh.trim()) {
      skipped += 1;
      continue;
    }
    if (looksMostlyChinese(item.title)) {
      item.titleZh = item.title;
      skipped += 1;
      continue;
    }
    need.push(item);
    if (need.length >= limit) break;
  }

  if (!need.length) {
    saveWatchlist(wl);
    const keys = new Set(
      (opts.productKeys?.length
        ? opts.productKeys
        : targets.slice(0, limit).map((i) => i.productKey)),
    );
    const rows = wl.items
      .filter((i) => keys.has(i.productKey))
      .map((i) => ({
        productKey: i.productKey,
        title: i.title,
        titleZh: i.titleZh ?? null,
      }));
    return { translated: 0, skipped, rows, configured };
  }

  if (!configured) {
    return {
      translated: 0,
      skipped,
      rows: need.map((i) => ({
        productKey: i.productKey,
        title: i.title,
        titleZh: null,
      })),
      configured: false,
    };
  }

  const zhList = await translateBatch(need.map((i) => i.title.slice(0, 240)));
  let translated = 0;
  for (let i = 0; i < need.length; i += 1) {
    const zh = zhList[i]?.trim();
    if (zh) {
      need[i]!.titleZh = zh.slice(0, 320);
      translated += 1;
    }
  }
  saveWatchlist(wl);

  const keySet = new Set(need.map((i) => i.productKey));
  if (opts.productKeys?.length) {
    for (const k of opts.productKeys) keySet.add(k);
  }
  const rows = wl.items
    .filter((i) => keySet.has(i.productKey))
    .map((i) => ({
      productKey: i.productKey,
      title: i.title,
      titleZh: i.titleZh ?? null,
    }));

  return { translated, skipped, rows, configured };
}
