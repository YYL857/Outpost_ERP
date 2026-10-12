/**
 * 货代大纲（bitable）→ 报价清洗（只读本地 raw 快照，不回写飞书）。
 * 单元格多为自由文本，如「(空运) 50.5-52.5/KG - (海运) 10.4/KG」。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getFeishuRawDir } from "../config.js";
import { cellText, headerIndexMap, pickCol } from "./cells.js";
import { canonicalizeForwarderName } from "./forwarder-names.js";

export type CargoKind =
  | "general"
  | "battery"
  | "sensitive"
  | "sensitive_battery"
  | "lamp"
  | "other";

export type ParsedModeRate = {
  /** 区间取中值；单值即该值 */
  mid: number | null;
  low: number | null;
  high: number | null;
  unit: "kg" | "cbm" | "unknown";
  raw: string;
};

export type ForwarderQuoteRow = {
  forwarder: string;
  cargoKind: CargoKind;
  cargoLabel: string;
  air: ParsedModeRate | null;
  sea: ParsedModeRate | null;
  extra: string;
  raw: string;
};

export type FreightRatesPayload = {
  source: {
    snapshotPath: string | null;
    pulledAt: string | null;
    rowCount: number;
  };
  quotes: ForwarderQuoteRow[];
  /** 默认用普货中值做看板对比 */
  byForwarder: Array<{
    forwarder: string;
    generalAirMid: number | null;
    generalSeaMid: number | null;
    batteryAirMid: number | null;
    batterySeaMid: number | null;
    sensitiveAirMid: number | null;
    sensitiveSeaMid: number | null;
    sensitiveBatteryAirMid: number | null;
    sensitiveBatterySeaMid: number | null;
    lampAirMid: number | null;
    lampSeaMid: number | null;
    extra: string;
  }>;
};

const CARGO_COLS: Array<{ kind: CargoKind; names: string[] }> = [
  { kind: "general", names: ["普货"] },
  { kind: "battery", names: ["带电普货", "带电", "普货带电"] },
  { kind: "sensitive", names: ["敏货", "敏感"] },
  {
    kind: "sensitive_battery",
    names: ["敏货带电", "带电敏货", "敏感带电"],
  },
  { kind: "lamp", names: ["灯具"] },
];

function round(n: number, d = 2): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function parseNumberToken(s: string): number | null {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 从片段提取价：50.5-52.5、单50.5-杂52.5、或单值 */
export function parsePriceSpan(fragment: string): {
  low: number | null;
  high: number | null;
  mid: number | null;
} {
  const danZa = fragment.match(
    /单\s*(\d+(?:\.\d+)?)\s*[-~/～—]?\s*杂[^\d]*(\d+(?:\.\d+)?)/,
  );
  if (danZa) {
    const low = parseNumberToken(danZa[1]!);
    const high = parseNumberToken(danZa[2]!);
    if (low != null && high != null) {
      return { low, high, mid: round((low + high) / 2) };
    }
  }
  const m = fragment.match(/(\d+(?:\.\d+)?)\s*[-~～—]\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const low = parseNumberToken(m[1]!);
    const high = parseNumberToken(m[2]!);
    if (low == null || high == null) return { low: null, high: null, mid: null };
    return { low, high, mid: round((low + high) / 2) };
  }
  const one = fragment.match(/(\d+(?:\.\d+)?)/);
  if (!one) return { low: null, high: null, mid: null };
  const v = parseNumberToken(one[1]!);
  return { low: v, high: v, mid: v };
}

function detectUnit(fragment: string): ParsedModeRate["unit"] {
  if (/\/\s*KG|每KG|元\/KG|\/KG/i.test(fragment)) return "kg";
  if (/\/\s*CBM|\/方|每方|CBM/i.test(fragment)) return "cbm";
  if (/KG/i.test(fragment)) return "kg";
  return "unknown";
}

/** 解析单模式片段，如「(空运) 50.5-52.5/KG」 */
export function parseModeFragment(raw: string): ParsedModeRate | null {
  const t = raw.trim();
  if (!t || /无法|暂无|—|-/i.test(t) && !/\d/.test(t)) return null;
  const span = parsePriceSpan(t);
  if (span.mid == null) return null;
  return {
    mid: span.mid,
    low: span.low,
    high: span.high,
    unit: detectUnit(t),
    raw: t,
  };
}

/**
 * 拆空运/海运。兼容：
 * - (空运) 50.5-52.5/KG - (海运) 10.4/KG
 * - 空运：50 / 海运：1200/CBM
 */
export function parseAirSeaQuoteText(raw: unknown): {
  air: ParsedModeRate | null;
  sea: ParsedModeRate | null;
} {
  const text = cellText(raw);
  if (!text) return { air: null, sea: null };

  const airMatch = text.match(
    /(?:\(空运\)|空运)[:：\s]*([^海]*?)(?=\(海运\)|海运|$)/i,
  );
  const seaMatch = text.match(/(?:\(海运\)|海运)[:：\s]*(.+)$/i);

  let air = airMatch ? parseModeFragment(airMatch[1]!) : null;
  let sea = seaMatch ? parseModeFragment(seaMatch[1]!) : null;

  if (!air && !sea) {
    // 整格只有一个价时，按是否含海运关键词归类
    if (/海运/.test(text) && !/空运/.test(text)) {
      sea = parseModeFragment(text);
    } else {
      air = parseModeFragment(text);
    }
  }
  return { air, sea };
}

/** 正式货代行；排除「注：」「空运普货（汉沙）」等说明行 */
export function isFreightForwarderRowName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (/^注/.test(n)) return false;
  if (/^(空运|海运)/.test(n)) return false;
  if (/系数|地址|仓库|送仓地址|同价/.test(n)) return false;
  return true;
}

