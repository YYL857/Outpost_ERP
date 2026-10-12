import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OUTPOST_ROOT } from "../../shops/registry.js";
import { buildCargoLedger } from "./build.js";
import { loadSnapshot } from "./snapshots.js";
import type { CargoLedger } from "./types.js";

export function cargoLedgerDir(): string {
  const override = process.env.OUTPOST_CARGO_LEDGER_DIR?.trim();
  const dir = override
    ? resolve(override)
    : join(OUTPOST_ROOT, "cargo-ledger");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function cargoLedgerPath(): string {
  return join(cargoLedgerDir(), "latest.json");
}

export function readCargoLedger(): CargoLedger | null {
  const path = cargoLedgerPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as CargoLedger;
    if (raw?.version !== 1 || !Array.isArray(raw.tickets)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeCargoLedger(ledger: CargoLedger): string {
  const path = cargoLedgerPath();
  writeFileSync(path, JSON.stringify(ledger), "utf8");
  return path;
}

export function rebuildCargoLedger(): { ledger: CargoLedger; path: string } {
  const packing = loadSnapshot("packing");
  const product = loadSnapshot("product");
  const accounts = loadSnapshot("accounts");
  const daily = loadSnapshot("daily");
  const ledger = buildCargoLedger({ packing, product, accounts, daily });
  const path = writeCargoLedger(ledger);
  return { ledger, path };
}

export function loadOrBuildCargoLedger(): CargoLedger {
  const existing = readCargoLedger();
  const packing = loadSnapshot("packing");
  if (
    existing &&
    packing &&
    existing.sources.packing.path === packing.path
  ) {
    return existing;
  }
  return rebuildCargoLedger().ledger;
}
