/**
 * 货代门户浏览器自动化 — 类型与配置（凭据只读本地，不进仓库）
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ForwarderAdapterId =
  | "nextsls"
  | "yundaomen"
  | "fleetan"
  | "ontask"
  | "chicexpress";

export type ForwarderPortalRef = {
  id: string;
  name: string;
  adapter: ForwarderAdapterId;
  enabled?: boolean;
  loginUrl: string;
  trackingIdKinds?: string[];
};

export type ForwarderPortalAccount = {
  username: string;
  password: string;
};

export type ForwarderPortalsFile = {
  version: 1;
  portals: ForwarderPortalRef[];
};

export type ForwarderCredentialsFile = {
  version: 1;
  accounts: Record<string, ForwarderPortalAccount>;
};

export type LoginProbeResult = {
  portalId: string;
  name: string;
  adapter: ForwarderAdapterId;
  ok: boolean;
  stage: "config" | "launch" | "navigate" | "fill" | "submit" | "verify";
  message: string;
  finalUrl?: string;
  screenshotPath?: string;
  durationMs: number;
};

export function getForwarderPortalsDir(): string {
  const fromEnv = process.env.OUTPOST_FORWARDER_PORTALS_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  const root =
    process.env.OUTPOST_ROOT?.trim() ||
    process.env.OUTPOST_DATA_DIR?.trim() ||
    "D:\\outpost-data";
  return resolve(root, "forwarder-portals");
}

export function getForwarderPortalsConfigPath(): string {
  const fromEnv = process.env.OUTPOST_FORWARDER_PORTALS_FILE?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd(), "config", "forwarder-portals.example.json");
}

export function getForwarderCredentialsPath(): string {
  const fromEnv = process.env.OUTPOST_FORWARDER_CREDENTIALS_FILE?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(getForwarderPortalsDir(), "credentials.json");
}

export function loadForwarderPortalsFile(
  filePath = getForwarderPortalsConfigPath(),
): ForwarderPortalsFile {
  if (!existsSync(filePath)) {
    throw new Error(`找不到货代门户配置: ${filePath}`);
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as ForwarderPortalsFile;
  if (raw.version !== 1 || !Array.isArray(raw.portals)) {
    throw new Error("forwarder-portals 配置格式无效");
  }
  return raw;
}

export function loadForwarderCredentials(
  filePath = getForwarderCredentialsPath(),
): ForwarderCredentialsFile {
  if (!existsSync(filePath)) {
    throw new Error(
      `找不到货代账号文件: ${filePath}（请从桌面登记表导入到 outpost-data/forwarder-portals/credentials.json）`,
    );
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as ForwarderCredentialsFile;
  if (raw.version !== 1 || !raw.accounts) {
    throw new Error("credentials.json 格式无效");
  }
  return raw;
}
