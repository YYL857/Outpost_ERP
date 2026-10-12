import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CursorDriverResult = {
  ok: boolean;
  mode: "sdk" | "manual";
  agentId?: string;
  runId?: string;
  status?: string;
  resultText?: string;
  error?: string;
};

function repoRootAbs(): string {
  // apps/api/src/modules/listing/promo -> repo root
  const here = fileURLToPath(new URL(".", import.meta.url));
  return resolve(here, "../../../../../../");
}

/** .env 显式密钥（优先） */
export function cursorApiKey(): string | null {
  return process.env.CURSOR_API_KEY?.trim() || null;
}

/** 是否已有可用凭证：env 或 Cursor.auth.login 落盘 */
export async function hasCursorAuth(): Promise<boolean> {
  if (cursorApiKey()) return true;
  try {
    const { Cursor } = await import("@cursor/sdk");
    const st = await Cursor.auth.status();
    return st.status === "logged-in";
  } catch {
    return false;
  }
}

export function promoModelId(): string {
  return process.env.LISTING_PROMO_MODEL?.trim() || "composer-2.5";
}

export function loadRefImagesAsBase64(
  absPaths: string[],
  max = 6,
): Array<{ data: string; mimeType: string }> {
  const out: Array<{ data: string; mimeType: string }> = [];
  for (const p of absPaths.slice(0, max)) {
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    if (buf.length > 6 * 1024 * 1024) continue;
    const lower = p.toLowerCase();
    const mimeType = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    out.push({ data: buf.toString("base64"), mimeType });
  }
  return out;
}

/**
 * 调用 Cursor SDK 本机 Agent。
 * 鉴权顺序：显式 CURSOR_API_KEY → SDK 已登录缓存（auth.login）→ 否则 manual。
 */
export async function runCursorPromoAgent(opts: {
  prompt: string;
  refImageAbsPaths: string[];
  /** 改图时 resume */
  resumeAgentId?: string;
}): Promise<CursorDriverResult> {
  let Agent: typeof import("@cursor/sdk").Agent;
  try {
    ({ Agent } = await import("@cursor/sdk"));
  } catch (e) {
    return {
      ok: false,
      mode: "manual",
      error: `无法加载 @cursor/sdk: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const apiKey = cursorApiKey();
  const authed = apiKey ? true : await hasCursorAuth();
  if (!authed) {
    return {
      ok: false,
      mode: "manual",
      error:
        "未登录 Cursor SDK。请在 apps/api 执行 npm run listing-promo:login（浏览器登一次），或配置 CURSOR_API_KEY",
    };
  }

  const cwd = repoRootAbs();
  const images = loadRefImagesAsBase64(opts.refImageAbsPaths);
  // 有 env 则显式传入；否则交给 SDK 读 ~/.cursor/sdk/auth.json
  const authOpt = apiKey ? { apiKey } : {};

  try {
    const agent = opts.resumeAgentId
      ? await Agent.resume(opts.resumeAgentId, {
          ...authOpt,
          model: { id: promoModelId() },
        })
      : await Agent.create({
          ...authOpt,
          model: { id: promoModelId() },
          local: { cwd },
        });

    try {
      const message =
        images.length > 0 ? { text: opts.prompt, images } : opts.prompt;
      const run = await agent.send(message as never);
      const result = await run.wait();
      const agentId = agent.agentId;
      const runId = result.id;

      if (result.status === "finished") {
        return {
          ok: true,
          mode: "sdk",
          agentId,
          runId,
          status: result.status,
          resultText: result.result || "",
        };
      }
      return {
        ok: false,
        mode: "sdk",
        agentId,
        runId,
        status: result.status,
        resultText: result.result || "",
        error: result.error?.message || `run status=${result.status}`,
      };
    } finally {
      try {
        await agent[Symbol.asyncDispose]();
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    return {
      ok: false,
      mode: "manual",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function draftImageAbsPaths(
  listingRoot: string,
  relativePaths: string[],
): string[] {
  return relativePaths.map((r) => join(listingRoot, r));
}
