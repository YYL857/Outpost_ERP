const REDACT_KEYS = new Set([
  "password",
  "passwordhash",
  "passwordHash",
  "token",
  "accesstoken",
  "accessToken",
  "refreshtoken",
  "refreshToken",
  "authorization",
  "cookie",
  "cookies",
  "secret",
  "apikey",
  "apiKey",
  "credentials",
  "storageState",
  "storagestate",
]);

const MAX_DEPTH = 4;
const MAX_KEYS = 40;
const MAX_STRING = 200;
const MAX_JSON_CHARS = 2500;

function keyLooksSensitive(key: string) {
  const k = key.toLowerCase();
  if (REDACT_KEYS.has(key) || REDACT_KEYS.has(k)) return true;
  if (k.includes("password") || k.includes("secret") || k.includes("token")) {
    return true;
  }
  if (k.includes("base64") || k.endsWith("b64")) return true;
  return false;
}

function scrubValue(value: unknown, depth: number): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > MAX_STRING) return `${value.slice(0, MAX_STRING)}…`;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `[array:${value.length}]`;
    return value.slice(0, 12).map((v) => scrubValue(v, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return "[object]";
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n >= MAX_KEYS) {
        out._truncated = true;
        break;
      }
      if (keyLooksSensitive(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = scrubValue(v, depth + 1);
      }
      n += 1;
    }
    return out;
  }
  return String(value);
}

/** 脱敏 + 截断，供审计落盘 */
export function sanitizeBody(body: unknown): Record<string, unknown> | undefined {
  if (body == null) return undefined;
  if (typeof body !== "object") {
    return { value: scrubValue(body, 0) as unknown };
  }
  const scrubbed = scrubValue(body, 0);
  let text = "";
  try {
    text = JSON.stringify(scrubbed);
  } catch {
    return { _error: "unserializable" };
  }
  if (text.length > MAX_JSON_CHARS) {
    return {
      ...(typeof scrubbed === "object" && scrubbed && !Array.isArray(scrubbed)
        ? (scrubbed as Record<string, unknown>)
        : { value: scrubbed }),
      _truncatedChars: true,
    };
  }
  return typeof scrubbed === "object" && scrubbed && !Array.isArray(scrubbed)
    ? (scrubbed as Record<string, unknown>)
    : { value: scrubbed as unknown };
}
