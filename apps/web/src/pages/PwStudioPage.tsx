import { useEffect, useMemo, useState } from "react";
import {
  api,
  type PwExportSchedule,
  type PwJobName,
  type PwJobStatus,
  type PwRunLogDetail,
  type PwRunLogSummary,
  type PwSessionStatus,
  type ShopInfo,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";
import "./pw-studio.css";

type DatePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "last90"
  | "ytd"
  | "all"
  | "custom";

type Tab = PwJobName;

const DATE_PRESETS: { id: DatePreset; zh: string; en: string; hint: string }[] = [
  { id: "today", zh: "今天", en: "Today", hint: "只导今天" },
  { id: "yesterday", zh: "昨天", en: "Yesterday", hint: "只导昨天（广告原来的默认）" },
  { id: "last7", zh: "近 7 天", en: "Last 7 days", hint: "含今天共 7 天" },
  { id: "last30", zh: "近 30 天", en: "Last 30 days", hint: "含今天共 30 天" },
  { id: "last90", zh: "近 90 天", en: "Last 90 days", hint: "含今天共 90 天" },
  { id: "ytd", zh: "年初至今", en: "Year to Date", hint: "今年 1 月 1 日到今天" },
  { id: "all", zh: "全部", en: "All time", hint: "从 2019 年到今天" },
  { id: "custom", zh: "自定义", en: "Custom range", hint: "自己填起止日期" },
];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function previewRange(
  preset: DatePreset,
  fromDate: string,
  toDate: string,
): { from: string; to: string } {
  const to = startOfDay();
  if (preset === "today") return { from: ymd(to), to: ymd(to) };
  if (preset === "yesterday") {
    const y = addDays(to, -1);
    return { from: ymd(y), to: ymd(y) };
  }
  if (preset === "last7") return { from: ymd(addDays(to, -6)), to: ymd(to) };
  if (preset === "last30") return { from: ymd(addDays(to, -29)), to: ymd(to) };
  if (preset === "last90") return { from: ymd(addDays(to, -89)), to: ymd(to) };
  if (preset === "ytd")
    return { from: ymd(new Date(to.getFullYear(), 0, 1)), to: ymd(to) };
  if (preset === "all") return { from: "2019-01-01", to: ymd(to) };
  return { from: fromDate, to: toDate };
}

function statusZh(s: PwJobStatus["status"]): string {
  if (s === "ok") return "成功";
  if (s === "failed") return "失败";
  if (s === "running") return "运行中";
  if (s === "starting") return "启动中";
  return "未运行";
}

function statusTone(s: PwJobStatus["status"] | string): string {
  if (s === "ok") return "ok";
  if (s === "failed") return "fail";
  if (s === "running" || s === "starting") return "run";
  return "idle";
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function fmtDur(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} 分 ${r} 秒` : `${m} 分`;
}

function statusLogZh(s: string): string {
  if (s === "ok") return "成功";
  if (s === "failed") return "失败";
  if (s === "running" || s === "starting") return "运行中";
  return s;
}

function sessionLevelZh(level: string): string {
  if (level === "ok") return "有效";
  if (level === "expiring") return "即将过期";
  if (level === "expired") return "已过期";
  if (level === "missing") return "未登录";
  if (level === "unknown") return "会话 cookie";
  return level;
}

type Props = { onExit: () => void; shops?: ShopInfo[] };

function shopsFromResponse(r: { data?: { shops?: ShopInfo[] } | ShopInfo[] }): ShopInfo[] {
  const d = r.data;
  if (Array.isArray(d)) return d.filter((s) => s && s.id);
  if (d && Array.isArray(d.shops)) return d.shops.filter((s) => s && s.id);
  return [];
}

export function PwStudioPage({ onExit, shops: shopsFromApp = [] }: Props) {
  const [tab, setTab] = useState<Tab>("ads");
  const [shops, setShops] = useState<ShopInfo[]>(shopsFromApp);
  const [shopIds, setShopIds] = useState<string[]>(() =>
    shopsFromApp.map((s) => s.id),
  );
  const [jobs, setJobs] = useState<PwJobStatus[]>([]);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [adsPreset, setAdsPreset] = useState<DatePreset>("yesterday");
  const [salesPreset, setSalesPreset] = useState<DatePreset>("last90");
  const [adsFrom, setAdsFrom] = useState(() => ymd(addDays(startOfDay(), -1)));
  const [adsTo, setAdsTo] = useState(() => ymd(addDays(startOfDay(), -1)));
  const [salesFrom, setSalesFrom] = useState(() => ymd(addDays(startOfDay(), -89)));
  const [salesTo, setSalesTo] = useState(() => ymd(startOfDay()));
  const [kaAds, setKaAds] = useState(true);
  const [kaSeller, setKaSeller] = useState(true);
  const [session, setSession] = useState<PwSessionStatus | null>(null);
  const [schedules, setSchedules] = useState<PwExportSchedule[]>([]);
  const [adsEvery, setAdsEvery] = useState(24);
  const [salesEvery, setSalesEvery] = useState(24);
  const [logs, setLogs] = useState<PwRunLogSummary[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logJob, setLogJob] = useState<"" | "ads" | "sales">("");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [detail, setDetail] = useState<PwRunLogDetail | null>(null);

  const adsWindow = useMemo(
    () => previewRange(adsPreset, adsFrom, adsTo),
    [adsPreset, adsFrom, adsTo],
  );
  const salesWindow = useMemo(
    () => previewRange(salesPreset, salesFrom, salesTo),
    [salesPreset, salesFrom, salesTo],
  );

  async function refreshJobs() {
    const r = await api.listPwJobs();
    setJobs(r.data);
  }

  async function refreshSession() {
    const r = await api.getPwSessionStatus();
    setSession(r.data);
    // 默认只勾选需要登录的后台，避免一次开两个窗互相打断
    const ads = r.data.sites.find((s) => s.site === "ads");
    const seller = r.data.sites.find((s) => s.site === "seller");
    const adsNeed =
      ads?.level === "missing" ||
      ads?.level === "expired" ||
      ads?.level === "expiring";
    const sellerNeed =
      seller?.level === "missing" ||
      seller?.level === "expired" ||
      seller?.level === "expiring";
    if (adsNeed || sellerNeed) {
      setKaAds(Boolean(adsNeed));
      setKaSeller(Boolean(sellerNeed));
    }
  }

  async function refreshSchedules() {
    const r = await api.listPwSchedules();
    setSchedules(r.data);
    const ads = r.data.find((s) => s.job === "ads");
    const sales = r.data.find((s) => s.job === "sales");
    if (ads?.everyMs) setAdsEvery(Math.max(1, Math.round(ads.everyMs / 3600000)));
    if (sales?.everyMs)
      setSalesEvery(Math.max(1, Math.round(sales.everyMs / 3600000)));
  }

  async function refreshLogs() {
    const r = await api.listPwRunLogs({
      job: logJob || undefined,
      from: logFrom ? `${logFrom}T00:00:00` : undefined,
      to: logTo ? `${logTo}T23:59:59` : undefined,
      limit: 20,
    });
    setLogs(r.data.items);
    setLogTotal(r.data.total);
  }

  function applyShopList(list: ShopInfo[]) {
    setShops(list);
    setShopIds((prev) => {
      const ids = list.map((s) => s.id);
      if (!prev.length) return ids;
      const keep = prev.filter((id) => ids.includes(id));
      return keep.length ? keep : ids;
    });
  }

  useEffect(() => {
    if (shopsFromApp.length) applyShopList(shopsFromApp);
  }, [shopsFromApp]);

  useEffect(() => {
    api
      .getShops()
      .then((r) => {
        const list = shopsFromResponse(r);
        if (!list.length) {
          if (!shopsFromApp.length) {
            setError("店铺列表是空的。请返回慧运营看顶栏有没有店，再刷新进工作台。");
          }
          return;
        }
        applyShopList(list);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "加载店铺失败"),
      );
    refreshJobs().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "读取任务状态失败"),
    );
    refreshSession().catch(() => undefined);
    refreshSchedules().catch(() => undefined);
    const id = setInterval(() => {
      refreshJobs().catch(() => undefined);
    }, 2000);
    const sid = setInterval(() => {
      refreshSession().catch(() => undefined);
    }, 60_000);
    return () => {
      clearInterval(id);
      clearInterval(sid);
    };
  }, []);

  useEffect(() => {
    refreshLogs().catch(() => undefined);
    const id = setInterval(() => {
      refreshLogs().catch(() => undefined);
    }, 4000);
    return () => clearInterval(id);
  }, [logJob, logFrom, logTo]);

  const byJob = (name: PwJobName) => jobs.find((j) => j.job === name);
  const busy = jobs.some((j) => j.status === "running" || j.status === "starting");

  function toggleShop(id: string) {
    setShopIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function run(job: PwJobName, cmd: "ui" | "login" = "ui") {
    setError("");
    setHint("");
    try {
      const body: Parameters<typeof api.runPwJob>[1] = {
        shopIds: shopIds.length ? shopIds : undefined,
        cmd,
      };
      if (job === "ads" && cmd === "ui") {
        body.range = adsPreset;
        body.fromDate = adsWindow.from;
        body.toDate = adsWindow.to;
      }
      if (job === "sales" && cmd === "ui") {
        body.range = salesPreset;
        body.fromDate = salesWindow.from;
        body.toDate = salesWindow.to;
      }
      if (job === "keepalive") {
        if (cmd === "login") {
          // 统一一次登录始终覆盖广告+卖家
          body.targets = ["ads", "seller"];
        } else {
          const targets: Array<"ads" | "seller"> = [];
          if (kaAds) targets.push("ads");
          if (kaSeller) targets.push("seller");
          body.targets = targets.length ? targets : ["ads", "seller"];
        }
      }
      const r = await api.runPwJob(job, body);
      setHint(r.meta?.hint || r.data.message || "");
      await refreshJobs();
      await refreshLogs();
      if (job === "keepalive" || cmd === "login") {
        await refreshSession().catch(() => undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败");
    }
  }

  async function saveSchedule(job: "ads" | "sales", enabled: boolean) {
    setError("");
    try {
      const preset = job === "ads" ? adsPreset : salesPreset;
      const win = job === "ads" ? adsWindow : salesWindow;
      await api.savePwSchedule(job, {
        enabled,
        everyHours: job === "ads" ? adsEvery : salesEvery,
        range: preset,
        shopIds,
        fromDate: win.from,
        toDate: win.to,
      });
      await refreshSchedules();
      setHint(enabled ? "定时已打开（用当前日期和店铺）" : "定时已关闭");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存定时失败");
    }
  }

  const adsSched = schedules.find((s) => s.job === "ads");
  const salesSched = schedules.find((s) => s.job === "sales");

  return (
    <div className="pws">
      <div className="pws-bg" aria-hidden>
        <div className="pws-orb pws-orb-a" />
        <div className="pws-orb pws-orb-b" />
        <div className="pws-grain" />
      </div>

      <header className="pws-top">
        <div className="pws-brand">
          <span className="pws-mark" />
          <div>
            <p className="pws-kicker">与慧运营业务页分开 · 只管爬虫</p>
            <h1 className="pws-title">爬虫工作台</h1>
          </div>
        </div>
        <button className="pws-exit" type="button" onClick={onExit}>
          返回慧运营
        </button>
      </header>

      <ol className="pws-howto">
        <li>先选店铺（可多选）。开始跑后会按店切 Noon 后台，各自落盘入库</li>
        <li>点下方三条链路之一，改日期或查看登录态</li>
        <li>点「开始跑」会弹出 Chromium；某店失败不影响已成功店入库</li>
        <li>
          登录态过期时点「一次登录」：同窗完成 OTP，自动覆盖广告+卖家，勿关
          Chrome
        </li>
      </ol>

      {error ? <p className="pws-alert">{error}</p> : null}
      {hint ? <p className="pws-hint">{hint}</p> : null}
      {session?.needsAttention ? (
        <p className="pws-alert">
          登录态需要处理：{session.summary}
          {" · "}
          <button
            type="button"
            className="pws-linkish"
            onClick={() => setTab("keepalive")}
          >
            去登录态页
          </button>
        </p>
      ) : null}

      <section className="pws-shops">
        <span className="pws-label">对哪些店跑</span>
        {shops.length === 0 ? (
          <p className="pws-empty-shops">
            还没拉到店铺（HUI / HFY / Glam Bag / mmm 应出现在这里）。返回慧运营看顶栏店铺，或刷新后再进。
          </p>
        ) : (
          <div className="pws-chips">
            {shops.map((s) => {
              const on = shopIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`pws-chip${on ? " on" : ""}`}
                  onClick={() => toggleShop(s.id)}
                >
                  {s.name || s.projectCode || s.id}
                  <span className="pws-chip-id">
                    {s.projectCode && s.projectCode !== s.name ? s.projectCode : s.id}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <nav className="pws-tabs" aria-label="三条链路">
        <TabBtn
          id="ads"
          current={tab}
          label="广告导出"
          sub="Ad Manager 花费表"
          job={byJob("ads")}
          onClick={setTab}
        />
        <TabBtn
          id="sales"
          current={tab}
          label="销量导出"
          sub="Seller Lab 销量表"
          job={byJob("sales")}
          onClick={setTab}
        />
        <TabBtn
          id="keepalive"
          current={tab}
          label="登录态"
          sub={
            session?.needsAttention
              ? "需重新登录"
              : session
                ? "查看过期时间"
                : "cookie 状态"
          }
          job={byJob("keepalive")}
          onClick={setTab}
        />
      </nav>

      {tab === "ads" ? (
        <article className="pws-card">
          <h2>广告导出</h2>
          <p className="pws-card-desc">
            打开 Noon <strong>广告后台 Ad Manager</strong>，按你选的日期点下拉（和门户里
            Today / Yesterday / Last 30 days 那些选项是同一套），导出 Campaign
            Overview，再灌进慧运营广告页。
          </p>
          <span className="pws-label">改这里 = 改爬虫要点的日期</span>
          <DatePresets
            value={adsPreset}
            onChange={setAdsPreset}
            fromDate={adsFrom}
            toDate={adsTo}
            onFrom={setAdsFrom}
            onTo={setAdsTo}
            window={adsWindow}
          />
          <div className="pws-actions">
            <button
              className="pws-btn primary"
              type="button"
              disabled={busy || shopIds.length === 0}
              onClick={() => void run("ads")}
            >
              开始导出广告
            </button>
            <button
              className="pws-btn"
              type="button"
              disabled={busy}
              onClick={() => {
                setTab("keepalive");
                void run("keepalive", "login");
              }}
            >
              未登录：一次登录（广告+卖家）
            </button>
          </div>
          <JobLine job={byJob("ads")} />
          <ScheduleBox
            enabled={Boolean(adsSched?.enabled)}
            everyHours={adsEvery}
            onEvery={setAdsEvery}
            last={adsSched}
            onSave={(on) => void saveSchedule("ads", on)}
          />
        </article>
      ) : null}

      {tab === "sales" ? (
        <article className="pws-card">
          <h2>销量导出</h2>
          <p className="pws-card-desc">
            打开 Noon <strong>卖家后台 Seller Lab · Sales</strong>，用你选的起止日期深链进入，点
            Export → New export，再点文件名旁边的下载链接。导完清洗成
            Delivered / Processing / Shipped，灌进补货页销量表。
          </p>
          <span className="pws-label">改这里 = 改销量查询的起止日</span>
          <DatePresets
            value={salesPreset}
            onChange={setSalesPreset}
            fromDate={salesFrom}
            toDate={salesTo}
            onFrom={setSalesFrom}
            onTo={setSalesTo}
            window={salesWindow}
          />
          <div className="pws-actions">
            <button
              className="pws-btn primary"
              type="button"
              disabled={busy || shopIds.length === 0}
              onClick={() => void run("sales")}
            >
              开始导出销量
            </button>
            <button
              className="pws-btn"
              type="button"
              disabled={busy}
              onClick={() => {
                setTab("keepalive");
                void run("keepalive", "login");
              }}
            >
              未登录：一次登录（广告+卖家）
            </button>
          </div>
          <JobLine job={byJob("sales")} />
          <ScheduleBox
            enabled={Boolean(salesSched?.enabled)}
            everyHours={salesEvery}
            onEvery={setSalesEvery}
            last={salesSched}
            onSave={(on) => void saveSchedule("sales", on)}
          />
        </article>
      ) : null}

      {tab === "keepalive" ? (
        <article className="pws-card">
          <h2>登录态</h2>
          <p className="pws-card-desc">
            同一个 Noon
            伙伴账号。点「打开登录窗口」只弹一个
            Chrome：先完成广告 OTP，同窗再进卖家（一般不用再收验证码），确认两边都能进后写入两套
            cookie，并无头复测——复测不过不算成功。导出仍分广告/销量两套档案，避免并发抢浏览器。
          </p>
          <div className="pws-session-list">
            {(session?.sites ?? []).map((s) => (
              <div key={s.site} className={`pws-session-row ${s.level}`}>
                <strong>{s.label}</strong>
                <em>{sessionLevelZh(s.level)}</em>
                <span>{s.message}</span>
                <span className="pws-session-meta">
                  最早过期：{fmtWhen(s.earliestExpiresAt)}
                  {" · "}
                  文件更新：{fmtWhen(s.stateMtime)}
                </span>
              </div>
            ))}
            {!session ? (
              <p className="pws-card-desc">正在读取登录态…</p>
            ) : null}
          </div>
          <span className="pws-label">软探测范围（登录始终覆盖两边）</span>
          <div className="pws-chips">
            <button
              type="button"
              className={`pws-chip${kaAds ? " on" : ""}`}
              onClick={() => setKaAds((v) => !v)}
            >
              广告后台 Ad Manager
            </button>
            <button
              type="button"
              className={`pws-chip${kaSeller ? " on" : ""}`}
              onClick={() => setKaSeller((v) => !v)}
            >
              卖家后台 Seller Lab
            </button>
          </div>
          <div className="pws-actions">
            <button
              className="pws-btn primary"
              type="button"
              disabled={busy}
              onClick={() => void run("keepalive", "login")}
            >
              打开登录窗口（一次两边）
            </button>
            <button
              className="pws-btn"
              type="button"
              disabled={busy || (!kaAds && !kaSeller)}
              onClick={() => void run("keepalive", "ui")}
              title="先查本地 cookie，再短时无头探一下；约一分钟内必结束，不会一直转"
            >
              软探测（不弹窗）
            </button>
            <button
              className="pws-btn"
              type="button"
              onClick={() => void refreshSession()}
            >
              重新检查
            </button>
          </div>
          <JobLine job={byJob("keepalive")} />
        </article>
      ) : null}

      <section className="pws-card pws-log-card">
        <h2>运行日志</h2>
        <p className="pws-card-desc">
          只记广告导出、销量导出。列表是最近 20 条；点一行看全文（口径、筛选、控制台输出）。
        </p>
        <div className="pws-log-filters">
          <label>
            链路
            <select
              value={logJob}
              onChange={(e) =>
                setLogJob(e.target.value as "" | "ads" | "sales")
              }
            >
              <option value="">全部</option>
              <option value="ads">广告导出</option>
              <option value="sales">销量导出</option>
            </select>
          </label>
          <label>
            从
            <ClearableInput
              type="date"
              value={logFrom}
              onChange={(e) => setLogFrom(e.target.value)}
            />
          </label>
          <label>
            到
            <ClearableInput
              type="date"
              value={logTo}
              onChange={(e) => setLogTo(e.target.value)}
            />
          </label>
          <button
            className="pws-btn"
            type="button"
            onClick={() => {
              setLogFrom("");
              setLogTo("");
              setLogJob("");
            }}
          >
            清除筛选
          </button>
        </div>
        <p className="pws-window">
          显示 {logs.length} 条
          {logTotal > logs.length ? `（筛选命中 ${logTotal}）` : null}
        </p>
        <div className="pws-log-table">
          {logs.length === 0 ? (
            <p className="pws-line muted">还没有记录。跑一次导出后会出现。</p>
          ) : (
            logs.map((row) => (
              <button
                key={row.runId}
                type="button"
                className="pws-log-row"
                onClick={() => {
                  api
                    .getPwRunLog(row.runId)
                    .then((r) => setDetail(r.data))
                    .catch((e: Error) => setError(e.message));
                }}
              >
                <span className={`pws-pill ${statusTone(row.status)}`}>
                  {statusLogZh(row.status)}
                </span>
                <strong>{row.jobLabel}</strong>
                <span>
                  {row.口径.rangeLabel || row.口径.range}
                  {row.口径.fromDate
                    ? ` · ${row.口径.fromDate} → ${row.口径.toDate}`
                    : ""}
                </span>
                <span>
                  {row.filters.shopIds.length
                    ? row.filters.shopIds.join("、")
                    : "默认两店"}
                </span>
                <span>{fmtWhen(row.startedAt)}</span>
                <span>{fmtDur(row.durationMs)}</span>
              </button>
            ))
          )}
        </div>
      </section>

      {detail ? (
        <div
          className="pws-drawer-bg"
          onClick={() => setDetail(null)}
          role="presentation"
        >
          <aside
            className="pws-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="运行日志详情"
          >
            <header>
              <h3>
                {detail.jobLabel} · {statusLogZh(detail.status)}
              </h3>
              <button
                className="pws-btn"
                type="button"
                onClick={() => setDetail(null)}
              >
                关闭
              </button>
            </header>
            <dl className="pws-dl">
              <div>
                <dt>链路</dt>
                <dd>{detail.jobLabel}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{statusLogZh(detail.status)}</dd>
              </div>
              <div>
                <dt>导出口径</dt>
                <dd>
                  {detail.口径.rangeLabel}（{detail.口径.range}）
                  <br />
                  {detail.口径.fromDate} → {detail.口径.toDate}
                </dd>
              </div>
              <div>
                <dt>筛选项</dt>
                <dd>
                  店铺：
                  {detail.filters.shopIds.length
                    ? detail.filters.shopIds.join("、")
                    : "未指定（默认两店）"}
                  <br />
                  命令：{detail.filters.cmd} · 触发：
                  {detail.trigger === "schedule" ? "定时" : "手动"}
                </dd>
              </div>
              <div>
                <dt>运行时间</dt>
                <dd>
                  开始 {fmtWhen(detail.startedAt)}
                  <br />
                  结束 {fmtWhen(detail.finishedAt)}
                  <br />
                  耗时 {fmtDur(detail.durationMs)}
                </dd>
              </div>
              <div>
                <dt>结果说明</dt>
                <dd>{detail.message || "—"}</dd>
              </div>
            </dl>
            <p className="pws-label">控制台全文</p>
            <pre className="pws-pre">{detail.stdout || "（无输出）"}</pre>
          </aside>
        </div>
      ) : null}

      <p className="pws-foot">
        市场情报 / 耗材（买家商城 www.noon.com）不在本页，仍走影刀。库存走
        Impex，不要在这里做爬虫。
      </p>
    </div>
  );
}

function TabBtn({
  id,
  current,
  label,
  sub,
  job,
  onClick,
}: {
  id: Tab;
  current: Tab;
  label: string;
  sub: string;
  job?: PwJobStatus;
  onClick: (t: Tab) => void;
}) {
  const s = job?.status ?? "idle";
  return (
    <button
      type="button"
      className={`pws-tab${current === id ? " on" : ""}`}
      onClick={() => onClick(id)}
    >
      <strong>{label}</strong>
      <span>{sub}</span>
      <em className={statusTone(s)}>{statusZh(s)}</em>
    </button>
  );
}

function DatePresets({
  value,
  onChange,
  fromDate,
  toDate,
  onFrom,
  onTo,
  window,
}: {
  value: DatePreset;
  onChange: (v: DatePreset) => void;
  fromDate: string;
  toDate: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  window: { from: string; to: string };
}) {
  return (
    <>
      <div className="pws-presets">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.hint}
            className={`pws-preset${value === p.id ? " on" : ""}`}
            onClick={() => onChange(p.id)}
          >
            <em>{p.zh}</em>
            <span>{p.en}</span>
          </button>
        ))}
      </div>
      {value === "custom" ? (
        <div className="pws-custom">
          <label>
            开始日期
            <ClearableInput
              type="date"
              value={fromDate}
              onChange={(e) => onFrom(e.target.value)}
            />
          </label>
          <label>
            结束日期
            <ClearableInput
              type="date"
              value={toDate}
              onChange={(e) => onTo(e.target.value)}
            />
          </label>
        </div>
      ) : null}
      <p className="pws-window">
        将按 <code>{window.from}</code> 到 <code>{window.to}</code> 去拉表
      </p>
    </>
  );
}

function JobLine({ job }: { job?: PwJobStatus }) {
  if (!job?.message && !job?.runId) {
    return <p className="pws-line muted">还没跑过。点上面的开始按钮。</p>;
  }
  return (
    <p className="pws-line">
      最近一次：{statusZh(job.status)} · {job.message}
    </p>
  );
}

function ScheduleBox({
  enabled,
  everyHours,
  onEvery,
  last,
  onSave,
}: {
  enabled: boolean;
  everyHours: number;
  onEvery: (n: number) => void;
  last?: PwExportSchedule;
  onSave: (enabled: boolean) => void;
}) {
  return (
    <div className="pws-sched">
      <span className="pws-label">定时任务</span>
      <p className="pws-card-desc">
        打开后按间隔自动导出，口径和店铺用你现在页面上选的。默认关。
      </p>
      <div className="pws-sched-row">
        <label>
          每隔
          <select
            value={everyHours}
            onChange={(e) => onEvery(Number(e.target.value))}
          >
            <option value={6}>6 小时</option>
            <option value={12}>12 小时</option>
            <option value={24}>24 小时</option>
          </select>
        </label>
        <button
          className={`pws-btn${enabled ? "" : " primary"}`}
          type="button"
          onClick={() => onSave(!enabled)}
        >
          {enabled ? "关闭定时" : "打开定时"}
        </button>
      </div>
      <p className="pws-line">
        现在：{enabled ? "已开启" : "已关闭"}
        {last?.timerActive ? " · 计时器在跑" : ""}
        {last?.lastRunAt ? ` · 上次 ${fmtWhen(last.lastRunAt)}` : ""}
        {last?.lastMessage ? ` · ${last.lastMessage}` : ""}
      </p>
    </div>
  );
}
