/**
 * 发货计划本地 JSON（D:\outpost-data\shipping\ship-plans\）。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { ShipPlanDoc } from "./types.js";

function outpostRoot(): string {
  return resolve(process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data");
}

export function shipPlansDir(): string {
  return join(outpostRoot(), "shipping", "ship-plans");
}

function ensureDir(): void {
  const dir = shipPlansDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function planPath(id: string): string {
  const safe = id.replace(/[^\w.-]+/g, "_").slice(0, 80);
  return join(shipPlansDir(), `${safe}.json`);
}

export function listShipPlanDocs(): ShipPlanDoc[] {
  ensureDir();
  const files = readdirSync(shipPlansDir()).filter((f) => f.endsWith(".json"));
  const docs: ShipPlanDoc[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(
        readFileSync(join(shipPlansDir(), f), "utf8"),
      ) as ShipPlanDoc;
      if (raw?.id && Array.isArray(raw.lines)) docs.push(raw);
    } catch {
      /* skip broken */
    }
  }
  docs.sort((a, b) => (b.importedAt || "").localeCompare(a.importedAt || ""));
  return docs;
}

export function loadShipPlanDoc(id: string): ShipPlanDoc | null {
  const path = planPath(id);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as ShipPlanDoc;
    if (!raw?.id || !Array.isArray(raw.lines)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveShipPlanDoc(doc: ShipPlanDoc): void {
  ensureDir();
  doc.updatedAt = new Date().toISOString();
  writeFileSync(planPath(doc.id), JSON.stringify(doc, null, 2), "utf8");
}

export function deleteShipPlanDoc(id: string): boolean {
  const path = planPath(id);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
