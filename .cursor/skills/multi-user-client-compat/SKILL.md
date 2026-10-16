---
name: multi-user-client-compat
description: >-
  Outpost ERP is a multi-user office system, not a personal localhost tool.
  Forces LAN/HTTP/non-admin client compatibility for browser APIs (clipboard,
  downloads, open-folder, secure context). Use automatically on any coding task
  that touches web UI, copy/download/export buttons, RPA handoff, or features
  assumed to run only on the developer's machine.
---

# 多用户客户端兼容（非本机专用）

## 硬性规则（用户原话要点）

这个系统不是给开发者自己用的。做功能时必须考虑其他电脑上的同事：局域网访问、非 HTTPS、非管理员、非本机路径。

## 何时启用

凡本仓库编码任务一律遵守，尤其：

- 前端「复制 / 下载 / 打开文件夹 / 唤起本机程序」
- 依赖 `localhost`、本机磁盘、剪贴板、通知、文件选择器的交互
- 任何「我这边测过能用」的浏览器能力

## 开工前自问

1. 同事是否用 `http://内网IP:端口` 打开？（非 Secure Context）
2. 该能力是否只在 HTTPS / localhost 可用？
3. 失败时有无静默吞错、却显示「已复制」？
4. 是否误把「服务器本机」当成「用户本机」？

## 剪贴板（已踩坑）

| 错误写法 | 后果 |
|----------|------|
| 只调 `navigator.clipboard.writeText` | 局域网 HTTP 上其他电脑复制失败；开发者本机 localhost 正常 |

**正确做法：**

- 统一用 `apps/web/src/lib/clipboard.ts` 的 `copyText()`
- 先尝试 Clipboard API（仅 `window.isSecureContext`）
- 失败则用隐藏 `textarea` + `document.execCommand("copy")`
- 仅在返回 `true` 时显示「已复制」；失败勿假装成功

禁止在页面里再写一份只调 Clipboard API 的本地 `copyText`。

## 其他同类陷阱（做功能时对照）

| 能力 | 多用户风险 | 要求 |
|------|------------|------|
| 打开本机文件夹 / 键鼠 RPA | 请求打到服务器电脑，不是同事电脑 | 明确区分「浏览器所在机」vs「API 所在机」；非本机访问要降级（复制路径 / 提示） |
| 下载文件 | 依赖 blob URL / 特殊协议在旧浏览器失败 | 给可点的 `<a download>` 或明确失败提示 |
| `window.open` / 弹窗 | 被拦截 | 尽量用用户点击直接触发的导航 |
| 仅管理员本机有的路径、盘符、影刀 | 同事机器没有 | UI 标明「仅服务器本机」或提供无本机依赖的替代路径 |
| 权限 / 角色 | 只按 Admin 自测 | 用普通账号路径再过一遍关键按钮 |

## 验收（改完前）

- [ ] 假设用户从 `http://局域网IP` 打开，核心按钮仍可用或有明确失败提示
- [ ] 复制类交互走共享 `copyText`，且成功态与真实写入剪贴板一致
- [ ] 没有把「开发者 localhost 能用」当成完成标准
- [ ] 新增浏览器专用 API 时写了非安全上下文或权限被拒的降级

## 范围提醒

与 `touch-only-task-scope` 一并遵守：只改本次任务相关模块；但**新增**复制/本机能力时，必须按本 Skill 做兼容，不得再引入「仅本人本机可用」的实现。
