/**
 * 联网搜证（纯代码，不耗 LLM 额度）
 * 主路径：Bing HTML（本机可达）；DuckDuckGo / Wikipedia 作短超时兜底。
 */
import type { BrandEvidenceItem } from "./types.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 OutpostBrandIntel/1.0";

function decodeHtml(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string, timeoutMs = 12_000): Promise<string | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/json,*/*",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.6,ar;q=0.4",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function pushUnique(
  out: BrandEvidenceItem[],
  item: BrandEvidenceItem,
  seen: Set<string>,
) {
  const key = (item.url || "").toLowerCase();
  if (!item.url || seen.has(key)) return;
  if (!/^https?:\/\//i.test(item.url)) return;
  // 跳过 bing 自身追踪页
  if (/bing\.com\/(ck|aclick|search)/i.test(item.url)) return;
  seen.add(key);
  out.push({
    ...item,
    title: item.title.slice(0, 180),
    snippet: item.snippet.slice(0, 320),
  });
}

/** Bing 网页结果解析 */
async function searchBing(query: string): Promise<BrandEvidenceItem[]> {
  const q = encodeURIComponent(query);
  const html = await fetchText(
    `https://www.bing.com/search?q=${q}&setlang=en-us&mkt=en-SA&cc=SA`,
    15_000,
  );
  if (!html) return [];
  const out: BrandEvidenceItem[] = [];
  const seen = new Set<string>();

  // 常见结构：<li class="b_algo"> ... <h2><a href="URL">title</a></h2> ... <p>snippet</p>
  const blocks = html.split(/<li class="b_algo"/i).slice(1);
  for (const block of blocks) {
    if (out.length >= 6) break;
    const am = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!am) continue;
    let url = decodeHtml(am[1] || "");
    const title = decodeHtml(am[2] || "");
    const sm =
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i) ||
      block.match(/class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = decodeHtml(sm?.[1] || "");
    try {
      const u = new URL(url);
      // bing 跳转包装
      const u2 = u.searchParams.get("u") || u.searchParams.get("r");
      if (u2 && /^https?:/i.test(u2)) url = u2;
      if (u.hostname.includes("bing.com") && u.pathname.includes("/ck/")) {
        const ck = u.searchParams.get("u");
        if (ck) {
          try {
            // bing ck 常为 base64 变体
            const padded = ck.replace(/^a1/, "");
            const decoded = Buffer.from(padded, "base64").toString("utf8");
            if (/^https?:/i.test(decoded)) url = decoded;
          } catch {
            /* keep */
          }
        }
      }
    } catch {
      continue;
    }
    if (!title && !snippet) continue;
    pushUnique(
      out,
      { title, url, snippet, source: "bing" },
      seen,
    );
  }

  // 兜底：cite 链接
  if (!out.length) {
    const citeRe = /<cite[^>]*>([\s\S]*?)<\/cite>/gi;
    const hrefRe = /<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(html)) && out.length < 5) {
      pushUnique(
        out,
        {
          title: decodeHtml(m[2] || ""),
          url: decodeHtml(m[1] || ""),
          snippet: "",
          source: "other",
        },
        seen,
      );
    }
    void citeRe;
  }
  return out;
}

async function searchDuckDuckGo(query: string): Promise<BrandEvidenceItem[]> {
  const q = encodeURIComponent(query);
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${q}`, 8_000);
  if (!html) return [];
  const out: BrandEvidenceItem[] = [];
  const seen = new Set<string>();
  const re =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 4) {
    let url = decodeHtml(m[1] || "");
    try {
      const u = new URL(url, "https://duckduckgo.com");
      const uddg = u.searchParams.get("uddg");
      if (uddg) url = decodeURIComponent(uddg);
    } catch {
      continue;
    }
    pushUnique(
      out,
      {
        title: decodeHtml(m[2] || ""),
        url,
        snippet: decodeHtml(m[3] || ""),
        source: "duckduckgo",
      },
      seen,
    );
  }
  return out;
}

async function searchWikipedia(token: string): Promise<BrandEvidenceItem[]> {
  const q = encodeURIComponent(token);
  const searchJson = await fetchText(
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${q}&limit=3&namespace=0&format=json`,
    8_000,
  );
  if (!searchJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(searchJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length < 4) return [];
  const titles = parsed[1] as string[];
  const descs = parsed[2] as string[];
  const urls = parsed[3] as string[];
  const out: BrandEvidenceItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.min(titles.length, 3); i++) {
    pushUnique(
      out,
      {
        title: String(titles[i] || ""),
        url: String(urls[i] || ""),
        snippet: String(descs[i] || ""),
        source: "wikipedia",
      },
      seen,
    );
  }
  return out;
}

/** 丢掉明显与品牌无关的噪音 */
function evidenceMentionsToken(e: BrandEvidenceItem, token: string): boolean {
  const t = token.toLowerCase();
  if (t.length < 3) return true;
  const blob = `${e.title} ${e.snippet} ${e.url}`.toLowerCase();
  if (blob.includes(t)) return true;
  const compact = t.replace(/\s+/g, "");
  return compact.length >= 3 && blob.replace(/[\s_-]+/g, "").includes(compact);
}

/** 围绕沙特/海湾知名度构造查询并搜证 */
export async function gatherBrandEvidence(token: string): Promise<{
  evidence: BrandEvidenceItem[];
  queries: string[];
}> {
  const t = token.trim();
  const queries = [
    `"${t}" brand Saudi Arabia`,
    `"${t}" brand KSA OR UAE OR "Middle East"`,
    `"${t}" official website OR manufacturer OR company`,
  ];
  const seen = new Set<string>();
  const evidence: BrandEvidenceItem[] = [];

  for (const q of queries) {
    const rows = await searchBing(q);
    for (const r of rows) {
      if (!evidenceMentionsToken(r, t)) continue;
      pushUnique(evidence, r, seen);
    }
    if (evidence.length >= 6) break;
  }

  if (evidence.length < 3) {
    const ddg = await searchDuckDuckGo(`"${t}" brand Saudi Arabia`);
    for (const r of ddg) {
      if (!evidenceMentionsToken(r, t)) continue;
      pushUnique(evidence, r, seen);
    }
  }
  if (evidence.length < 3) {
    const wiki = await searchWikipedia(t);
    for (const r of wiki) {
      if (!evidenceMentionsToken(r, t)) continue;
      pushUnique(evidence, r, seen);
    }
  }

  const useful = evidence.filter(
    (e) => (e.title && e.title.length > 2) || (e.snippet && e.snippet.length > 8),
  );
  return { evidence: useful.slice(0, 8), queries };
}
