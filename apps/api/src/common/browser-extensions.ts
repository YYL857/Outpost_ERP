/**
 * Pack Chrome extensions under apps/*-extension for ERP download / overwrite update.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipStore } from "./zip-store.js";

export type BrowserExtensionId = "listing" | "asn-booking";

export type BrowserExtensionMeta = {
  id: BrowserExtensionId;
  /** apps/ 下目录名 */
  folder: string;
  title: string;
  pageHint: string;
  version: string;
  available: boolean;
};

const DEFS: Array<{
  id: BrowserExtensionId;
  folder: string;
  title: string;
  pageHint: string;
  install: string;
}> = [
  {
    id: "listing",
    folder: "listing-extension",
    title: "Listing 对手采集",
    pageHint: "上架文案",
    install: `Outpost Listing 采集扩展

【首次安装】
1. 解压本 zip，得到 listing-extension 文件夹
2. Chrome → chrome://extensions → 打开「开发者模式」
3. 「加载已解压的扩展程序」→ 选中 listing-extension
4. 填写 Outpost 登录用户名 → 保存 → 测试连接

【更新到最新】
1. 在 ERP 重新下载本 zip
2. 解压后用新文件【覆盖】本机原 listing-extension 文件夹
3. chrome://extensions → 该扩展点「重新加载」

API 默认 http://192.168.1.112:8787
`,
  },
  {
    id: "asn-booking",
    folder: "asn-booking-extension",
    title: "约仓陪伴",
    pageHint: "物流管理",
    install: `Outpost 约仓陪伴扩展

【首次安装】
1. 解压本 zip，得到 asn-booking-extension 文件夹
2. Chrome → chrome://extensions → 打开「开发者模式」
3. 「加载已解压的扩展程序」→ 选中 asn-booking-extension
4. 在 Noon 页点扩展图标打开右侧侧栏

【更新到最新】
1. 在 ERP 重新下载本 zip
2. 解压后【覆盖】本机原 asn-booking-extension 文件夹
3. chrome://extensions → 该扩展点「重新加载」

API 默认 http://192.168.1.112:8787
`,
  },
];

function monorepoRoot(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  // common → src → api → apps → repo (4× ..)
  return resolve(here, "../../../..");
}

function extensionDir(folder: string): string {
  return join(monorepoRoot(), "apps", folder);
}

function walkFiles(dir: string, base: string): { rel: string; abs: string }[] {
  if (!existsSync(dir)) return [];
  const out: { rel: string; abs: string }[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walkFiles(abs, base));
    else if (st.isFile()) out.push({ abs, rel: relative(base, abs) });
  }
  return out;
}

function readManifestVersion(dir: string): string {
  const p = join(dir, "manifest.json");
  if (!existsSync(p)) return "0.0.0";
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as { version?: string };
    return String(j.version || "0.0.0").trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function listBrowserExtensions(): BrowserExtensionMeta[] {
  return DEFS.map((d) => {
    const dir = extensionDir(d.folder);
    const available = existsSync(dir);
    return {
      id: d.id,
      folder: d.folder,
      title: d.title,
      pageHint: d.pageHint,
      version: available ? readManifestVersion(dir) : "—",
      available,
    };
  });
}

export function isBrowserExtensionId(raw: string): raw is BrowserExtensionId {
  return DEFS.some((d) => d.id === raw);
}

export function buildBrowserExtensionZip(
  id: BrowserExtensionId,
): { zip: Buffer; filename: string; version: string; folder: string } | null {
  const def = DEFS.find((d) => d.id === id);
  if (!def) return null;
  const dir = extensionDir(def.folder);
  if (!existsSync(dir)) return null;
  const version = readManifestVersion(dir);
  const entries: { name: string; data: Buffer }[] = [
    {
      name: `${def.folder}/INSTALL.txt`,
      data: Buffer.from(def.install, "utf8"),
    },
  ];
  for (const f of walkFiles(dir, dir)) {
    const rel = f.rel.replace(/\\/g, "/");
    entries.push({
      name: `${def.folder}/${rel}`,
      data: readFileSync(f.abs),
    });
  }
  if (entries.length < 2) return null;
  return {
    zip: zipStore(entries),
    filename: `outpost-${def.folder}-v${version}.zip`,
    version,
    folder: def.folder,
  };
}

/** @deprecated alias — Listing 旧路径仍可用 */
export function buildListingExtensionZip() {
  return buildBrowserExtensionZip("listing");
}
