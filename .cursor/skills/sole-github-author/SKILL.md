---
name: sole-github-author
description: >-
  Ensures Git commits and GitHub pushes have only the user's identity as author
  and committer—never Cursor or other co-authors. Use when committing, pushing,
  creating/rewriting git history, publishing to GitHub, or when the user mentions
  撰稿人、贡献者、作者、Co-authored-by、Cursor contributor, or sole author.
---

# 仅本人 GitHub 作者 / 提交者

## 硬性规则（用户原话要点）

撰稿人只能有用户自己，不能出现其他作者，包括 Cursor。根因是提交信息里被自动写入了（如 `Co-authored-by`），GitHub 会据此把 Cursor 算作贡献者。

## 何时启用

- 用户要求 commit / push / 发布到 GitHub
- 用户提到撰稿人、贡献者、作者只能是自己、不要 Cursor
- 新建仓库、改写历史、force push 以清洗贡献者列表

## 目标身份（本机默认）

| 字段 | 值 |
|------|-----|
| Name | `YYL857` |
| Email | `331113556+YYL857@users.noreply.github.com` |
| GitHub login | `YYL857` |

若用户另行指定 name/email/login，以当次指定为准，但仍须 **author = committer = 同一人**，且禁止第三方 trailer。

## 提交前：杜绝 Cursor 进历史

1. **禁止**在 commit message 中写入：
   - `Co-authored-by:`（任何人或 Cursor）
   - `Signed-off-by:` 指向 Cursor / 非用户身份
   - 任何会让 GitHub 解析出第二作者的 trailer
2. **不要**依赖 Cursor/IDE 默认的 “commit with co-author” 行为。
3. 用环境变量强制身份（推荐），避免读到错误的 `user.name` / 另一套 SSH 账号身份：

```powershell
$env:GIT_AUTHOR_NAME = "YYL857"
$env:GIT_AUTHOR_EMAIL = "331113556+YYL857@users.noreply.github.com"
$env:GIT_COMMITTER_NAME = "YYL857"
$env:GIT_COMMITTER_EMAIL = "331113556+YYL857@users.noreply.github.com"
```

4. 需要绝对干净时，用 `git commit-tree` + `-F` 消息文件创建提交，再 `git update-ref`，不要经会注入 trailer 的封装层。
5. 消息文件用 UTF-8；Windows 上避免把含中文的绝对路径写进脚本（易乱码）；在已 `cd` 到仓库目录后操作。

## 推送前自检（必须）

推送前执行并确认输出里 **没有** Cursor / 第二作者：

```powershell
git log -1 --format=full
git cat-file -p HEAD
```

通过标准：

- `author` 与 `committer` 均为 `YYL857 <331113556+YYL857@users.noreply.github.com>`
- message 正文与 trailer 区均无 `Co-authored-by`、`Cursor`、其他人类作者

不通过则 **禁止 push**；重写该提交后再检。

## 账号与远程

1. 推送目标账号必须是 **YYL857**（`https://github.com/YYL857/...`）。
2. 本机 SSH 若认证为其他账号（例如 `yaoyaolin711`），**不要**用该 SSH 推 YYL857 的仓库；改用 HTTPS + YYL857 授权（GCM device flow / PAT），并确认 `api.github.com/user` 的 `login` 为 `YYL857`。
3. 直连 `github.com` 失败时，可用本机代理（常见 `http://127.0.0.1:7897`）再试；`api.github.com` 通不代表 `github.com` 通。

## 远程已有历史时

若 `git push` 因 remote 已有提交被拒：

1. 先列出 remote commits 的 author / committer / message。
2. 用户要求「只能有我自己」时：用**仅含干净本地提交**的历史覆盖 remote（`push --force-with-lease`，失败且用户明确要独占作者时再 `--force`）。
3. 覆盖后再次核对 remote 上该 commit 的 author/committer/login，确认无 Cursor。

## 禁止

- 为「方便」保留或合并带 Cursor trailer 的提交
- 用错误账号 push 后再口头说「忽略贡献者」
- 在未自检 `git cat-file -p HEAD` 的情况下 push
- 把 Cursor 写进 commit message、tag message、或 GitHub Release 正文并当作作者信息

## 完成后回复用户

简短说明：

- 仓库 URL
- author / committer 均为 YYL857
- 已确认无 `Co-authored-by` / Cursor
