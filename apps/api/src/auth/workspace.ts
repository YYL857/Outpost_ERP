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
import { join } from "node:path";
import { OUTPOST_ROOT, getActiveShop, loadRegistry } from "../shops/registry.js";
import type { FavoriteItem } from "../common/types.js";
import { getAdminUser } from "./users.js";
import type { UserPrefs } from "./types.js";
import { getContextUserId } from "./context.js";

function nowIso() {
  return new Date().toISOString();
}

export function userRoot(userId: string) {
  return join(OUTPOST_ROOT, "users", userId);
}

export function ensureUserWorkspace(userId: string) {
  const root = userRoot(userId);
  for (const dir of [
    root,
    join(root, "listing-drafts"),
    join(root, "listing-drafts", "drafts"),
    join(root, "listing-drafts", "competitor-inbox"),
    join(root, "listing-drafts", "optimize"),
    join(root, "market-intel"),
    join(root, "agent-hub"),
    join(root, "agent-hub", "conversations"),
  ]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return root;
}

export function userListingRoot(userId: string) {
  return join(userRoot(userId), "listing-drafts");
}

export function userWatchlistPath(userId: string) {
  return join(userRoot(userId), "market-intel", "watchlist.json");
}

export function userFavoritesPath(userId: string) {
  return join(userRoot(userId), "favorites.json");
}

export function userPrefsPath(userId: string) {
  return join(userRoot(userId), "prefs.json");
}

export function resolveWorkspaceUserId(explicit?: string): string {
  if (explicit) return explicit;
  const fromCtx = getContextUserId();
  if (fromCtx) return fromCtx;
  const admin = getAdminUser();
  if (admin) return admin.id;
  throw new Error("无可用用户工作区");
}

export function loadUserPrefs(userId: string): UserPrefs {
  ensureUserWorkspace(userId);
  const p = userPrefsPath(userId);
  const registry = loadRegistry();
  const fallbackShop =
    registry.shops.find((s) => s.id === registry.activeShopId)?.id ??
    registry.shops[0]?.id ??
    getActiveShop().id;
  if (!existsSync(p)) {
    const prefs: UserPrefs = {
      selectedShopId: fallbackShop,
      updatedAt: nowIso(),
    };
    writeFileSync(p, JSON.stringify(prefs, null, 2), "utf8");
    return prefs;
  }
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<UserPrefs>;
    const selectedShopId =
      registry.shops.some((s) => s.id === raw.selectedShopId)
        ? String(raw.selectedShopId)
        : fallbackShop;
    return {
      selectedShopId,
      updatedAt: raw.updatedAt ?? nowIso(),
    };
  } catch {
    return { selectedShopId: fallbackShop, updatedAt: nowIso() };
  }
}

export function saveUserPrefs(userId: string, prefs: UserPrefs) {
  ensureUserWorkspace(userId);
  const next: UserPrefs = { ...prefs, updatedAt: nowIso() };
  writeFileSync(userPrefsPath(userId), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function setSelectedShopId(userId: string, shopId: string) {
  const registry = loadRegistry();
  if (!registry.shops.some((s) => s.id === shopId)) {
    throw new Error(`未知店铺: ${shopId}`);
  }
  return saveUserPrefs(userId, {
    selectedShopId: shopId,
    updatedAt: nowIso(),
  });
}

export function loadUserFavorites(userId: string): FavoriteItem[] {
  ensureUserWorkspace(userId);
  const p = userFavoritesPath(userId);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      items?: FavoriteItem[];
    };
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

export function saveUserFavorites(userId: string, items: FavoriteItem[]) {
  ensureUserWorkspace(userId);
  writeFileSync(
    userFavoritesPath(userId),
    JSON.stringify({ items, updatedAt: nowIso() }, null, 2),
    "utf8",
  );
  return items;
}

function copyDirRecursive(src: string, dest: string) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) {
      copyDirRecursive(from, to);
    } else if (!existsSync(to)) {
      copyFileSync(from, to);
    }
  }
}

/**
 * 将旧全局操作区数据挂到超管名下（仅当超管工作区尚空时）。
 */
export function migrateLegacyWorkspacesToAdmin(adminUserId: string) {
  ensureUserWorkspace(adminUserId);
  const marker = join(userRoot(adminUserId), ".migrated-v1");
  if (existsSync(marker)) return;

  const legacyListing = join(OUTPOST_ROOT, "listing-drafts");
  const adminListing = userListingRoot(adminUserId);
  const adminIndex = join(adminListing, "index.json");
  if (existsSync(legacyListing) && !existsSync(adminIndex)) {
    copyDirRecursive(legacyListing, adminListing);
    console.log(
      `[auth] migrated listing-drafts → users/${adminUserId}/listing-drafts`,
    );
  }

  const legacyWatch = join(
    OUTPOST_ROOT,
    "market-imports",
    "noon",
    "sa",
    "watchlist.json",
  );
  const adminWatch = userWatchlistPath(adminUserId);
  if (existsSync(legacyWatch) && !existsSync(adminWatch)) {
    mkdirSync(join(userRoot(adminUserId), "market-intel"), { recursive: true });
    copyFileSync(legacyWatch, adminWatch);
    console.log(
      `[auth] migrated market watchlist → users/${adminUserId}/market-intel/watchlist.json`,
    );
  }

  // 从默认店 state 抽 favorites
  try {
    const shop = getActiveShop();
    const statePath = join(shop.rootDir, "json", "state.json");
    const favPath = userFavoritesPath(adminUserId);
    if (existsSync(statePath) && !existsSync(favPath)) {
      const raw = JSON.parse(readFileSync(statePath, "utf8")) as {
        favorites?: FavoriteItem[];
      };
      if (Array.isArray(raw.favorites) && raw.favorites.length > 0) {
        saveUserFavorites(adminUserId, raw.favorites);
        console.log(
          `[auth] migrated favorites (${raw.favorites.length}) → users/${adminUserId}/favorites.json`,
        );
      }
    }
  } catch {
    /* ignore */
  }

  writeFileSync(marker, nowIso(), "utf8");
}

/** 兼容：把目录挪到 users 下后可选重命名旧目录 */
export function archiveLegacyListingRoot() {
  const legacy = join(OUTPOST_ROOT, "listing-drafts");
  const archived = join(OUTPOST_ROOT, "listing-drafts.archived");
  if (existsSync(legacy) && !existsSync(archived)) {
    try {
      renameSync(legacy, archived);
    } catch {
      /* Windows 占用时跳过 */
    }
  }
}
