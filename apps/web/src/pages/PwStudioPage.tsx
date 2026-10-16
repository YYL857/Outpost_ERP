import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type AdsBudgetBaselineRow,
  type AdsBudgetLastRun,
  type AdsBudgetRunCampaignChange,
  type AdsBudgetRunRow,
  type AdsBudgetScheduleStatus,
  type PwExportSchedule,
  type PwJobName,
  type PwJobStatus,
  type PwRunLogDetail,
  type PwRunLogSummary,
  type PwSessionStatus,
  type ShopInfo,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";
import { ProductCell } from "../components/ProductCell";
import "./pw-studio.css";

type BudgetCatalogHit = { title: string; imageUrl: string };

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

/** 改 Noon 预算 / 刷新基准：仅试店；其他店只开放「同步列表」记录 */
const ADS_BUDGET_PILOT_SHOP = "PRJ488078";

/** 与 Python OFFPEAK_BUDGET_FLOOR / API defaultOffpeakBudget 一致 */
const DEFAULT_OFFPEAK_BUDGET = 5;

/** 广告/销量导出定时默认只跑前两家老店 */
const DEFAULT_EXPORT_SHOP_IDS = ["PRJ396770", "PRJ482387"] as const;

function budgetModeZh(mode: string): string {
  const m = (mode || "").toLowerCase();
  if (m === "peak") return "高峰";
  if (m === "offpeak") return "低峰";
  if (m === "idle") return "空闲";
  if (m === "unknown" || !m) return "未知";
  return mode;
}

function budgetSourceZh(by: string): string {
  const b = (by || "").toLowerCase();
  if (b === "ui") return "前端";
  if (b === "ui-import") return "导入表格";
  if (b === "calc") return "计算";
  if (b === "sync-refresh") return "页面导入";
  if (b === "sync-offline") return "同步未见Live";
  if (b === "sync") return "同步";
  if (b === "apply") return "应用任务";
  if (!b) return "—";
  return by;
}

/** baseline.psku 可能带前导 `-` 或中文后缀；生成 Catalog 查找候选键 */
function budgetPskuLookupKeys(raw: string): string[] {
  const s = (raw || "").trim().toUpperCase();
  if (!s) return [];
  const keys: string[] = [];
  const push = (k: string) => {
    if (k && !keys.includes(k)) keys.push(k);
  };
  push(s);
  const stripped = s.replace(/^[^A-Z0-9]+/, "");
  push(stripped);
  const m = stripped.match(/^([A-Z0-9]+)/);
  if (m) push(m[1]);
  if (stripped.includes("-")) push(stripped.split("-", 1)[0] || "");
  return keys;
}

/** 像正式 PSKU（字母+数字），不是「Kaza品牌广告」这类活动名碎片 */
function looksLikePartnerSku(raw: string): boolean {
  const token = (raw || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6,40}$/.test(token)) return false;
  return /[A-Z]/.test(token) && /\d/.test(token);
}

function budgetDisplayPsku(raw: string): string {
  for (const key of budgetPskuLookupKeys(raw)) {
    if (looksLikePartnerSku(key)) return key;
  }
  return "";
}

/** 去掉 Noon 活动名尾部日期/targeting 赘词，便于作标题 */
function shortCampaignTitle(name: string): string {
  const s = (name || "").trim();
  if (!s) return "";
  const cut = s
    .replace(/\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b.*$/i, "")
    .replace(/\s+-\s+(No end date|Manual targeting|Auto targeting).*$/i, "")
    .trim();
  return cut || s;
}

function csvEscapeCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 用户点击触发的浏览器下载（局域网 HTTP 可用，不依赖服务器本机路径） */
function downloadTextFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/** 与后端一致的简易 CSV 行解析（支持引号） */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseBudgetImportCsv(text: string): Array<{
  campaignId: string;
  baselineBudget?: number | null;
  offpeakBudget?: number | null;
  enabled?: boolean;
  psku?: string;
  campaignName?: string;
}> {
  const raw = text.replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (aliases: string[]) => {
    const set = new Set(aliases.map((a) => a.toLowerCase()));
    return headers.findIndex((h) => set.has(h.toLowerCase()));
  };
  const iCid = idx(["campaignId", "活动编号"]);
  const iPeak = idx(["高峰预算", "baselineBudget", "peak"]);
  const iOff = idx(["低峰预算", "offpeakBudget", "offpeak"]);
  const iEn = idx(["启用", "enabled"]);
  const iPsku = idx(["psku", "货号"]);
  const iName = idx(["campaignName", "活动名"]);
  if (iCid < 0) {
    throw new Error("CSV 缺少 campaignId / 活动编号 列（请用「导出表格」同款格式）");
  }
  const parseNumCell = (v: string): number | null | undefined => {
    const s = (v ?? "").trim();
    if (s === "") return null;
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };
  const out: Array<{
    campaignId: string;
    baselineBudget?: number | null;
    offpeakBudget?: number | null;
    enabled?: boolean;
    psku?: string;
    campaignName?: string;
  }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const campaignId = String(cols[iCid] || "").trim();
    if (!campaignId) continue;
    const row: (typeof out)[number] = { campaignId };
    if (iPeak >= 0) {
      const n = parseNumCell(cols[iPeak] ?? "");
      if (n !== undefined) row.baselineBudget = n;
    }
    if (iOff >= 0) {
      const n = parseNumCell(cols[iOff] ?? "");
      if (n !== undefined) row.offpeakBudget = n;
    }
    if (iEn >= 0) {
      const s = String(cols[iEn] ?? "")
        .trim()
        .toLowerCase();
      if (s !== "") {
        row.enabled = ["1", "true", "yes", "y", "on"].includes(s);
      }
    }
    if (iPsku >= 0 && String(cols[iPsku] || "").trim()) {
      row.psku = String(cols[iPsku]).trim();
    }
    if (iName >= 0 && String(cols[iName] || "").trim()) {
      row.campaignName = String(cols[iName]).trim();
    }
    out.push(row);
  }
  return out;
}

function defaultExportShopIds(list: ShopInfo[]): string[] {
  const ids = new Set(list.map((s) => s.id));
  const preferred = DEFAULT_EXPORT_SHOP_IDS.filter((id) => ids.has(id));
  return preferred.length ? [...preferred] : list.slice(0, 2).map((s) => s.id);
}

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

/** 预算运行：人话标题（一眼知道在干什么） */
function budgetRunTitle(row: {
  cmd?: string;
  mode?: string;
  dryRun?: boolean;
}): string {
  const dry = row.dryRun ? "（干跑预览，未改 Noon）" : "";
  const cmd = (row.cmd || "").toLowerCase();
  const mode = (row.mode || "").toLowerCase();
  if (cmd === "apply" && mode === "peak") {
    return `高峰回调：Live 预算拉回权威表目标${dry}`;
  }
  if (cmd === "apply" && mode === "offpeak") {
    return `低峰压预算：Live 预算压到低峰值（默认 5）${dry}`;
  }
  if (cmd === "apply") return `应用预算变更（${mode || "auto"}）${dry}`;
  if (cmd === "sync") {
    return mode === "peak" && dry === ""
      ? "同步列表：刷新页面现状（不改目标）"
      : `同步列表（${mode || "观测"}）`;
  }
  if (cmd === "probe") return "探针：只读 Live 样例，不改预算";
  return `${cmd || "任务"} / ${mode || "—"}`;
}

