/**
 * Browser-local form backup for multi-user / mid-dev restarts.
 * Survives API restart; LAN HTTP OK (no Secure Context required).
 */

export type LocalBackupEnvelope<T> = {
  v: 1;
  key: string;
  savedAt: string;
  payload: T;
};

function storageAvailable(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const k = "__outpost_backup_ping__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

export function writeLocalBackup<T>(key: string, payload: T): boolean {
  const store = storageAvailable();
  if (!store) return false;
  try {
    const env: LocalBackupEnvelope<T> = {
      v: 1,
      key,
      savedAt: new Date().toISOString(),
      payload,
    };
    store.setItem(key, JSON.stringify(env));
    return true;
  } catch {
    return false;
  }
}

export function readLocalBackup<T>(key: string): LocalBackupEnvelope<T> | null {
  const store = storageAvailable();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalBackupEnvelope<T>;
    if (!parsed || parsed.v !== 1 || !parsed.savedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLocalBackup(key: string): void {
  const store = storageAvailable();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function listingBackupKey(userId: string | undefined, draftId: string) {
  const u = String(userId || "anon").trim() || "anon";
  return `outpost.listing.backup.v1.${u}.${draftId}`;
}

export function listingPromoBriefBackupKey(draftId: string) {
  return `outpost.listing.promo-brief.v1.${draftId}`;
}

export function isBackupNewerThan(
  backupSavedAt: string,
  serverUpdatedAt: string | undefined,
): boolean {
  const b = Date.parse(backupSavedAt);
  const s = Date.parse(serverUpdatedAt || "");
  if (!Number.isFinite(b)) return false;
  if (!Number.isFinite(s)) return true;
  return b > s + 1500;
}
