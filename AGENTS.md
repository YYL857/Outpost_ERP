# Outpost — Agent 入口

先读系统骨架，再按问题类型下钻。不要从 README 架构段推断当前模块。

| 要做什么 | 先读 |
|----------|------|
| 看清分层、目录、API、数据根 | `.cursor/skills/outpost-system-map/preload.md` 或 `GET /api/system-map/agent-preload` |
| 深挖挂载 / UI / RPA | `GET /api/system-map` |
| 箱号、票号、PSKU、表怎么连 | `GET /api/wiki-graph/agent-preload`（Skill `outpost-wiki-graph`） |
| 能调哪些工具、反幻觉 | `GET /api/agent-hub/manifest`（Skill `outpost-agent-hub`） |

事实在 `OUTPOST_ROOT`（默认 `D:\outpost-data`）各店 `state.json`，不在 Git。无工具证据不得编造单号与金额。
