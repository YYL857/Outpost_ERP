import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  type ReviewConfig,
  type ShippingConfig,
  type ShopInfo,
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
  const navigate = useNavigate();
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [shipping, setShipping] = useState<ShippingConfig | null>(null);
  const [review, setReview] = useState<ReviewConfig | null>(null);
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [saving, setSaving] = useState<"shipping" | "review" | "register" | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [credPath, setCredPath] = useState("");
  const [shopName, setShopName] = useState("");
  const [countryCode, setCountryCode] = useState<"sa" | "ae" | "eg">("sa");
  const [setActiveAfterRegister, setSetActiveAfterRegister] = useState(true);

  async function refresh() {
    const [s, ship, rev, h, shopRes] = await Promise.all([
      api.getStore(),
      api.getShipping(),
      api.getReview(),
      api.getSyncHealth(),
      api.getShops(),
    ]);
    setStore(s.data);
    setShipping(ship.data);
    setReview(rev.data);
    setHealth(h.data);
    setShops(shopRes.data.shops);
  }

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function registerShop() {
    const path = credPath.trim();
    if (!path) {
      setError("请填写 Service Account JSON 的本机绝对路径");
      return;
    }
    setSaving("register");
    setMessage("");
    setError("");
    try {
      const res = await api.registerShop({
        credentialsFile: path,
        name: shopName.trim() || undefined,
        countryCode,
        noonMode: "live",
        setActive: setActiveAfterRegister,
      });
      setMessage(res.message ?? "店铺已录入");
      setCredPath("");
      setShopName("");
      const list = await api.getShops();
      setShops(list.data.shops);
      if (res.data.switched || res.data.shop.isActive) {
        navigate(0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "店铺录入失败");
    } finally {
      setSaving(null);
    }
  }

  async function saveShipping() {
    if (!shipping) return;
    if (!(shipping.buybackRate > 0)) {
      setError("请填写回购汇率（1 SAR → 多少 RMB，须大于 0）后再保存");
      setMessage("");
      return;
    }
    setSaving("shipping");
    setMessage("");
    setError("");
    try {
      const body = {
        airFreightAedPerKg: shipping.airFreightAedPerKg ?? 0,
        airLeadDays: shipping.airLeadDays,
        seaFreightAedPerCbm: shipping.seaFreightAedPerCbm ?? 0,
        seaLeadDays: shipping.seaLeadDays,
        airFreightRmbPerKg: shipping.airFreightRmbPerKg ?? 65,
        seaFreightRmbPerCbmPlug: shipping.seaFreightRmbPerCbmPlug ?? 2200,
        seaFreightRmbPerCbmBuiltin: shipping.seaFreightRmbPerCbmBuiltin ?? 2400,
        seaFreightRmbPerCbmGeneral: shipping.seaFreightRmbPerCbmGeneral ?? 1830,
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>店铺录入</h3>
          <button
            className="btn btn-primary"
            type="button"
            disabled={saving === "register"}
            onClick={registerShop}
          >
            {saving === "register" ? "录入中…" : "录入店铺"}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          在 NOON Partner 控制台下载 Access App 的 Service Account JSON，填本机绝对路径即可录入。
          系统会读取其中的 <code>project_code</code>，私钥只留在你指定的文件里。
        </p>
        <div className="field-grid">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>凭证 JSON 路径</label>
            <input
              type="text"
              placeholder="例如 D:\PRJ396770\noon_credentials_sensitive.json"
              value={credPath}
              onChange={(e) => setCredPath(e.target.value)}
            />
          </div>
          <div className="field">
            <label>店铺名称（可选）</label>
            <input
              type="text"
              placeholder="留空则用 Shop PRJ…"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>站点</label>
            <select
              value={countryCode}
              onChange={(e) =>
                setCountryCode(e.target.value as "sa" | "ae" | "eg")
              }
            >
              <option value="sa">沙特 SA</option>
              <option value="ae">阿联酋 AE</option>
              <option value="eg">埃及 EG</option>
            </select>
          </div>
          <div className="field">
            <label>录入后切为当前店</label>
            <label className="row" style={{ gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={setActiveAfterRegister}
                onChange={(e) => setSetActiveAfterRegister(e.target.checked)}
              />
              <span>是</span>
            </label>
          </div>
        </div>
        {shops.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <p className="muted" style={{ marginBottom: 8 }}>
              已登记 {shops.length} 家店铺（顶栏可切换）
            </p>
            <div className="kv">
              {shops.map((s) => (
                <div key={s.id} style={{ display: "contents" }}>
                  <label>
                    {s.name}
                    {s.isActive ? " · 当前" : ""}
                  </label>
                  <div className="muted" style={{ wordBreak: "break-all" }}>
                    {s.projectCode} · {s.credentialsFile}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
              <label>空运运费 (RMB/kg)</label>
              <input
                type="number"
                value={shipping.airFreightRmbPerKg ?? 65}
                onChange={(e) =>
                  setShipping({
                    ...shipping,
                    airFreightRmbPerKg: Number(e.target.value),
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
              <label>海运·插电 (RMB/cbm)</label>
              <input
                type="number"
                value={shipping.seaFreightRmbPerCbmPlug ?? 2200}
                onChange={(e) =>
                  setShipping({
                    ...shipping,
                    seaFreightRmbPerCbmPlug: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="field">
              <label>海运·内置电 (RMB/cbm)</label>
              <input
                type="number"
                value={shipping.seaFreightRmbPerCbmBuiltin ?? 2400}
                onChange={(e) =>
                  setShipping({
                    ...shipping,
                    seaFreightRmbPerCbmBuiltin: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="field">
              <label>海运·普货 (RMB/cbm)</label>
              <input
                type="number"
                value={shipping.seaFreightRmbPerCbmGeneral ?? 1830}
                onChange={(e) =>
                  setShipping({
                    ...shipping,
                    seaFreightRmbPerCbmGeneral: Number(e.target.value),
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
              <label>回购汇率（1 SAR → RMB）</label>
              <input
                type="number"
                step="0.01"
                min={0.01}
                placeholder="例如 1.8"
                value={shipping.buybackRate || ""}
                onChange={(e) =>
                  setShipping({
                    ...shipping,
                    buybackRate: Number(e.target.value) || 0,
                  })
                }
              />
              {shipping.buybackRate <= 0 ? (
                <p className="muted" style={{ margin: "6px 0 0", color: "var(--danger)" }}>
                  未配置：Catalog 利润 RMB 为空，且不扣人民币采购/头程。
                  <button
                    className="btn"
                    type="button"
                    style={{ marginLeft: 8, padding: "2px 8px", fontSize: 12 }}
                    onClick={() => setShipping({ ...shipping, buybackRate: 1.8 })}
                  >
                    填入参考值 1.8
                  </button>
                </p>
              ) : (
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  毛利 RMB = (售价 − 平台税费) × {shipping.buybackRate} − 头程 − 采购；
                  空运头程 = 计费重 × {shipping.airFreightRmbPerKg} RMB/kg。
                </p>
              )}
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
