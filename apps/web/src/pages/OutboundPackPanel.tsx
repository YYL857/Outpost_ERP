/**
 * 物流管理 · 发货搭配 Phase1：待发池 / 路由规则 / 货性缺口 / 实付样本。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type CargoKindOption,
  type OutboundCargoGap,
  type OutboundPoolLineView,
  type RateRollupRow,
  type ReplenishBatchBrief,
  type ReplenishBatchRecord,
  type ShippingRouteRules,
} from "../api";

const KIND_LABEL: Record<string, string> = {
  general: "普货",
  battery: "带电普货",
  sensitive: "敏货",
  sensitive_battery: "敏货带电",
  lamp: "灯具",
  other: "其他",
  unlabeled: "未标注",
};

function kindLabel(code: string | null | undefined): string {
  if (!code) return "未标注";
  return KIND_LABEL[code] ?? code;
}

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

export function OutboundPackPanel() {
  const [rules, setRules] = useState<ShippingRouteRules | null>(null);
  const [lines, setLines] = useState<OutboundPoolLineView[]>([]);
  const [gapCount, setGapCount] = useState(0);
  const [gaps, setGaps] = useState<OutboundCargoGap[]>([]);
  const [options, setOptions] = useState<CargoKindOption[]>([]);
  const [rollup, setRollup] = useState<RateRollupRow[]>([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [sampleUpdatedAt, setSampleUpdatedAt] = useState("");
  const [arrivalBriefs, setArrivalBriefs] = useState<ReplenishBatchBrief[]>([]);
  const [arrivalDetail, setArrivalDetail] =
    useState<ReplenishBatchRecord | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [gapSaving, setGapSaving] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setErr("");
    try {
      const [r, pool, g, samples, arrivals] = await Promise.all([
        api.getShippingRouteRules(),
        api.getOutboundPool(),
        api.getOutboundPoolGaps(),
        api.getRateSamples(false).catch(() => null),
        api.listShippingPurchaseArrivals().catch(() => null),
      ]);
      setRules(r.data);
      setLines(pool.data.lines);
      setGapCount(pool.data.gapCount);
      setGaps(g.data.gaps);
      if (g.data.options?.length) setOptions(g.data.options);
      if (samples) {
        setRollup(samples.data.rollup ?? []);
        setSampleCount(samples.data.sampleCount ?? 0);
        setSampleUpdatedAt(samples.data.updatedAt ?? "");
      }
      if (arrivals) setArrivalBriefs(arrivals.data.batches ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveBatterySwitch(on: boolean) {
    setBusy("rules");
    setErr("");
    try {
      const r = await api.saveShippingRouteRules({
        batteryToHansha: on,
        batteryToHanshaSince: on
          ? rules?.batteryToHanshaSince ||
            new Date().toISOString().slice(0, 10)
          : rules?.batteryToHanshaSince || "",
      });
      setRules(r.data);
      setMsg(r.message || "规则已保存");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onImportFile(file: File | null) {
    if (!file) return;
    setBusy("import");
    setErr("");
    setMsg("");
    try {
      const base64 = await fileToBase64(file);
      const r = await api.importOutboundPoolXlsx({
        filename: file.name,
        base64,
      });
      setLines(r.data.lines);
      setGapCount(r.data.gapCount);
      setMsg(r.message || `已导入 ${r.data.imported} 行`);
      const g = await api.getOutboundPoolGaps();
      setGaps(g.data.gaps);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function clearPool() {
    if (!window.confirm("清空待发池？")) return;
    setBusy("clear");
    try {
      const r = await api.clearOutboundPool();
      setLines(r.data.lines);
      setGapCount(0);
      setGaps([]);
      setMsg(r.message || "已清空");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function rebuildSamples() {
    setBusy("samples");
    setErr("");
    try {
      const r = await api.rebuildRateSamples();
      setRollup(r.data.rollup ?? []);
      setSampleCount(r.data.sampleCount ?? 0);
      setSampleUpdatedAt(r.data.updatedAt ?? "");
      setMsg(r.message || "样本已重建");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function fillGap(
    gap: OutboundCargoGap,
    cargoKind: string,
  ) {
    const key = `${gap.partnerSku}\0${gap.suggestForwarder}`;
    setGapSaving(key);
    setErr("");
    try {
      await api.upsertCargoHint({
        partnerSku: gap.partnerSku,
        forwarder: gap.suggestForwarder,
        cargoKind,
      });
      await refresh();
      setMsg(`已标注 ${gap.partnerSku} @ ${gap.suggestForwarder}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGapSaving(null);
    }
  }

  async function openArrival(id: string) {
    setBusy("arrival");
    setErr("");
    try {
      const r = await api.getShippingPurchaseArrival(id);
      setArrivalDetail(r.data.batch);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>发货搭配</h3>

      <div
        style={{
          border: "1px solid var(--border, #ddd)",
          borderRadius: 8,
          padding: 12,
          marginBottom: 14,
          background: "rgba(46, 125, 50, 0.04)",
        }}
      >
        <strong>近期采购到货（给阿沈）</strong>
        <p className="muted" style={{ margin: "6px 0 10px", lineHeight: 1.5 }}>
          采购导入「已下单」批次后会出现在这里，按店铺归类。任务收件箱点「知道了」即可，到本页看明细。
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>采购批次</th>
                <th>导入</th>
                <th>行/件</th>
                <th>店铺</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {arrivalBriefs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    暂无采购批次。等采购在「采购管理」导入补货表后刷新。
                  </td>
                </tr>
              ) : (
                arrivalBriefs.map((b) => (
                  <tr key={b.id}>
                    <td>{b.batchDate}</td>
                    <td>
                      {b.importedBy} ·{" "}
                      {b.importedAt.slice(0, 16).replace("T", " ")}
                    </td>
                    <td>
                      {b.lineCount} / {b.totalQty}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {b.shopLabels.join(" · ")}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        disabled={!!busy}
                        onClick={() => void openArrival(b.id)}
                      >
                        按店看
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {arrivalDetail ? (
          <div style={{ marginTop: 10 }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <strong>明细 {arrivalDetail.batchDate}</strong>
              <button
                type="button"
                className="btn"
                onClick={() => setArrivalDetail(null)}
              >
                收起
              </button>
            </div>
            {arrivalDetail.byShop.map((s) => (
              <div key={s.shop} style={{ marginBottom: 10 }}>
                <strong>
                  {s.shop} {s.shopName}
                </strong>
                <span className="muted">
                  {" "}
                  · {s.skuCount} SKU / {s.totalQty} 件
                </span>
                <div style={{ overflowX: "auto", marginTop: 4 }}>
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

      <h4 style={{ margin: "0 0 8px" }}>Phase 1 · 待发池 / 货性 / 样本</h4>
      <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
        待发池、货性缺口、票级实付样本。货性以{" "}
        <code>货代×PSKU</code> 手工标注为准；搭配优化在后续 Phase。
      </p>

      {err ? (
        <p style={{ color: "var(--danger, #b00020)", marginTop: 0 }}>{err}</p>
      ) : null}
      {msg ? <p className="muted" style={{ marginTop: 0 }}>{msg}</p> : null}

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            border: "1px solid var(--border, #ddd)",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <strong>路由规则</strong>
          {rules ? (
            <ul className="muted" style={{ margin: "8px 0", paddingLeft: 18 }}>
              <li>普货 → {rules.generalForwarder}</li>
              <li>敏货 → {rules.sensitiveForwarder}</li>
              <li>
                带电 →{" "}
                {rules.batteryToHansha ? "汉沙" : rules.batteryForwarder}
                {rules.batteryToHansha && rules.batteryToHanshaSince
                  ? `（自 ${rules.batteryToHanshaSince}）`
                  : ""}
              </li>
              <li>咖啡机 → {rules.coffeeForwarder}</li>
              <li>监测手环 → {rules.bandForwarder}</li>
            </ul>
          ) : (
            <p className="muted">加载中…</p>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={!!rules?.batteryToHansha}
              disabled={!!busy || !rules}
              onChange={(e) => void saveBatterySwitch(e.target.checked)}
            />
            带电改走汉沙
          </label>
        </div>

        <div
          style={{
            border: "1px solid var(--border, #ddd)",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <strong>待发池</strong>
          <p className="muted" style={{ margin: "8px 0" }}>
            {lines.length} 行 · 货性缺口 {gapCount}
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,.xls"
              style={{ display: "none" }}
              onChange={(e) =>
                void onImportFile(e.target.files?.[0] ?? null)
              }
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy === "import" ? "导入中…" : "导入到货表"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!!busy || !lines.length}
              onClick={() => void clearPool()}
            >
              清空
            </button>
            <button
              type="button"
              className="btn"
              disabled={!!busy}
              onClick={() => void refresh()}
            >
              刷新
            </button>
          </div>
        </div>

        <div
          style={{
            border: "1px solid var(--border, #ddd)",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <strong>票级实付样本</strong>
          <p className="muted" style={{ margin: "8px 0" }}>
            {sampleCount} 票
            {sampleUpdatedAt
              ? ` · 更新 ${sampleUpdatedAt.slice(0, 19).replace("T", " ")}`
              : ""}
          </p>
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => void rebuildSamples()}
          >
            {busy === "samples" ? "重建中…" : "从装箱表重建"}
          </button>
        </div>
      </div>

      {gaps.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <h4 style={{ margin: "0 0 8px" }}>货性缺口（建议货代下未标注）</h4>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>PSKU</th>
                  <th>品名</th>
                  <th>店</th>
                  <th>建议货代</th>
                  <th>仓管粗分</th>
                  <th>件数</th>
                  <th>补标注</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g) => {
                  const key = `${g.partnerSku}\0${g.suggestForwarder}`;
                  return (
                    <tr key={key}>
                      <td>{g.partnerSku}</td>
                      <td>{g.name}</td>
                      <td>{g.shop}</td>
                      <td>{g.suggestForwarder}</td>
                      <td>{g.warehouseType || "—"}</td>
                      <td>{g.qty}</td>
                      <td>
                        <select
                          disabled={gapSaving === key}
                          defaultValue=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            void fillGap(g, v);
                            e.target.value = "";
                          }}
                        >
                          <option value="">选择货性…</option>
                          {(options.length
                            ? options
                            : Object.entries(KIND_LABEL)
                                .filter(([k]) => k !== "unlabeled")
                                .map(([value, label]) => ({ value, label }))
                          ).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <h4 style={{ margin: "0 0 8px" }}>待发行</h4>
      <div style={{ overflowX: "auto", marginBottom: 14 }}>
        <table className="table">
          <thead>
            <tr>
              <th>PSKU</th>
              <th>品名</th>
              <th>店</th>
              <th>空/海</th>
              <th>数量</th>
              <th>重量kg</th>
              <th>仓管粗分</th>
              <th>建议货代</th>
              <th>货性(hints)</th>
              <th>理由</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={10} className="muted">
                  暂无待发。请导入桌面「每日到货情况」类 xlsx（含「发货计划」表）。
                </td>
              </tr>
            ) : (
              lines.map((l) => (
                <tr
                  key={l.id}
                  style={
                    l.cargoGap
                      ? { background: "rgba(255, 235, 156, 0.35)" }
                      : undefined
                  }
                >
                  <td>{l.partnerSku}</td>
                  <td>{l.name}</td>
                  <td>{l.shop}</td>
                  <td>{l.modePref || "—"}</td>
                  <td>{l.qty}</td>
                  <td>
                    {l.weightKg != null ? Number(l.weightKg).toFixed(2) : "—"}
                  </td>
                  <td>{l.warehouseType || "—"}</td>
                  <td>{l.suggestForwarder}</td>
                  <td>
                    {l.cargoGap ? (
                      <span style={{ color: "#a67c00" }}>缺</span>
                    ) : (
                      kindLabel(l.hintCargoKind)
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {l.suggestReason}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rollup.length > 0 ? (
        <>
          <h4 style={{ margin: "0 0 8px" }}>
            实付滚动（货代 × 货性 × 模式）
          </h4>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>货代</th>
                  <th>货性</th>
                  <th>模式</th>
                  <th>票数</th>
                  <th>实付合计</th>
                  <th>中位元/kg</th>
                  <th>中位元/方</th>
                </tr>
              </thead>
              <tbody>
                {rollup.slice(0, 40).map((r) => (
                  <tr
                    key={`${r.forwarder}-${r.cargoKind}-${r.mode}`}
                  >
                    <td>{r.forwarder}</td>
                    <td>{kindLabel(r.cargoKind)}</td>
                    <td>
                      {r.mode === "air"
                        ? "空运"
                        : r.mode === "sea"
                          ? "海运"
                          : r.mode}
                    </td>
                    <td>{r.ticketCount}</td>
                    <td>{Math.round(r.paidSum)}</td>
                    <td>
                      {r.medianRmbPerKg != null
                        ? r.medianRmbPerKg.toFixed(1)
                        : "—"}
                    </td>
                    <td>
                      {r.medianRmbPerCbm != null
                        ? r.medianRmbPerCbm.toFixed(0)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
