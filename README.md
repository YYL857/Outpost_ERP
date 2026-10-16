# 慧运营 ERP

跨境电商经营后台。业务数据统一来自 **NOON**。

同步主路径：

- **Partner Impex（live）**：订单 / 销售报表 / 库存 / 价库 / 费用 → 直接写入各店 `state.json`
- **Playwright（pw-rpa）**：须点门户导出的广告、销量等 → 各店 `portal-imports` → auto-ingest → `state.json`

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
- 数据根 `D:\outpost-data`（各店 `shops\{shopId}\json\state.json`、`shops\{shopId}\portal-imports\`）

上线对接步骤见 [GO_LIVE.md](./GO_LIVE.md)。环境变量模板：[.env.example](./.env.example)。  
Playwright 门户导出见 [docs/PW_RPA_PLATFORM.md](./docs/PW_RPA_PLATFORM.md)。

## 架构要点

```
NOON
  → Impex（live）直接入库
  → 或 Playwright 门户导出 → portal-imports → Inbox / auto-ingest
  → 幂等写入 orders / catalog / stock / salesFacts / adsFacts …
  → 业务模块只读本地店态
  → 同步健康中心告警
```

门户实现：`apps/api/src/platforms/noon/portal/`  
Playwright 调度：`apps/api/src/modules/pw-rpa/`（脚本在 `apps/api/scripts/noon-pw-platform/`）  
操作入口：前端「NOON 接入」/ 广告与补货相关导出按钮。

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
