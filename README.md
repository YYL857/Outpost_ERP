# 前哨 Outpost ERP

跨境电商经营后台。业务数据统一来自 **NOON**。  
若官方无开放接口：使用 **portal 模式**（后台导出 CSV/JSON 导入，或 Cookie 会话拉取）→ Inbox → 业务库。

## 快速开始

本地工具链与数据目录约定在 **D 盘**，详见 [docs/LOCAL_SETUP.md](./docs/LOCAL_SETUP.md)。

```powershell
# 可选：自检 PATH / 目录 / .env
D:\outpost-erp\scripts\setup-d-drive-env.ps1

cd D:\outpost-erp
pnpm install
pnpm dev
```

- 前端 http://127.0.0.1:5173
- 后端 http://127.0.0.1:8787
- 数据 `D:\outpost-data\json\state.json`（`OUTPOST_DATA_DIR`）

上线对接步骤见 [GO_LIVE.md](./GO_LIVE.md)。环境变量模板：[.env.example](./.env.example)。

## 架构要点

```
NOON 卖家后台
  → 导出文件导入 或 Cookie+URL 会话拉取（portal）
  → Inbox（先落库、归类）
  → 幂等写入 orders/catalog/stock
  → 业务模块只读本地库
  → 同步健康中心告警
```

门户实现目录：`apps/api/src/platforms/noon/portal/`  
操作入口：前端「NOON 接入」页。

## 已具备模块

| 区域 | 状态 |
|------|------|
| 主页配置 / NOON 接入 / 同步健康 | 可用 |
| Catalog / 上架额度 / 销量 / Best Sell / 财务骨架 | 可用（吃同步数据） |
| 采购补货发货 / 广告 / 测评活动等 | 路由占位 |
| 数据驱动 | json 默认；postgres 接口已留 |

## 目录

```
apps/web   React UI
apps/api   Express API + NOON 接入层
```
