import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type InfoCheckMeta,
  type InfoCheckQueryRow,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";

const SOURCE_LABELS = {
  product: "产品表",
  monthlyDeals: "月度 Deals",
  infoCheck: "信息检查",
} as const;

type SourceKey = keyof typeof SOURCE_LABELS;

function dash(v: string | null | undefined) {
  if (v == null || v === "") return "—";
  return v;
}

function fieldUnion(row: InfoCheckQueryRow): string[] {
  const keys = new Set<string>();
  for (const src of [row.sources.product, row.sources.monthlyDeals, row.sources.infoCheck]) {
    if (!src) continue;
    for (const k of Object.keys(src)) keys.add(k);
  }
  return [...keys].sort((a, b) => a.localeCompare(b, "zh"));
}

function valuesMismatch(...vals: Array<string | null | undefined>) {
  const nonempty = vals.map((v) => (v ?? "").trim()).filter(Boolean);
  if (nonempty.length <= 1) return false;
  return !nonempty.every((v) => v === nonempty[0]);
}

function SourceColumn({
  label,
  record,
  highlightFields,
}: {
  label: string;
  record: Record<string, string> | null;
  highlightFields: Set<string>;
}) {
  if (!record) {
    return (
      <div className="ic-col">
        <h3 className="ic-col-title">{label}</h3>
        <p className="muted">该表无此 PSKU</p>
      </div>
    );
  }
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return (
      <div className="ic-col">
        <h3 className="ic-col-title">{label}</h3>
        <p className="muted">无字段</p>
      </div>
    );
  }
  return (
    <div className="ic-col">
      <h3 className="ic-col-title">{label}</h3>
      <dl className="ic-kv">
        {entries.map(([k, v]) => (
          <div
            key={k}
            className={highlightFields.has(k) ? "ic-kv-row ic-mismatch" : "ic-kv-row"}
          >
            <dt>{k}</dt>
            <dd>{dash(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function InfoCheckPage() {
  const [meta, setMeta] = useState<InfoCheckMeta | null>(null);
  const [q, setQ] = useState("");
  const [exact, setExact] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [rows, setRows] = useState<InfoCheckQueryRow[]>([]);
  const [totalMatched, setTotalMatched] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  const loadMeta = useCallback(async () => {
    const res = await api.getInfoCheckMeta();
    setMeta(res.data);
  }, []);

  useEffect(() => {
    loadMeta().catch((e: Error) => setError(e.message));
  }, [loadMeta]);

  const commonFields = meta?.commonFields ?? [];

  async function runQuery() {
    setBusy(true);
    setError("");
    try {
      const res = await api.getInfoCheckQuery({
        q,
        mode: exact ? "exact" : "fuzzy",
        fields: selectedFields,
      });
      setRows(res.data);
      setTotalMatched(res.meta.totalMatched);
      setTruncated(res.meta.truncated);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRefresh() {
    setRefreshBusy(true);
    setError("");
    try {
      const res = await api.refreshInfoCheck();
      setMeta(res.data.tables);
      const fails = res.data.results.filter((r) => !r.ok);
      if (fails.length) {
        setError(
          `部分拉取失败：${fails
            .map((f) => `${f.docId}(${f.error?.message ?? f.error?.code ?? "error"})`)
            .join("；")}`,
        );
      }
      if (searched) await runQuery();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshBusy(false);
    }
  }

  function toggleField(field: string) {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    );
  }

  const statusLine = useMemo(() => {
    if (!meta) return "";
    const parts = (
      [
        ["product", meta.product],
        ["monthlyDeals", meta.monthlyDeals],
        ["infoCheck", meta.infoCheck],
      ] as const
    ).map(([, t]) => {
      const when = t.pulledAt ? t.pulledAt.slice(0, 19).replace("T", " ") : "无快照";
      return `${t.label} ${t.rowCount} 行 · ${when}`;
    });
    return parts.join(" ｜ ");
  }, [meta]);

  const fieldFilterOn = selectedFields.length > 0;

  return (
    <div>
      <h1 className="page-title">信息检查</h1>
      <p className="page-desc">
        以产品表为准，按 PSKU / 关键词查询，并与月度 Deals、信息检查表只读对比。不写回飞书。
      </p>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {statusLine && <p className="muted" style={{ fontSize: 12 }}>{statusLine}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <ClearableInput
            className="input"
            style={{ minWidth: 240, flex: "1 1 240px" }}
            placeholder={exact ? "输入完整 PSKU" : "PSKU 或关键词（名称等）"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runQuery();
            }}
          />
          <label className="cat-check">
            <input
              type="checkbox"
              checked={exact}
              onChange={(e) => setExact(e.target.checked)}
            />
            精确匹配 PSKU
          </label>
          <button className="btn" type="button" disabled={busy} onClick={() => void runQuery()}>
            {busy ? "查询中…" : "查询"}
          </button>
          <button
            className="btn"
            type="button"
            disabled={refreshBusy}
            onClick={() => void onRefresh()}
          >
            {refreshBusy ? "拉取中…" : "刷新拉取"}
          </button>
        </div>

        <div className="ic-fields">
          <span className="muted" style={{ fontSize: 12 }}>
            共有/同义字段筛选（可选；如「活动价」会同时对上 deal_price、价格）：
          </span>
          {commonFields.length === 0 ? (
            <span className="muted" style={{ fontSize: 12 }}>
              暂无共有字段（需三表均有快照且表头交集非空）
            </span>
          ) : (
            <div className="row" style={{ gap: 8 }}>
              {commonFields.map((f) => (
                <label key={f} className="cat-check">
                  <input
                    type="checkbox"
                    checked={selectedFields.includes(f)}
                    onChange={() => toggleField(f)}
                  />
                  {f}
                </label>
              ))}
              {selectedFields.length > 0 && (
                <button
                  className="btn"
                  type="button"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => setSelectedFields([])}
                >
                  清除筛选
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {searched && (
        <p className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
          命中 {totalMatched} 条
          {truncated ? "（已截断展示）" : ""}
          {fieldFilterOn ? ` · 字段：${selectedFields.join("、")}` : " · 全字段三列对比"}
        </p>
      )}

      {searched && rows.length === 0 && (
        <div className="card">
          <p className="muted">无匹配产品。请确认产品表已拉取，或换关键词 / 精确 PSKU。</p>
        </div>
      )}

      {fieldFilterOn && rows.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>PSKU</th>
                <th>字段</th>
                <th>{SOURCE_LABELS.product}</th>
                <th>{SOURCE_LABELS.monthlyDeals}</th>
                <th>{SOURCE_LABELS.infoCheck}</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((row) =>
                (row.compare ??
                  selectedFields.map((field) => ({
                    field,
                    product: row.sources.product?.[field] ?? "",
                    monthlyDeals: row.sources.monthlyDeals?.[field] ?? "",
                    infoCheck: row.sources.infoCheck?.[field] ?? "",
                    mismatch: valuesMismatch(
                      row.sources.product?.[field],
                      row.sources.monthlyDeals?.[field],
                      row.sources.infoCheck?.[field],
                    ),
                    sources: undefined as
                      | {
                          product: string | null;
                          monthlyDeals: string | null;
                          infoCheck: string | null;
                        }
                      | undefined,
                  }))).map((c) => (
                  <tr
                    key={`${row.psku}:${c.field}`}
                    className={c.mismatch ? "ic-mismatch-row" : undefined}
                  >
                    <td>{row.psku}</td>
                    <td>{c.field}</td>
                    <td>
                      {dash(c.product)}
                      {c.sources?.product && c.sources.product !== c.field ? (
                        <div className="muted" style={{ fontSize: 11 }}>
                          ← {c.sources.product}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {dash(c.monthlyDeals)}
                      {c.sources?.monthlyDeals &&
                      c.sources.monthlyDeals !== c.field ? (
                        <div className="muted" style={{ fontSize: 11 }}>
                          ← {c.sources.monthlyDeals}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {dash(c.infoCheck)}
                      {c.sources?.infoCheck &&
                      c.sources.infoCheck !== c.field ? (
                        <div className="muted" style={{ fontSize: 11 }}>
                          ← {c.sources.infoCheck}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      {!fieldFilterOn &&
        rows.map((row) => {
          const fields = fieldUnion(row);
          const highlight = new Set(
            fields.filter((f) =>
              valuesMismatch(
                row.sources.product?.[f],
                row.sources.monthlyDeals?.[f],
                row.sources.infoCheck?.[f],
              ),
            ),
          );
          return (
            <div key={row.psku} className="card ic-card">
              <div className="ic-card-head">
                <strong>PSKU</strong>
                <code>{row.psku}</code>
                <span className="muted" style={{ fontSize: 12 }}>
                  {(
                    [
                      ["product", row.sources.product],
                      ["monthlyDeals", row.sources.monthlyDeals],
                      ["infoCheck", row.sources.infoCheck],
                    ] as Array<[SourceKey, Record<string, string> | null]>
                  )
                    .map(([k, v]) => `${SOURCE_LABELS[k]}:${v ? "有" : "无"}`)
                    .join(" · ")}
                </span>
              </div>
              <div className="ic-grid">
                <SourceColumn
                  label={SOURCE_LABELS.product}
                  record={row.sources.product}
                  highlightFields={highlight}
                />
                <SourceColumn
                  label={SOURCE_LABELS.monthlyDeals}
                  record={row.sources.monthlyDeals}
                  highlightFields={highlight}
                />
                <SourceColumn
                  label={SOURCE_LABELS.infoCheck}
                  record={row.sources.infoCheck}
                  highlightFields={highlight}
                />
              </div>
            </div>
          );
        })}
    </div>
  );
}
