# 本地开发环境（D 盘）

本仓库约定：开发工具链与运行数据都放在 **D 盘**，不依赖 Cursor 自带 Node。

## 目录

| 路径 | 用途 |
|------|------|
| `D:\devtools\nodejs` | Node.js + npm |
| `D:\devtools\pnpm` | PNPM_HOME（全局命令） |
| `D:\devtools\pnpm\store` | pnpm 包缓存 |
| `D:\outpost-erp` | 源码 |
| `D:\outpost-data\json` | 业务 `state.json`（本期真实存储） |
| `D:\outpost-data\portal-imports` | SOP 报表落盘（后续导入） |
| `D:\outpost-data\logs` | 日志预留 |
| `D:\outpost-data\postgres` | 日后 PostgreSQL 数据目录预留 |

语言栈：**Node ≥ 20 + TypeScript + pnpm workspace**。本期 `DATA_DRIVER=json`；Postgres 仓储未实现前不要切 `postgres`。

## 一键自检

```powershell
Set-ExecutionPolicy -Scope Process Bypass
D:\outpost-erp\scripts\setup-d-drive-env.ps1
```

首次若尚未安装 Node：从 [nodejs.org dist](https://nodejs.org/dist/) 下载 **win-x64 zip**，解压内容到 `D:\devtools\nodejs`，再跑上述脚本。

## 启动（推荐：与 Cursor 解耦）

日常请用后台独立进程，**关掉 / 重启 Cursor 也不会停服务**：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
D:\Outpost_ERP\scripts\start-services.ps1
```

| 脚本 | 作用 |
|------|------|
| `scripts\start-services.ps1` | 后台启动 API + Web（脱离终端 Job） |
| `scripts\status-services.ps1` | 查看是否在跑 |
| `scripts\stop-services.ps1` | 停止后台服务 |
| `scripts\install-autostart.ps1` | **一键开机自启**（登录后约 45 秒自动拉起） |
| `scripts\open-firewall.ps1` | 开放防火墙 5173/8787（需管理员，局域网访问用） |

局域网其他设备：用本机 IP 打开 `http://<本机IP>:5173`（前端会经 Vite 代理访问本机 API）。  
若打不开，**以管理员**运行 `scripts\open-firewall.ps1`。

### 开机自启

```powershell
Set-ExecutionPolicy -Scope Process Bypass
D:\Outpost_ERP\scripts\install-autostart.ps1
```

- 查看：`install-autostart.ps1 -Status`
- 取消：`install-autostart.ps1 -Uninstall`

会注册计划任务 `OutpostERP-Services`（当前用户登录时启动，不依赖 Cursor）。

日志：`D:\outpost-data\logs\`（`api-out.log` / `web-out.log` 等）

若终端里已在跑 `pnpm dev`，先停掉再执行 `start-services.ps1`，避免端口占用。

### 前台开发（会挂在当前终端）

仅调试时用；关终端 / 关 Cursor 可能一起退出：

```powershell
cd D:\Outpost_ERP
pnpm install
pnpm dev
```

- 前端：http://127.0.0.1:5173  
- 后端：http://127.0.0.1:8787  
- 就绪：`GET /api/ready`（应含 `"dataDir":"D:\\outpost-data\\json"`）  
- 健康：`GET /api/health`

## 环境变量

根目录 `.env`（可由 `.env.example` 复制）：

- `OUTPOST_DATA_DIR=D:\outpost-data\json`
- `NOON_MODE=mock`（先验链路；通后再改 `portal`）
- `DATA_DRIVER=json`

中文控制台乱码时可在会话内执行 `chcp 65001`。

## 常见问题：pnpm install 报 EPERM symlink

Windows 未开启「开发人员模式」时，pnpm 无法在 store 里创建项目符号链接。

1. 打开 **设置 → 系统 → 开发者选项（或隐私和安全性 → 开发者选项）→ 开发人员模式 = 开**
2. **重新打开** PowerShell 后执行：

```powershell
cd D:\outpost-erp
pnpm install
```

若暂时无法开启开发人员模式，而仓库里已有 `node_modules`，可用：

```powershell
D:\outpost-erp\scripts\dev-d-drive.ps1
```

直接用 `D:\devtools\nodejs` 启动 API + Web（不经过 pnpm 链接安装）。

## 链路验收顺序

1. mock：接入口校验 → `POST /api/sync/run/orders|catalog|stock`
2. portal 模板导入（仍可不接真实后台）
3. 按 SOP 真导出 CSV 导入

详见 `GO_LIVE.md` 与同步健康中心。

