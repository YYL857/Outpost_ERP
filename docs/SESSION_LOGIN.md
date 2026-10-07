# 浏览器登录态

唯一方式：**打开登录窗**（本机 Chrome + Playwright `storage_state`）。

不要复制日常 Chrome Cookie，也不要粘贴 Cookie / 调试端口导入——这些方式已移除。

## 操作步骤

1. 前哨 → **NOON 接入** → **打开登录窗**
2. 在弹出的本机 Chrome 中登录并进入 Seller Lab（地址栏含 `www.noon.partners`）
3. 选好店铺后等待自动保存，关闭窗口
4. **尽快**点「探测可用性」或「自动同步」（网关 Cookie 短命）

有文件 ≠ 可用。自动同步前会先探针；`blocked` / `expired` 会跳过 SOP 并提示重登。

探针 API：`POST /api/noon/portal/session-probe`

```powershell
cd apps\api
node scripts\verify-noon-session.mjs
```

## 官方 Partner API（二阶段 / live 模式）

文档：[noon-docs.noonpartners.dev](https://noon-docs.noonpartners.dev/)

1. Partner → Access App → Add Service Account，下载 JSON（勿提交 git）
2. 放到 `D:\outpost-data\noon-credentials_sensitive.json`，或设 `OUTPOST_NOON_CREDENTIALS_FILE`
3. 接入模式改为 `live`，点校验：会走 JWT → `noon-api-gateway` → `/identity/v1/whoami`

sales / fees 官方覆盖弱，仍可用门户或手工 CSV。

## 环境变量

- `OUTPOST_BROWSER_CHANNEL=chrome`
- `OUTPOST_NOON_PROBE_URL=https://www.noon.partners/en-ae/`
- `OUTPOST_NOON_CREDENTIALS_FILE=D:\outpost-data\noon-credentials_sensitive.json`
- `OUTPOST_NOON_API_BASE=https://noon-api-gateway.noon.partners`
- `OUTPOST_NOON_USER_AGENT=OutpostErp/0.1 (PartnerAPI)`
- `OUTPOST_SOP_HEADLESS=1`（不推荐）
- `OUTPOST_SESSION_WARN_MINUTES=30`
- `OUTPOST_SESSION_ESTIMATED_HOURS=12`
