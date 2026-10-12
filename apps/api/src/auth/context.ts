import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthUser } from "./types.js";

export type RequestContext = {
  user: AuthUser;
  shopId: string;
};

/** 后台多店同步 / 轮询用的系统身份（非登录用户） */
export const SYSTEM_SYNC_USER: AuthUser = {
  id: "system-sync",
  username: "system-sync",
  role: "admin",
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function getContextUser(): AuthUser | undefined {
  return getRequestContext()?.user;
}

export function getContextUserId(): string | undefined {
  return getRequestContext()?.user.id;
}

export function getContextShopId(): string | undefined {
  return getRequestContext()?.shopId;
}

export function requireContextUser(): AuthUser {
  const user = getContextUser();
  if (!user) throw new Error("未登录");
  return user;
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn);
}
