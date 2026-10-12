import { useState } from "react";
import { api, type BomLineCategory, type BomQuote } from "../api";
import { ClearableInput } from "../components/ClearableInput";

type LineDraft = {
  name: string;
  category: BomLineCategory;
  unitCostSar: string;
  qty: string;
};

const EMPTY_LINE: LineDraft = {
  name: "",
  category: "purchase",
  unitCostSar: "",
  qty: "1",
};

export function BomCostPage() {
  const [sellPriceSar, setSellPriceSar] = useState("");
  const [profile, setProfile] = useState<"general_15" | "fashion_25">("general_15");
  const [lines, setLines] = useState<LineDraft[]>([
    { name: "采购", category: "purchase", unitCostSar: "", qty: "1" },
    { name: "头程", category: "first_mile", unitCostSar: "", qty: "1" },
  ]);
  const [quote, setQuote] = useState<BomQuote | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function payload() {
    return {
      sellPriceSar: Number(sellPriceSar),
      profile,
      lines: lines
        .filter((line) => line.name.trim() && line.unitCostSar.trim() !== "")
        .map((line) => ({
          name: line.name.trim(),
          category: line.category,
          unitCostSar: Number(line.unitCostSar),
          qty: Number(line.qty || "1"),
        })),
    };
  }

  async function calculate() {
    setBusy("calc");
    setError("");
    try {
      const res = await api.quoteBom(payload());
      setQuote(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "核算失败");
    } finally {
      setBusy("");
    }
  }

  async function explain() {
    setBusy("explain");
    setError("");
    try {
      const res = await api.explainBom(payload());
      setQuote(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "说明失败");
    } finally {
      setBusy("");
    }
  }

  const breakdown = quote?.breakdown;

  return (
    <div>
      <h1 className="page-title">成本核算</h1>
      <p className="page-desc">
        毛利按现有 FBN 单件公式计算（售价减采购、仓配、头程、落地配、佣金、VAT、仓储和广告假设）。模型只解释算好的数字，不重算。
      </p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field-grid">
          <div className="field">
            <label>目标售价 (SAR)</label>
            <ClearableInput
              className="input"
              value={sellPriceSar}
              onChange={(e) => setSellPriceSar(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div className="field">
            <label>佣金档</label>
            <select
              className="input"
              value={profile}
              onChange={(e) =>
                setProfile(e.target.value === "fashion_25" ? "fashion_25" : "general_15")
              }
            >
              <option value="general_15">15% 普货</option>
              <option value="fashion_25">25% 时尚</option>
            </select>
          </div>
        </div>
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>物料</th>
              <th>类别</th>
              <th>单价 SAR</th>
              <th>件数</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td>
                  <ClearableInput
                    className="input"
                    value={line.name}
                    onChange={(e) => updateLine(index, { name: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="input"
                    value={line.category}
                    onChange={(e) =>
                      updateLine(index, { category: e.target.value as BomLineCategory })
                    }
                  >
                    <option value="purchase">采购</option>
                    <option value="first_mile">头程</option>
                    <option value="warehouse">海外仓</option>
                  </select>
                </td>
                <td>
                  <ClearableInput
                    className="input"
                    value={line.unitCostSar}
                    inputMode="decimal"
                    onChange={(e) => updateLine(index, { unitCostSar: e.target.value })}
                  />
                </td>
                <td>
                  <ClearableInput
                    className="input"
                    value={line.qty}
                    inputMode="decimal"
                    onChange={(e) => updateLine(index, { qty: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn"
            type="button"
            onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
          >
            加一行
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!!busy}
            onClick={calculate}
          >
            {busy === "calc" ? "计算中…" : "计算毛利"}
          </button>
          <button className="btn" type="button" disabled={!!busy || !quote} onClick={explain}>
            {busy === "explain" ? "生成中…" : "生成定价说明"}
          </button>
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
      {breakdown && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>
            单件结果
            {!breakdown.profitComplete && (
              <span className="muted"> · 估算（缺采购成本）</span>
            )}
          </h3>
          <div className="grid-3" style={{ marginBottom: 12 }}>
            <Metric label="销售毛利 SAR" value={breakdown.profitSar} />
            <Metric
              label="利润率"
              value={
                breakdown.marginPct == null
                  ? "—"
                  : `${(breakdown.marginPct * 100).toFixed(2)}%`
              }
            />
            <Metric
              label="售价 / 采购"
              value={breakdown.multiple == null ? "—" : breakdown.multiple}
            />
          </div>
          <table className="table">
            <tbody>
              <Money label="售价" value={breakdown.sellPriceSar} />
              <Money label="采购" value={breakdown.purchaseCostSar} />
              <Money label="海外仓上架" value={breakdown.inboundListingSar} />
              <Money label="海外仓拣货" value={breakdown.inboundPickSar} />
              <Money label="海外仓操作" value={breakdown.inboundHandleSar} />
              <Money label="头程" value={breakdown.firstMileSar} />
              <Money label="落地配" value={breakdown.outboundFeeSar} />
              <Money label="佣金" value={breakdown.referralFeeSar} />
              <Money label="VAT" value={breakdown.vatPayableSar} />
              <Money label="仓储" value={breakdown.storageSar} />
              <Money label="广告假设" value={breakdown.adCostSar} />
            </tbody>
          </table>
          {quote?.usedDefaults.length ? (
            <p className="muted">未填写项：{quote.usedDefaults.join("；")}</p>
          ) : null}
          {quote?.explanation && (
            <div>
              <p style={{ fontWeight: 650 }}>{quote.explanation.summary}</p>
              {quote.explanation.priceNote && <p>{quote.explanation.priceNote}</p>}
              {quote.explanation.caveats.length > 0 && (
                <p className="muted">说明限制：{quote.explanation.caveats.join("；")}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="muted">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 650 }}>{value}</div>
    </div>
  );
}

function Money({ label, value }: { label: string; value: number | null }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{value == null ? "未填" : value}</td>
    </tr>
  );
}
