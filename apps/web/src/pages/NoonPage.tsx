import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DomainMapRow, type NoonConnection } from "../api";
import { ClearableInput } from "../components/ClearableInput";

const emptyPortal = {
  portalUrl: "https://login.noon.partners/",
  ordersUrl: "",
  catalogUrl: "",
  stockUrl: "",
  lastFetchAt: null as string | null,
  lastImportAt: null as string | null,
  lastImportSummary: null as string | null,
};

const empty: NoonConnection = {
  mode: "portal",
  partnerId: "",
  apiKey: "",
  apiSecret: "",
  webhookSecret: "",
  baseUrl: "https://login.noon.partners/",
  countryCode: "sa",
  enabled: true,
  lastValidatedAt: null,
  lastError: null,
  portal: emptyPortal,
};

type Domain = "orders" | "catalog" | "stock" | "sales" | "fees" | "ads";

export function NoonPage() {
  const [form, setForm] = useState<NoonConnection>(empty);
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [domain, setDomain] = useState<Domain>("orders");
  const [importText, setImportText] = useState("");
  const [filename, setFilename] = useState("");
  const [cacheInfo, setCacheInfo] = useState("");
  const [domainMap, setDomainMap] = useState<DomainMapRow[]>([]);

  async function refreshCache() {
    const res = await api.getPortalCache();
    const c = res.data;
    setCacheInfo(
      `缓冲：订单 ${c.counts.orders} / 商品 ${c.counts.catalog} / 库存 ${c.counts.stock}` +
        ` / 销量 ${c.counts.sales ?? 0} / 费用 ${c.counts.fees ?? 0} / 广告 ${c.counts.ads ?? 0}` +
        (c.lastImportSummary ? ` · ${c.lastImportSummary}` : ""),
    );
  }

  async function refreshDomainMap() {
    const res = await api.getNoonDomainMap();
    setDomainMap(res.data);
  }

  useEffect(() => {
    api
      .getNoonConnection()
      .then((res) => {
        setForm({
          ...res.data,
          portal: { ...emptyPortal, ...(res.data.portal ?? {}) },
        });
        setSlots(res.data.integrationSlots ?? {});
      })
      .catch((e: Error) => setError(e.message));
    refreshCache().catch(() => undefined);
    refreshDomainMap().catch(() => undefined);
  }, []);

  function patch<K extends keyof NoonConnection>(key: K, value: NoonConnection[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function patchPortal(key: keyof NonNullable<NoonConnection["portal"]>, value: string) {
    setForm((prev) => ({
      ...prev,
      portal: { ...emptyPortal, ...(prev.portal ?? {}), [key]: value },
    }));
  }

  async function save() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api.putNoonConnection({
        mode: form.mode,
        partnerId: form.partnerId,
        apiKey: form.apiKey,
        apiSecret: form.apiSecret,
        webhookSecret: form.webhookSecret,
        baseUrl: form.baseUrl,
        countryCode: form.countryCode,
        enabled: form.enabled,
        portal: {
          portalUrl: form.portal?.portalUrl ?? "",
          ordersUrl: form.portal?.ordersUrl ?? "",
          catalogUrl: form.portal?.catalogUrl ?? "",
          stockUrl: form.portal?.stockUrl ?? "",
        },
      });
      setForm({ ...res.data, portal: { ...emptyPortal, ...(res.data.portal ?? {}) } });
      setMessage("NOON 接入配置已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api.validateNoon();
      setMessage(res.data.message);
      const latest = await api.getNoonConnection();
      setForm({ ...latest.data, portal: { ...emptyPortal, ...(latest.data.portal ?? {}) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "校验失败");
    } finally {
      setBusy(false);
    }
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    setFilename(file.name);
    const text = await file.text();
    setImportText(text);
  }

  async function doImport() {
    if (!importText.trim()) {
      setError("请先选择导出文件或粘贴 CSV/JSON 内容");
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api.importPortal({
        domain,
        content: importText,
        format: "auto",
        filename: filename || undefined,
      });
      setMessage(res.message ?? res.data.summary);
      await refreshCache();
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  async function doAutoSync() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      setMessage(
        form.mode === "live"
          ? "正在 live 同步：Impex 导出（注意 30 分钟限额）…"
          : "正在扫描 portal-imports 并自动入库…",
      );
      const res = await api.autoSync({ forceIngest: false });
      setMessage(res.message ?? res.data.message);
      await refreshCache();
      await refreshDomainMap();
      const latest = await api.getNoonConnection();
      setForm({
        ...latest.data,
        portal: { ...emptyPortal, ...(latest.data.portal ?? {}) },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "自动同步失败");
    } finally {
      setBusy(false);
    }
  }

  async function doAutoIngestOnly() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api.autoIngest({ force: false });
      setMessage(
        res.message ??
          `扫描 ${res.data.scanned}，新导入 ${res.data.imported}，跳过 ${res.data.skipped}`,
      );
      await refreshCache();
      await refreshDomainMap();
    } catch (e) {
      setError(e instanceof Error ? e.message : "自动入库失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">NOON 接入</h1>
      <p className="page-desc">
        {form.mode === "live"
          ? "推荐：模式选 live，配置 Service Account JSON（OUTPOST_NOON_CREDENTIALS_FILE），点「校验凭证」后「自动同步」。"
          : "门户路径：将 CSV 放入 portal-imports 后点「自动同步」入库。推荐改用 live（Partner API）。"}
      </p>

      <div className="status-bar ok" style={{ marginBottom: 16 }}>
        <div className="row">
          <span className="badge ok">
            {form.mode === "live" ? "主路径：Partner API" : "主路径：全自动同步"}
          </span>
          <span className="muted">
            模式 {form.mode} · {form.enabled ? "已启用" : "已停用"}
            {form.mode === "live" && form.partnerApi
              ? form.partnerApi.credentialsPresent
                ? ` · 凭证已就绪${form.partnerApi.projectCode ? ` (${form.partnerApi.projectCode})` : ""}`
                : " · 缺少凭证文件"
              : ""}
            {cacheInfo ? ` · ${cacheInfo}` : ""}
          </span>
        </div>
        <Link className="btn" to="/sync-health">
          数据对齐 · 一键补齐
        </Link>
      </div>

      {(message || error) && (
        <p style={{ color: error ? "var(--danger)" : "var(--ok)", marginBottom: 12 }}>
          {error || message}
        </p>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>自动同步</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {form.mode === "live"
            ? "live 模式走 Partner API Impex。注意账号常见限额：30 分钟约 20 次导出。"
            : "扫描 portal-imports 自动识别文件类型并入库。后台也会定时扫目录。"}
        </p>
        <div className="row">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => doAutoSync()}
          >
            {busy
              ? "同步中…"
              : form.mode === "live"
                ? "自动同步（Partner API）"
                : "自动同步（扫目录入库）"}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={doAutoIngestOnly}>
            立即扫描 portal-imports
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>分域映射（一源一域一主页）</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          不同 NOON 报表进入不同 SyncDomain，展示到对应慧运营页面，禁止全部塞进 Catalog。完整说明见{" "}
          <code>docs/NOON_OUTPOST_DATA_MAP.md</code>。广告域由 Playwright 导出投递（
          <code>docs/PW_RPA_PLATFORM.md</code>），不走 Impex。
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>域</th>
              <th>NOON 来源</th>
              <th>本地条数</th>
              <th>慧运营主页面</th>
              <th>状态</th>
              <th>期</th>
            </tr>
          </thead>
          <tbody>
            {domainMap.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  加载中…
                </td>
              </tr>
            ) : (
              domainMap.map((row) => (
                <tr key={row.domain}>
                  <td>{row.domain}</td>
                  <td>{row.noonSource}</td>
                  <td>{row.count}</td>
                  <td>
                    {row.primaryPage}
                    {row.refs.length > 0 ? (
                      <span className="muted"> · 引用：{row.refs.join("、")}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className={`badge ${row.mapped ? "ok" : "idle"}`}>
                      {row.mapped ? "已映射" : "未映射"}
                    </span>
                  </td>
                  <td>W{row.wave}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>连接配置</h3>
          <div className="field-grid">
            <div className="field">
              <label>模式</label>
              <select
                value={form.mode}
                onChange={(e) =>
                  patch("mode", e.target.value as NoonConnection["mode"])
                }
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                <option value="live">live（Partner API / Impex）</option>
                <option value="portal">portal（CSV / portal-imports）</option>
                <option value="mock">mock（开发模拟）</option>
              </select>
            </div>
            <div className="field">
              <label>国家站点</label>
              <select
                value={form.countryCode}
                onChange={(e) =>
                  patch("countryCode", e.target.value as "sa" | "ae" | "eg")
                }
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                <option value="sa">Saudi (sa)</option>
                <option value="ae">UAE (ae)</option>
                <option value="eg">Egypt (eg)</option>
              </select>
            </div>
            <div className="field">
              <label>启用接入</label>
              <select
                value={form.enabled ? "1" : "0"}
                onChange={(e) => patch("enabled", e.target.value === "1")}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                <option value="1">启用</option>
                <option value="0">停用</option>
              </select>
            </div>
            <div className="field">
              <label>卖家后台地址</label>
              <ClearableInput
                value={form.portal?.portalUrl ?? ""}
                onChange={(e) => patchPortal("portalUrl", e.target.value)}
                placeholder="NOON Seller 后台首页 URL"
              />
            </div>
          </div>

          {form.mode === "live" ? (
            <>
              <h3 style={{ marginTop: 18 }}>Partner API 凭证</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                将 Access App 下载的 Service Account JSON 放到服务器本地路径，并设置环境变量{" "}
                <code>OUTPOST_NOON_CREDENTIALS_FILE</code>
                。私钥不会回传到浏览器。保存模式为 live 后，点「校验凭证」与「自动同步」。
              </p>
              <div
                className="placeholder"
                style={{ padding: 12, marginBottom: 12, fontSize: 13 }}
              >
                {form.partnerApi?.credentialsPresent ? (
                  <>
                    <strong style={{ color: "var(--ok)" }}>已检测到凭证文件</strong>
                    <div className="muted" style={{ marginTop: 6 }}>
                      路径：{form.partnerApi.credentialsFilePath}
                      {form.partnerApi.projectCode
                        ? ` · 项目 ${form.partnerApi.projectCode}`
                        : ""}
                      {form.partnerApi.keyIdSuffix
                        ? ` · key ${form.partnerApi.keyIdSuffix}`
                        : ""}
                    </div>
                  </>
                ) : (
                  <>
                    <strong style={{ color: "var(--danger)" }}>未找到凭证文件</strong>
                    <div className="muted" style={{ marginTop: 6 }}>
                      期望路径：
                      {form.partnerApi?.credentialsFilePath ??
                        "OUTPOST_NOON_CREDENTIALS_FILE"}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : null}

          <div className="row" style={{ marginTop: 18, marginBottom: 12 }}>
            <button className="btn" type="button" disabled={busy} onClick={save}>
              保存接入配置
            </button>
            <button className="btn" type="button" disabled={busy} onClick={validate}>
              校验凭证
            </button>
          </div>
        </div>

        <div className="card">
          <details open={false}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              高级 / 兜底：手工文件导入
            </summary>
            <p className="muted" style={{ marginTop: 8 }}>
              仅当自动导出失败时使用。也可把 CSV 直接丢进 D:\outpost-data\portal-imports，系统会自动识别入库。
            </p>
            <div className="field-grid">
              <div className="field">
                <label>数据类型</label>
                <select
                  value={domain}
                  onChange={(e) => setDomain(e.target.value as Domain)}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  <option value="orders">订单 orders</option>
                  <option value="catalog">商品 catalog（SOP 在线/不在线）</option>
                  <option value="stock">库存 stock（SOP Inventory）</option>
                  <option value="sales">销量 sales（SOP Sales）</option>
                  <option value="fees">费用 fees（SOP Transaction）</option>
                  <option value="ads">广告 ads（Campaign Overview SKU CSV）</option>
                </select>
              </div>
              <div className="field">
                <label>选择文件</label>
                <input
                  type="file"
                  accept=".csv,.json,.txt,text/csv,application/json"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>内容预览 / 粘贴</label>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={8}
                style={{
                  width: "100%",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: 8,
                  fontFamily: "Consolas, monospace",
                  fontSize: 12,
                }}
              />
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" type="button" disabled={busy} onClick={doImport}>
                导入并同步到系统
              </button>
              <a className="btn" href={`/api/noon/portal/template/${domain}`}>
                下载 {domain} 模板
              </a>
            </div>
          </details>

          <div className="kv" style={{ marginTop: 14 }}>
            {Object.entries(slots).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <label>{k}</label>
                <div style={{ fontSize: 12, wordBreak: "break-all" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
