/**
 * 品名 → 货代大纲货性（普货 / 普货带电 / 敏货 / 敏货带电 / 灯具）。
 */
import type { CargoKind } from "../../platforms/feishu/normalize/freight-rates.js";

export type FreightCargoKind = Exclude<CargoKind, "other"> | "other";

const BATTERY_KEYWORDS = [
  "电池",
  "充电",
  "锂电池",
  "内置电",
  "移动电源",
  "充电宝",
  "无线",
  "电动牙刷",
  "带电",
  "锂电池",
  "可充电",
  "USB充电",
  "power bank",
  "rechargeable",
  "battery",
];

const SENSITIVE_KEYWORDS = [
  "液体",
  "膏",
  "粉",
  "喷雾",
  "刀具",
  "磁性",
  "化妆品",
  "乳液",
  "精华",
  "口红",
  "香水",
  "酒精",
  "气雾",
  "指甲油",
  "膏状",
  "粉末",
  "刀片",
  "剪刀",
  "磁力",
  "磁铁",
];

const LAMP_KEYWORDS = ["灯具", "台灯", "壁灯", "灯带", "LED灯", "球泡"];

function hitAny(name: string, keywords: string[]): boolean {
  const lower = name.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

/**
 * 从品名推断货性。优先级：敏货带电 > 带电 > 敏货 > 灯具 > 普货。
 */
export function classifyCargoFromName(name: string): FreightCargoKind {
  const n = (name ?? "").trim();
  if (!n) return "general";
  const battery = hitAny(n, BATTERY_KEYWORDS);
  const sensitive = hitAny(n, SENSITIVE_KEYWORDS);
  if (battery && sensitive) return "sensitive_battery";
  if (battery) return "battery";
  if (sensitive) return "sensitive";
  if (hitAny(n, LAMP_KEYWORDS)) return "lamp";
  return "general";
}

/** 产品表货物类型列（插电/内置/普货）→ 大纲货性粗映射 */
export function cargoKindFromProductLabel(raw: string | null | undefined): FreightCargoKind | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/敏.?带电|带电.?敏|敏感带电/.test(s)) return "sensitive_battery";
  if (/带电普货|普货带电|带电|内置/.test(s)) return "battery";
  if (/敏货|敏感/.test(s)) return "sensitive";
  if (/灯具/.test(s)) return "lamp";
  if (/插电/.test(s)) return "battery"; // 插电电器按带电档更接近大纲
  if (/普货|普通/.test(s)) return "general";
  return null;
}

/**
 * 覆盖顺序：品名规则 → 产品表列 → 默认普货。
 * 品名已非普货时优先生效；品名为普货且产品表有值则用产品表。
 */
export function resolveCargoKind(args: {
  productName: string;
  productCargoLabel?: string | null;
}): FreightCargoKind {
  const fromName = classifyCargoFromName(args.productName);
  if (fromName !== "general") return fromName;
  return cargoKindFromProductLabel(args.productCargoLabel) ?? "general";
}

export function cargoKindLabel(kind: FreightCargoKind): string {
  switch (kind) {
    case "battery":
      return "普货带电";
    case "sensitive":
      return "敏货";
    case "sensitive_battery":
      return "敏货带电";
    case "lamp":
      return "灯具";
    case "other":
      return "其他";
    default:
      return "普货";
  }
}
