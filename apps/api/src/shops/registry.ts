import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { ShopRecord, ShopsRegistry } from "./types.js";

export const OUTPOST_ROOT = resolve(
  process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data",
);

const REGISTRY_PATH = join(OUTPOST_ROOT, "shops-registry.json");

/** 两家 Noon 店：凭证按你提供的路径隔离 */
export const DEFAULT_SHOPS: ShopRecord[] = [
  {
    id: "PRJ396770",
    name: "Shop PRJ396770",
    projectCode: "PRJ396770",
    credentialsFile: "D:\\PRJ396770\\noon_credentials_sensitive.json",
    rootDir: join(OUTPOST_ROOT, "shops", "PRJ396770"),
    countryCode: "sa",
    noonMode: "live",
  },
  {
    id: "PRJ482387",
    name: "Shop PRJ482387",
    projectCode: "PRJ482387",
    credentialsFile: "D:\\PRJ482387\\noon_credentials_sensitive.json",
    rootDir: join(OUTPOST_ROOT, "shops", "PRJ482387"),
    countryCode: "sa",
    noonMode: "live",
  },
];

function nowIso() {
  return new Date().toISOString();
}

export function getRegistryPath() {
  return REGISTRY_PATH;
}

export function ensureShopDirs(shop: ShopRecord) {
  for (const sub of [
    shop.rootDir,
    join(shop.rootDir, "json"),
    join(shop.rootDir, "portal-imports"),
    join(shop.rootDir, "noon-session"),
    join(shop.rootDir, "noon-browser-profile"),
  ]) {
    if (!existsSync(sub)) mkdirSync(sub, { recursive: true });
  }
}