function budgetTriggerZh(trigger?: string): string {
  const t = (trigger || "manual").trim();
  if (t === "schedule:peak" || t === "schedule") return "定时 · 峰期";
  if (t === "schedule:offpeak") return "定时 · 低峰";
  if (t.startsWith("schedule:")) return `定时 · ${t.slice("schedule:".length)}`;
  if (t === "manual") return "手工触发";
  if (t.startsWith("manual")) return `手工 · ${t.replace(/^manual-?/, "") || "触发"}`;
  return t;
}

function budgetModeChip(mode?: string): string {
  const m = (mode || "").toLowerCase();
  if (m === "peak") return "峰期";
  if (m === "offpeak") return "低峰";
  if (m === "auto") return "自动";
  return m || "—";
}

function extractBudgetCampaignChanges(
  row: AdsBudgetRunRow,
): AdsBudgetRunCampaignChange[] {
  const out: AdsBudgetRunCampaignChange[] = [];
  const shops = row.results;
  if (!Array.isArray(shops)) return out;
  for (const shop of shops) {
    if (!shop || typeof shop !== "object") continue;
    if (shop.error && !shop.results?.length && !shop.skippedDetail?.length) {
      out.push({ ok: false, error: String(shop.error) });
      continue;
    }
    for (const sk of shop.skippedDetail || []) {
      out.push({
        ...sk,
        skip: true,
        target: sk.target ?? sk.to ?? null,
      });
    }
    for (const r of shop.results || []) {
      out.push({
        ...r,
        target: r.target ?? r.to ?? null,
      });
    }
  }
  return out;
}

function fmtBudgetNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return String(n);
}

/** 列表短标题，避免卡片堆成一片长句 */
function budgetRunTitleShort(row: {
  cmd?: string;
  mode?: string;
  dryRun?: boolean;
}): string {
  const dry = row.dryRun ? "·干跑" : "";
  const cmd = (row.cmd || "").toLowerCase();
  const mode = (row.mode || "").toLowerCase();
  if (cmd === "apply" && mode === "peak") return `高峰回调${dry}`;
  if (cmd === "apply" && mode === "offpeak") return `低峰压预算${dry}`;
  if (cmd === "apply") return `改预算·${budgetModeChip(mode)}${dry}`;
  if (cmd === "sync") return `同步列表${dry}`;
  if (cmd === "probe") return "探针";
  return `${cmd || "任务"}·${budgetModeChip(mode)}`;
}

type BudgetRunGroup = {
  key: string;
  primary: AdsBudgetRunRow;
  /** 紧挨着的同类失败，已折叠 */
  collapsedFails: AdsBudgetRunRow[];
};

function budgetRunCollapseSig(row: AdsBudgetRunRow): string {
  return [
    row.ok ? "ok" : "fail",
    (row.cmd || "").toLowerCase(),
    (row.mode || "").toLowerCase(),
    (row.trigger || "manual").trim(),
  ].join("|");
}

/** 连续同类失败合成一条，避免重试风暴刷屏 */
function collapseBudgetRunGroups(rows: AdsBudgetRunRow[]): BudgetRunGroup[] {
  const groups: BudgetRunGroup[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const sig = budgetRunCollapseSig(row);
    const prev = groups[groups.length - 1];
    if (prev && !row.ok && !prev.primary.ok && budgetRunCollapseSig(prev.primary) === sig) {
      prev.collapsedFails.push(row);
      continue;
    }
    groups.push({
      key: `${row.finishedAt || i}-${sig}`,
      primary: row,
      collapsedFails: [],
    });
  }
  return groups;
}

