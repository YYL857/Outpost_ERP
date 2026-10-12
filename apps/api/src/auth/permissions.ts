import type { NextFunction, Request, Response } from "express";
import type { AuthUser, UserRole } from "./types.js";

type ReqWithUser = Request & { user?: AuthUser };

/**
 * 业务能力（Capability）：API 与 Agent 工具共用同一矩阵。
 * 超管全开；其他人按角色收紧（防侧栏隐藏但直调 API / 套模型掏数）。
 */
export type Capability =
  | "finance.read"
  | "sales.read"
  | "catalog.read"
  | "catalog.cost"
  | "catalog.bulk"
  | "purchase.read"
  | "purchase.write"
  | "replenish.read"
  | "shipping.read"
  | "dashboard.read"
  | "bom.read"
  | "docs.assist"
  | "agent.mutate";

const ALL_CAPABILITIES: Capability[] = [
  "finance.read",
  "sales.read",
  "catalog.read",
  "catalog.cost",
  "catalog.bulk",
  "purchase.read",
  "purchase.write",
  "replenish.read",
  "shipping.read",
  "dashboard.read",
  "bom.read",
  "docs.assist",
  "agent.mutate",
];

/** 角色 → 能力。admin 隐式拥有全部。 */
const ROLE_CAPABILITIES: Record<UserRole, readonly Capability[]> = {
  admin: ALL_CAPABILITIES,
  ops_lead: [
    "sales.read",
    "catalog.read",
    "catalog.cost",
    "catalog.bulk",
    "replenish.read",
    "shipping.read",
    "dashboard.read",
    "docs.assist",
  ],
  ops: [
    "catalog.read",
    "replenish.read",
    "shipping.read",
    "dashboard.read",
    "docs.assist",
  ],
  purchase: [
    "catalog.read",
    "catalog.cost",
    "catalog.bulk",
    "purchase.read",
    "purchase.write",
    "replenish.read",
    "shipping.read",
    "dashboard.read",
    "docs.assist",
  ],
};

/** Agent 工具 id → 所需能力（无条目则任意登录用户可用） */
export const AGENT_TOOL_CAPABILITY: Record<string, Capability> = {
  "finance.query": "finance.read",
  "sales.query": "sales.read",
  "catalog.query": "catalog.bulk",
  "purchase.list": "purchase.read",
  "replenish.query": "replenish.read",
  "shipping.board": "shipping.read",
  "dashboard.overview": "dashboard.read",
  "wiki.context_pack": "shipping.read",
  "wiki.lookup": "shipping.read",
  "wiki.rebuild": "agent.mutate",
  "hub.preload": "dashboard.read",
  "hub.manifest": "dashboard.read",
  // ops.interpret：按 surface 在路由内再鉴权；工具本身需至少一种解读能力
};

export function capabilitiesForRole(role: UserRole | string | undefined | null): Set<Capability> {
  if (!role || !(role in ROLE_CAPABILITIES)) return new Set();
  return new Set(ROLE_CAPABILITIES[role as UserRole]);
}

export function hasCapability(
  role: UserRole | string | undefined | null,
  cap: Capability,
): boolean {
  return capabilitiesForRole(role).has(cap);
}

export function requireCapability(cap: Capability) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as ReqWithUser).user;
    if (!user || !hasCapability(user.role, cap)) {
      res.status(403).json({
        error: `需要权限：${cap}`,
        code: "FORBIDDEN",
        capability: cap,
      });
      return;
    }
    next();
  };
}

/** ops.interpret 的 surface → 能力 */
export function capabilityForOpsSurface(
  surface: string,
): Capability | null {
  if (surface === "finance") return "finance.read";
  if (surface === "sales") return "sales.read";
  if (surface === "replenish") return "replenish.read";
  return null;
}

/** 当前角色是否至少能解读一种 surface（才把 ops.interpret 暴露给模型） */
export function canUseOpsInterpret(role: UserRole | string | undefined | null): boolean {
  return (
    hasCapability(role, "finance.read") ||
    hasCapability(role, "sales.read") ||
    hasCapability(role, "replenish.read")
  );
}

export function roleCapabilitySummary(role: UserRole | string | undefined | null): string {
  const caps = [...capabilitiesForRole(role)].sort();
  if (!caps.length) return "无业务读权限";
  return caps.join(", ");
}
