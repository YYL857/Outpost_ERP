# Outpost · Noon 沙特采集插件（MVP）

在 Chrome 加载本目录（开发者模式 → 加载已解压的扩展程序）。

1. 打开 `https://www.noon.com/saudi-en/...` 类目页  
2. 点击扩展「采集当前页 → Outpost」  
3. 数据 POST 到 `http://127.0.0.1:8787/api/market-intel/ingest`  
4. 慧运营「市场情报」监控池应出现真实条目  

慧运营 API 需已启动，且允许本机跨源（当前 CORS `origin: true`）。
