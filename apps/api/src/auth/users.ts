import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { OUTPOST_ROOT } from "../shops/registry.js";
import { hashPassword } from "./password.js";
import type { AuthUser, UserRecord, UserRole, UsersRegistry } from "./types.js";

const REGISTRY_PATH = join(OUTPOST_ROOT, "users-registry.json");

/** 旧「用户」定位按人名迁到运营角色，只在 role 仍是 user 时生效 */
const LEGACY_USER_ROLE: Record<string, UserRole> = {
  乐东: "purchase",
  黎哥: "ops_lead",
  阿沈: "ops",
};

export function isUserRole(value: string): value is UserRole {
  return (
    value === "admin" ||
    value === "ops_lead" ||
    value === "ops" ||
    value === "purchase"
  );
}

function coerceRole(username: string, role: string): UserRole {
  if (isUserRole(role)) return role;
  if (role === "user" && LEGACY_USER_ROLE[username]) {
    return LEGACY_USER_ROLE[username];
  }
  return "ops";
}

function nowIso() {
  return new Date().toISOString();
}

function ensureRoot() {
  if (!existsSync(OUTPOST_ROOT)) mkdirSync(OUTPOST_ROOT, { recursive: true });
}

function toPublic(u: UserRecord) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    disabled: Boolean(u.disabled),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function adminCount(users: UserRecord[]) {
  return users.filter((u) => u.role === "admin" && !u.disabled).length;
}

export function getUsersRegistryPath() {
  return REGISTRY_PATH;
}

export function loadUsersRegistry(): UsersRegistry {
  ensureRoot();
  if (!existsSync(REGISTRY_PATH)) {
    const empty: UsersRegistry = {
      version: 1,
      users: [],
      updatedAt: nowIso(),
    };
    writeFileSync(REGISTRY_PATH, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as UsersRegistry;
  const source = Array.isArray(raw.users) ? raw.users : [];
  let changed = false;
  const users = source.map((u) => {
    const role = coerceRole(u.username, String(u.role ?? ""));
    if (role !== u.role) changed = true;
    return { ...u, role };
  });
  const reg: UsersRegistry = {
    version: 1,
    users,
    updatedAt: raw.updatedAt ?? nowIso(),
  };
  if (changed) return saveUsersRegistry(reg);
  return reg;
}

export function saveUsersRegistry(reg: UsersRegistry) {
  ensureRoot();
  const next: UsersRegistry = {
    version: 1,
    users: reg.users,
    updatedAt: nowIso(),
  };
  writeFileSync(REGISTRY_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function toAuthUser(u: UserRecord): AuthUser {
  return { id: u.id, username: u.username, role: u.role };
}

export function findUserById(id: string): UserRecord | undefined {
  return loadUsersRegistry().users.find((u) => u.id === id);
}

export function findUserByUsername(username: string): UserRecord | undefined {
  const key = username.trim().toLowerCase();
  return loadUsersRegistry().users.find(
    (u) => u.username.toLowerCase() === key,
  );
}

export function getAdminUser(): UserRecord | undefined {
  return loadUsersRegistry().users.find(
    (u) => u.role === "admin" && !u.disabled,
  );
}

export function listUsersPublic() {
  return loadUsersRegistry().users.map(toPublic);
}

export function createUser(input: {
  username: string;
  password: string;
  role?: UserRole;
}): UserRecord {
  const username = input.username.trim();
  if (!username || username.length < 2) {
    throw new Error("用户名至少 2 个字符");
  }
  if (!input.password || input.password.length < 6) {
    throw new Error("密码至少 6 个字符");
  }
  const role = input.role ?? "ops";
  if (!isUserRole(role)) {
    throw new Error("角色无效");
  }
  if (findUserByUsername(username)) {
    throw new Error("用户名已存在");
  }
  const ts = nowIso();
  const user: UserRecord = {
    id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    username,
    passwordHash: hashPassword(input.password),
    role,
    disabled: false,
    createdAt: ts,
    updatedAt: ts,
  };
  const reg = loadUsersRegistry();
  reg.users.push(user);
  saveUsersRegistry(reg);
  return user;
}

export function resetUserPassword(userId: string, password: string): UserRecord {
  if (!password || password.length < 6) {
    throw new Error("密码至少 6 个字符");
  }
  const reg = loadUsersRegistry();
  const idx = reg.users.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error("用户不存在");
  const prev = reg.users[idx]!;
  const next: UserRecord = {
    ...prev,
    passwordHash: hashPassword(password),
    updatedAt: nowIso(),
  };
  reg.users[idx] = next;
  saveUsersRegistry(reg);
  return next;
}

export function updateUserRole(userId: string, role: UserRole): UserRecord {
  if (!isUserRole(role)) throw new Error("角色无效");
  const reg = loadUsersRegistry();
  const idx = reg.users.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error("用户不存在");
  const prev = reg.users[idx]!;
  if (
    prev.role === "admin" &&
    role !== "admin" &&
    adminCount(reg.users) <= 1
  ) {
    throw new Error("至少保留一名可用的超级管理员");
  }
  const next: UserRecord = {
    ...prev,
    role,
    updatedAt: nowIso(),
  };
  reg.users[idx] = next;
  saveUsersRegistry(reg);
  return next;
}

export function setUserDisabled(userId: string, disabled: boolean): UserRecord {
  const reg = loadUsersRegistry();
  const idx = reg.users.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error("用户不存在");
  const prev = reg.users[idx]!;
  if (disabled && prev.role === "admin" && adminCount(reg.users) <= 1) {
    throw new Error("不能停用最后一名超级管理员");
  }
  const next: UserRecord = {
    ...prev,
    disabled,
    updatedAt: nowIso(),
  };
  reg.users[idx] = next;
  saveUsersRegistry(reg);
  return next;
}

export function deleteUser(userId: string): UserRecord {
  const reg = loadUsersRegistry();
  const idx = reg.users.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error("用户不存在");
  const prev = reg.users[idx]!;
  if (prev.role === "admin" && adminCount(reg.users) <= 1) {
    throw new Error("不能删除最后一名超级管理员");
  }
  reg.users.splice(idx, 1);
  saveUsersRegistry(reg);
  return prev;
}

export function publicUser(u: UserRecord) {
  return toPublic(u);
}
