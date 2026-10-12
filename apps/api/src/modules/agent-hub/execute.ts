import { agentHubRuntimeConfig } from "./config.js";
import { findToolDef } from "./openai-tools.js";

export type ToolExecResult = {
  toolId: string;
  ok: boolean;
  status: number;
  unavailable: boolean;
  source: string;
  /** 截断后的文本，供模型与 evidence */
  excerpt: string;
  /** 用于拼装 evidence 的短摘录 */
  evidenceSnippet: string;
  error?: string;
  ms: number;
};

/**
 * 经 loopback 调本机 API（转发登录 Cookie），超时即标 unavailable。
 * 大响应强制截断，避免拖垮 DeepSeek 上下文与延迟。
 */
export async function executeAgentTool(input: {
  toolId: string;
  args: Record<string, unknown>;
  cookieHeader?: string;
  authorization?: string;
}): Promise<ToolExecResult> {
  const cfg = agentHubRuntimeConfig();
  const def = findToolDef(input.toolId);
  const started = Date.now();
  if (!def) {
    return {
      toolId: input.toolId,
      ok: false,
      status: 0,
      unavailable: true,
      source: "",
      excerpt: "",
      evidenceSnippet: "",
      error: "unknown_tool",
      ms: 0,
    };
  }

  const url = buildUrl(cfg.loopbackBase, def.method, def.path, input.args);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (input.cookieHeader) headers.Cookie = input.cookieHeader;
  if (input.authorization) headers.Authorization = input.authorization;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.toolTimeoutMs);

  try {
    const init: RequestInit = {
      method: def.method,
      headers,
      signal: ac.signal,
    };
    if (def.method === "POST") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(pickBody(def.id, input.args));
    }
    const res = await fetch(url, init);
    const text = await res.text();
    const ms = Date.now() - started;
    if (!res.ok) {
      const unavailable = res.status >= 500 || res.status === 0;
      return {
        toolId: input.toolId,
        ok: false,
        status: res.status,
        unavailable,
        source: def.path,
        excerpt: text.slice(0, 400),
        evidenceSnippet: "",
        error: `http_${res.status}`,
        ms,
      };
    }
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
    const compact = compactResult(input.toolId, parsed, input.args, cfg.maxResultChars);
    return {
      toolId: input.toolId,
      ok: true,
      status: res.status,
      unavailable: false,
      source: def.path,
      excerpt: compact,
      evidenceSnippet: pickEvidenceSnippet(input.toolId, parsed, compact),
      ms,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const aborted = /abort/i.test(msg);
    return {
      toolId: input.toolId,
      ok: false,
      status: 0,
      unavailable: true,
      source: def.path,
      excerpt: "",
      evidenceSnippet: "",
      error: aborted ? "timeout" : msg.slice(0, 200),
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(
  base: string,
  method: string,
  path: string,
  args: Record<string, unknown>,
): string {
  const u = new URL(path, base.endsWith("/") ? base : `${base}/`);
  if (method === "GET") {
    for (const [k, v] of Object.entries(args)) {
      if (v == null || v === "") continue;
      if (k === "partnerSku" && path.startsWith("/api/catalog")) continue; // 非 API 参数
      if (typeof v === "object") u.searchParams.set(k, JSON.stringify(v));
      else u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

function pickBody(toolId: string, args: Record<string, unknown>): Record<string, unknown> {
  if (toolId === "ops.interpret") {
    return { surface: args.surface };
  }
  if (toolId === "wiki.rebuild") {
    return args.sources != null ? { sources: args.sources } : {};
  }
  return { ...args };
}

function compactResult(
  toolId: string,
  parsed: unknown,
  args: Record<string, unknown>,
  maxChars: number,
): string {
  const root = asObj(parsed);
  const data = root?.data ?? parsed;

  if (toolId === "catalog.query") {
    const sku = String(args.partnerSku ?? "").trim();
    const rows = Array.isArray(data) ? data : [];
    const filtered = sku
      ? rows.filter((r) => asObj(r)?.partnerSku === sku)
      : rows.slice(0, 8);
    const slim = filtered.slice(0, sku ? 3 : 8).map(slimCatalogRow);
    return clip(
      JSON.stringify({
        meta: asObj(root)?.meta ?? null,
        count: rows.length,
        filtered: sku || null,
        rows: slim,
      }),
      maxChars,
    );
  }

  if (toolId === "shipping.board") {
    const d = asObj(data);
    return clip(
      JSON.stringify({
        summary: d?.summary,
        packingInTransit: Array.isArray(d?.packingInTransit)
          ? d!.packingInTransit.slice(0, 12)
          : [],
        forwarderBoard: {
          ranking: asObj(d?.forwarderBoard)?.ranking,
          forwarders: asObj(d?.forwarderBoard)?.forwarders,
        },
      }),
      maxChars,
    );
  }

  if (toolId === "purchase.list") {
    const rows = Array.isArray(data) ? data.slice(0, 30) : data;
    return clip(JSON.stringify({ data: rows, meta: asObj(root)?.meta }), maxChars);
  }

  if (toolId === "replenish.query") {
    const d = asObj(data);
    const rows = Array.isArray(d?.rows) ? d!.rows : [];
    const urgent = rows
      .filter((r) => {
        const s = String(asObj(r)?.status ?? "");
        return /urgent|critical|缺|紧急/i.test(s);
      })
      .slice(0, 20);
    return clip(
      JSON.stringify({
        summary: d?.summary,
        sample: (urgent.length ? urgent : rows.slice(0, 15)).map(slimReplenishRow),
      }),
      maxChars,
    );
  }

  if (toolId === "wiki.context_pack") {
    const d = asObj(data);
    const entities = Array.isArray(d?.entities) ? d!.entities.slice(0, 25) : [];
    return clip(
      JSON.stringify({
        seed: d?.seed,
        nextActions: d?.nextActions,
        entities: entities.map((e) => ({
          id: asObj(e)?.id,
          type: asObj(e)?.type,
          summary: asObj(e)?.summary,
        })),
        markdownCard: String(d?.markdownCard ?? "").slice(0, 2500),
      }),
      maxChars,
    );
  }

  return clip(typeof parsed === "string" ? parsed : JSON.stringify(parsed), maxChars);
}

function pickEvidenceSnippet(
  toolId: string,
  parsed: unknown,
  compact: string,
): string {
  const root = asObj(parsed);
  const data = root?.data ?? parsed;
  if (toolId === "wiki.lookup") {
    const summary = String(asObj(asObj(data)?.node)?.summary ?? "").trim();
    if (summary) return summary.slice(0, 240);
  }
  if (toolId === "wiki.context_pack") {
    const entities = Array.isArray(asObj(data)?.entities)
      ? (asObj(data)!.entities as unknown[])
      : [];
    const summary = String(asObj(entities[0])?.summary ?? "").trim();
    if (summary) return summary.slice(0, 240);
  }
  if (toolId === "sales.query") {
    const d = asObj(data);
    if (d) {
      return `salesUnits=${d.salesUnits} amount=${d.salesAmount} ${d.currency ?? ""}`.slice(
        0,
        240,
      );
    }
  }
  if (toolId === "finance.query") {
    const d = asObj(data);
    if (d) {
      return `revenueSar=${d.revenueSar} salesRevenue=${d.salesRevenueSar ?? d.revenueSar} orderRevenue=${d.orderRevenueSar ?? "?"} profitCny=${d.profitCny}`.slice(
        0,
        240,
      );
    }
  }
  if (toolId === "shipping.board") {
    const s = asObj(asObj(data)?.summary);
    if (s) {
      return `packingInTransitBoxes=${s.packingInTransitBoxes} forwarders=${s.forwarderCount}`.slice(
        0,
        240,
      );
    }
  }
  return compact.slice(0, 240);
}

function slimCatalogRow(r: unknown) {
  const o = asObj(r);
  if (!o) return r;
  return {
    partnerSku: o.partnerSku,
    title: o.title,
    price: o.price ?? o.sellingPrice,
    inventory: o.inventory,
    local: o.local,
    isActive: o.isActive,
  };
}

function slimReplenishRow(r: unknown) {
  const o = asObj(r);
  if (!o) return r;
  return {
    partnerSku: o.partnerSku,
    title: o.title,
    status: o.status,
    availableDays: o.availableDays,
    dailyAvg: o.dailyAvg,
    inventory: o.inventory,
  };
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated ${s.length - max} chars]`;
}
