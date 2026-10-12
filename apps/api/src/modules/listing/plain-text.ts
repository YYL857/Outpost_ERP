/**
 * 长描述应对人可读纯文本；模型偶发包 <p> 等标签时剥掉。
 */
export function toPlainLongDescription(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return "";

  for (let i = 0; i < 3; i++) {
    const m = s.match(/^<p(?:\s[^>]*)?>\s*([\s\S]*?)\s*<\/p>\s*$/i);
    if (!m) break;
    s = m[1]!.trim();
  }

  if (/<\/?[a-z][\s\S]*>/i.test(s)) {
    s = s
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*p\s*>/gi, "\n")
      .replace(/<\s*p(?:\s[^>]*)?>/gi, "")
      .replace(/<\/\s*li\s*>/gi, "\n")
      .replace(/<\s*li(?:\s[^>]*)?>/gi, "• ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
