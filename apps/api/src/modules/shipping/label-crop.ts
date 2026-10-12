import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFPage,
} from "pdf-lib";

export class LabelCropError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelCropError";
  }
}

export type PdfRect = { x0: number; y0: number; x1: number; y1: number };

export type CroppedLabelPdf = {
  pdfBytes: Uint8Array;
  pageCount: number;
  widthPt: number;
  heightPt: number;
};

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 80;
const BORDER_THICK = 2.5;
const BORDER_MIN_LEN = 10;
const CLIP_PAD = 0.75;
const MIN_LABEL = 40;

export function croppedDownloadName(original: string): string {
  const base =
    original
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop()
      ?.trim() || "labels.pdf";
  const stem = base.replace(/\.pdf$/i, "");
  if (/裁标$/.test(stem)) return `${stem}.pdf`;
  return `${stem}-裁标.pdf`;
}

export function decodePdfBase64(raw: string): Uint8Array {
  const b64 = raw.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!b64) throw new LabelCropError("请上传 PDF 文件");
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    throw new LabelCropError("PDF 内容无法解码");
  }
  if (buf.length < 5 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new LabelCropError("不是有效的 PDF 文件");
  }
  if (buf.length > MAX_BYTES) {
    throw new LabelCropError("PDF 超过 15MB，请拆成更小的文件");
  }
  return new Uint8Array(buf);
}

export function unionRects(rects: PdfRect[]): PdfRect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x0);
    y0 = Math.min(y0, r.y0);
    x1 = Math.max(x1, r.x1);
    y1 = Math.max(y1, r.y1);
  }
  return { x0, y0, x1, y1 };
}

export function padRect(r: PdfRect, pad: number, page: PdfRect): PdfRect {
  return {
    x0: Math.max(page.x0, r.x0 - pad),
    y0: Math.max(page.y0, r.y0 - pad),
    x1: Math.min(page.x1, r.x1 + pad),
    y1: Math.min(page.y1, r.y1 + pad),
  };
}

export function isBorderRect(r: PdfRect): boolean {
  const w = Math.abs(r.x1 - r.x0);
  const h = Math.abs(r.y1 - r.y0);
  const thick = Math.min(w, h);
  const len = Math.max(w, h);
  return thick > 0 && thick <= BORDER_THICK && len >= BORDER_MIN_LEN;
}

function rectsOverlap(a: PdfRect, b: PdfRect, grow: number): boolean {
  return (
    a.x0 - grow <= b.x1 + grow &&
    a.x1 + grow >= b.x0 - grow &&
    a.y0 - grow <= b.y1 + grow &&
    a.y1 + grow >= b.y0 - grow
  );
}

export function largestBorderCluster(borders: PdfRect[]): PdfRect | null {
  if (borders.length === 0) return null;
  const n = borders.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rectsOverlap(borders[i]!, borders[j]!, 2)) unite(i, j);
    }
  }
  const groups = new Map<number, PdfRect[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = groups.get(r) ?? [];
    list.push(borders[i]!);
    groups.set(r, list);
  }
  let best: PdfRect | null = null;
  let bestArea = -1;
  for (const list of groups.values()) {
    const u = unionRects(list);
    if (!u) continue;
    const area = Math.max(0, u.x1 - u.x0) * Math.max(0, u.y1 - u.y0);
    if (area > bestArea) {
      bestArea = area;
      best = u;
    }
  }
  return best;
}

type Matrix = [number, number, number, number, number, number];

function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

function transformRect(m: Matrix, x: number, y: number, w: number, h: number): PdfRect {
  return rectFromPoints([
    apply(m, x, y),
    apply(m, x + w, y),
    apply(m, x, y + h),
    apply(m, x + w, y + h),
  ]);
}