function looksLikeRateCell(raw: string): boolean {
  if (!/\d/.test(raw)) return false;
  return /空运|海运|\/\s*KG|\/\s*CBM|\/\s*kg|\/\s*方/i.test(raw);
}

export function extractFreightQuotes(values: unknown[][]): ForwarderQuoteRow[] {
  if (values.length < 2) return [];
  const headers = headerIndexMap(
    (values[0] ?? []).map((h) => cellText(h).trim()),
  );
  // 兼容表头带空格
  for (const [k, i] of [...headers.entries()]) {
    const t = k.trim();
    if (t && t !== k && !headers.has(t)) headers.set(t, i);
  }

  const out: ForwarderQuoteRow[] = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const forwarder = cellText(
      pickCol(row, headers, ["文本", "货代", "货代名称", "名称", "Name"]),
    ).trim();
    if (!isFreightForwarderRowName(forwarder)) continue;
    const forwarderName = canonicalizeForwarderName(forwarder);
    const extra = cellText(
      pickCol(row, headers, ["额外费用", "备注", "附加费"]),
    );

    for (const col of CARGO_COLS) {
      const raw = cellText(pickCol(row, headers, col.names));
      if (!raw || !looksLikeRateCell(raw)) continue;
      const { air, sea } = parseAirSeaQuoteText(raw);
      if (!air && !sea) continue;
      out.push({
        forwarder: forwarderName,
        cargoKind: col.kind,
        cargoLabel: col.names[0]!,
        air,
        sea,
        extra,
        raw,
      });
    }
  }
  return out;
}

export function summarizeQuotesByForwarder(
  quotes: ForwarderQuoteRow[],
): FreightRatesPayload["byForwarder"] {
  const map = new Map<
    string,
    FreightRatesPayload["byForwarder"][number]
  >();
  for (const q of quotes) {
    const row =
      map.get(q.forwarder) ??
      ({
        forwarder: q.forwarder,
        generalAirMid: null,
        generalSeaMid: null,
        batteryAirMid: null,
        batterySeaMid: null,
        sensitiveAirMid: null,
        sensitiveSeaMid: null,
        sensitiveBatteryAirMid: null,
        sensitiveBatterySeaMid: null,
        lampAirMid: null,
        lampSeaMid: null,
        extra: q.extra,
      } satisfies FreightRatesPayload["byForwarder"][number]);
    if (q.extra) row.extra = q.extra;
    if (q.cargoKind === "general") {
      if (q.air?.mid != null) row.generalAirMid = q.air.mid;
      if (q.sea?.mid != null) row.generalSeaMid = q.sea.mid;
    } else if (q.cargoKind === "battery") {
      if (q.air?.mid != null) row.batteryAirMid = q.air.mid;
      if (q.sea?.mid != null) row.batterySeaMid = q.sea.mid;
    } else if (q.cargoKind === "sensitive") {
      if (q.air?.mid != null) row.sensitiveAirMid = q.air.mid;
      if (q.sea?.mid != null) row.sensitiveSeaMid = q.sea.mid;
    } else if (q.cargoKind === "sensitive_battery") {
      if (q.air?.mid != null) row.sensitiveBatteryAirMid = q.air.mid;
      if (q.sea?.mid != null) row.sensitiveBatterySeaMid = q.sea.mid;
    } else if (q.cargoKind === "lamp") {
      if (q.air?.mid != null) row.lampAirMid = q.air.mid;
      if (q.sea?.mid != null) row.lampSeaMid = q.sea.mid;
    }
    map.set(q.forwarder, row);
  }
  return [...map.values()].sort((a, b) =>
    a.forwarder.localeCompare(b.forwarder, "zh"),
  );
}

function rawDirCandidates(): string[] {
  const primary = getFeishuRawDir();
  const shared = resolve(
    process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data",
    "feishu-raw",
  );
  return [...new Set([primary, shared])];
}

function latestFreightRatesSnapshot(): {
  path: string;
  pulledAt: string | null;
  values: unknown[][];
} | null {
  for (const dir of rawDirCandidates()) {
    const runsDir = join(dir, "runs");
    if (!existsSync(runsDir)) continue;
    try {
      const hits = readdirSync(runsDir)
        .map((name) => {
          const path = join(runsDir, name, "freight-rates", "snapshot.json");
          if (!existsSync(path)) return null;
          return { path, mtime: statSync(path).mtimeMs };
        })
        .filter(Boolean) as Array<{ path: string; mtime: number }>;
      hits.sort((a, b) => b.mtime - a.mtime);
      const hit = hits[0];
      if (!hit) continue;
      const snap = JSON.parse(readFileSync(hit.path, "utf8")) as {
        pulledAt?: string;
        sheets?: Array<{ values?: unknown[][] }>;
      };
      const values = snap.sheets?.[0]?.values;
      if (!values) continue;
      return { path: hit.path, pulledAt: snap.pulledAt ?? null, values };
    } catch {
      /* next */
    }
  }
  return null;
}

export function buildFreightRatesPayload(): FreightRatesPayload {
  const snap = latestFreightRatesSnapshot();
  const quotes = snap ? extractFreightQuotes(snap.values) : [];
  return {
    source: {
      snapshotPath: snap?.path ?? null,
      pulledAt: snap?.pulledAt ?? null,
      rowCount: Math.max(0, (snap?.values.length ?? 1) - 1),
    },
    quotes,
    byForwarder: summarizeQuotesByForwarder(quotes),
  };
}
