import { useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type DocsAssistResult,
  type DocsKind,
} from "../api";

const KIND_LABEL: Record<DocsKind, string> = {
  weekly: "周报",
  competitor: "竞品材料",
  product: "产品资料",
};

const KIND_HINT: Record<DocsKind, string> = {
  weekly: "输出总览、亮点、风险和待办，格式与晨报一致。不推飞书。",
  competitor: "提炼对手卖点、差异点和风险。要写入 Listing 请去 Listing 页。",
  product: "抽出可填 Listing 的候选字段，不会自动写入草稿。",
};

export function DocsAssistPage() {
  const [kind, setKind] = useState<DocsKind>("weekly");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DocsAssistResult | null>(null);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const res = await api.assistDocs({ kind, text });
      setResult(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "整理失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">文档助手</h1>
      <p className="page-desc">
        贴周报、竞品材料或产品资料，提炼重点。经营日报与店内晨报仍走飞书推送；这里只做按需整理。
      </p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {(Object.keys(KIND_LABEL) as DocsKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={kind === k ? "btn btn-primary" : "btn"}
              onClick={() => {
                setKind(k);
                setResult(null);
              }}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="muted">{KIND_HINT[kind]}</p>
        <textarea
          className="input"
          rows={12}
          value={text}
          placeholder="粘贴正文…"
          onChange={(e) => setText(e.target.value)}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={run}>
            {busy ? "整理中…" : "提炼重点"}
          </button>
          {kind === "competitor" || kind === "product" ? (
            <Link className="btn" to="/listing">
              打开 Listing
            </Link>
          ) : null}
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>

      {result?.judgment && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{result.judgment.headline}</h3>
          <Section title="亮点" rows={result.judgment.highlights} />
          <Section title="风险" rows={result.judgment.risks} />
          {result.judgment.actions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>待办</strong>
              <ul>
                {result.judgment.actions.map((a) => (
                  <li key={`${a.id}-${a.action}`}>
                    <span className="muted">{a.priority}</span> {a.name}：{a.action}
                    {a.why ? <span className="muted"> — {a.why}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.judgment.caveats.length > 0 && (
            <p className="muted">限制：{result.judgment.caveats.join("；")}</p>
          )}
        </div>
      )}

      {result?.competitor && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>
            {result.competitor.title || "竞品要点"}
            {result.competitor.brand ? ` · ${result.competitor.brand}` : ""}
            {result.competitor.price ? ` · ${result.competitor.price}` : ""}
          </h3>
          <StringList title="优势" items={result.competitor.strengths} />
          <StringList title="要点" items={result.competitor.points} />
          <StringList title="风险" items={result.competitor.risks} />
        </div>
      )}

      {result?.productFields && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Listing 候选字段（未写入）</h3>
          {result.productFields.brandHint ? (
            <p>
              品牌建议：<strong>{result.productFields.brandHint}</strong>
            </p>
          ) : null}
          <StringList title="标题提示" items={result.productFields.titleHints} />
          <StringList title="卖点候选" items={result.productFields.featureBullets} />
          <StringList title="规格" items={result.productFields.specs} />
          <StringList title="备注" items={result.productFields.notes} />
        </div>
      )}
    </div>
  );
}

function Section({
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

function StringList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
