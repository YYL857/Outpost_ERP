/**
 * 从 Playwright storage_state 读 cookie 过期时间，替代盲目定时保活。
 * 会话 cookie（expires=-1）无法从文件推算绝对过期，标为 unknown。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type PwSessionLevel = "missing" | "expired" | "expiring" | "ok" | "unknown";

export type PwSiteSession = {
  site: "ads" | "seller";
  label: string;
  profileDir: string;
  statePath: string;
  stateExists: boolean;
  stateMtime: string | null;
  cookieCount: number;
  persistentCookieCount: number;
  earliestExpiresAt: string | null;
  level: PwSessionLevel;
  message: string;
};

export type PwSessionStatus = {
  checkedAt: string;
  warnWithinMs: number;
  sites: PwSiteSession[];
  /** 任一站点 expired / expiring / missing → 需要用户动手 */
  needsAttention: boolean;
  summary: string;
};

type CookieRow = {
  name?: string;
  domain?: string;
  expires?: number;
};

function profileRoot(): string {
  return (
    process.env.OUTPOST_ADS_PW_PROFILE?.trim() ||
    "D:\\outpost-data\\browser-profiles\\noon-ads-pw"
  );
}

function sellerProfileRoot(): string {
  return (
    process.env.OUTPOST_SELLER_PW_PROFILE?.trim() ||
    "D:\\outpost-data\\browser-profiles\\noon-seller-pw"
  );
}

function warnWithinMs(): number {
  const n = Number(process.env.OUTPOST_PW_SESSION_WARN_MS);
  return Number.isFinite(n) && n > 0 ? n : 48 * 60 * 60 * 1000;
}

function isNoonDomain(domain: string | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^\./, "");
  return d.includes("noon.partners") || d.includes("noon.com");
}

/** 纯函数：便于单测 */
export function assessCookies(
  cookies: CookieRow[],
  nowMs: number,
  warnMs: number,
): Pick<
  PwSiteSession,
  | "cookieCount"
  | "persistentCookieCount"
  | "earliestExpiresAt"
  | "level"
  | "message"
> {
  const noon = cookies.filter((c) => isNoonDomain(c.domain));
  const cookieCount = noon.length;
  if (!cookieCount) {
    return {
      cookieCount: 0,
      persistentCookieCount: 0,
      earliestExpiresAt: null,
      level: "missing",
      message: "无 Noon cookie，请打开登录窗口",
    };
  }

  const persistent = noon.filter(
    (c) => typeof c.expires === "number" && c.expires > 0,
  );
  const persistentCookieCount = persistent.length;
  if (!persistentCookieCount) {
    return {
      cookieCount,
      persistentCookieCount: 0,
      earliestExpiresAt: null,
      level: "unknown",
      message: "仅有会话 cookie，文件里看不出绝对过期时间；导出失败时再登录即可",
    };
  }

  let minExp = Infinity;
  for (const c of persistent) {
    const expMs = (c.expires as number) * 1000;
    if (expMs < minExp) minExp = expMs;
  }
  const earliestExpiresAt = new Date(minExp).toISOString();
  if (minExp <= nowMs) {
    return {
      cookieCount,
      persistentCookieCount,
      earliestExpiresAt,
      level: "expired",
      message: "登录 cookie 已过期，请重新打开登录窗口",
    };
  }
  if (minExp - nowMs <= warnMs) {
    const hours = Math.max(1, Math.round((minExp - nowMs) / 3600000));
    return {
      cookieCount,
      persistentCookieCount,
      earliestExpiresAt,
      level: "expiring",
      message: `约 ${hours} 小时内过期，建议尽快重新登录`,
    };
  }
  return {
    cookieCount,
    persistentCookieCount,
    earliestExpiresAt,
    level: "ok",
    message: "登录态有效",
  };
}

function assessSite(
  site: "ads" | "seller",
  label: string,
  profileDir: string,
  nowMs: number,
  warnMs: number,
): PwSiteSession {
  const statePath = join(profileDir, "storage_state.json");
  if (!existsSync(statePath)) {
    return {
      site,
      label,
      profileDir,
      statePath,
      stateExists: false,
      stateMtime: null,
      cookieCount: 0,
      persistentCookieCount: 0,
      earliestExpiresAt: null,
      level: "missing",
      message: "尚无 storage_state，请先登录",
    };
  }
  let stateMtime: string | null = null;
  try {
    stateMtime = statSync(statePath).mtime.toISOString();
  } catch {
    stateMtime = null;
  }
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as {
      cookies?: CookieRow[];
    };
    const assessed = assessCookies(raw.cookies ?? [], nowMs, warnMs);
    return {
      site,
      label,
      profileDir,
      statePath,
      stateExists: true,
      stateMtime,
      ...assessed,
    };
  } catch {
    return {
      site,
      label,
      profileDir,
      statePath,
      stateExists: true,
      stateMtime,
      cookieCount: 0,
      persistentCookieCount: 0,
      earliestExpiresAt: null,
      level: "missing",
      message: "storage_state 无法解析，请重新登录",
    };
  }
}

export function getPwSessionStatus(nowMs = Date.now()): PwSessionStatus {
  const warnMs = warnWithinMs();
  const sites = [
    assessSite("ads", "广告后台 Ad Manager", profileRoot(), nowMs, warnMs),
    assessSite(
      "seller",
      "卖家后台 Seller Lab",
      sellerProfileRoot(),
      nowMs,
      warnMs,
    ),
  ];
  const needsAttention = sites.some((s) =>
    s.level === "missing" || s.level === "expired" || s.level === "expiring",
  );
  const bad = sites.filter((s) =>
    s.level === "missing" || s.level === "expired" || s.level === "expiring",
  );
  let summary = "两套 Noon 登录态均有效";
  if (needsAttention) {
    summary = bad.map((s) => `${s.label}：${s.message}`).join("；");
  } else if (sites.some((s) => s.level === "unknown")) {
    summary = "有会话 cookie（无绝对过期时间）；导出失败时再登录即可";
  }
  return {
    checkedAt: new Date(nowMs).toISOString(),
    warnWithinMs: warnMs,
    sites,
    needsAttention,
    summary,
  };
}