function rectFromPoints(pts: Array<[number, number]>): PdfRect {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

export function parseFilledRects(content: string): PdfRect[] {
  const s = content;
  const n = s.length;
  let i = 0;
  const stack: number[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const saved: Matrix[] = [];
  const filled: PdfRect[] = [];
  let pending: PdfRect | null = null;
  let path: Array<[number, number]> = [];

  const skipWs = () => {
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 37) {
        while (i < n && s.charCodeAt(i) !== 10 && s.charCodeAt(i) !== 13) i++;
        continue;
      }
      if (c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32) {
        i++;
        continue;
      }
      break;
    }
  };

  const skipString = () => {
    i++;
    let depth = 1;
    while (i < n && depth > 0) {
      const c = s.charCodeAt(i);
      if (c === 92) {
        i += 2;
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41) depth--;
      i++;
    }
  };

  while (i < n) {
    skipWs();
    if (i >= n) break;
    const ch = s[i]!;

    if (ch === "(") {
      skipString();
      continue;
    }
    if (ch === "<") {
      if (s[i + 1] === "<") {
        i += 2;
        continue;
      }
      i++;
      while (i < n && s[i] !== ">") i++;
      i++;
      continue;
    }
    if (ch === ">") {
      i += s[i + 1] === ">" ? 2 : 1;
      continue;
    }
    if (ch === "[") {
      i++;
      continue;
    }
    if (ch === "]") {
      i++;
      continue;
    }
    if (ch === "/") {
      i++;
      while (i < n && !/[ \t\r\n()<>[\]/%]/.test(s[i]!)) i++;
      continue;
    }

    if (ch === "+" || ch === "-" || ch === "." || (ch >= "0" && ch <= "9")) {
      const start = i;
      if (ch === "+" || ch === "-") i++;
      while (i < n && s[i]! >= "0" && s[i]! <= "9") i++;
      if (s[i] === ".") {
        i++;
        while (i < n && s[i]! >= "0" && s[i]! <= "9") i++;
      }
      if (s[i] === "e" || s[i] === "E") {
        i++;
        if (s[i] === "+" || s[i] === "-") i++;
        while (i < n && s[i]! >= "0" && s[i]! <= "9") i++;
      }
      stack.push(Number(s.slice(start, i)));
      continue;
    }

    const opStart = i;
    while (i < n && /[A-Za-z*'"]/.test(s[i]!)) i++;
    if (i === opStart) {
      i++;
      continue;
    }
    const op = s.slice(opStart, i);

    if (op === "q") saved.push(ctm);
    else if (op === "Q") {
      ctm = saved.pop() ?? [1, 0, 0, 1, 0, 0];
      pending = null;
      path = [];
    } else if (op === "cm" && stack.length >= 6) {
      const f = stack.pop()!;
      const e = stack.pop()!;
      const d = stack.pop()!;
      const c = stack.pop()!;
      const b = stack.pop()!;
      const a = stack.pop()!;
      ctm = mul(ctm, [a, b, c, d, e, f]);
    } else if (op === "m" && stack.length >= 2) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      path = [apply(ctm, x, y)];
    } else if (op === "l" && stack.length >= 2) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      path.push(apply(ctm, x, y));
    } else if (op === "h") {
      if (path[0]) path.push(path[0]);
    } else if (op === "re" && stack.length >= 4) {
      const h = stack.pop()!;
      const w = stack.pop()!;
      const y = stack.pop()!;
      const x = stack.pop()!;
      pending = transformRect(ctm, x, y, w, h);
      path = [];
    } else if (
      op === "f" ||
      op === "F" ||
      op === "f*" ||
      op === "B" ||
      op === "B*" ||
      op === "b" ||
      op === "b*"
    ) {
      if (pending) filled.push(pending);
      else if (path.length >= 3) filled.push(rectFromPoints(path));
      pending = null;
      path = [];
      stack.length = 0;
    } else if (op === "n" || op === "S" || op === "s") {
      pending = null;
      path = [];
      stack.length = 0;
    } else {
      stack.length = 0;
    }
  }
  return filled;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function streamBytes(obj: unknown): Uint8Array {
  if (obj instanceof PDFArray) {
    const parts: Uint8Array[] = [];
    for (let i = 0; i < obj.size(); i++) parts.push(streamBytes(obj.lookup(i)));
    return concatBytes(parts);
  }
  if (obj instanceof PDFRawStream) {
    return decodePDFRawStream({ dict: obj.dict, contents: obj.contents }).decode();
  }
  if (obj instanceof PDFStream) {
    try {
      return decodePDFRawStream({
        dict: obj.dict,
        contents: obj.getContents(),
      }).decode();
    } catch {
      return obj.getContents();
    }
  }
  throw new LabelCropError("页面内容无法解析");
}

function pageContentString(page: PDFPage): string {
  const raw = page.node.Contents();
  if (!raw) return "";
  const obj = raw instanceof PDFRef ? page.node.context.lookup(raw) : raw;
  const bytes = streamBytes(obj);
  return Buffer.from(bytes).toString("latin1");
}

function pageMediaRect(page: PDFPage): PdfRect {
  const { width, height } = page.getSize();
  return { x0: 0, y0: 0, x1: width, y1: height };
}

export function detectLabelClip(page: PDFPage): PdfRect {
  const media = pageMediaRect(page);
  const filled = parseFilledRects(pageContentString(page));
  const borders = filled.filter(isBorderRect);
  const cluster = largestBorderCluster(borders);
  if (!cluster) {
    throw new LabelCropError("未找到标签框线，请确认是货代打印的面单 PDF");
  }
  const w = cluster.x1 - cluster.x0;
  const h = cluster.y1 - cluster.y0;
  if (w < MIN_LABEL || h < MIN_LABEL) {
    throw new LabelCropError("识别到的标签过小，请换一份完整打印 PDF");
  }
  return padRect(cluster, CLIP_PAD, media);
}

export async function cropAwbLabelPdf(input: Uint8Array): Promise<CroppedLabelPdf> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(input, { ignoreEncryption: true });
  } catch {
    throw new LabelCropError("PDF 无法打开");
  }
  const pages = src.getPages();
  if (pages.length === 0) throw new LabelCropError("PDF 没有页面");
  if (pages.length > MAX_PAGES) {
    throw new LabelCropError(`页数超过 ${MAX_PAGES}，请拆分后再裁`);
  }

  const out = await PDFDocument.create();
  let widthPt = 0;
  let heightPt = 0;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    let clip: PdfRect;
    try {
      clip = detectLabelClip(page);
    } catch (e) {
      if (e instanceof LabelCropError) {
        throw new LabelCropError(`第 ${i + 1} 页：${e.message}`);
      }
      throw e;
    }
    const embedded = await out.embedPage(page, {
      left: clip.x0,
      bottom: clip.y0,
      right: clip.x1,
      top: clip.y1,
    });
    const w = embedded.width;
    const h = embedded.height;
    widthPt = w;
    heightPt = h;
    const next = out.addPage([w, h]);
    next.drawPage(embedded, { x: 0, y: 0, width: w, height: h });
  }
  const pdfBytes = await out.save({ useObjectStreams: false });
  return { pdfBytes, pageCount: pages.length, widthPt, heightPt };
}
