import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type SchedulerOverrideId =
  | "noon-poller"
  | "assembly-sync"
  | "store-morning-digest"
  | "mi-morning-digest"
  | "pw-keepalive"
  | "gp-month-close";

export type SchedulersOverrides = {
  /** runtime enable overrides; missing key → fall back to env default */
  enabled?: Partial<Record<SchedulerOverrideId, boolean>>;
};

function overridesPath(): string {
  const root =
    process.env.OUTPOST_DATA_DIR?.trim() ||
    process.env.DATA_DIR?.trim() ||
    join(process.cwd(), ".data");
  return join(root, "schedulers-overrides.json");
}

export function loadSchedulersOverrides(): SchedulersOverrides {
  const path = overridesPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SchedulersOverrides;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function saveSchedulersOverrides(next: SchedulersOverrides): void {
  const path = overridesPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), "utf8");
}

export function getOverrideEnabled(
  id: SchedulerOverrideId,
): boolean | undefined {
  return loadSchedulersOverrides().enabled?.[id];
}

export function setOverrideEnabled(
  id: SchedulerOverrideId,
  enabled: boolean,
): SchedulersOverrides {
  const cur = loadSchedulersOverrides();
  const next: SchedulersOverrides = {
    ...cur,
    enabled: { ...cur.enabled, [id]: enabled },
  };
  saveSchedulersOverrides(next);
  return next;
}
