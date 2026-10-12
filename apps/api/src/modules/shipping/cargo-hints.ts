/**
 * 货代 × PSKU 手工货性标注（本地 JSON，不写飞书）。
 * 与头程品名推断无关：记录「该货代实际按什么货性收这品」。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalizeForwarderName } from "../../platforms/feishu/normalize/forwarder-names.js";

export const CARGO_KIND_OPTIONS = [
  { value: "general", label: "普货" },
  { value: "battery", label: "带电普货" },
  { value: "sensitive", label: "敏货" },
  { value: "sensitive_battery", label: "敏货带电" },
  { value: "lamp", label: "灯具" },
  { value: "other", label: "其他" },
] as const;

export type ManualCargoKind = (typeof CARGO_KIND_OPTIONS)[number]["value"];

export type ForwarderCargoHint = {
  forwarder: string;
  partnerSku: string;
  cargoKind: ManualCargoKind;
  updatedAt: string;
};

export type CargoHintsFile = {
  updatedAt: string;
  hints: ForwarderCargoHint[];
};

const VALID_KINDS = new Set<string>(CARGO_KIND_OPTIONS.map((o) => o.value));

function outpostRoot(): string {
  return resolve(process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data");
}

export function cargoHintsPath(): string {
  return join(outpostRoot(), "shipping", "forwarder-cargo-hints.json");
}

function ensureDir(): void {
  const dir = join(outpostRoot(), "shipping");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

export function cargoKindLabel(kind: string | null | undefined): string {
  if (!kind) return "未标注";
  const hit = CARGO_KIND_OPTIONS.find((o) => o.value === kind);
  return hit?.label ?? kind;
}

export function hintKey(forwarder: string, partnerSku: string): string {
  return `${canonicalizeForwarderName(forwarder.trim())}\0${partnerSku.trim()}`;
}

export function loadCargoHintsFile(): CargoHintsFile {
  const path = cargoHintsPath();
  if (!existsSync(path)) {
    return { updatedAt: nowIso(), hints: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as CargoHintsFile;
    const hints = Array.isArray(raw.hints) ? raw.hints : [];
    return {
      updatedAt: raw.updatedAt || nowIso(),
      hints: hints
        .filter(
          (h) =>
            h &&
            typeof h.forwarder === "string" &&
            typeof h.partnerSku === "string" &&
            VALID_KINDS.has(h.cargoKind),
        )
        .map((h) => ({
          forwarder: canonicalizeForwarderName(h.forwarder.trim()),
          partnerSku: h.partnerSku.trim(),
          cargoKind: h.cargoKind,
          updatedAt: h.updatedAt || nowIso(),
        })),
    };
  } catch {
    return { updatedAt: nowIso(), hints: [] };
  }
}

export function listCargoHints(): ForwarderCargoHint[] {
  return loadCargoHintsFile().hints;
}

export function findCargoHint(
  hints: ForwarderCargoHint[],
  partnerSku: string,
  forwarder: string,
): ForwarderCargoHint | null {
  const key = hintKey(forwarder, partnerSku);
  return hints.find((h) => hintKey(h.forwarder, h.partnerSku) === key) ?? null;
}

export function saveCargoHintsFile(file: CargoHintsFile): void {
  ensureDir();
  file.updatedAt = nowIso();
  writeFileSync(cargoHintsPath(), JSON.stringify(file, null, 2), "utf8");
}

/** 写入或更新一条；cargoKind 空字符串则删除 */
export function upsertCargoHint(input: {
  partnerSku: string;
  forwarder: string;
  cargoKind: string;
}): ForwarderCargoHint | null {
  const partnerSku = input.partnerSku.trim();
  const forwarder = canonicalizeForwarderName(input.forwarder.trim());
  if (!partnerSku) throw new Error("partnerSku 不能为空");
  if (!forwarder) throw new Error("forwarder 不能为空");

  const kind = input.cargoKind.trim();
  const file = loadCargoHintsFile();
  const key = hintKey(forwarder, partnerSku);
  const idx = file.hints.findIndex(
    (h) => hintKey(h.forwarder, h.partnerSku) === key,
  );

  if (!kind) {
    if (idx >= 0) file.hints.splice(idx, 1);
    saveCargoHintsFile(file);
    return null;
  }
  if (!VALID_KINDS.has(kind)) {
    throw new Error(
      `无效货性 ${kind}；可选：${CARGO_KIND_OPTIONS.map((o) => o.value).join("|")}`,
    );
  }

  const row: ForwarderCargoHint = {
    forwarder,
    partnerSku,
    cargoKind: kind as ManualCargoKind,
    updatedAt: nowIso(),
  };
  if (idx >= 0) file.hints[idx] = row;
  else file.hints.push(row);
  file.hints.sort(
    (a, b) =>
      a.partnerSku.localeCompare(b.partnerSku) ||
      a.forwarder.localeCompare(b.forwarder, "zh"),
  );
  saveCargoHintsFile(file);
  return row;
}

export function deleteCargoHint(partnerSku: string, forwarder: string): boolean {
  const before = loadCargoHintsFile().hints.length;
  upsertCargoHint({ partnerSku, forwarder, cargoKind: "" });
  return loadCargoHintsFile().hints.length < before;
}
