# 接入真实 NOON（全自动同步）

日常路径（推荐）：

1. 「NOON 接入」→ **浏览器登录并保存登录态**
2. 点 **自动同步（SOP导出+入库）**，或等待后台定时任务
3. 打开 **Catalog** 查看拼装结果

报表会落到：`D:\outpost-data\portal-imports\`  
系统按文件名自动识别（live/notlive/Inventory/sales_export/transactionview…）并入库。

## 环境变量

- `OUTPOST_IMPORT_DIR`：导入目录（默认 `D:\outpost-data\portal-imports`）
- `OUTPOST_DISABLE_SOP=true`：定时任务只扫目录、不跑 Playwright 导出
- `OUTPOST_SOP_EVERY_N_TICKS`：隔多少个 poll 周期跑一次 SOP（默认 30）
- `OUTPOST_SOP_HEADLESS=1`：无头跑 SOP

## 兜底

- 手工把 CSV 丢进 `portal-imports` → 自动入库
- 「高级/兜底：手工文件导入」页内上传
- 可配置 XHR URL 的「会话拉取」

## SOP 选择器

Playwright 动作在 `apps/api/src/platforms/noon/portal/sop-selectors.json`。  
Seller Lab 改版时只改该文件中的 URL/选择器即可。

登录入口：https://login.noon.partners/
