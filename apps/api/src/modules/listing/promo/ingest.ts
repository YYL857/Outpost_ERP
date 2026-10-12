import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { listingPaths } from "../paths.js";
import type { PromoImage } from "./types.js";

const EXPECTED_NAMES = [
  "01-main-hero-9x16.jpg",
  "02-spec-lock-9x16.jpg",
  "03-size-fit-9x16.jpg",
  "04-tech-feature-9x16.jpg",
  "05-effect-number-9x16.jpg",
  "06-in-use-scene-9x16.jpg",
  "07-variant-only-9x16.jpg",
  "08-comfort-detail-9x16.jpg",
  "09-feature-summary-9x16.jpg",
];

/** Minimal JPEG / PNG dimension reader (no extra deps). */
export function readImageSize(
  buf: Buffer,
): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7),
        };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
  }
  return null;
}

function aspectOk(w?: number, h?: number, target = 9 / 16): boolean | undefined {
  if (!w || !h) return undefined;
  return Math.abs(w / h - target) < 0.02;
}

export function expectedFilenames(frameCount: number): string[] {
  return EXPECTED_NAMES.slice(0, Math.max(1, Math.min(frameCount, EXPECTED_NAMES.length)));
}

export function ingestPromoOutDir(opts: {
  draftId: string;
  jobId: string;
  outDirAbs: string;
  frameCount: number;
}): { images: PromoImage[]; missing: string[] } {
  const { draftId, jobId, outDirAbs, frameCount } = opts;
  const want = expectedFilenames(frameCount);
  const present = new Set(
    existsSync(outDirAbs)
      ? readdirSync(outDirAbs).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      : [],
  );

  const images: PromoImage[] = [];
  const missing: string[] = [];
  const root = listingPaths().root;

  for (const name of want) {
    // allow alternate extension
    const hit =
      [...present].find((f) => f.toLowerCase() === name.toLowerCase()) ||
      [...present].find((f) => f.startsWith(name.slice(0, 2) + "-") && /\.jpe?g$/i.test(f));
    if (!hit) {
      missing.push(name);
      continue;
    }
    const abs = join(outDirAbs, hit);
    const st = statSync(abs);
    let width: number | undefined;
    let height: number | undefined;
    try {
      const dim = readImageSize(readFileSync(abs));
      if (dim) {
        width = dim.width;
        height = dim.height;
      }
    } catch {
      /* ignore */
    }
    const relativePath = join("drafts", draftId, "promo", jobId, "out", hit).replace(
      /\\/g,
      "/",
    );
    // ensure path is under listing root when possible
    void root;
    images.push({
      filename: hit,
      relativePath,
      sizeBytes: st.size,
      width,
      height,
      aspectOk: aspectOk(width, height),
      updatedAt: st.mtime.toISOString(),
    });
  }

  // also pick up any extra jpgs not in list
  for (const f of present) {
    if (images.some((x) => x.filename === f)) continue;
    if (!/^\d{2}-/i.test(f)) continue;
    const abs = join(outDirAbs, f);
    const st = statSync(abs);
    let width: number | undefined;
    let height: number | undefined;
    try {
      const dim = readImageSize(readFileSync(abs));
      if (dim) {
        width = dim.width;
        height = dim.height;
      }
    } catch {
      /* ignore */
    }
    images.push({
      filename: f,
      relativePath: join("drafts", draftId, "promo", jobId, "out", f).replace(/\\/g, "/"),
      sizeBytes: st.size,
      width,
      height,
      aspectOk: aspectOk(width, height),
      updatedAt: st.mtime.toISOString(),
    });
  }

  images.sort((a, b) => a.filename.localeCompare(b.filename));
  return { images, missing };
}
