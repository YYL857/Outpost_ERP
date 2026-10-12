export type UserRole = "admin" | "ops_lead" | "ops" | "purchase";

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  /** 停用后不能登录，已有会话作废 */
  disabled?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UsersRegistry = {
  version: 1;
  users: UserRecord[];
  updatedAt: string;
};

export type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
};

export type UserPrefs = {
  selectedShopId: string;
  updatedAt: string;
};

export type SessionRecord = {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  /** 最近一次经鉴权访问的时间（用于在线判断） */
  lastSeenAt?: string;
};
