import { useState } from "react";
import { api, type OpsInterpretResult, type OpsSurface } from "../api";

const TITLE: Record<OpsSurface, string> = {
  sales: "销量解读",
  replenish: "补货解读",
  finance: "财务解读",
};

const HINT: Record<OpsSurface, string> = {
  sales: "依据近 7 日销量与广告关注的汇总，不是订单明细全表。",
  replenish: "依据 FBN 库存 ÷ 近 90 日日均（FBN可撑天数）里的紧急行；FBN=0 即链接断货（supermall 不计入），不是飞书补货计划全文。",
  finance: "依据财务报表页同一套汇总数字，不是发票逐行，也不是单品 BOM。",
};

export function InterpretPanel({ surface }: { surface: OpsSurface }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<OpsInterpretResult | null>(null);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const res = await api.interpretOps(surface);
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "解读失败");
    } finally {
      setBusy(false);
    }
  }

  const judgment = data?.judgment;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
        <div>
          <h3 style={{ margin: "0 0 4px" }}>{TITLE[surface]}</h3>
          <p className="muted" style={{ margin: 0 }}>
            {HINT[surface]}
          </p>
        </div>
        <button className="btn" type="button" disabled={busy} onClick={run}>
          {busy ? "生成中…" : "生成解读"}
        </button>
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {judgment && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 650 }}>{judgment.headline}</p>
          <p className="muted" style={{ marginTop: 0 }}>
            把握 {confidenceLabel(judgment.confidence)}
            {data?.skippedLlm ? " · 未调用模型" : ""}
            {data?.asOf ? ` · ${data.asOf.slice(0, 16).replace("T", " ")}` : ""}
          </p>
          <InterpretList title="值得看" rows={judgment.highlights} />
          <InterpretList title="风险" rows={judgment.risks} />
          {judgment.actions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>待办</strong>
              <ul>
                {judgment.actions.map((a) => (
                  <li key={`${a.id}-${a.action}`}>
                    <span className="muted">{a.priority}</span> {a.name}：{a.action}
                    {a.why ? <span className="muted"> — {a.why}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {judgment.caveats.length > 0 && (
            <p className="muted" style={{ marginBottom: 0 }}>
              数据缺口：{judgment.caveats.join("；")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function InterpretList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; name: string; point: string; evidence: string }>;
}) {
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <strong>{title}</strong>
      <ul>
        {rows.map((row) => (
          <li key={`${row.id}-${row.point}`}>
            {row.name}：{row.point}
            {row.evidence ? <span className="muted"> — {row.evidence}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function confidenceLabel(value: "high" | "medium" | "low"): string {
  if (value === "high") return "高";
  if (value === "low") return "低";
  return "中";
}
