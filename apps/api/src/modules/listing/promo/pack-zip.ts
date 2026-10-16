/**
 * Listing promo job pack zip for LAN clients.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { zipStore, type ZipEntry } from "../../../common/zip-store.js";
import { promoJobDir } from "../paths.js";

function walkFiles(dir: string, base: string): { rel: string; abs: string }[] {
  if (!existsSync(dir)) return [];
  const out: { rel: string; abs: string }[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walkFiles(abs, base));
    } else if (st.isFile()) {
      out.push({ abs, rel: relative(base, abs) });
    }
  }
  return out;
}

const CLIENT_README = `Listing promo pack — run on YOUR PC

1. Unzip this folder.
2. Open the folder in Cursor (File → Open Folder).
3. Paste the full contents of prompt.md into Cursor Agent and send.
4. Save finished jpgs into the out/ folder (names like 01-main-hero-9x16.jpg).
5. Back in Outpost Listing page: click「上传成品图」and select the jpgs from out/.

Do NOT use「打开出图文件夹」on a LAN IP — that opens the server PC.
`;

/**
 * Zip prompt.md + refs/ (+ README) for a promo job so remote clients can work locally.
 */
export function buildPromoPackZip(
  draftId: string,
  jobId: string,
): { zip: Buffer; filename: string } | null {
  const jobDir = promoJobDir(draftId, jobId);
  const promptPath = join(jobDir, "prompt.md");
  if (!existsSync(promptPath)) return null;

  const entries: ZipEntry[] = [
    { name: "README-CLIENT.txt", data: Buffer.from(CLIENT_README, "utf8") },
    { name: "prompt.md", data: readFileSync(promptPath) },
  ];

  const refsDir = join(jobDir, "refs");
  for (const f of walkFiles(refsDir, jobDir)) {
    entries.push({
      name: f.rel.replace(/\\/g, "/"),
      data: readFileSync(f.abs),
    });
  }

  entries.push({ name: "out/.keep", data: Buffer.from("", "utf8") });

  const zip = zipStore(entries);
  const tag = createHash("sha1").update(jobId).digest("hex").slice(0, 6);
  return { zip, filename: `listing-promo-${jobId.slice(0, 18)}-${tag}.zip` };
}

export { zipStore } from "../../../common/zip-store.js";