export function loadRegistry(): ShopsRegistry {
  if (!existsSync(OUTPOST_ROOT)) mkdirSync(OUTPOST_ROOT, { recursive: true });
  if (!existsSync(REGISTRY_PATH)) {
    const initial: ShopsRegistry = {
      version: 1,
      activeShopId: DEFAULT_SHOPS[0].id,
      shops: DEFAULT_SHOPS.map((s) => ({ ...s })),
      updatedAt: nowIso(),
    };
    writeFileSync(REGISTRY_PATH, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as ShopsRegistry;
  const byId = new Map((raw.shops ?? []).map((s) => [s.id, s]));
  // 仅补齐默认店；已存在的记录保留用户录入的凭证路径 / 名称
  for (const def of DEFAULT_SHOPS) {
    const prev = byId.get(def.id);
    if (!prev) {
      byId.set(def.id, { ...def });
      continue;
    }
    byId.set(def.id, {
      ...def,
      ...prev,
      id: def.id,
      projectCode: def.projectCode,
      credentialsFile: prev.credentialsFile?.trim() || def.credentialsFile,
      rootDir: prev.rootDir?.trim() || def.rootDir,
      name: prev.name?.trim() || def.name,
      noonMode: prev.noonMode ?? def.noonMode,
      countryCode: prev.countryCode ?? def.countryCode,
    });
  }
  const shops = [...byId.values()];
  const activeShopId = shops.some((s) => s.id === raw.activeShopId)
    ? raw.activeShopId
    : shops[0].id;
  const next: ShopsRegistry = {
    version: 1,
    activeShopId,
    shops,
    updatedAt: nowIso(),
  };
  writeFileSync(REGISTRY_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function saveRegistry(registry: ShopsRegistry) {
  registry.updatedAt = nowIso();
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf8");
}

export function getActiveShop(registry?: ShopsRegistry): ShopRecord {
  const reg = registry ?? loadRegistry();
  return (
    reg.shops.find((s) => s.id === reg.activeShopId) ??
    reg.shops[0] ??
    DEFAULT_SHOPS[0]
  );
}

/** 把当前店铺路径写入 process.env，供 store / http / portal 读取 */
export function applyShopEnv(shop: ShopRecord) {
  ensureShopDirs(shop);
  process.env.OUTPOST_DATA_DIR = join(shop.rootDir, "json");
  process.env.OUTPOST_BROWSER_DIR = shop.rootDir;
  process.env.OUTPOST_IMPORT_DIR = join(shop.rootDir, "portal-imports");
  process.env.OUTPOST_NOON_CREDENTIALS_FILE = shop.credentialsFile;
  if (shop.noonMode) {
    process.env.NOON_MODE = shop.noonMode;
  }
  if (shop.countryCode) {
    process.env.NOON_COUNTRY_CODE = shop.countryCode;
  }
  process.env.NOON_PARTNER_ID = shop.projectCode;
}

function copyDirContents(src: string, dest: string) {
  if (!existsSync(src)) return 0;
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const name of readdirSync(src)) {
    if (name === "." || name === "..") continue;
    const from = join(src, name);
    const to = join(dest, name);
    const st = statSync(from);
    if (st.isDirectory()) {
      n += copyDirContents(from, to);
      continue;
    }
    if (!existsSync(to)) {
      copyFileSync(from, to);
      n += 1;
    }
  }
  return n;
}

/**
 * 将旧的全局 D:\\outpost-data\\json 等迁入 PRJ396770，避免丢现有 Catalog。
 */
export function migrateLegacyIntoPrimaryShop(primary: ShopRecord) {
  ensureShopDirs(primary);
  const legacyJson = join(OUTPOST_ROOT, "json", "state.json");
  const shopState = join(primary.rootDir, "json", "state.json");
  if (existsSync(legacyJson) && !existsSync(shopState)) {
    copyFileSync(legacyJson, shopState);
    // 保留旧文件作备份，再标名避免双写混淆
    try {
      renameSync(legacyJson, `${legacyJson}.migrated-to-${primary.id}.bak`);
    } catch {
      /* ignore */
    }
    console.log(
      `[shops] migrated state.json → ${shopState} (from legacy json/)`,
    );
  }

  const pairs: Array<[string, string]> = [
    [join(OUTPOST_ROOT, "portal-imports"), join(primary.rootDir, "portal-imports")],
    [join(OUTPOST_ROOT, "noon-session"), join(primary.rootDir, "noon-session")],
    [
      join(OUTPOST_ROOT, "noon-browser-profile"),
      join(primary.rootDir, "noon-browser-profile"),
    ],
  ];
  for (const [from, to] of pairs) {
    const n = copyDirContents(from, to);
    if (n > 0) {
      console.log(`[shops] copied ${n} files ${from} → ${to}`);
    }
  }
}

export function bootstrapShops(): { registry: ShopsRegistry; active: ShopRecord } {
  const registry = loadRegistry();
  for (const shop of registry.shops) ensureShopDirs(shop);
  const primary =
    registry.shops.find((s) => s.id === "PRJ396770") ?? registry.shops[0];
  migrateLegacyIntoPrimaryShop(primary);
  const active = getActiveShop(registry);
  applyShopEnv(active);
  console.log(
    `[shops] active=${active.id} data=${process.env.OUTPOST_DATA_DIR} cred=${process.env.OUTPOST_NOON_CREDENTIALS_FILE}`,
  );
  return { registry, active };
}

export type RegisterShopInput = {
  /** Service Account JSON 绝对路径（本机盘符路径） */
  credentialsFile: string;
  /** 展示名；默认 Shop {project_code} */
  name?: string;
  countryCode?: ShopRecord["countryCode"];
  noonMode?: ShopRecord["noonMode"];
};

/**
 * 从凭证 JSON 路径录入/更新店铺：
 * 读 key_id / private_key / project_code → upsert shops-registry.json → 建数据目录。
 * 不复制私钥内容进注册表，只存文件路径。
 */
export function registerShopFromCredentials(input: RegisterShopInput): {
  shop: ShopRecord;
  created: boolean;
  updated: boolean;
  registry: ShopsRegistry;
} {
  const abs = resolve(input.credentialsFile.trim());
  if (!existsSync(abs)) {
    throw new Error(`凭证文件不存在: ${abs}`);
  }

  let raw: { key_id?: string; private_key?: string; project_code?: string };
  try {
    raw = JSON.parse(readFileSync(abs, "utf8")) as typeof raw;
  } catch {
    throw new Error(`无法解析 JSON 凭证文件: ${abs}`);
  }
  const keyId = String(raw.key_id ?? "").trim();
  const privateKey = String(raw.private_key ?? "").trim();
  const projectCode = String(raw.project_code ?? "").trim();
  if (!keyId || !privateKey || !projectCode) {
    throw new Error(
      "凭证 JSON 缺少必填字段 key_id / private_key / project_code（请使用 NOON Access App 下载的 Service Account）",
    );
  }
  if (!/^PRJ\d+$/i.test(projectCode)) {
    throw new Error(`project_code 格式异常: ${projectCode}`);
  }

  const registry = loadRegistry();
  const existing = registry.shops.find(
    (s) => s.id === projectCode || s.projectCode === projectCode,
  );
  const shop: ShopRecord = {
    id: projectCode,
    projectCode,
    name: input.name?.trim() || existing?.name || `Shop ${projectCode}`,
    credentialsFile: abs,
    rootDir: existing?.rootDir || join(OUTPOST_ROOT, "shops", projectCode),
    countryCode: input.countryCode ?? existing?.countryCode ?? "sa",
    noonMode: input.noonMode ?? existing?.noonMode ?? "live",
  };

  ensureShopDirs(shop);

  if (existing) {
    const idx = registry.shops.findIndex((s) => s.id === existing.id);
    registry.shops[idx] = shop;
  } else {
    registry.shops.push(shop);
  }
  saveRegistry(registry);

  return {
    shop,
    created: !existing,
    updated: Boolean(existing),
    registry,
  };
}
