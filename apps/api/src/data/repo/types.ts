import type { AppState } from "../../common/types.js";

/**
 * 业务仓储抽象。
 * 当前 JsonFileRepository 落地；上线可换 PostgresRepository，路由层无需改。
 */
export interface AppRepository {
  readonly driver: "json" | "postgres";
  getState(): AppState;
  save(): void;
  /** 多店切换时替换内存 state（可选） */
  replaceState?(next: AppState): void;
}

export type { AppState };