const BUDGET_RUNS_PAGE = 6;

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
    defaultExportShopIds(shopsFromApp),
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
  const [adsDailyAt, setAdsDailyAt] = useState("17:00");
  const [salesDailyAt, setSalesDailyAt] = useState("17:20");
  const [logs, setLogs] = useState<PwRunLogSummary[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logJob, setLogJob] = useState<"" | "ads" | "sales">("");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [detail, setDetail] = useState<PwRunLogDetail | null>(null);
  const [budgetSched, setBudgetSched] = useState<AdsBudgetScheduleStatus | null>(
    null,
  );
  const [budgetLast, setBudgetLast] = useState<AdsBudgetLastRun>(null);
  const [budgetRuns, setBudgetRuns] = useState<AdsBudgetRunRow[]>([]);
  const [budgetRunsTotal, setBudgetRunsTotal] = useState(0);
  const [budgetRunOpen, setBudgetRunOpen] = useState<string | null>(null);
  const [budgetRunsExpanded, setBudgetRunsExpanded] = useState(false);
  const [budgetRows, setBudgetRows] = useState<AdsBudgetBaselineRow[]>([]);
  /** Catalog 按 PSKU 对齐：标题 / 图（只读展示，不进 baseline.csv） */
  const [budgetCatalogBySku, setBudgetCatalogBySku] = useState<
    Record<string, BudgetCatalogHit>
  >({});
  /** 编辑中的高峰/低峰：campaignId → 输入串 */
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>({});
  const [budgetOffpeakDrafts, setBudgetOffpeakDrafts] = useState<
    Record<string, string>
  >({});
  const [budgetSaving, setBudgetSaving] = useState<string | null>(null);
  /** 刚保存成功的行，用于行内确认感 */
  const [budgetSavedFlash, setBudgetSavedFlash] = useState<string | null>(null);
  const [budgetTableMsg, setBudgetTableMsg] = useState("");
  const [newCid, setNewCid] = useState("");
  const [newPsku, setNewPsku] = useState("");
  const [newBaseline, setNewBaseline] = useState("");
  const [newOffpeak, setNewOffpeak] = useState(String(DEFAULT_OFFPEAK_BUDGET));
  const [budgetPskuQ, setBudgetPskuQ] = useState("");
  /** 默认隐藏已停用（含同步时不在 Live 的） */
  const [budgetShowDisabled, setBudgetShowDisabled] = useState(false);
  const [budgetImporting, setBudgetImporting] = useState(false);
  const budgetImportInputRef = useRef<HTMLInputElement | null>(null);

  /** 广告预算页当前查看/记录的店（单选） */
  const budgetShopId = shopIds[0] || ADS_BUDGET_PILOT_SHOP;
  const budgetCanChangeNoon = budgetShopId === ADS_BUDGET_PILOT_SHOP;
  const tabRef = useRef(tab);
  const budgetShopIdRef = useRef(budgetShopId);
  const budgetFetchSeqRef = useRef(0);
  tabRef.current = tab;
  budgetShopIdRef.current = budgetShopId;

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
    if (ads?.dailyAt) setAdsDailyAt(ads.dailyAt);
    if (sales?.dailyAt) setSalesDailyAt(sales.dailyAt);
    // 导出定时店铺 → 顶部芯片；预算页是单选，禁止被导出多店列表冲掉
    if (tabRef.current === "ads-budget") return;
    const fromSched =
      ads?.shopIds?.length ? ads.shopIds : sales?.shopIds?.length ? sales.shopIds : null;
    if (fromSched?.length) {
      setShopIds((prev) => {
        const next = fromSched.map((s) => s.trim().toUpperCase()).filter(Boolean);
        if (
          next.length === prev.length &&
          next.every((id, i) => id === prev[i])
        ) {
          return prev;
        }
        return next;
      });
    }
  }

  async function refreshBudgetCatalogMap(shopId?: string) {
    const sid = (
      shopId ||
      budgetShopIdRef.current ||
      ADS_BUDGET_PILOT_SHOP
    ).toUpperCase();
    try {
      // 按预算店读 Catalog，勿用顶栏当前店的 getCatalog
      const r = await api.getAdsBudgetProductMeta(sid);
      setBudgetCatalogBySku(r.data.byPsku || {});
    } catch {
      /* Catalog 可选：没有图/名仍展示 PSKU + 活动名 */
      setBudgetCatalogBySku({});
    }
  }

  async function refreshBudgetTable(shopId?: string) {
    const sid = (
      shopId ||
      budgetShopIdRef.current ||
      ADS_BUDGET_PILOT_SHOP
    ).toUpperCase();
    const seq = ++budgetFetchSeqRef.current;
    const r = await api.getAdsBudgetBaseline(sid);
    // 丢弃过期响应，避免标题已是 482387、表格却被首屏/轮询的 396770 盖回
    if (seq !== budgetFetchSeqRef.current) return;
    if (sid !== budgetShopIdRef.current.toUpperCase()) return;
    setBudgetRows(r.data.rows);
    const drafts: Record<string, string> = {};
    const offDrafts: Record<string, string> = {};
    const defaultOff =
      r.data.defaultOffpeakBudget ?? DEFAULT_OFFPEAK_BUDGET;
    for (const row of r.data.rows) {
      drafts[row.campaignId] =
        row.baselineBudget == null ? "" : String(row.baselineBudget);
      // 空低峰在输入框预填默认值，方便直接改；未保存前 dirty 以「空=默认」对齐
      offDrafts[row.campaignId] =
        row.offpeakBudget == null
          ? String(defaultOff)
          : String(row.offpeakBudget);
    }
    setBudgetDrafts(drafts);
    setBudgetOffpeakDrafts(offDrafts);
    void refreshBudgetCatalogMap(sid);
  }

  function budgetDraftOf(row: AdsBudgetBaselineRow): string {
    return budgetDrafts[row.campaignId] ?? "";
  }

  function budgetOffpeakDraftOf(row: AdsBudgetBaselineRow): string {
    return budgetOffpeakDrafts[row.campaignId] ?? String(DEFAULT_OFFPEAK_BUDGET);
  }

  function budgetSavedText(row: AdsBudgetBaselineRow): string {
    return row.baselineBudget == null ? "" : String(row.baselineBudget);
  }

  function budgetOffpeakSavedText(row: AdsBudgetBaselineRow): string {
    return row.offpeakBudget == null
      ? String(DEFAULT_OFFPEAK_BUDGET)
      : String(row.offpeakBudget);
  }

  function budgetRowDirty(row: AdsBudgetBaselineRow): boolean {
    return (
      budgetDraftOf(row).trim() !== budgetSavedText(row).trim() ||
      budgetOffpeakDraftOf(row).trim() !== budgetOffpeakSavedText(row).trim()
    );
  }

  function pageStatusText(row: AdsBudgetBaselineRow): string {
    const mode = budgetModeZh(row.mode);
    const seen =
      row.lastSeenBudget == null ? "—" : String(row.lastSeenBudget);
    return `${mode} · ${seen}`;
  }

  const budgetDisabledCount = useMemo(
    () => budgetRows.filter((r) => !r.enabled).length,
    [budgetRows],
  );

  const filteredBudgetRows = useMemo(() => {
    const q = budgetPskuQ.trim().toUpperCase();
    return budgetRows.filter((row) => {
      if (!budgetShowDisabled && !row.enabled) return false;
      if (!q) return true;
      const cid = (row.campaignId || "").toUpperCase();
      const hay = [
        row.psku,
        cid,
        cid.replace(/^C_/, ""),
        row.campaignName,
        ...budgetPskuLookupKeys(row.psku),
      ]
        .join(" ")
        .toUpperCase();
      return hay.includes(q) || cid.includes(q);
    });
  }, [budgetRows, budgetPskuQ, budgetShowDisabled]);

  /** 导出当前店权威表（含 Catalog 标题），方便和 Noon 页面对照 */
  function exportBudgetTableCsv() {
    if (!budgetRows.length) {
      setError("表空，无法导出。先同步列表或刷新表。");
      return;
    }
    const headers = [
      "shopId",
      "psku",
      "title",
      "campaignId",
      "campaignName",
      "高峰预算",
      "低峰预算",
      "页面模式",
      "页面预算",
      "启用",
      "写入来源",
      "更新时间",
    ];
    const lines = [headers.map(csvEscapeCell).join(",")];
    for (const row of budgetRows) {
      const hit = catalogHitFor(row.psku);
      const title =
        hit?.title || row.campaignName || row.psku || row.campaignId;
      const off =
        row.offpeakBudget == null
          ? DEFAULT_OFFPEAK_BUDGET
          : row.offpeakBudget;
      lines.push(
        [
          row.shopId || budgetShopId,
          row.psku,
          title,
          row.campaignId,
          row.campaignName,
          row.baselineBudget == null ? "" : row.baselineBudget,
          off,
          budgetModeZh(row.mode),
          row.lastSeenBudget == null ? "" : row.lastSeenBudget,
          row.enabled ? "1" : "0",
          budgetSourceZh(row.updatedBy),
          row.updatedAt || "",
        ]
          .map(csvEscapeCell)
          .join(","),
      );
    }
    const stamp = ymd(startOfDay());
    const filename = `ads-budget-${budgetShopId}-${stamp}.csv`;
    // BOM：Excel 直接打开中文不乱码
    downloadTextFile(
      filename,
      `\uFEFF${lines.join("\n")}\n`,
      "text/csv;charset=utf-8",
    );
    const msg = `已导出 ${budgetRows.length} 条到本机下载目录：${filename}`;
    setHint(msg);
    setBudgetTableMsg(msg);
    setError("");
  }

  async function importBudgetTableFromFile(file: File) {
    setBudgetImporting(true);
    setError("");
    setBudgetTableMsg("");
    try {
      const text = await file.text();
      const rows = parseBudgetImportCsv(text);
      if (!rows.length) {
        setError("CSV 没有可导入的行（需含 campaignId，且与导出表格同格式）");
        return;
      }
      if (
        !window.confirm(
          `将按活动编号更新 ${rows.length} 行的高峰/低峰预算到当前店 ${budgetShopId}？\n不认识的活动会跳过，不会改「页面现状」。`,
        )
      ) {
        return;
      }
      const r = await api.importAdsBudgetBaseline({
        shopId: budgetShopId,
        rows,
      });
      const skipHint =
        r.data.skipped > 0
          ? `，跳过 ${r.data.skipped}${
              r.data.skippedIds.length
                ? `（如 ${r.data.skippedIds.slice(0, 3).join("、")}）`
                : ""
            }`
          : "";
      const msg = `导入完成：更新 ${r.data.updated} 条${skipHint}`;
      setHint(msg);
      setBudgetTableMsg(msg);
      await refreshBudgetTable(budgetShopId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBudgetImporting(false);
      if (budgetImportInputRef.current) budgetImportInputRef.current.value = "";
    }
  }

  function catalogHitFor(psku: string): BudgetCatalogHit | undefined {
    for (const key of budgetPskuLookupKeys(psku)) {
      const hit = budgetCatalogBySku[key];
      if (hit && (hit.imageUrl || hit.title)) return hit;
    }
    return undefined;
  }

  async function refreshBudgetRuns(shopId?: string) {
    const sid =
      shopId?.trim().toUpperCase() ||
      (tabRef.current === "ads-budget"
        ? budgetShopIdRef.current
        : undefined);
    const r = await api.listAdsBudgetRuns({
      shopId: sid || undefined,
      limit: 30,
    });
    setBudgetRuns(r.data.items);
    setBudgetRunsTotal(r.data.total);
  }

  async function refreshBudgetMeta() {
    const [sch, last] = await Promise.all([
      api.getAdsBudgetSchedule(),
      api.getAdsBudgetLast(),
    ]);
    setBudgetSched(sch.data);
    setBudgetLast(last.data);
    // 仅预算页拉 baseline；避免非预算 Tab 用 shopIds[0]（常为 396770）污染表格
    if (tabRef.current !== "ads-budget") return;
    try {
      await Promise.all([refreshBudgetTable(), refreshBudgetRuns()]);
    } catch {
      /* baseline / runs 表可选 */
    }
  }

  async function saveBudgetRow(row: AdsBudgetBaselineRow) {
    const raw = budgetDrafts[row.campaignId];
    const baselineBudget =
      raw == null || String(raw).trim() === ""
        ? null
        : Number(String(raw).trim());
    if (baselineBudget != null && !Number.isFinite(baselineBudget)) {
      setError("高峰预算须为数字");
      setBudgetTableMsg("");
      return;
    }
    const offRaw = budgetOffpeakDraftOf(row).trim();
    const offpeakBudget =
      offRaw === "" ? DEFAULT_OFFPEAK_BUDGET : Number(offRaw);
    if (!Number.isFinite(offpeakBudget) || offpeakBudget < 0) {
      setError("低峰预算须为非负数字");
      setBudgetTableMsg("");
      return;
    }
    setBudgetSaving(row.campaignId);
    setError("");
    setBudgetTableMsg("");
    try {
      await api.patchAdsBudgetBaseline(row.campaignId, {
        shopId: budgetShopId,
        baselineBudget,
        offpeakBudget,
      });
      const label = row.psku || row.campaignId;
      const peakPart =
        baselineBudget == null ? "高峰空" : `高峰=${baselineBudget}`;
      const msg = `已保存「${label}」${peakPart} · 低峰=${offpeakBudget}`;
      setHint(msg);
      setBudgetTableMsg(msg);
      setBudgetSavedFlash(row.campaignId);
      window.setTimeout(() => {
        setBudgetSavedFlash((cur) => (cur === row.campaignId ? null : cur));
      }, 2800);
      await refreshBudgetTable();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setBudgetTableMsg("");
    } finally {
      setBudgetSaving(null);
    }
  }

  async function toggleBudgetEnabled(row: AdsBudgetBaselineRow) {
    setBudgetSaving(row.campaignId);
    setError("");
    try {
      await api.patchAdsBudgetBaseline(row.campaignId, {
        shopId: budgetShopId,
        enabled: !row.enabled,
      });
      const on = !row.enabled;
      const msg = `已${on ? "启用" : "停用"}「${row.psku || row.campaignId}」，已写入权威表`;
      setHint(msg);
      setBudgetTableMsg(msg);
      await refreshBudgetTable();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新启用失败");
    } finally {
      setBudgetSaving(null);
    }
  }

  async function removeBudgetRow(row: AdsBudgetBaselineRow) {
    if (
      !window.confirm(
        `从权威表删除「${row.psku || row.campaignId}」？定时高峰将不再回调该活动。`,
      )
    ) {
      return;
    }
    setBudgetSaving(row.campaignId);
    setError("");
    try {
      await api.deleteAdsBudgetBaseline(row.campaignId, budgetShopId);
      const msg = `已从权威表删除活动 ${row.campaignId}`;
      setHint(msg);
      setBudgetTableMsg(msg);
      await refreshBudgetTable();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBudgetSaving(null);
    }
  }

  async function addBudgetRow() {
    const campaignId = newCid.trim();
    if (!campaignId) {
      setError("新增需要填写活动编号");
      return;
    }
    const baselineBudget =
      newBaseline.trim() === "" ? null : Number(newBaseline.trim());
    if (baselineBudget != null && !Number.isFinite(baselineBudget)) {
      setError("高峰预算须为数字");
      return;
    }
    const offpeakBudget =
      newOffpeak.trim() === ""
        ? DEFAULT_OFFPEAK_BUDGET
        : Number(newOffpeak.trim());
    if (!Number.isFinite(offpeakBudget) || offpeakBudget < 0) {
      setError("低峰预算须为非负数字");
      return;
    }
    setBudgetSaving("__new__");
    setError("");
    try {
      await api.createAdsBudgetBaseline({
        shopId: budgetShopId,
        campaignId,
        psku: newPsku.trim(),
        baselineBudget,
        offpeakBudget,
      });
      setNewCid("");
      setNewPsku("");
      setNewBaseline("");
      setNewOffpeak(String(DEFAULT_OFFPEAK_BUDGET));
      setHint(`已新增活动 ${campaignId}`);
      await refreshBudgetTable();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增失败");
    } finally {
      setBudgetSaving(null);
    }
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
      // 预算页保持单选，勿被店铺列表刷新扩成导出默认多店
      if (tabRef.current === "ads-budget") {
        const cur = (prev[0] || ADS_BUDGET_PILOT_SHOP).toUpperCase();
        if (list.some((s) => s.id === cur)) return prev.length === 1 ? prev : [cur];
        const pilot = list.some((s) => s.id === ADS_BUDGET_PILOT_SHOP)
          ? ADS_BUDGET_PILOT_SHOP
          : list[0]?.id;
        return pilot ? [pilot] : prev;
      }
      if (!prev.length) return defaultExportShopIds(list);
      const keep = prev.filter((id) => list.some((s) => s.id === id));
      return keep.length ? keep : defaultExportShopIds(list);
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
    refreshBudgetMeta().catch(() => undefined);
    const id = setInterval(() => {
      refreshJobs().catch(() => undefined);
    }, 2000);
    const sid = setInterval(() => {
      refreshSession().catch(() => undefined);
    }, 60_000);
    const bid = setInterval(() => {
      refreshBudgetMeta().catch(() => undefined);
    }, 8_000);
    return () => {
      clearInterval(id);
      clearInterval(sid);
      clearInterval(bid);
    };
  }, []);

  useEffect(() => {
    refreshLogs().catch(() => undefined);
    const id = setInterval(() => {
      refreshLogs().catch(() => undefined);
    }, 4000);
    return () => clearInterval(id);
  }, [logJob, logFrom, logTo]);

  // 切到预算页或换店时按当前店拉表 + 运行历史（轮询走 ref，不依赖首屏闭包）
  useEffect(() => {
    if (tab !== "ads-budget") return;
    void refreshBudgetTable(budgetShopId).catch(() => undefined);
    void refreshBudgetRuns(budgetShopId).catch(() => undefined);
  }, [tab, budgetShopId]);

  const byJob = (name: PwJobName) => jobs.find((j) => j.job === name);
  const busy = jobs.some((j) => j.status === "running" || j.status === "starting");

  function selectTab(t: Tab) {
    if (t === "ads-budget") {
      // 预算页单选当前店；多店导出勾选时收成试店，避免 shopIds[0] 误用 396770
      setShopIds((prev) =>
        prev.length === 1 ? prev : [ADS_BUDGET_PILOT_SHOP],
      );
    }
    setTab(t);
  }

  function toggleShop(id: string) {
    if (tab === "ads-budget") {
      // 单选：可切换任意店查看/记录；改 Noon 仍仅试店
      setShopIds([id]);
      setBudgetTableMsg("");
      setBudgetSavedFlash(null);
      void refreshBudgetTable(id).catch(() => undefined);
      void refreshBudgetRuns(id).catch(() => undefined);
      if (id !== ADS_BUDGET_PILOT_SHOP) {
        setHint(
          `${id}：测试中仅开放「同步列表」记录，不能改页面预算`,
        );
      } else {
        setHint("");
      }
      return;
    }
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
      const dailyAt = job === "ads" ? adsDailyAt : salesDailyAt;
      const shops =
        shopIds.length > 0 ? shopIds : [...DEFAULT_EXPORT_SHOP_IDS];
      await api.savePwSchedule(job, {
        enabled,
        dailyAt,
        range: preset,
        shopIds: shops,
        fromDate: win.from,
        toDate: win.to,
      });
      await refreshSchedules();
      setHint(
        enabled
          ? `定时已打开：每天 ${dailyAt}（上海）· ${shops.join("、")}`
          : "定时已关闭",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存定时失败");
    }
  }

  async function runBudget(
    cmd: "apply" | "sync" | "probe",
    mode?: "peak" | "offpeak" | "auto",
    dryRun?: boolean,
  ) {
    setError("");
    setHint("");
    const sid = budgetShopId;
    if (cmd === "apply" && sid !== ADS_BUDGET_PILOT_SHOP) {
      setError(`改页面预算仅试店 ${ADS_BUDGET_PILOT_SHOP}；当前店只可同步记录`);
      return;
    }
    try {
      const r = await api.runPwJob("ads-budget", {
        shopIds: [sid],
        cmd,
        mode: mode || "auto",
        dryRun: Boolean(dryRun),
      });
      setHint(r.meta?.hint || r.data.message || "");
      await refreshJobs();
      await refreshBudgetMeta();
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动预算任务失败");
    }
  }

  async function toggleBudgetSchedule(enabled: boolean) {
    setError("");
    try {
      const r = await api.saveAdsBudgetSchedule({ enabled });
      setBudgetSched(r.data);
      setHint(enabled ? "广告预算定时已开启（峰期 00:10 / 低峰 09:10）" : "广告预算定时已关闭");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存预算定时失败");
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

      <details className="pws-howto-fold">
        <summary>怎么用（点开）</summary>
        <ol>
          <li>左侧选链路，上方选店铺（可多选）</li>
          <li>
            点开始会弹 Chromium；登录过期会在导出窗内自动邮箱验证码，一般不必再点「登录态」
          </li>
          <li>
            广告预算：各店可切换查看；非试店仅「同步列表」记录，改页面预算仍仅试店
          </li>
        </ol>
      </details>

      {error ? <p className="pws-alert">{error}</p> : null}
      {hint ? <p className="pws-hint">{hint}</p> : null}
      {session?.needsAttention ? (
        <p className="pws-alert">
          登录态需要处理：{session.summary}
          {" · "}
          <button
            type="button"
            className="pws-linkish"
            onClick={() => selectTab("keepalive")}
          >
            去登录态
          </button>
        </p>
      ) : null}

      <section className="pws-shops">
        <span className="pws-label">
          对哪些店跑
          {tab === "ads-budget"
            ? " · 各店可切换；非试店仅开放记录（同步列表）"
            : tab === "ads" || tab === "sales"
              ? " · 定时默认前两家老店"
              : ""}
        </span>
        {shops.length === 0 ? (
          <p className="pws-empty-shops">
            还没拉到店铺。返回慧运营看顶栏店铺，或刷新后再进。
          </p>
        ) : (
          <div className="pws-chips">
            {shops.map((s) => {
              const on = shopIds.includes(s.id);
              const recordOnly =
                tab === "ads-budget" && s.id !== ADS_BUDGET_PILOT_SHOP;
              return (
                <button
                  key={s.id}
                  type="button"
                  title={
                    recordOnly
                      ? "测试中：可查看表并同步记录，不能改页面预算"
                      : undefined
                  }
                  className={`pws-chip${on ? " on" : ""}`}
                  onClick={() => toggleShop(s.id)}
                >
                  {s.name || s.projectCode || s.id}
                  <span className="pws-chip-id">
                    {s.projectCode && s.projectCode !== s.name ? s.projectCode : s.id}
                    {recordOnly ? " · 仅记录" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="pws-shell">
        <nav className="pws-rail" aria-label="爬虫链路">
          <TabBtn
            id="ads"
            current={tab}
            label="广告导出"
            sub="花费表"
            job={byJob("ads")}
            onClick={selectTab}
          />
          <TabBtn
            id="sales"
            current={tab}
            label="销量导出"
            sub="销量表"
            job={byJob("sales")}
            onClick={selectTab}
          />
          <TabBtn
            id="ads-budget"
            current={tab}
            label="广告预算"
            sub="仅试店"
            job={byJob("ads-budget")}
            onClick={selectTab}
          />
          <TabBtn
            id="keepalive"
            current={tab}
            label="登录态"
            sub={
              session?.needsAttention
                ? "需重登"
                : session
                  ? "cookie"
                  : "状态"
            }
            job={byJob("keepalive")}
            onClick={selectTab}
          />
        </nav>

        <div className="pws-panel">

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
                selectTab("keepalive");
                void run("keepalive", "login");
              }}
            >
              备用：一次登录（广告+卖家）
            </button>
          </div>
          <JobLine job={byJob("ads")} />
          <ScheduleBox
            enabled={Boolean(adsSched?.enabled)}
            dailyAt={adsDailyAt}
            onDailyAt={setAdsDailyAt}
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
                selectTab("keepalive");
                void run("keepalive", "login");
              }}
            >
              未登录：一次登录（广告+卖家）
            </button>
          </div>
          <JobLine job={byJob("sales")} />
          <ScheduleBox
            enabled={Boolean(salesSched?.enabled)}
            dailyAt={salesDailyAt}
            onDailyAt={setSalesDailyAt}
            last={salesSched}
            onSave={(on) => void saveSchedule("sales", on)}
          />
        </article>
      ) : null}

      {tab === "ads-budget" ? (
        <article className="pws-card">
          <h2>广告预算 · 峰期切换</h2>
          <p className="pws-card-desc">
            低峰把线上预算压到 <strong>5</strong>，高峰按下方<strong>权威表</strong>
            的「高峰预算」回调；低峰写各行「低峰预算」。前端改表与定时任务读同一文件，禁止把「页面现状」当目标。
            当前店 <strong>{budgetShopId}</strong>
            {budgetCanChangeNoon
              ? "（试店：可改页面预算）"
              : "（测试中：只开放记录，不能改页面预算）"}
            。登录掉线走邮箱验证码（与广告导出同套）。
          </p>
          <div className="pws-budget-last">
            <span className="pws-label">最近一次运行</span>
            {budgetLast ? (
              <>
                <p className="pws-budget-last-title">
                  <span
                    className={`pws-budget-pill ${budgetLast.ok ? "ok" : "fail"}`}
                  >
                    {budgetLast.ok ? "成功" : "失败"}
                  </span>
                  {budgetRunTitle(budgetLast)}
                </p>
                <p className="pws-line">
                  {budgetLast.finishedAtCst || fmtWhen(budgetLast.finishedAt)}
                  {" · "}
                  {budgetTriggerZh(budgetLast.trigger)}
                  {" · "}
                  {budgetModeChip(budgetLast.mode)}
                  {budgetLast.applyOk != null || budgetLast.applyFailed != null
                    ? ` · 改成功 ${budgetLast.applyOk ?? 0} / 失败 ${budgetLast.applyFailed ?? 0}`
                    : ""}
                </p>
                {budgetLast.error ? (
                  <p className="pws-line pws-budget-err-line">{budgetLast.error}</p>
                ) : null}
              </>
            ) : (
              <p className="pws-line muted">还没有记录。跑一次或等定时 00:10 峰期回调。</p>
            )}
            {budgetSched ? (
              <p className="pws-line">
                定时：{budgetSched.enabled ? "开" : "关"}
                {budgetSched.timerActive ? " · 墙钟在跑" : ""}
                {" · 峰期 "}
                {budgetSched.peakAt}
                {" · 低峰 "}
                {budgetSched.offpeakAt}
                {budgetSched.lastSlot
                  ? ` · 上次槽 ${budgetSched.lastSlot === "peak" ? "峰期" : "低峰"}`
                  : ""}
              </p>
            ) : null}
          </div>
          <div className="pws-budget-runs" id="ads-budget-runs">
            <div className="pws-budget-runs-head">
              <div>
                <span className="pws-label">每日运行明细</span>
                <p className="pws-budget-runs-hint">
                  点开看每条活动改了多少；与服务器 jsonl 同源，同事用内网打开也能看。
                </p>
              </div>
              <span className="muted">
                {budgetRunsTotal
                  ? `本店最近 ${budgetRuns.length} / 共 ${budgetRunsTotal}`
                  : "暂无记录"}
              </span>
              <button
                type="button"
                className="pws-btn"
                disabled={busy}
                onClick={() =>
                  void refreshBudgetRuns().catch((e) =>
                    setError(e instanceof Error ? e.message : "读历史失败"),
                  )
                }
              >
                刷新
              </button>
            </div>
            {budgetRuns.length ? (
              <>
                {(() => {
                  const groups = collapseBudgetRunGroups(budgetRuns);
                  const visible = budgetRunsExpanded
                    ? groups
                    : groups.slice(0, BUDGET_RUNS_PAGE);
                  const hidden = Math.max(0, groups.length - visible.length);
                  return (
                    <>
                      <div className="pws-budget-run-list">
                        {visible.map((g) => {
                          const row = g.primary;
                          const key = g.key;
                          const open = budgetRunOpen === key;
                          const changes = extractBudgetCampaignChanges(row);
                          const shopErr = changes.find(
                            (c) => c.error && !c.campaignId,
                          );
                          const failN = 1 + g.collapsedFails.length;
                          return (
                            <article
                              key={key}
                              className={`pws-budget-run-card${row.ok ? "" : " is-fail"}${open ? " is-open" : ""}`}
                            >
                              <button
                                type="button"
                                className="pws-budget-run-card-head"
                                onClick={() =>
                                  setBudgetRunOpen((cur) =>
                                    cur === key ? null : key,
                                  )
                                }
                                aria-expanded={open}
                              >
                                <span
                                  className={`pws-budget-pill ${row.ok ? "ok" : "fail"}`}
                                >
                                  {row.ok ? "成功" : "失败"}
                                </span>
                                <div className="pws-budget-run-card-main">
                                  <strong>
                                    {budgetRunTitleShort(row)}
                                    {!row.ok && failN > 1 ? (
                                      <em className="pws-budget-run-dup">
                                        ×{failN} 次同类
                                      </em>
                                    ) : null}
                                  </strong>
                                  <span className="pws-budget-run-meta">
                                    {row.finishedAtCst ||
                                      fmtWhen(row.finishedAt) ||
                                      "—"}
                                    <i aria-hidden>·</i>
                                    {budgetTriggerZh(row.trigger)}
                                    {(row.shops || []).length ? (
                                      <>
                                        <i aria-hidden>·</i>
                                        {(row.shops || []).join("、")}
                                      </>
                                    ) : null}
                                    {row.ok &&
                                    (row.applyOk != null ||
                                      row.applyFailed != null) ? (
                                      <>
                                        <i aria-hidden>·</i>
                                        改成功 {row.applyOk ?? 0}
                                        {(row.applyFailed ?? 0) > 0
                                          ? ` / 失败 ${row.applyFailed}`
                                          : ""}
                                      </>
                                    ) : null}
                                    {!row.ok && failN > 1 ? (
                                      <>
                                        <i aria-hidden>·</i>
                                        已折叠同因重试
                                      </>
                                    ) : null}
                                  </span>
                                </div>
                                <span className="pws-budget-run-chevron">
                                  {open ? "收起" : "明细"}
                                </span>
                              </button>
                              {open ? (
                                <div className="pws-budget-run-body">
                                  <p className="pws-budget-run-fulltitle">
                                    {budgetRunTitle(row)}
                                  </p>
                                  {shopErr?.error ? (
                                    <div className="pws-budget-run-failbox">
                                      <span className="pws-label">失败原因</span>
                                      <pre>{shopErr.error}</pre>
                                    </div>
                                  ) : null}
                                  {row.error && !shopErr ? (
                                    <div className="pws-budget-run-failbox">
                                      <span className="pws-label">失败原因</span>
                                      <pre>{row.error}</pre>
                                    </div>
                                  ) : null}
                                  {g.collapsedFails.length ? (
                                    <p className="pws-budget-run-collapsed">
                                      另有 {g.collapsedFails.length}{" "}
                                      次同类失败（已折叠）：
                                      {g.collapsedFails
                                        .slice(0, 4)
                                        .map(
                                          (r) =>
                                            r.finishedAtCst ||
                                            fmtWhen(r.finishedAt),
                                        )
                                        .join("、")}
                                      {g.collapsedFails.length > 4
                                        ? "…"
                                        : ""}
                                    </p>
                                  ) : null}
                                  {changes.some(
                                    (c) => c.campaignId || c.psku,
                                  ) ? (
                                    <table className="pws-budget-run-chg">
                                      <thead>
                                        <tr>
                                          <th>PSKU</th>
                                          <th>活动编号</th>
                                          <th>原预算</th>
                                          <th>目标</th>
                                          <th>结果</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {changes
                                          .filter((c) => c.campaignId || c.psku)
                                          .map((c, j) => (
                                            <tr
                                              key={`${c.campaignId || c.psku}-${j}`}
                                              className={
                                                c.skip
                                                  ? "is-skip"
                                                  : c.ok === false
                                                    ? "is-fail"
                                                    : ""
                                              }
                                            >
                                              <td>{c.psku || "—"}</td>
                                              <td className="mono">
                                                {c.campaignId || "—"}
                                              </td>
                                              <td>{fmtBudgetNum(c.from)}</td>
                                              <td>{fmtBudgetNum(c.target)}</td>
                                              <td>
                                                {c.skip
                                                  ? `跳过${c.reason ? `（${c.reason}）` : ""}`
                                                  : c.ok === false
                                                    ? c.error || "失败"
                                                    : "已改"}
                                              </td>
                                            </tr>
                                          ))}
                                      </tbody>
                                    </table>
                                  ) : !shopErr && !row.error ? (
                                    <p className="pws-line muted">
                                      本轮无活动明细（同步/探针或未改到行）。
                                    </p>
                                  ) : null}
                                  {row.message ? (
                                    <p className="pws-budget-run-rawmsg">
                                      {row.message}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                      {hidden > 0 || budgetRunsExpanded ? (
                        <div className="pws-budget-run-more">
                          <button
                            type="button"
                            className="pws-btn"
                            onClick={() =>
                              setBudgetRunsExpanded((v) => !v)
                            }
                          >
                            {budgetRunsExpanded
                              ? "收起列表"
                              : `还有 ${hidden} 条，展开`}
                          </button>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </>
            ) : (
              <p className="pws-line muted">
                还没有历史。跑一次或等定时后会出现在这里。
              </p>
            )}
          </div>
          <div className="pws-actions">
            <button
              className="pws-btn primary"
              type="button"
              disabled={busy || !budgetCanChangeNoon}
              title={
                budgetCanChangeNoon
                  ? undefined
                  : "非试店不能改页面预算"
              }
              onClick={() => void runBudget("apply", "peak")}
            >
              高峰回调（拉回目标）
            </button>
            <button
              className="pws-btn"
              type="button"
              disabled={busy || !budgetCanChangeNoon}
              title={
                budgetCanChangeNoon
                  ? undefined
                  : "非试店不能改页面预算"
              }
              onClick={() => void runBudget("apply", "offpeak")}
            >
              低峰压到 5
            </button>
            <button
              className="pws-btn"
              type="button"
              disabled={busy || !budgetCanChangeNoon}
              onClick={() => void runBudget("apply", "peak", true)}
            >
              干跑预览
            </button>
          </div>
          <div className="pws-actions">
            <button
              className="pws-btn primary"
              type="button"
              disabled={busy}
              onClick={() => void runBudget("sync")}
              title="只刷新页面现状，不覆盖高峰/低峰目标"
            >
              同步列表（只记录）
            </button>
            <button
              className="pws-btn"
              type="button"
              disabled={busy || !budgetCanChangeNoon}
              title={
                budgetCanChangeNoon
                  ? "用当前页面预算覆盖高峰目标"
                  : "非试店禁用"
              }
              onClick={() => {
                if (
                  !window.confirm(
                    `将用 ${budgetShopId} 当前页面预算覆盖高峰目标。请确认现在是高峰、人为预算已设好。继续？`,
                  )
                ) {
                  return;
                }
                void (async () => {
                  setError("");
                  setHint("");
                  try {
                    const r = await api.runPwJob("ads-budget", {
                      shopIds: [budgetShopId],
                      cmd: "sync",
                      mode: "peak",
                      refreshBaseline: true,
                    });
                    setHint(r.meta?.hint || r.data.message || "已启动刷新基准");
                    await refreshJobs();
                    await refreshBudgetMeta();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "同步失败");
                  }
                })();
              }}
            >
              刷新基准（慎用）
            </button>
            <button
              className={`pws-btn${budgetSched?.enabled ? "" : " primary"}`}
              type="button"
              disabled={!budgetCanChangeNoon}
              title={
                budgetCanChangeNoon
                  ? undefined
                  : "定时改预算仅试店"
              }
              onClick={() => void toggleBudgetSchedule(!budgetSched?.enabled)}
            >
              {budgetSched?.enabled ? "关闭预算定时" : "打开预算定时"}
            </button>
          </div>
          <JobLine job={byJob("ads-budget")} />
          <div className="pws-budget-panel">
          <div className="pws-budget-toolbar">
            <div className="pws-budget-toolbar-row">
              <div className="pws-budget-toolbar-title">
                <h3>权威预算表 · {budgetShopId}</h3>
                <span className="pws-budget-count">
                  {budgetRows.length
                    ? budgetPskuQ.trim()
                      ? `显示 ${filteredBudgetRows.length} / ${budgetRows.length}`
                      : `共 ${budgetRows.length} 条`
                    : "暂无行"}
                </span>
              </div>
              <div className="pws-budget-toolbar-actions">
                <button
                  type="button"
                  className="pws-btn"
                  disabled={busy}
                  onClick={() =>
                    void refreshBudgetTable().catch((e) =>
                      setError(e instanceof Error ? e.message : "读表失败"),
                    )
                  }
                >
                  刷新
                </button>
                <button
                  type="button"
                  className="pws-btn"
                  disabled={budgetImporting || busy}
                  title="从本机选择导出表格同款 CSV，按活动编号更新高峰/低峰"
                  onClick={() => budgetImportInputRef.current?.click()}
                >
                  {budgetImporting ? "导入中…" : "导入表格"}
                </button>
                <input
                  ref={budgetImportInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="pws-hidden-file"
                  tabIndex={-1}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importBudgetTableFromFile(f);
                  }}
                />
                <button
                  type="button"
                  className="pws-btn primary"
                  disabled={!budgetRows.length}
                  title="下载到你正在用的这台电脑（浏览器下载目录），不是服务器盘"
                  onClick={() => exportBudgetTableCsv()}
                >
                  导出表格
                </button>
              </div>
            </div>
            <div className="pws-budget-search">
              <span className="pws-budget-search-label">筛选</span>
              <ClearableInput
                className="pws-budget-search-input"
                value={budgetPskuQ}
                onChange={(e) => setBudgetPskuQ(e.target.value)}
                placeholder="PSKU 或活动编号 C_…"
                aria-label="PSKU / 活动编号查询"
              />
              <label className="pws-budget-show-off">
                <input
                  type="checkbox"
                  checked={budgetShowDisabled}
                  onChange={(e) => setBudgetShowDisabled(e.target.checked)}
                />
                显示已停用
                {budgetDisabledCount > 0
                  ? `（${budgetDisabledCount}）`
                  : ""}
              </label>
            </div>
            <p className="pws-budget-hint">
              改高峰/低峰后点本行保存。整表用导出 → 改完再导入。同步列表只抓
              Live：已暂停/下架的会自动停用（默认识别隐藏）；Noon
              里用 Live 筛也查不到是正常的。
            </p>
          </div>
          {budgetTableMsg ? (
            <p className="pws-budget-saved" role="status">
              {budgetTableMsg}
            </p>
          ) : null}
          <div className="pws-budget-table-wrap">
            <table className="pws-budget-table">
              <thead>
                <tr>
                  <th>产品</th>
                  <th>活动编号</th>
                  <th title="峰期要写回 Noon 的权威值">高峰预算</th>
                  <th title={`低峰要写入的目标；空则默认 ${DEFAULT_OFFPEAK_BUDGET}`}>
                    低峰预算
                  </th>
                  <th title="同步/应用后的页面现状（模式 · 观测值）">
                    页面现状
                  </th>
                  <th>启用</th>
                  <th>写入来源</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredBudgetRows.map((row) => {
                  const dirty = budgetRowDirty(row);
                  const saving = budgetSaving === row.campaignId;
                  const justSaved = budgetSavedFlash === row.campaignId;
                  const displayPsku = budgetDisplayPsku(row.psku);
                  const hit = catalogHitFor(row.psku);
                  const title =
                    hit?.title ||
                    shortCampaignTitle(row.campaignName) ||
                    displayPsku ||
                    "（无货号活动）";
                  const rowClass = [
                    row.needsBaseline ? "needs-bl" : "",
                    dirty ? "is-dirty" : "",
                    justSaved ? "just-saved" : "",
                    !row.enabled ? "is-disabled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const detailBits = [
                    row.needsBaseline ? "缺高峰预算" : "",
                    !row.enabled
                      ? row.updatedBy === "sync-offline"
                        ? "不在 Live（已停用）"
                        : "已停用"
                      : "",
                    row.enabled && !displayPsku ? "品牌活动（无 PSKU）" : "",
                  ].filter(Boolean);
                  return (
                    <tr key={row.campaignId} className={rowClass || undefined}>
                      <td className="pws-bl-product">
                        <ProductCell
                          partnerSku={displayPsku}
                          title={title}
                          imageUrl={hit?.imageUrl || ""}
                          detail={
                            detailBits.length
                              ? detailBits.join(" · ")
                              : undefined
                          }
                          thumbSize={44}
                        />
                      </td>
                      <td className="mono" title={row.campaignName || undefined}>
                        {row.campaignId}
                      </td>
                      <td>
                        <input
                          className={`pws-bl-input${
                            budgetDraftOf(row).trim() !==
                            budgetSavedText(row).trim()
                              ? " is-dirty"
                              : ""
                          }`}
                          type="text"
                          inputMode="decimal"
                          value={budgetDraftOf(row)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBudgetDrafts((d) => ({
                              ...d,
                              [row.campaignId]: v,
                            }));
                            setBudgetTableMsg("");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && dirty && !saving) {
                              e.preventDefault();
                              void saveBudgetRow(row);
                            }
                          }}
                          aria-label={`${row.psku || row.campaignId} 高峰预算`}
                        />
                        {dirty ? (
                          <div className="pws-bl-dirty-hint">未保存</div>
                        ) : null}
                        {justSaved ? (
                          <div className="pws-bl-ok-hint">已写入表格</div>
                        ) : null}
                      </td>
                      <td>
                        <input
                          className={`pws-bl-input${
                            budgetOffpeakDraftOf(row).trim() !==
                            budgetOffpeakSavedText(row).trim()
                              ? " is-dirty"
                              : ""
                          }`}
                          type="text"
                          inputMode="decimal"
                          value={budgetOffpeakDraftOf(row)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBudgetOffpeakDrafts((d) => ({
                              ...d,
                              [row.campaignId]: v,
                            }));
                            setBudgetTableMsg("");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && dirty && !saving) {
                              e.preventDefault();
                              void saveBudgetRow(row);
                            }
                          }}
                          aria-label={`${row.psku || row.campaignId} 低峰预算`}
                          title={`空则保存为默认 ${DEFAULT_OFFPEAK_BUDGET}`}
                        />
                      </td>
                      <td
                        className="muted"
                        title="只读观测：模式 · 页面预算，不当目标"
                      >
                        {pageStatusText(row)}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          disabled={saving}
                          onChange={() => void toggleBudgetEnabled(row)}
                          title="关闭后应用任务会跳过"
                        />
                      </td>
                      <td className="muted">
                        {budgetSourceZh(row.updatedBy)}
                        <br />
                        <span className="pws-bl-at">
                          {fmtWhen(row.updatedAt)}
                        </span>
                      </td>
                      <td className="pws-bl-actions-cell">
                        <div className="pws-bl-actions">
                          <button
                            type="button"
                            className={`pws-btn${dirty ? " primary" : ""}`}
                            disabled={saving || !dirty}
                            onClick={() => void saveBudgetRow(row)}
                            title={
                              dirty
                                ? "保存高峰/低峰到权威表（不是热更新）"
                                : "没有未保存的改动"
                            }
                          >
                            {saving
                              ? "保存中…"
                              : dirty
                                ? "保存到表格"
                                : justSaved
                                  ? "已保存"
                                  : "保存"}
                          </button>
                          <button
                            type="button"
                            className="pws-btn"
                            disabled={saving}
                            onClick={() => void removeBudgetRow(row)}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!budgetRows.length ? (
                  <tr>
                    <td colSpan={8} className="muted">
                      表空。先点「同步列表（只记录）」拉取线上活动，或下方手工新增。
                    </td>
                  </tr>
                ) : !filteredBudgetRows.length ? (
                  <tr>
                    <td colSpan={8} className="muted">
                      没有匹配「{budgetPskuQ.trim()}」的行，清空筛选再试。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="pws-bl-add">
            <ClearableInput
              value={newCid}
              onChange={(e) => setNewCid(e.target.value)}
              placeholder="活动编号"
            />
            <ClearableInput
              value={newPsku}
              onChange={(e) => setNewPsku(e.target.value)}
              placeholder="货号"
            />
            <ClearableInput
              value={newBaseline}
              onChange={(e) => setNewBaseline(e.target.value)}
              placeholder="高峰预算"
            />
            <ClearableInput
              value={newOffpeak}
              onChange={(e) => setNewOffpeak(e.target.value)}
              placeholder={`低峰预算(${DEFAULT_OFFPEAK_BUDGET})`}
            />
            <button
              type="button"
              className="pws-btn"
              disabled={budgetSaving === "__new__"}
              onClick={() => void addBudgetRow()}
            >
              新增行
            </button>
          </div>
          </div>
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
        </div>
      </div>

      <section className="pws-card pws-log-card">
        <h2>运行日志</h2>
        <p className="pws-card-desc">
          广告/销量导出记录。广告预算运行历史在上方「广告预算」页（
          <a href="#ads-budget-runs">跳到运行历史</a>
          ）。
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
  dailyAt,
  onDailyAt,
  last,
  onSave,
}: {
  enabled: boolean;
  dailyAt: string;
  onDailyAt: (v: string) => void;
  last?: PwExportSchedule;
  onSave: (enabled: boolean) => void;
}) {
  const shops =
    last?.shopIds?.length ? last.shopIds.join("、") : DEFAULT_EXPORT_SHOP_IDS.join("、");
  return (
    <div className="pws-sched">
      <span className="pws-label">定时任务</span>
      <p className="pws-card-desc">
        上海时区每天定点导出；店铺用你现在页面上选的（默认前两家老店）。需 API
        过夜常开。
      </p>
      <div className="pws-sched-row">
        <label>
          每天
          <input
            type="time"
            value={dailyAt}
            onChange={(e) => onDailyAt(e.target.value || "17:00")}
          />
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
        {enabled ? ` · 每天 ${last?.dailyAt || dailyAt}` : ""}
        {last?.timerActive ? " · 计时器在跑" : ""}
        {` · 店铺 ${shops}`}
        {last?.lastRunAt ? ` · 上次 ${fmtWhen(last.lastRunAt)}` : ""}
        {last?.lastMessage ? ` · ${last.lastMessage}` : ""}
      </p>
    </div>
  );
}
