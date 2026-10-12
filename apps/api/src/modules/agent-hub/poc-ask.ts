/**
 * 最小编排 PoC：选工具 → 调 API → HubAnswer → validate-answer
 *
 *   npx tsx src/modules/agent-hub/poc-ask.ts
 *   OUTPOST_API=http://127.0.0.1:8787 OUTPOST_USER=admin OUTPOST_PASS=xxx npx tsx ...
 *
 * 默认问句：箱号 2508-01-N1-K 状态（wiki.context_pack）
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const API = (process.env.OUTPOST_API ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const BOX = process.env.POC_BOX ?? "2508-01-N1-K";

function readBootstrapPassword(): string | null {
  const p = join(
    process.env.OUTPOST_DATA_DIR ?? "D:\\outpost-data",
    "admin-bootstrap.txt",
  );
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf8").match(/password:\s*(\S+)/);
  return m?.[1] ?? null;
}

async function main() {
  const user = process.env.OUTPOST_USER ?? "admin";
  const pass =
    process.env.OUTPOST_PASS ??
    process.env.OUTPOST_ADMIN_PASSWORD ??
    readBootstrapPassword();
  if (!pass) {
    throw new Error("缺少密码：设 OUTPOST_PASS 或保留 admin-bootstrap.txt");
  }

  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (!loginRes.ok) {
    throw new Error(`login ${loginRes.status}: ${await loginRes.text()}`);
  }
  const loginJson = (await loginRes.json()) as {
    data?: { token?: string };
  };
  const token = loginJson.data?.token;
  if (!token) throw new Error("login 未返回 token");
  const cookie = loginRes.headers.getSetCookie?.() ?? [];
  const cookieHeader =
    cookie.map((c) => c.split(";")[0]).join("; ") ||
    `outpost_session=${token}`;

  const headers: Record<string, string> = {
    cookie: cookieHeader,
    authorization: `Bearer ${token}`,
  };

  // 1) 选工具：有箱号 → wiki.context_pack
  const packUrl = `${API}/api/wiki-graph/context-pack?keyType=boxNo&keyValue=${encodeURIComponent(BOX)}`;
  const packRes = await fetch(packUrl, { headers });
  if (!packRes.ok) {
    throw new Error(`context-pack ${packRes.status}: ${await packRes.text()}`);
  }
  const pack = (await packRes.json()) as {
    data?: {
      entities?: Array<{ summary?: string; id?: string }>;
      notFound?: boolean;
    };
  };
  const entity = pack.data?.entities?.[0];
  const excerpt = entity?.summary?.trim() || "";
  if (!excerpt) {
    const answer = {
      verdict: `未查到箱号 ${BOX}`,
      confidence: "low" as const,
      evidence: [] as Array<{
        toolId: string;
        source: string;
        key?: string;
        excerpt: string;
      }>,
      openQuestions: ["请核对箱号拼写或换 keyType"],
      toolsUsed: ["wiki.context_pack"],
      notFound: [BOX],
    };
    const v = await validate(headers, answer);
    console.log("[poc] not found", JSON.stringify({ answer, validate: v }, null, 2));
    return;
  }

  // 2) HubAnswer
  const answer = {
    verdict: `箱号 ${BOX}：${excerpt}`,
    confidence: "high" as const,
    evidence: [
      {
        toolId: "wiki.context_pack",
        source: "/api/wiki-graph/context-pack",
        key: `boxNo=${BOX}`,
        excerpt,
      },
    ],
    openQuestions: [
      "如需 portal 轨迹，需另调货代 track 接口（不在本 12 工具默认集）。",
    ],
    toolsUsed: ["wiki.context_pack"],
  };

  // 3) validate
  const v = await validate(headers, answer);
  console.log("[poc] question: 箱号", BOX, "现在什么状态？");
  console.log("[poc] toolsUsed:", answer.toolsUsed.join(", "));
  console.log("[poc] verdict:", answer.verdict);
  console.log("[poc] validate:", JSON.stringify(v));
  if (!v.ok) process.exitCode = 1;
}

async function validate(
  headers: Record<string, string>,
  answer: unknown,
): Promise<{ ok: boolean; violations?: string[] }> {
  const res = await fetch(`${API}/api/agent-hub/validate-answer`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(answer),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    data?: { ok?: boolean; violations?: string[] };
  };
  return {
    ok: Boolean(json.ok && json.data?.ok),
    violations: json.data?.violations,
  };
}

main().catch((e) => {
  console.error("[poc] fail", e);
  process.exitCode = 1;
});
