import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUTPOST_ROOT } from "../shops/registry.js";
import { generateBootstrapPassword } from "./password.js";
import { createUser, loadUsersRegistry } from "./users.js";
import {
  ensureUserWorkspace,
  migrateLegacyWorkspacesToAdmin,
} from "./workspace.js";

/**
 * 首次启动：创建默认超管 admin；密码来自 OUTPOST_ADMIN_PASSWORD，
 * 未设则写入 OUTPOST_ROOT/admin-bootstrap.txt。
 */
export function bootstrapAuth() {
  const reg = loadUsersRegistry();
  if (reg.users.length > 0) {
    const admin = reg.users.find((u) => u.role === "admin") ?? reg.users[0]!;
    ensureUserWorkspace(admin.id);
    migrateLegacyWorkspacesToAdmin(admin.id);
    return admin;
  }

  const fromEnv = process.env.OUTPOST_ADMIN_PASSWORD?.trim();
  const password = fromEnv || generateBootstrapPassword();
  const admin = createUser({
    username: "admin",
    password,
    role: "admin",
  });
  ensureUserWorkspace(admin.id);

  if (!fromEnv) {
    const bootFile = join(OUTPOST_ROOT, "admin-bootstrap.txt");
    if (!existsSync(OUTPOST_ROOT)) {
      /* OUTPOST_ROOT ensured by registry */
    }
    writeFileSync(
      bootFile,
      [
        "Outpost ERP 默认超级管理员（首次启动自动生成）",
        `username: admin`,
        `password: ${password}`,
        "",
        "登录后请立即修改密码，并删除本文件。",
        `generatedAt: ${new Date().toISOString()}`,
        "",
      ].join("\n"),
      "utf8",
    );
    console.log(
      `[auth] 已创建超管 admin，初始密码见 ${bootFile}（或设置 OUTPOST_ADMIN_PASSWORD）`,
    );
  } else {
    console.log(`[auth] 已创建超管 admin（密码来自 OUTPOST_ADMIN_PASSWORD）`);
  }

  migrateLegacyWorkspacesToAdmin(admin.id);
  return admin;
}
