import type { AppRepository } from "./types.js";

/**
 * PostgreSQL 仓储占位。
 * 上线步骤：安装 pg → 建表迁移 → 实现 getState/save（或按聚合读写）。
 * 切换方式：DATA_DRIVER=postgres + DATABASE_URL
 */
export class PostgresRepository implements AppRepository {
  readonly driver = "postgres" as const;

  constructor(private readonly databaseUrl: string) {
    if (!databaseUrl) {
      throw new Error("DATA_DRIVER=postgres 时必须配置 DATABASE_URL");
    }
  }

  getState(): never {
    throw new Error(
      "PostgresRepository 尚未实现。请先用 DATA_DRIVER=json，或完成 apps/api/src/data/repo/postgres-repository.ts",
    );
  }

  save(): never {
    throw new Error("PostgresRepository.save 尚未实现");
  }
}
