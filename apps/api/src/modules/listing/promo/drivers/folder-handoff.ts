import {
  existsSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PromoDriver, PromoHandoffPayload } from "./types.js";

function repoRootAbs(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return resolve(here, "../../../../../../../");
}

/** 公司级投递箱：Cursor / 影刀 / 本机 Agent 只盯这里即可，员工不用登录 */
export function promoInboxRoot(): string {
  const env = process.env.LISTING_PROMO_INBOX?.trim();
  if (env) return resolve(env);
  return join(repoRootAbs(), ".tmp_listing_promo_inbox");
}

/**
 * 落盘驱动：拼好的提示词 + 参考图写到任务目录，并镜像到 inbox。
 * 默认链路在落盘后再由 cursor-rpa 键鼠唤起本机 Cursor；亦可单独用 folder 只投递。
 */
export const folderHandoffDriver: PromoDriver = {
  id: "folder",
  async dispatch(payload) {
    const inboxJob = join(promoInboxRoot(), payload.jobId);
    mkdirSync(inboxJob, { recursive: true });
    mkdirSync(join(inboxJob, "refs"), { recursive: true });
    mkdirSync(join(inboxJob, "out"), { recursive: true });

    const promptText = existsSync(payload.promptPathAbs)
      ? readFileSync(payload.promptPathAbs, "utf8")
      : "";

    // 镜像任务包到 inbox（出图端只认 inbox）
    writeFileSync(join(inboxJob, "prompt.md"), promptText, "utf8");
    writeFileSync(
      join(inboxJob, "HANDOFF.json"),
      JSON.stringify(
        {
          ...payload,
          inboxJobDirAbs: inboxJob,
          /** 出图端请把成品 jpg 写到这里（与草稿 out 同步时再拷回） */
          writeImagesTo: payload.outDirAbs,
          alsoWriteImagesToInboxOut: join(inboxJob, "out"),
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    if (existsSync(payload.refsDirAbs)) {
      try {
        cpSync(payload.refsDirAbs, join(inboxJob, "refs"), { recursive: true });
      } catch {
        /* ignore */
      }
    }

    // 任务目录也放一份投递说明，方便本机直接打开
    writeFileSync(
      join(payload.jobDirAbs, "HANDOFF.json"),
      JSON.stringify(
        {
          driver: "folder",
          inboxJobDirAbs: inboxJob,
          outDirAbs: payload.outDirAbs,
          promptPathAbs: payload.promptPathAbs,
          instruction:
            "本机 RPA 或人工：把 prompt.md + refs 交给 Cursor 出图；成品写入 outDirAbs。Outpost 轮询该目录回显。",
        },
        null,
        2,
      ),
      "utf8",
    );

    writeFileSync(
      join(inboxJob, "READY"),
      `ready ${new Date().toISOString()}\n`,
      "utf8",
    );

    return {
      ok: true,
      message: `已投递到 inbox：${inboxJob}；请将成品写入 ${payload.outDirAbs}`,
    };
  },
};
