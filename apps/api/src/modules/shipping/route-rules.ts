/**
 * 发货路由规则（本机 JSON）：品类/货性 → 默认货代。
 * 货性真相仍是 cargo-hints；本文件只做「建议走哪家」。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type RouteRulesFile = {
  updatedAt: string;
  /** 普货 / 普杂 → */
  generalForwarder: string;
  /** 敏货 → */
  sensitiveForwarder: string;
  /** 带电（现行；可被 batteryToHansha 覆盖）→ */
  batteryForwarder: string;
  /** 咖啡机 / 磨粉机 → */
  coffeeForwarder: string;
  /** 监测手环 → */
  bandForwarder: string;
  /** 灯具默认 → */
  lampForwarder: string;
  /** 眼镜默认 → */
  glassesForwarder: string;
  /** 慧姐：带电改走汉沙 */
  batteryToHansha: boolean;
  /** YYYY-MM-DD；空=立即按开关 */
  batteryToHanshaSince: string;
};

const DEFAULTS: Omit<RouteRulesFile, "updatedAt"> = {
  generalForwarder: "汉沙",
  sensitiveForwarder: "飞坦",
  batteryForwarder: "飞坦",
  coffeeForwarder: "亚优汇",
  bandForwarder: "亚优汇",
  lampForwarder: "飞坦",
  glassesForwarder: "飞坦",
  batteryToHansha: false,
  batteryToHanshaSince: "",
};

function outpostRoot(): string {
  return resolve(process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data");
}

export function routeRulesPath(): string {
  return join(outpostRoot(), "shipping", "route-rules.json");
}

function ensureDir(): void {
  const dir = join(outpostRoot(), "shipping");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

export function loadRouteRules(): RouteRulesFile {
  const path = routeRulesPath();
  if (!existsSync(path)) {
    return { ...DEFAULTS, updatedAt: nowIso() };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<RouteRulesFile>;
    return {
      ...DEFAULTS,
      ...raw,
      updatedAt: raw.updatedAt || nowIso(),
      generalForwarder: String(raw.generalForwarder || DEFAULTS.generalForwarder),
      sensitiveForwarder: String(
        raw.sensitiveForwarder || DEFAULTS.sensitiveForwarder,
      ),
      batteryForwarder: String(raw.batteryForwarder || DEFAULTS.batteryForwarder),
      coffeeForwarder: String(raw.coffeeForwarder || DEFAULTS.coffeeForwarder),
      bandForwarder: String(raw.bandForwarder || DEFAULTS.bandForwarder),
      lampForwarder: String(raw.lampForwarder || DEFAULTS.lampForwarder),
      glassesForwarder: String(raw.glassesForwarder || DEFAULTS.glassesForwarder),
      batteryToHansha: Boolean(raw.batteryToHansha),
      batteryToHanshaSince: String(raw.batteryToHanshaSince || ""),
    };
  } catch {
    return { ...DEFAULTS, updatedAt: nowIso() };
  }
}

export function saveRouteRules(
  patch: Partial<Omit<RouteRulesFile, "updatedAt">>,
): RouteRulesFile {
  const cur = loadRouteRules();
  const next: RouteRulesFile = {
    ...cur,
    ...patch,
    updatedAt: nowIso(),
  };
  ensureDir();
  writeFileSync(routeRulesPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function isCoffeeProduct(name: string, partnerSku = ""): boolean {
  const n = name || "";
  if (/咖啡机垫|托盘|滤纸|胶囊|除垢/.test(n)) return false;
  if (/咖啡机|咖啡磨粉|磨豆/.test(n)) return true;
  if (/KFJ/i.test(partnerSku) && /咖啡/.test(n)) return true;
  return false;
}

export function isMonitorBand(name: string, partnerSku = ""): boolean {
  const n = name || "";
  if (/监测手环|手环.*屏|带屏显/.test(n)) return true;
  if (/JCSH/i.test(partnerSku) && /手环/.test(n)) return true;
  return false;
}

export function isLampProduct(name: string): boolean {
  return /灯具|台灯|壁灯|灯带|月亮灯|LED灯|球泡|小夜灯/.test(name || "");
}

export function isGlassesProduct(name: string): boolean {
  return /眼镜|墨镜|老花镜|VR眼镜|防蓝光|变色眼镜/.test(name || "");
}

function batteryForwarderEffective(
  rules: RouteRulesFile,
  asOfYmd?: string,
): string {
  if (!rules.batteryToHansha) return rules.batteryForwarder;
  const since = rules.batteryToHanshaSince.trim();
  if (!since) return "汉沙";
  const day = (asOfYmd || new Date().toISOString().slice(0, 10)).trim();
  return day >= since ? "汉沙" : rules.batteryForwarder;
}

export type SuggestForwarderInput = {
  partnerSku: string;
  name: string;
  /** 仓管粗分：普货/敏货/带电；非最终货性 */
  warehouseType?: string | null;
  /** 已知货性 code：general|battery|sensitive|… */
  cargoKind?: string | null;
  asOfYmd?: string;
};

/**
 * 建议货代（路由层）。优先级：咖啡/手环 > 灯具/眼镜 > 显式货性/仓管粗分 > 默认普货汉沙。
 */
export function suggestForwarder(
  input: SuggestForwarderInput,
  rules = loadRouteRules(),
): { forwarder: string; reason: string } {
  const name = input.name || "";
  const sku = input.partnerSku || "";

  if (isCoffeeProduct(name, sku)) {
    return { forwarder: rules.coffeeForwarder, reason: "品类=咖啡机/磨粉机" };
  }
  if (isMonitorBand(name, sku)) {
    return { forwarder: rules.bandForwarder, reason: "品类=监测手环" };
  }
  if (isLampProduct(name)) {
    return { forwarder: rules.lampForwarder, reason: "品类=灯具" };
  }
  if (isGlassesProduct(name)) {
    return { forwarder: rules.glassesForwarder, reason: "品类=眼镜" };
  }

  const kind = (input.cargoKind || "").trim();
  const wh = (input.warehouseType || "").trim();

  if (
    kind === "sensitive_battery" ||
    kind === "sensitive" ||
    wh === "敏货"
  ) {
    if (kind === "sensitive_battery" || (wh === "敏货" && kind === "battery")) {
      return {
        forwarder: batteryForwarderEffective(rules, input.asOfYmd),
        reason: "敏货带电→带电路由",
      };
    }
    return {
      forwarder: rules.sensitiveForwarder,
      reason: kind ? `货性=${kind}` : "仓管粗分=敏货",
    };
  }

  if (kind === "battery" || kind === "lamp" || wh === "带电") {
    const fwd = batteryForwarderEffective(rules, input.asOfYmd);
    return {
      forwarder: fwd,
      reason:
        wh === "带电" || kind === "battery"
          ? `带电→${fwd}${rules.batteryToHansha ? "（改汉沙开关开）" : ""}`
          : `货性=${kind}`,
    };
  }

  if (kind === "general" || wh === "普货" || !kind) {
    return {
      forwarder: rules.generalForwarder,
      reason: wh === "普货" ? "仓管粗分=普货" : "默认普货路由",
    };
  }

  return {
    forwarder: rules.generalForwarder,
    reason: "兜底普货路由",
  };
}
