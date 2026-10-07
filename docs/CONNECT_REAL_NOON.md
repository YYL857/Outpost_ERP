# 接入真实 NOON

日常路径（推荐）：

1. 「NOON 接入」→ 模式选 **live**，配置 Service Account JSON（`OUTPOST_NOON_CREDENTIALS_FILE`）
2. 点 **校验凭证**，再点 **自动同步（Partner API）**
3. 打开 **Catalog** 查看结果

## 兜底

- 手工把 CSV 丢进 `portal-imports` → 自动入库
- 「高级/兜底：手工文件导入」页内上传

## 影刀补洞（Ads）

Ads 无 Impex；由影刀导出投递，慧运营只扫 `portal-imports`。  
说明：[`YINGDAO_BRIDGE.md`](./YINGDAO_BRIDGE.md)
