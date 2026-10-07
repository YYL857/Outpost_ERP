import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DomainMapRow, type NoonConnection } from "../api";

const emptyPortal = {
  portalUrl: "https://login.noon.partners/",
  ordersUrl: "",
  catalogUrl: "",
  stockUrl: "",
  lastFetchAt: null as string | null,
  lastImportAt: null as string | null,
  lastImportSummary: null as string | null,
  hasSession: false,
  sessionCookieCount: 0,
  sessionFilePath: "",
  sessionExpiresAt: null as string | null,
  sessionRemainingMs: null as number | null,
  sessionHealth: "missing" as const,
  sessionUsable: "missing" as const,
  sessionProbeAt: null as string | null,
  sessionProbeMessage: null as string | null,
  sessionProbeVerdict: null as string | null,
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

type Domain = "orders" | "catalog" | "stock" | "sales" | "fees";

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

  async function doBrowserLogin() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      setMessage(
        "已打开登录窗（本机 Chrome）：请登录并进入 Seller Lab；进入后约 3 秒会自动保存，然后关闭窗口即可…",
      );
      const res = await api.browserLogin();
      setMessage(
        (res.message ??
          `登录态已写入本地文件（${res.data.cookieCount} 条 Cookie）`) +
          " · 请尽快点「探测可用性」或「自动同步」",
      );
      const latest = await api.getNoonConnection();
      setForm({
        ...latest.data,
        portal: { ...emptyPortal, ...(latest.data.portal ?? {}) },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "浏览器登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function doClearSession() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api.clearBrowserSession();
      setMessage(res.message ?? "已清除本地登录态");
      const latest = await api.getNoonConnection();
      setForm({
        ...latest.data,
        portal: { ...emptyPortal, ...(latest.data.portal ?? {}) },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "清除失败");
    } finally {
      setBusy(false);
    }
  }

  async function doProbeSession() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      setMessage("正在探针登录态是否可用（会打开本机 Chrome）…");
      const res = await api.probePortalSession();
      setMessage(res.message ?? res.data.probe.message);
      const latest = await api.getNoonConnection();
      setForm({
        ...latest.data,
        portal: { ...emptyPortal, ...(latest.data.portal ?? {}) },
      });
      if (res.data.probe.usable !== "ok") {
        setError(res.data.probe.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "探针失败");
    } finally {
      setBusy(false);
    }
  }

  async function doSessionFetch() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await api.fetchPortalSession();
      setMessage(
        `${res.data.summary}${res.data.warnings.length ? `；警告：${res.data.warnings.join("；")}` : ""}`,
      );
      await refreshCache();
    } catch (e) {
      setError(e instanceof Error ? e.message : "会话拉取失败");
    } finally {
      setBusy(false);
    }
  }

  async function doAutoSync(skipSop = false) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      setMessage(
        form.mode === "live"
          ? "正在 live 同步：Impex 导出 catalog + orders（库存随目录写入；注意 30 分钟限额）"
          : skipSop
            ? "正在扫描 portal-imports 并自动入库…"
            : "正在自动同步：SOP 导出（需登录态）→ 自动入库…",
      );
      const res = await api.autoSync({ skipSop, forceIngest: false });
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
          ? "推荐：模式选 live，配置 Service Account JSON（OUTPOST_NOON_CREDENTIALS_FILE），点「校验凭证」后「自动同步」——经 Partner API Impex 拉目录/订单/库存，不经 Seller Lab。"
          : "门户路径：浏览器登录一次 → 点「自动同步」。系统按 SOP 拉报表到 D:\\outpost-data\\portal-imports 并入库。门户易被 Akamai 拦截时可改用 live。"}
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
          查看同步健康
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
            ? "live 模式会 Impex 导出 catalog（默认 live）+ orders（近 30 天）；库存随目录 CSV 写入。注意账号常见限额：30 分钟约 2 次导出。"
            : "有登录态时会尝试 Playwright 按 SOP 导出；随后扫描 portal-imports 自动识别文件类型并入库。后台也会定时扫目录。"}
        </p>
        <div className="row">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => doAutoSync(false)}
          >
            {busy
              ? "同步中…"
              : form.mode === "live"
                ? "自动同步（Partner API）"
                : "自动同步（SOP导出+入库）"}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => doAutoSync(true)}
          >
            仅扫目录入库
          </button>
          <button className="btn" type="button" disabled={busy} onClick={doAutoIngestOnly}>
            立即扫描 portal-imports
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>分域映射（一源一域一主页）</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          不同 NOON 报表进入不同 SyncDomain，展示到对应前哨页面，禁止全部塞进 Catalog。完整说明见{" "}
          <code>docs/NOON_OUTPOST_DATA_MAP.md</code>。
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>域</th>
              <th>NOON 来源</th>
              <th>本地条数</th>
              <th>前哨主页面</th>
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
                <option value="portal">portal（浏览器 SOP，易被拦截）</option>
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
              <input
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

          <h3 style={{ marginTop: 18 }}>门户登录态</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            {form.mode === "live"
              ? "live 模式不依赖门户 Cookie；以下仅作过渡/对比。若仍用 portal，请完成登录并尽快探测。"
              : null}
            {form.mode !== "live" ? (
              <>
                点击下方按钮打开专用登录窗（本机 Chrome），完成 NOON 登录并进入 Seller Lab 后，
                <strong>系统会等待约 3 秒再自动保存</strong>
                ，然后关闭该窗口即可。
                <strong>保存后请尽快点「自动同步」或「探测可用性」</strong>
                （网关 Cookie 短命；有文件不等于一定能用）。
              </>
            ) : null}
          </p>
          <div
            className="placeholder"
            style={{ padding: 12, marginBottom: 12, fontSize: 13 }}
          >
            {form.portal?.hasSession ? (
              <>
                <strong
                  style={{
                    color:
                      form.portal.sessionHealth === "expired"
                        ? "var(--danger)"
                        : form.portal.sessionHealth === "warning"
                          ? "var(--warn)"
                          : "var(--ok)",
                  }}
                >
                  本地文件：
                  {form.portal.sessionHealth === "expired"
                    ? "已过期"
                    : form.portal.sessionHealth === "warning"
                      ? "即将过期"
                      : "已保存"}
                </strong>
                <div style={{ marginTop: 8 }}>
                  <strong
                    style={{
                      color:
                        form.portal.sessionUsable === "ok"
                          ? "var(--ok)"
                          : form.portal.sessionUsable === "blocked" ||
                              form.portal.sessionUsable === "expired"
                            ? "var(--danger)"
                            : "var(--warn)",
                    }}
                  >
                    可用性：
                    {form.portal.sessionUsable === "ok"
                      ? "探针通过（可同步）"
                      : form.portal.sessionUsable === "blocked"
                        ? "被网关拦截"
                        : form.portal.sessionUsable === "expired"
                          ? "已失效"
                          : form.portal.sessionUsable === "missing"
                            ? "未保存"
                            : "未探测 / 不明确"}
                  </strong>
                </div>
                {form.portal.sessionProbeMessage && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    {form.portal.sessionProbeMessage}
                    {form.portal.sessionProbeAt
                      ? ` · ${new Date(form.portal.sessionProbeAt).toLocaleString()}`
                      : ""}
                  </div>
                )}
                {(form.portal.sessionUsable === "blocked" ||
                  form.portal.sessionUsable === "expired" ||
                  form.portal.sessionHealth === "expired" ||
                  form.portal.sessionHealth === "warning") && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    请点击「打开登录窗」重新登录，保存后立即同步或再点「探测可用性」。
                  </div>
                )}
                <div className="muted" style={{ marginTop: 6 }}>
                  {form.portal.sessionCookieCount} 条 Cookie
                  {form.portal.sessionExpiresAt
                    ? ` · 失效时间 ${new Date(form.portal.sessionExpiresAt).toLocaleString()}`
                    : ""}
                  {form.portal.sessionRemainingMs != null &&
                  form.portal.sessionRemainingMs > 0
                    ? ` · 剩余约 ${Math.max(1, Math.round(form.portal.sessionRemainingMs / 60000))} 分钟`
                    : ""}
                </div>
                <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                  {form.portal.sessionFilePath ||
                    "D:\\outpost-data\\noon-session\\cookie-header.txt"}
                </div>
              </>
            ) : (
              <>
                <strong>本地登录态：未保存</strong>
                <div className="muted" style={{ marginTop: 6 }}>
                  请先点「打开登录窗」完成登录。文件路径：D:\outpost-data\noon-session\cookie-header.txt
                </div>
              </>
            )}
          </div>
          <div className="row" style={{ marginBottom: 12 }}>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy}
              onClick={doBrowserLogin}
            >
              打开登录窗
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy || !form.portal?.hasSession}
              onClick={doProbeSession}
            >
              探测可用性
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy || !form.portal?.hasSession}
              onClick={doClearSession}
            >
              清除本地登录态
            </button>
            <button className="btn" type="button" disabled={busy} onClick={save}>
              保存接入配置
            </button>
          </div>
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            自动同步前会先探针；被拦截（fault filter abort）时跳过导出并提示重登。
            仍失败时可把手动导出的 CSV 丢进 D:\outpost-data\portal-imports。
          </p>

          <details style={{ marginTop: 8 }}>
            <summary className="muted" style={{ cursor: "pointer" }}>
              高级：XHR URL / 会话拉取（可选）
            </summary>
            <div className="field-grid" style={{ marginTop: 10 }}>
              <div className="field">
                <label>订单数据 URL</label>
                <input
                  value={form.portal?.ordersUrl ?? ""}
                  onChange={(e) => patchPortal("ordersUrl", e.target.value)}
                  placeholder="portal.ordersUrl"
                />
              </div>
              <div className="field">
                <label>商品数据 URL</label>
                <input
                  value={form.portal?.catalogUrl ?? ""}
                  onChange={(e) => patchPortal("catalogUrl", e.target.value)}
                  placeholder="portal.catalogUrl"
                />
              </div>
              <div className="field">
                <label>库存数据 URL</label>
                <input
                  value={form.portal?.stockUrl ?? ""}
                  onChange={(e) => patchPortal("stockUrl", e.target.value)}
                  placeholder="portal.stockUrl"
                />
              </div>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" type="button" disabled={busy} onClick={save}>
                保存接入配置
              </button>
              <button className="btn" type="button" disabled={busy} onClick={validate}>
                校验门户就绪
              </button>
              <button className="btn" type="button" disabled={busy} onClick={doSessionFetch}>
                会话拉取并同步
              </button>
            </div>
          </details>
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
