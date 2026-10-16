/**
 * 采购管理 · 补货采购批次：导出标准模板 / 导入清洗 / 通知阿沈。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type ReplenishBatchBrief,
  type ReplenishBatchRecord,
} from "../api";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(reader.error ?? new Error("读文件失败"));
    reader.readAsDataURL(file);
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function PurchaseReplenishBatchPanel() {
  const [batches, setBatches] = useState<ReplenishBatchBrief[]>([]);
  const [detail, setDetail] = useState<ReplenishBatchRecord | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setErr("");
    try {
      const r = await api.listReplenishBatches();
      setBatches(r.data.batches);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onExport() {
    setBusy("export");
    setErr("");
    setMsg("");
    try {
      const { blob, filename } = await api.downloadReplenishBatchTemplate();
      downloadBlob(blob, filename);
      setMsg(`已导出 ${filename}（采购批次=导出当天）`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onImport(file: File | null) {
    if (!file) return;
    setBusy("import");
    setErr("");
    setMsg("");
    try {
      const base64 = await fileToBase64(file);
      const r = await api.importReplenishBatch({
        filename: file.name,
        base64,
      });
      setDetail(r.data.batch);
      setMsg(r.message || "导入成功");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function openBatch(id: string) {
    setBusy("detail");
    setErr("");
    try {
      const r = await api.getReplenishBatch(id);
      setDetail(r.data.batch);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>补货采购表（已下单）</h3>
      <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
        从系统导出空白模板填写 → 再导入。店铺由 PSKU 前缀（N1～N4）自动识别。
        导入后按店归类，并通知发货人「阿沈」在任务收件箱查看（有新任务才弹一次）。
      </p>

      {err ? (
        <p style={{ color: "var(--danger, #b00020)", marginTop: 0 }}>{err}</p>
      ) : null}
      {msg ? <p className="muted" style={{ marginTop: 0 }}>{msg}</p> : null}

      <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() => void onExport()}
        >
          {busy === "export" ? "导出中…" : "导出标准模板"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          style={{ display: "none" }}
          onChange={(e) => void onImport(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="btn"
          disabled={!!busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy === "import" ? "导入中…" : "导入已填表"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy}
          onClick={() => void refresh()}
        >
          刷新列表
        </button>
      </div>

      <h4 style={{ margin: "0 0 8px" }}>已导入批次</h4>
      <div style={{ overflowX: "auto", marginBottom: 12 }}>
        <table className="table">
          <thead>
            <tr>
              <th>采购批次</th>
              <th>导入时间</th>
              <th>操作人</th>
              <th>行/件</th>
              <th>店铺</th>
              <th>通知</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  暂无批次。请先导出模板填写后再导入。
                </td>
              </tr>
            ) : (
              batches.map((b) => (
                <tr key={b.id}>
                  <td>{b.batchDate}</td>
                  <td>
                    {b.importedAt.slice(0, 19).replace("T", " ")}
                  </td>
                  <td>{b.importedBy}</td>
                  <td>
                    {b.lineCount} / {b.totalQty}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {b.shopLabels.join(" · ") || "—"}
                  </td>
                  <td>{b.taskId ? "已通知阿沈" : "未通知"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      disabled={!!busy}
                      onClick={() => void openBatch(b.id)}
                    >
                      明细
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detail ? (
        <div>
          <h4 style={{ margin: "0 0 8px" }}>
            批次明细 {detail.batchDate}
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 8 }}
              onClick={() => setDetail(null)}
            >
              收起
            </button>
          </h4>
          {detail.warnings.length > 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>
              警告：{detail.warnings.join("；")}
            </p>
          ) : null}
          {detail.byShop.map((s) => (
            <div key={s.shop} style={{ marginBottom: 12 }}>
              <strong>
                {s.shop} {s.shopName}
              </strong>
              <span className="muted">
                {" "}
                · {s.skuCount} SKU / {s.totalQty} 件
              </span>
              <div style={{ overflowX: "auto", marginTop: 6 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>PSKU</th>
                      <th>名称</th>
                      <th>规格</th>
                      <th>数量</th>
                      <th>建议发运</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.lines.map((l, i) => (
                      <tr key={`${l.partnerSku}-${i}`}>
                        <td>{l.partnerSku}</td>
                        <td>{l.name || "—"}</td>
                        <td>{l.spec || "—"}</td>
                        <td>{l.qty}</td>
                        <td>{l.modePref}</td>
                        <td>{l.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
