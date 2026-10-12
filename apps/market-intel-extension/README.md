# Outpost · Noon 沙特采集插件（MVP）

在 Chrome 加载本目录（开发者模式 → 加载已解压的扩展程序）。

## 选品池（类目页）

1. 打开 `https://www.noon.com/saudi-en/...` 类目页  
2. 点击「采集当前页 → 选品池」  
3. `POST /api/market-intel/ingest`  
4. 慧运营「市场情报」监控池出现真实条目  

## 竞品盯价（商详页）

1. 打开单个商品详情页  
2. 「采价 → 竞品监控」→ `POST /api/market-intel/monitor/price`  
3. 带置信度入库；**两次同向价变**才出告警（低置信/脏价不告警）  
4. 「仅加入监控池」只登记 URL，不写价  

慧运营 API 需已启动（默认 `http://127.0.0.1:8787`），CORS 已放行本机。

