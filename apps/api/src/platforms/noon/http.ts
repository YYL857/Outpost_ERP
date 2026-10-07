import { createSign, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { NoonConnection } from "../../common/types.js";
import { NOON_API_GATEWAY, NOON_ENDPOINTS } from "./endpoints.js";

export class NoonHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "NoonHttpError";
  }
}

export type NoonCredentialsFile = {
  key_id: string;
  private_key: string;
  project_code: string;
};

type GatewaySession = {
  cookieHeader: string;
  obtainedAt: number;
};

let cachedGateway: GatewaySession | null = null;

function userAgent() {
  return (
    process.env.OUTPOST_NOON_USER_AGENT?.trim() || "OutpostErp/0.1 (PartnerAPI)"
  );
}

export function getNoonCredentialsPath() {
  return (
    process.env.OUTPOST_NOON_CREDENTIALS_FILE?.trim() ||
    "D:\\PRJ396770\\noon_credentials_sensitive.json"
  );
}

function credentialsPath() {
  return getNoonCredentialsPath();
}

/** 从任意绝对路径读取 Access App 下载的 Service Account JSON */
export function readNoonCredentialsFromFile(
  filePath: string,
): NoonCredentialsFile | null {
  const p = filePath.trim();
  if (!p || !existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as NoonCredentialsFile;
    if (!raw.key_id || !raw.private_key || !raw.project_code) return null;
    return {
      key_id: String(raw.key_id).trim(),
      private_key: String(raw.private_key).trim(),
      project_code: String(raw.project_code).trim(),
    };
  } catch {
    return null;
  }
}

export function readNoonCredentialsFile(): NoonCredentialsFile | null {
  return readNoonCredentialsFromFile(credentialsPath());
}

function base64url(buf: Buffer | string) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** 官方 Quick Start：RS256 JWT（sub=key_id） */
export function createNoonApiJwt(credentials: NoonCredentialsFile): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: credentials.key_id,
      iat: Math.floor(Date.now() / 1000),
      jti: randomUUID(),
    }),
  );
  const signingInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(credentials.private_key);
  return `${signingInput}.${base64url(signature)}`;
}

function extractCookieHeader(res: Response): string {
  const anyHeaders = res.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const list =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : [];
  if (list.length) {
    return list.map((c) => c.split(";")[0]!.trim()).join("; ");
  }
  const single = res.headers.get("set-cookie");
  if (!single) return "";
  return single
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0]!.trim())
    .filter(Boolean)
    .join("; ");
}

/**
 * Partner API 登录：JWT → 网关 Cookie。
 * 凭证文件：OUTPOST_NOON_CREDENTIALS_FILE（默认 D:\PRJ396770\noon_credentials_sensitive.json）
 * 多店时由 shops bootstrap / 切换店铺写入对应路径。
 */
export async function loginNoonApiGateway(
  force = false,
): Promise<GatewaySession> {
  if (
    !force &&
    cachedGateway &&
    Date.now() - cachedGateway.obtainedAt < 50 * 60 * 1000
  ) {
    return cachedGateway;
  }
  const credentials = readNoonCredentialsFile();
  if (!credentials) {
    throw new Error(
      `未找到 NOON Service Account 凭证。请把 Access App 下载的 JSON 放到 ${credentialsPath()}，或设置 OUTPOST_NOON_CREDENTIALS_FILE`,
    );
  }
  const token = createNoonApiJwt(credentials);
  const res = await fetch(`${NOON_API_GATEWAY}/identity/public/v1/api/login`, {
    method: "POST",
    headers: {
      "User-Agent": userAgent(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      token,
      default_project_code: credentials.project_code,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new NoonHttpError(
      `NOON API login HTTP ${res.status}`,
      res.status,
      text.slice(0, 400),
    );
  }
  const cookieHeader = extractCookieHeader(res);
  if (!cookieHeader) {
    throw new Error(
      "NOON API login 成功但未返回 Set-Cookie。请确认运行时支持 getSetCookie，或检查网关响应",
    );
  }
  cachedGateway = { cookieHeader, obtainedAt: Date.now() };
  return cachedGateway;
}

export function clearNoonApiGatewayCache() {
  cachedGateway = null;
}

function parseMethodPath(spec: string): { method: string; path: string } {
  const m = spec.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i);
  if (!m) return { method: "GET", path: spec };
  return { method: m[1]!.toUpperCase(), path: m[2]! };
}

/**
 * 通用 HTTP 调用。
 * - 若存在 Service Account 凭证文件 → Partner API 网关（JWT Cookie）
 * - 否则回退 connection.apiKey Bearer（旧占位）
 */
export async function noonRequest(
  connection: NoonConnection,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const cleanPath = path.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, "");
  const hasCredFile = Boolean(readNoonCredentialsFile());

  if (hasCredFile) {
    const credentials = readNoonCredentialsFile()!;
    const session = await loginNoonApiGateway();
    const finalUrl = new URL(
      cleanPath.replace(/^\//, ""),
      NOON_API_GATEWAY.endsWith("/")
        ? NOON_API_GATEWAY
        : `${NOON_API_GATEWAY}/`,
    );
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": userAgent(),
      Cookie: session.cookieHeader,
      "X-Project": credentials.project_code,
    };
    const res = await fetch(finalUrl, {
      method: method || "GET",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      clearNoonApiGatewayCache();
    }
    if (!res.ok) {
      throw new NoonHttpError(
        `NOON HTTP ${res.status} ${finalUrl.pathname}`,
        res.status,
        text,
      );
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  const base = connection.baseUrl.endsWith("/")
    ? connection.baseUrl
    : `${connection.baseUrl}/`;
  const finalUrl = new URL(cleanPath.replace(/^\//, ""), base);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": userAgent(),
    "X-Partner-Id": connection.partnerId,
    Authorization: `Bearer ${connection.apiKey}`,
    "X-Api-Secret": connection.apiSecret,
  };
  const res = await fetch(finalUrl, {
    method: method || "GET",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new NoonHttpError(
      `NOON HTTP ${res.status} ${finalUrl.pathname}`,
      res.status,
      text,
    );
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** whoami 探针：有凭证文件时走官方登录 */
export async function noonWhoami(
  connection: NoonConnection,
): Promise<unknown> {
  const { method, path } = parseMethodPath(NOON_ENDPOINTS.validate);
  return noonRequest(connection, method, path);
}
