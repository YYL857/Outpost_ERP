import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type DailyBriefRecipient,
  type DailyBriefStatus,
} from "../api";

export function DailyBriefPage() {
  const [status, setStatus] = useState<DailyBriefStatus | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formRemark, setFormRemark] = useState("");
  const [formChatId, setFormChatId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [lastMsg, setLastMsg] = useState("");

  const recipients = status?.recipients ?? [];

  const refresh = useCallback(async () => {
    const res = await api.getDailyBriefStatus();
    setStatus(res.data);
    setSelectedIds((prev) => {
      if (prev.length) {
        const alive = prev.filter((id) =>
          res.data.recipients.some((r) => r.id === id && r.enabled),
        );
        if (alive.length) return alive;
      }
      const def =
        res.data.defaultRecipientId ||
        res.data.recipients.find((r) => r.enabled)?.id ||
        res.data.recipients[0]?.id;
      return def ? [def] : [];
    });
  }, []);

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const selectedLabel = useMemo(() => {
    return recipients
      .filter((r) => selectedIds.includes(r.id))
      .map((r) => r.remark)
      .join("、");
  }, [recipients, selectedIds]);

  function toggleRecipient(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function saveRecipient() {
    setError("");
    setBusy("save-user");
    try {
      if (editingId) {
        const res = await api.updateDailyBriefRecipient(editingId, {
          remark: formRemark,
          chatId: formChatId,
          enabled: true,
        });
        setLastMsg(res.message ?? `已更新「${res.data.remark}」`);
      } else {
        const res = await api.addDailyBriefRecipient({
          remark: formRemark,
          chatId: formChatId,
          enabled: true,
        });
        setLastMsg(res.message ?? `已添加「${res.data.remark}」`);
        setSelectedIds((prev) =>
          prev.includes(res.data.id) ? prev : [...prev, res.data.id],
        );
      }
      setFormRemark("");
      setFormChatId("");
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function removeRecipient(r: DailyBriefRecipient) {
    if (!confirm(`删除接收人「${r.remark}」？`)) return;
    setError("");
    setBusy(`del-${r.id}`);
    try {
      const res = await api.deleteDailyBriefRecipient(r.id);
      setLastMsg(res.message ?? "已删除");
      setSelectedIds((prev) => prev.filter((id) => id !== r.id));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  function startEdit(r: DailyBriefRecipient) {
    setEditingId(r.id);
    setFormRemark(r.remark);
    setFormChatId(r.chatId);
  }

  async function run(
    action: "normalize" | "summarize" | "push" | "run-all" | "run-no-push",
  ) {
    setError("");
    setBusy(action);
    setLastMsg("");
    try {
      const recipientIds = selectedIds;
      if (
        (action === "push" || action === "run-all") &&
        recipientIds.length === 0
      ) {
        throw new Error("请先勾选至少一个接收人");
      }
      if (action === "normalize") {
        const res = await api.normalizeDailyBrief({ skipPull: false });
        setLastMsg(res.message ?? `规范化完成 watchlist=${res.data.watchlistKept}`);
      } else if (action === "summarize") {
        const res = await api.summarizeDailyBrief({});
        setLastMsg(res.message ?? res.data.headline);
      } else if (action === "push") {
        const res = await api.pushDailyBrief({ recipientIds });
        setLastMsg(res.message ?? `已推送`);
      } else if (action === "run-all") {
        const res = await api.runDailyBrief({
          recipientIds,
          skipPull: false,
          skipPush: false,
        });
        setLastMsg(res.message ?? res.data.headline);
      } else {
        const res = await api.runDailyBrief({
          recipientIds,
          skipPull: false,
          skipPush: true,
        });
        setLastMsg(res.message ?? res.data.headline);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const last = status?.last;
  const preview = status?.judgmentPreview;

  return (
    <div>
      <h1 className="page-title">运营日报简报</h1>
      <p className="page-desc">
        从飞书日报表本地导出 → 规则精筛 → 模型总结 → 以<strong>彩色卡片</strong>推送到固定会话。
        公司暂无拉群，接收人用「备注 ↔ 会话 ID」管理。不修改飞书源表。
      </p>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {lastMsg && <p className="muted">{lastMsg}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>接收人管理</h2>
        <p className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
          例如：备注「慧慧」对应会话 <code>oc_…</code>。推送前勾选要发的人（可多选）。
          配置文件：<code>{status?.recipientsPath ?? "…/feishu-daily-brief/recipients.json"}</code>
        </p>

        <table style={{ width: "100%", fontSize: 13, marginBottom: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr className="muted" style={{ textAlign: "left" }}>
              <th style={{ padding: "4px 6px" }}>选</th>
              <th style={{ padding: "4px 6px" }}>备注</th>
              <th style={{ padding: "4px 6px" }}>会话 ID</th>
              <th style={{ padding: "4px 6px" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {recipients.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: 8 }}>
                  暂无接收人
                </td>
              </tr>
            )}
            {recipients.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--border, #ddd)" }}>
                <td style={{ padding: "6px" }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(r.id)}
                    disabled={!r.enabled || Boolean(busy)}
                    onChange={() => toggleRecipient(r.id)}
                  />
                </td>
                <td style={{ padding: "6px" }}>
                  <strong>{r.remark}</strong>
                  {!r.enabled && (
                    <span className="muted">（已禁用）</span>
                  )}
                </td>
                <td style={{ padding: "6px", wordBreak: "break-all", fontSize: 12 }}>
                  <code>{r.chatId}</code>
                </td>
                <td style={{ padding: "6px", whiteSpace: "nowrap" }}>
                  <button
                    type="button"
                    className="btn"
                    style={{ marginRight: 4 }}
                    disabled={Boolean(busy)}
                    onClick={() => startEdit(r)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={Boolean(busy)}
                    onClick={() => void removeRecipient(r)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input
            className="input"
            style={{ minWidth: 120 }}
            placeholder="备注（如 慧慧）"
            value={formRemark}
            disabled={Boolean(busy)}
            onChange={(e) => setFormRemark(e.target.value)}
          />
          <input
            className="input"
            style={{ minWidth: 280, flex: 1 }}
            placeholder="会话 ID（oc_… / ou_…）"
            value={formChatId}
            disabled={Boolean(busy)}
            onChange={(e) => setFormChatId(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(busy) || !formRemark.trim() || !formChatId.trim()}
            onClick={() => void saveRecipient()}
          >
            {busy === "save-user"
              ? "保存中…"
              : editingId
                ? "保存修改"
                : "添加接收人"}
          </button>
          {editingId && (
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => {
                setEditingId(null);
                setFormRemark("");
                setFormChatId("");
              }}
            >
              取消编辑
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>状态</h2>
        <p className="muted" style={{ marginBottom: 8 }}>
          DeepSeek {status?.deepseekConfigured ? "已配置" : "未配置"}
          {status?.deepseekModel ? ` · ${status.deepseekModel}` : ""}
          {" · "}推送格式 <code>{status?.pushFormat ?? "card"}</code>
          {selectedLabel ? (
            <>
              {" · "}当前选中 <strong>{selectedLabel}</strong>
            </>
          ) : null}
        </p>
        {last ? (
          <ul className="muted" style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 13 }}>
            <li>
              Sheet：{last.currentSheet ?? "—"}
              {last.previousSheet ? ` vs ${last.previousSheet}` : ""}
            </li>
            <li>
              接受行 {last.currentAccepted ?? "—"} · watchlist{" "}
              {last.watchlistKept ?? "—"}
            </li>
            <li>最近 run：{last.runId ?? "—"}</li>
          </ul>
        ) : (
          <p className="muted">尚无本地 brief，请先跑通流水线。</p>
        )}
        {preview && (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <p style={{ margin: "0 0 4px" }}>
              <strong>最近简报：</strong>
              {preview.headline}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              置信度 {preview.confidence} · 亮点 {preview.highlights} · 风险{" "}
              {preview.risks} · 跟进 {preview.actions}
            </p>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>操作</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              Boolean(busy) ||
              !status?.deepseekConfigured ||
              selectedIds.length === 0
            }
            onClick={() => void run("run-all")}
          >
            {busy === "run-all" ? "跑通中…" : "一键：拉取→总结→推卡片"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={Boolean(busy) || !status?.deepseekConfigured}
            onClick={() => void run("run-no-push")}
          >
            {busy === "run-no-push" ? "生成中…" : "拉取→总结（不推送）"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={Boolean(busy)}
            onClick={() => void run("normalize")}
          >
            {busy === "normalize" ? "规范化中…" : "仅拉取并规范化"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={Boolean(busy) || !status?.deepseekConfigured}
            onClick={() => void run("summarize")}
          >
            {busy === "summarize" ? "总结中…" : "仅生成简报"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={Boolean(busy) || !preview || selectedIds.length === 0}
            onClick={() => void run("push")}
          >
            {busy === "push" ? "推送中…" : "推送彩色卡片"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={Boolean(busy)}
            onClick={() => void refresh().catch((e: Error) => setError(e.message))}
          >
            刷新状态
          </button>
        </div>
      </div>
    </div>
  );
}
