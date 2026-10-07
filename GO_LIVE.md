# 前哨 Outpost — 上线对接清单

## 前提（重要）

若 **NOON 官方不提供开放接口**，请使用 **portal（门户）模式**：

1. 在卖家后台导出 CSV/JSON，或  
2. 登录后复制 Cookie，并填写列表数据的 XHR/页面 URL  

系统会解析归类 → 写入 Inbox → 同步到业务库。  
`live` 模式仅在确有官方 API 时使用。

## 1. 部署前（本地已完成）

- [x] 模块壳与简约 UI、配置、同步健康中心
- [x] Inbox + 幂等写入 + 告警
- [x] **门户采集**：文件导入解析、Cookie 会话拉取、浏览器自动化占位
- [x] Catalog / 上架 / 销量 / Best Sell / 财务骨架（吃本地同步数据）
- [x] mock / portal / live 三模式可切换

## 2. 到环境后（门户模式推荐）

1. 复制 `.env.example` → `.env`，设置 `NOON_MODE=portal`
2. 启动：`pnpm install && pnpm dev`
3. 打开「NOON 接入」：
   - **主路径**：选择订单/商品/库存类型 → 上传后台导出文件 →「导入并同步」
   - **可选**：填写 Cookie + 数据 URL →「会话拉取并同步」
4. 到 Catalog / 销量 / 财务页确认数据已出现
5. 同步健康中心应显示 Inbox 处理成功；失败会红灯告警

### 导出字段建议

- 订单：`order_nr,status,currency,total_amount,item_count,placed_at,updated_at`
- 商品：`partner_sku,title,is_active,updated_at`
- 库存：`partner_sku,warehouse_code,qty,updated_at`  
（表头名称支持常见别名，如 sku / order id 等）

可在接入页下载对应 CSV 模板。

## 3. 若将来有官方 API

设 `NOON_MODE=live`，并调整：

- `platforms/noon/endpoints.ts`
- `platforms/noon/http.ts` 鉴权
- 必要时 `live-client.ts` 字段映射

## 4. 不要改的地方

业务页只读本地已同步数据。  
外部取数只走 `platforms/noon/*`（含 `portal/`）→ Inbox → 业务表。
