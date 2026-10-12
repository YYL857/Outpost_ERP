import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type PurchaseLedgerFieldMeta,
  type PurchaseLedgerRow,
  type PurchaseLedgerSheetKey,
  type PurchaseLedgerSheetMeta,
} from "../api";
import { ClearableInput } from "./ClearableInput";

type Props = {
  onSynced?: () => void;
  onError?: (message: string) => void;
  onInfo?: (message: string) => void;
};

function emptyForm(fields: PurchaseLedgerFieldMeta[]) {
  const o: Record<string, string> = {};
  for (const f of fields) o[f.key] = "";
  return o;
}

function toPayload(
  fields: PurchaseLedgerFieldMeta[],
  form: Record<string, string>,
  mode: "create" | "edit",
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const f of fields) {
    const raw = (form[f.key] ?? "").trim();
    if (raw === "") {
      if (mode === "edit") out[f.key] = null;
      continue;
    }
    if (f.type === "number") {
      const n = Number(raw.replace(/,/g, ""));
      out[f.key] = Number.isFinite(n) ? n : null;
    } else {
      out[f.key] = raw;
    }
  }
  return out;
}

export function AccountsLedgerCard({ onSynced, onError, onInfo }: Props) {
  const [sheets, setSheets] = useState<PurchaseLedgerSheetMeta[]>([]);
  const [sheetKey, setSheetKey] = useState<PurchaseLedgerSheetKey>(
    "product_purchase",
  );
  const [rows, setRows] = useState<PurchaseLedgerRow[]>([]);
  const [totalDataRows, setTotalDataRows] = useState(0);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editRow, setEditRow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const active = useMemo(
    () => sheets.find((s) => s.key === sheetKey) ?? null,
    [sheets, sheetKey],
  );

  const loadSheets = useCallback(async () => {
    const r = await api.getPurchaseLedgerSheets();
    setSheets(r.data.sheets);
    if (!r.data.sheets.some((s) => s.key === sheetKey) && r.data.sheets[0]) {
      setSheetKey(r.data.sheets[0].key);
    }
  }, [sheetKey]);

  const loadRows = useCallback(async (key: PurchaseLedgerSheetKey) => {
    setLoading(true);
    try {
      const r = await api.getPurchaseLedgerRows({ sheet: key, limit: 60 });
      setRows(r.data.rows);
      setTotalDataRows(r.data.totalDataRows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSheets().catch((e: Error) => onError?.(e.message));
  }, [loadSheets, onError]);

  useEffect(() => {
    if (!active) return;
    setForm(emptyForm(active.fields));
    setEditRow(null);
    loadRows(active.key).catch((e: Error) => onError?.(e.message));
  }, [active, loadRows, onError]);

  function startCreate() {
    if (!active) return;
    setEditRow(null);
    setForm(emptyForm(active.fields));
  }

  function startEdit(row: PurchaseLedgerRow) {
    if (!active) return;
    const next = emptyForm(active.fields);
    for (const f of active.fields) {
      const v = row.fields[f.key];
      next[f.key] = v == null ? "" : String(v);
    }
    setEditRow(row.sheetRow);
    setForm(next);
  }

  async function submit() {
    if (!active) return;
    setBusy(true);
    onError?.("");
    try {
      const mode = editRow != null ? "edit" : "create";
      const fields = toPayload(active.fields, form, mode);
      if (mode === "create") {
        const r = await api.appendPurchaseLedgerRow({
          sheet: active.key,
          fields,
          syncLocal: true,
        });
        onInfo?.(r.message || "已追加到飞书");
      } else {
        const r = await api.updatePurchaseLedgerRow({
          sheet: active.key,
          sheetRow: editRow!,
          fields,
          syncLocal: true,
        });
        onInfo?.(r.message || "已更新飞书");
      }
      await loadRows(active.key);
      startCreate();
      onSynced?.();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "记账失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>账目记账（飞书）</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        写入飞书账目表子表；提交后自动同步到本系统。改行只覆盖你填写的字段，空白提交在编辑模式下会清空该格。
      </p>
      <div className="row" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        {sheets.map((s) => (
          <button
            key={s.key}
            type="button"
            className={s.key === sheetKey ? "btn btn-primary" : "btn"}
            disabled={busy || loading}
            onClick={() => setSheetKey(s.key)}
          >
            {s.title}
          </button>
        ))}
        <button
          type="button"
          className="btn"
          disabled={busy || loading || !active}
          onClick={startCreate}
        >
          新建
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || loading || !active}
          onClick={() =>
            active &&
            loadRows(active.key).catch((e: Error) => onError?.(e.message))
          }
        >
          {loading ? "加载中…" : "刷新行"}
        </button>
      </div>

      {active && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 10,
              marginBottom: 12,
            }}
          >
            {active.fields.map((f) => (
              <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {f.label}
                  {f.required ? " *" : ""}
                  {editRow != null ? "" : ""}
                </span>
                <ClearableInput
                  className="input"
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  value={form[f.key] ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="row" style={{ marginBottom: 14, gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={submit}
            >
              {busy
                ? "提交中…"
                : editRow != null
                  ? `保存第 ${editRow} 行`
                  : "追加到飞书"}
            </button>
            {editRow != null && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={startCreate}
              >
                取消编辑
              </button>
            )}
            <span className="muted" style={{ alignSelf: "center" }}>
              {editRow != null
                ? `正在编辑飞书第 ${editRow} 行`
                : "新建模式：追加一行"}
            </span>
          </div>
        </>
      )}

      <div className="muted" style={{ marginBottom: 8 }}>
        飞书「{active?.title || "当前子表"}」已有记录（近 {rows.length} / 共{" "}
        {totalDataRows}）· 点「编辑」把该行填回上方表单后改补。不是操作审计日志。
      </div>
      <div style={{ maxHeight: 320, overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>行号</th>
              {(active?.fields ?? [])
                .filter((f) =>
                  [
                    "partnerSku",
                    "packName",
                    "category",
                    "productName",
                    "qty",
                    "amount",
                    "orderId",
                    "purchasedAt",
                    "occurredAt",
                  ].includes(f.key),
                )
                .slice(0, 6)
                .map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
              <th>摘要</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="muted"
                >
                  {loading ? "加载中…" : "暂无数据行"}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const cols = (active?.fields ?? [])
                  .filter((f) =>
                    [
                      "partnerSku",
                      "packName",
                      "category",
                      "productName",
                      "qty",
                      "amount",
                      "orderId",
                      "purchasedAt",
                      "occurredAt",
                    ].includes(f.key),
                  )
                  .slice(0, 6);
                return (
                  <tr key={r.sheetRow}>
                    <td>{r.sheetRow}</td>
                    {cols.map((f) => {
                      const v = r.fields[f.key];
                      return (
                        <td key={f.key}>
                          {v == null || v === "" ? "—" : String(v)}
                        </td>
                      );
                    })}
                    <td>{r.preview || "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => startEdit(r)}
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
