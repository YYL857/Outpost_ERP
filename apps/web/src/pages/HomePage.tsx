import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type ReviewConfig,
  type ShippingConfig,
  type StoreInfo,
  type SyncHealth,
} from "../api";

function toneOf(status: SyncHealth["overall"]): "ok" | "warn" | "danger" | "idle" {
  if (status === "failed") return "danger";
  if (status === "warning" || status === "running") return "warn";
  if (status === "success") return "ok";
  return "idle";
}

function labelOf(status: SyncHealth["overall"]) {
  const map = {
    success: "同步正常",
    warning: "同步异常/延迟",
    failed: "同步失败",
    running: "同步进行中",
    idle: "尚未同步",
  } as const;
  return map[status];
}

export function HomePage() {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [shipping, setShipping] = useState<ShippingConfig | null>(null);
  const [review, setReview] = useState<ReviewConfig | null>(null);
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [saving, setSaving] = useState<"shipping" | "review" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const [s, ship, rev, h] = await Promise.all([
      api.getStore(),
      api.getShipping(),
      api.getReview(),
      api.getSyncHealth(),
    ]);
    setStore(s.data);
    setShipping(ship.data);
    setReview(rev.data);
    setHealth(h.data);
  }

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function saveShipping() {
    if (!shipping) return;
    setSaving("shipping");
    setMessage("");
    setError("");
    try {
      const body = {
        airFreightAedPerKg: shipping.airFreightAedPerKg,
        airLeadDays: shipping.airLeadDays,
        seaFreightAedPerCbm: shipping.seaFreightAedPerCbm,
        seaLeadDays: shipping.seaLeadDays,
        buybackRate: shipping.buybackRate,
        volumetricDivisor: shipping.volumetricDivisor,
      };
      const res = await api.putShipping(body);
      setShipping(res.data);
      setMessage("运输费用配置已更新");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(null);
    }
  }

  async function saveReview() {
    if (!review) return;
    setSaving("review");
    setMessage("");
    setError("");
    try {
      const body = {
        commissionRmb: review.commissionRmb,
        exchangeRate: review.exchangeRate,
        expressFeeRmb: review.expressFeeRmb,
        balanceRmb: review.balanceRmb,
      };
      const res = await api.putReview(body);
      setReview(res.data);
      setMessage("测评费用配置已更新");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(null);
    }
  }

  if (!store || !shipping || !review || !health) {
    return <p className="muted">{error || "加载中…"}</p>;
  }

  const usedPct = Math.min(
    100,
    Math.round((store.listingUsed / store.listingQuota) * 100),
  );
  const tone = toneOf(health.overall);

  return (
    <div>
      <h1 className="page-title">我的主页</h1>
      <p className="page-desc">店铺概览、上架额度与成本配置。一眼能看懂当前经营状态。</p>

      <div className={`status-bar ${tone}`}>
        <div className="row">
          <span className={`badge ${tone}`}>{labelOf(health.overall)}</span>
          <span className="muted">
            未处理告警 {health.openAlertCount} 条 · 数据源 NOON · 双通道（Webhook + 拉取）已预留
          </span>
        </div>
        <Link className="btn" to="/sync-health">
          打开同步健康中心
        </Link>
      </div>

      {(message || error) && (
        <p className="muted" style={{ marginBottom: 12, color: error ? "var(--danger)" : "var(--ok)" }}>
          {error || message}
        </p>
      )}

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>店铺信息</h3>
          <div className="kv">
            <label>名称</label>
            <div>{store.name}</div>
            <label>账号</label>
            <div>{store.account}</div>
            <label>站点</label>
            <div>{store.site}</div>
            <label>平台</label>
            <div>{store.platform}</div>
          </div>
        </div>

        <div className="card">
          <h3>本月上架额度</h3>
          <p style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 650 }}>
            {store.listingUsed} / {store.listingQuota}
          </p>
          <div className="progress">
            <span style={{ width: `${usedPct}%` }} />
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            已用 {usedPct}%
          </p>
        </div>

        <div className="card">
          <h3>同步摘要</h3>
          <div className="kv">
            <label>订单</label>
            <div>
              {health.jobs.find((j) => j.domain === "orders")?.status ?? "-"}
            </div>
            <label>库存</label>
            <div>
              {health.jobs.find((j) => j.domain === "stock")?.status ?? "-"}
            </div>
            <label>对账</label>
            <div>
              {health.jobs.find((j) => j.domain === "reconcile")?.status ?? "-"}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>运输费用配置</h3>
            <button
              className="btn btn-primary"
              type="button"
              disabled={saving === "shipping"}
              onClick={saveShipping}
            >
              {saving === "shipping" ? "保存中…" : "更新配置"}
            </button>
          </div>
          <div className="field-grid">
            <div className="field">
              <label>空运运费 (AED/kg)</label>
              <input
                type="number"
                value={shipping.airFreightAedPerKg}
                onChange={(e) =>
                  setShipping({
                    ...shipping,
                    airFreightAedPerKg: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="field">
              <label>空运时效 (天)</label>
              <input
                type="number"
                value={shipping.airLeadDays}
                onChange={(e) =>
                  setShipping({ ...shipping, airLeadDays: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>海运运费 (AED/cbm)</label>
              <input
                type="number"
                value={shipping.seaFreightAedPerCbm}
                onChange={(e) =>
                  setShipping({
                    ...shipping,
                    seaFreightAedPerCbm: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="field">
              <label>海运时效 (天)</label>
              <input
                type="number"
                value={shipping.seaLeadDays}
                onChange={(e) =>
                  setShipping({ ...shipping, seaLeadDays: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>回购汇率</label>
              <input
                type="number"
                step="0.01"
                value={shipping.buybackRate}
                onChange={(e) =>
                  setShipping({ ...shipping, buybackRate: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>体积重比</label>
              <input
                type="number"
                value={shipping.volumetricDivisor}
                onChange={(e) =>
                  setShipping({
                    ...shipping,
                    volumetricDivisor: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            更新于 {new Date(shipping.updatedAt).toLocaleString()}
          </p>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>测评费用配置</h3>
            <button
              className="btn btn-primary"
              type="button"
              disabled={saving === "review"}
              onClick={saveReview}
            >
              {saving === "review" ? "保存中…" : "更新配置"}
            </button>
          </div>
          <div className="field-grid">
            <div className="field">
              <label>测评佣金 (RMB/单)</label>
              <input
                type="number"
                value={review.commissionRmb}
                onChange={(e) =>
                  setReview({ ...review, commissionRmb: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>测评汇率</label>
              <input
                type="number"
                step="0.01"
                value={review.exchangeRate}
                onChange={(e) =>
                  setReview({ ...review, exchangeRate: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>测评快递费 (RMB/单)</label>
              <input
                type="number"
                value={review.expressFeeRmb}
                onChange={(e) =>
                  setReview({ ...review, expressFeeRmb: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>测评余额 (RMB)</label>
              <input
                type="number"
                value={review.balanceRmb}
                onChange={(e) =>
                  setReview({ ...review, balanceRmb: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            更新于 {new Date(review.updatedAt).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
