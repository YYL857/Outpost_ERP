import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type BoxHeadhaulResult,
  type CargoKindOption,
  type ChannelHistoryPayload,
  type ForwarderBoardAnalyze,
  type ForwarderTrackHit,
  type LabelCropResult,
  type ShippingOpsOverview,
  type SkuChannelHistory,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";
import { ProductCell } from "../components/ProductCell";
import { filterProductDisplayRows } from "../lib/product-display";

/** 货代查轨迹链路（与店铺切换同款下拉；未就绪的标 disabled）
 * splitShipMode=true：海运/空运查询入口不同，UI 需选运输方式
 */
const TRACK_PORTALS = [
  {
    id: "yibang",
    name: "亦邦",
    queryField: "物流编号",
    placeholder: "输入物流编号，如 FNSA…",
    hint: "用装箱表「物流编号」查 yundaomen（海运空运同一链路），结果回填本页（不写飞书）。",
    enabled: true,
    splitShipMode: false,
  },
  {
    id: "feitan",
    name: "飞坦",
    queryField: "票号",
    placeholder: "输入票号，如 36384900000005",
    hint: "装箱「票号」查 vip.fleetan.com；海运→放货订单、空运→沙特仓批次，请先选运输方式。",
    enabled: true,
    splitShipMode: true,
  },
  {
    id: "hansha",
    name: "汉沙",
    queryField: "票号",
    placeholder: "输入票号，如 10000544",
    hint: "装箱「票号」= nextsls 运单号；发货→运单→搜票号→侧滑路由（海运空运同一链路）。",
    enabled: true,
    splitShipMode: false,
  },
  {
    id: "yayouhui",
    name: "亚优汇",
    queryField: "票号",
    placeholder: "输入票号，如 YYH2608208067",
    hint: "装箱「票号」= nextsls 运单号；与汉沙同 UI（发货→运单→搜票号→侧滑路由）。",
    enabled: true,
    splitShipMode: false,
  },
  {
    id: "yite",
    name: "义特",
    queryField: "物流编号",
    placeholder: "输入物流编号，如 YT…U002（自动去掉 U 及之后）",
    hint: "装箱「物流编号」去掉 U 及之后再查 nextsls 运单（如 YT2604647454U002 → YT2604647454）；与汉沙同 UI。",
    enabled: true,
    splitShipMode: false,
  },
  {
    id: "anshida",
    name: "安时达",
    queryField: "票号",
    placeholder: "输入票号，如 8A0918Y",
    hint: "装箱「票号」= 官网中国单「订单号」；登录 → 头程单/中国单 → 查询 → 操作 → 轨迹列表。",
    enabled: true,
    splitShipMode: false,
  },
  {
    id: "qike",
    name: "起克",
    queryField: "物流编号",
    placeholder: "输入物流编号，如 HPMYKSA04004-2",
    hint: "装箱「物流编号」= B2B报表「入仓号」；素材管理→B2B→B2B报表→搜索入仓号。",
    enabled: true,
    splitShipMode: false,
  },
] as const;

type TrackPortalId = (typeof TRACK_PORTALS)[number]["id"];
type ShipModeChoice = "sea" | "air";

type TrackHitRow = ForwarderTrackHit;

function trackQueryNo(hit: TrackHitRow): string {
  const track = hit?.track as
    | { ticketNo?: string; logisticsNo?: string }
    | undefined;
  if (!track) return "—";
  if (hit.portalId === "yite") {
    return (
      (hit as { waybillNo?: string }).waybillNo ||
      track.ticketNo ||
      track.logisticsNo ||
      "—"
    );
  }
  if (
    hit.portalId === "feitan" ||
    hit.portalId === "hansha" ||
    hit.portalId === "yayouhui" ||
    hit.portalId === "anshida"
  ) {
    return track.ticketNo || "—";
  }
  return track.logisticsNo || track.ticketNo || "—";
}

/** 义特：物流编号去掉 U 及之后 → 官网运单号 */
function yiteWaybillFromLogistics(logisticsNo: string): string {
  const raw = logisticsNo.trim();
  if (!raw) return "";
  const u = raw.search(/U/i);
  return (u >= 0 ? raw.slice(0, u) : raw).trim();
}

function trackPackingBox(hit: TrackHitRow): string {
  return hit.packing?.boxNo || "—";
}

function trackPortalLabel(hit: TrackHitRow): string {
  if (hit.portalName?.trim()) return hit.portalName.trim();
  return TRACK_PORTALS.find((p) => p.id === hit.portalId)?.name ?? hit.portalId;
}

/** 查询发起时间：优先 queriedAt；旧记录从 id 末尾 Date.now() 回填 */
function trackQueriedAt(hit: TrackHitRow): string {
  if (hit.queriedAt?.trim()) {
    const d = new Date(hit.queriedAt);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("zh-CN", { hour12: false });
    }
  }
  const tail = hit.id.split("-").pop();
  if (tail && /^\d{13}$/.test(tail)) {
    const d = new Date(Number(tail));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("zh-CN", { hour12: false });
    }
  }
  return "—";
}

/** 装箱「运输方式」→ 海运/空运（仅分链路货代用） */
function packingModeRawToShip(modeRaw: string): ShipModeChoice {
  const m = modeRaw.trim();
  if (/海运|海派|整柜|拼柜/.test(m)) return "sea";
  return "air";
}

function shipModeLabel(mode: string): string {
  if (mode === "air") return "空运";
  if (mode === "sea") return "海运";
  if (mode === "single") return "单品";
  return mode || "其他";
}

const DEFAULT_CARGO_OPTIONS: CargoKindOption[] = [
  { value: "general", label: "普货" },
  { value: "battery", label: "带电普货" },
  { value: "sensitive", label: "敏货" },
  { value: "sensitive_battery", label: "敏货带电" },
  { value: "lamp", label: "灯具" },
  { value: "other", label: "其他" },
];

const TRACK_HITS_KEY = "outpost.shipping.trackHits.v1";
const TRACK_PORTAL_KEY = "outpost.shipping.trackPortal.v1";
const TRACK_SHIP_MODE_KEY = "outpost.shipping.trackShipMode.v1";
/** 可视约 5 行，超出滚动 */
const TRACK_HISTORY_MAX_HEIGHT = 260;

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function downloadBase64Pdf(filename: string, b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isValidTrackHit(hit: unknown): hit is TrackHitRow {
  if (!hit || typeof hit !== "object") return false;
  const h = hit as Partial<TrackHitRow> & { track?: { durationMs?: unknown } };
  return (
    typeof h.id === "string" &&
    typeof h.portalId === "string" &&
    !!h.track &&
    typeof h.track === "object" &&
    typeof h.track.durationMs === "number"
  );
}

function loadTrackHits(): TrackHitRow[] {
  try {
    const raw = localStorage.getItem(TRACK_HITS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTrackHit);
  } catch {
    return [];
  }
}

function loadTrackPortal(): TrackPortalId {
  try {
    const raw = localStorage.getItem(TRACK_PORTAL_KEY);
    if (TRACK_PORTALS.some((p) => p.id === raw && p.enabled)) {
      return raw as TrackPortalId;
    }
  } catch {
    /* ignore */
  }
  return "yibang";
}

function loadShipMode(): ShipModeChoice {
  try {
    const raw = localStorage.getItem(TRACK_SHIP_MODE_KEY);
    if (raw === "sea" || raw === "air") return raw;
  } catch {
    /* ignore */
  }
  return "sea";
}

export function ShippingOpsPage() {
  const [data, setData] = useState<ShippingOpsOverview | null>(null);
  const [llm, setLlm] = useState<ForwarderBoardAnalyze["llm"] | null>(null);
  const [feishuQuery, setFeishuQuery] = useState("");
  const [noonQuery, setNoonQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [trackPortalId, setTrackPortalId] = useState<TrackPortalId>(loadTrackPortal);
  const [shipMode, setShipMode] = useState<ShipModeChoice>(loadShipMode);
  const [trackNo, setTrackNo] = useState("");
  const [trackHits, setTrackHits] = useState<TrackHitRow[]>(loadTrackHits);
  const [headhaulBoxNo, setHeadhaulBoxNo] = useState("");
  const [headhaulBox, setHeadhaulBox] = useState<BoxHeadhaulResult | null>(null);
  const [channelHistory, setChannelHistory] =
    useState<ChannelHistoryPayload | null>(null);
  const [channelSkuQ, setChannelSkuQ] = useState("");
  const [channelSkuHits, setChannelSkuHits] = useState<SkuChannelHistory[]>([]);
  const [channelSkuError, setChannelSkuError] = useState("");
  const [cargoOptions, setCargoOptions] =
    useState<CargoKindOption[]>(DEFAULT_CARGO_OPTIONS);
  const [cargoSavingKey, setCargoSavingKey] = useState<string | null>(null);
  const [labelFile, setLabelFile] = useState<File | null>(null);
  const [labelResult, setLabelResult] = useState<LabelCropResult | null>(null);
  const [labelMessage, setLabelMessage] = useState("");
  const [labelDragOver, setLabelDragOver] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);

  const trackPortal =
    TRACK_PORTALS.find((p) => p.id === trackPortalId) ?? TRACK_PORTALS[0];

  useEffect(() => {
    localStorage.setItem(TRACK_HITS_KEY, JSON.stringify(trackHits));
  }, [trackHits]);

  useEffect(() => {
    localStorage.setItem(TRACK_PORTAL_KEY, trackPortalId);
  }, [trackPortalId]);

  useEffect(() => {
    localStorage.setItem(TRACK_SHIP_MODE_KEY, shipMode);
  }, [shipMode]);

  async function refresh() {
    const [overview, channels, hints] = await Promise.all([
      api.getShippingOpsOverview(),
      api.getChannelHistory().catch(() => null),
      api.getCargoHints().catch(() => null),
    ]);
    setData(overview.data);
    if (channels) setChannelHistory(channels.data);
    if (hints?.data.options?.length) setCargoOptions(hints.data.options);
  }

  async function searchChannelSku() {
    const q = channelSkuQ.trim();
    if (!q) {
      setChannelSkuError("请输入 PSKU 或品名");
      setChannelSkuHits([]);
      return;
    }
    setBusy("channelSku");
    setChannelSkuError("");
    try {
      const res = await api.searchChannelHistorySku(q);
      setChannelSkuHits(res.data.skus);
      if (res.data.skus.length === 0) {
        setChannelSkuError("无匹配的已发货记录");
      }
    } catch (e) {
      setChannelSkuHits([]);
      setChannelSkuError(e instanceof Error ? e.message : "查询失败");
    } finally {
      setBusy(null);
    }
  }

  async function saveCargoHint(
    partnerSku: string,
    forwarder: string,
    cargoKind: string,
  ) {
    const key = `${partnerSku}\0${forwarder}`;
    setCargoSavingKey(key);
    setChannelSkuError("");
    try {
      const res = await api.upsertCargoHint({
        partnerSku,
        forwarder,
        cargoKind,
      });
      if (res.data.options?.length) setCargoOptions(res.data.options);
      const kind = res.data.hint?.cargoKind ?? null;
      setChannelSkuHits((prev) =>
        prev.map((sku) =>
          sku.partnerSku !== partnerSku
            ? sku
            : {
                ...sku,
                channels: sku.channels.map((c) =>
                  c.forwarder === forwarder ? { ...c, cargoKind: kind } : c,
                ),
              },
        ),
      );
    } catch (e) {
      setChannelSkuError(e instanceof Error ? e.message : "货性保存失败");
    } finally {
      setCargoSavingKey(null);
    }
  }

  function acceptLabelPdf(file: File | undefined | null) {
    if (!file) return;
    const okType =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!okType) {
      setLabelFile(null);
      setLabelResult(null);
      setLabelMessage("请选择 PDF 文件");
      return;
    }
    setLabelFile(file);
    setLabelResult(null);
    setLabelMessage("");
  }

  function clearLabelPdf() {
    setLabelFile(null);
    setLabelResult(null);
    setLabelMessage("");
    setLabelDragOver(false);
    if (labelInputRef.current) labelInputRef.current.value = "";
  }

  async function cropLabels() {
    if (!labelFile) {
      setLabelMessage("请先选择未裁剪的 PDF");
      return;
    }
    setBusy("labelCrop");
    setError("");
    setLabelMessage("");
    setLabelResult(null);
    try {
      const base64 = await fileToBase64(labelFile);
      const res = await api.cropShippingLabels({
        filename: labelFile.name,
        base64,
      });
      setLabelResult(res.data);
      setLabelMessage(res.message || `已裁剪 ${res.data.pageCount} 张标签`);
      downloadBase64Pdf(res.data.filename, res.data.base64);
    } catch (e) {
      setLabelMessage(e instanceof Error ? e.message : "裁标失败");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!data) return;
    if (window.location.hash !== "#packing-in-transit") return;
    const el = document.getElementById("packing-in-transit");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [data]);

  async function run(
    key: string,
    fn: () => Promise<unknown>,
  ) {
    setBusy(key);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function analyzeBoard() {
    setBusy("analyze");
    setError("");
    try {
      const res = await api.analyzeForwarderBoard();
      setLlm(res.data.llm);
      setData((prev) =>
        prev
          ? {
              ...prev,
              forwarderBoard: res.data.board,
            }
          : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setBusy(null);
    }
  }

  async function loadHeadhaulBox() {
    const no = headhaulBoxNo.trim();
    if (!no) {
      setError("请填写箱号");
      return;
    }
    setBusy("headhaul");
    setError("");
    try {
      const res = await api.getShippingHeadhaulBox(no);
      setHeadhaulBox(res.data);
    } catch (e) {
      setHeadhaulBox(null);
      setError(e instanceof Error ? e.message : "头程查询失败");
    } finally {
      setBusy(null);
    }
  }

  async function runTrack(
    queryNo: string,
    portalId: TrackPortalId = trackPortalId,
    modeOverride?: ShipModeChoice,
  ) {
    const portal = TRACK_PORTALS.find((p) => p.id === portalId);
    if (!portal?.enabled) {
      setError(`${portal?.name ?? portalId} 查轨迹尚未接入`);
      return;
    }
    const no = queryNo.trim();
    if (!no) {
      setError(`请填写${portal.queryField}`);
      return;
    }
    const mode = modeOverride ?? shipMode;
    if (portal.splitShipMode && modeOverride) {
      setShipMode(modeOverride);
    }
    setBusy(`track:${portalId}:${no}`);
    setError("");
    setTrackPortalId(portalId);
    setTrackNo(no);
    try {
      let row: TrackHitRow;
      const queriedMs = Date.now();
      const queriedAt = new Date(queriedMs).toISOString();
      if (portalId === "yibang") {
        const res = await api.trackYibang(no);
        row = {
          ...res.data,
          id: `${portalId}-${no}-${queriedMs}`,
          portalName: portal.name,
          queriedAt,
        };
      } else if (portalId === "feitan") {
        const res = await api.trackFeitan(no, mode);
        row = {
          ...res.data,
          id: `${portalId}-${mode}-${no}-${queriedMs}`,
          portalName: portal.name,
          queriedAt,
        };
      } else if (portalId === "hansha") {
        const res = await api.trackHansha(no);
        row = {
          ...res.data,
          id: `${portalId}-${no}-${queriedMs}`,
          portalName: portal.name,
          queriedAt,
        };
      } else if (portalId === "yayouhui") {
        const res = await api.trackYayouhui(no);
        row = {
          ...res.data,
          id: `${portalId}-${no}-${queriedMs}`,
          portalName: portal.name,
          queriedAt,
        };
      } else if (portalId === "yite") {
        const res = await api.trackYite(no);
        row = {
          ...res.data,
          id: `${portalId}-${no}-${queriedMs}`,
          portalName: portal.name,
          queriedAt,
        };
      } else if (portalId === "anshida") {
        const res = await api.trackAnshida(no);
        row = {
          ...res.data,
          id: `${portalId}-${no}-${queriedMs}`,
          portalName: portal.name,
          queriedAt,
        };
      } else if (portalId === "qike") {
        const res = await api.trackQike(no);
        row = {
          ...res.data,
          id: `${portalId}-${no}-${queriedMs}`,
          portalName: portal.name,
          queriedAt,
        };
      } else {
        setError(`${portal.name} 查轨迹尚未接入`);
        return;
      }
      setTrackHits((prev) => [
        row,
        ...prev.filter((x) => {
          if (x.portalId !== portalId) return true;
          if (portalId === "yite") {
            return trackQueryNo(x) !== yiteWaybillFromLogistics(no);
          }
          return trackQueryNo(x) !== no;
        }),
      ]);
      if (!row.track.ok) {
        setError(row.track.message || `${portal.name}查件失败`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `${portal.name}查件失败`);
    } finally {
      setBusy(null);
    }
  }

  function removeTrackHit(id: string) {
    setTrackHits((prev) => prev.filter((x) => x.id !== id));
  }

  function clearTrackHits() {
    setTrackHits((prev) => prev.filter((x) => x.portalId !== trackPortalId));
  }

  const summary = data?.summary;
  const feishuRows = data?.feishuTransit ?? [];
  const noonRows = data?.inTransit ?? [];
  const packingInTransit = data?.packingInTransit ?? [];
  const packingDetail = data?.packingInTransitDetail;
  const board = data?.forwarderBoard;
  const ranking = board?.ranking ?? [];
  const forwarders = board?.forwarders ?? [];

  const feishuView = useMemo(
    () =>
      filterProductDisplayRows(feishuRows, feishuQuery, {
        compare: (a, b) =>
          b.airInTransit + b.seaInTransit - (a.airInTransit + a.seaInTransit),
      }),
    [feishuRows, feishuQuery],
  );

  const noonView = useMemo(
    () =>
      filterProductDisplayRows(noonRows, noonQuery, {
        compare: (a, b) => b.inTransit - a.inTransit,
      }),
    [noonRows, noonQuery],
  );

  const portalHits = useMemo(
    () => trackHits.filter((h) => h.portalId === trackPortalId),
    [trackHits, trackPortalId],
  );

  return (
    <div>
      <h1 className="page-title">物流管理</h1>
      <p className="page-desc">
        在途 / 送仓、货代性价比、面单裁标，以及下方「发货渠道参考」（历史走哪家货代、空/海运，并可按货代标注货性）。
        Catalog 头程优先用装箱双轨分摊。运费全局兜底在{" "}
        <Link to="/">我的主页</Link>。
      </p>
      <div className="row" style={{ marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!!busy}
          onClick={() => run("packing", () => api.syncShippingPacking())}
        >
          {busy === "packing" ? "同步中…" : "同步装箱表"}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!!busy}
          onClick={() => run("rates", () => api.syncShippingFreightRates())}
        >
          {busy === "rates" ? "同步中…" : "同步货代大纲"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={!!busy}
          onClick={() => run("daily", () => api.syncShippingFeishuDaily())}
        >
          {busy === "daily" ? "同步中…" : "同步飞书日报在途"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={!!busy || (forwarders.length === 0 && !(board?.quotes?.length))}
          onClick={analyzeBoard}
        >
          {busy === "analyze" ? "分析中…" : "AI 解读货代排名"}
        </button>
        <button className="btn" type="button" onClick={() => refresh()}>
          刷新
        </button>
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>按箱头程明细</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          箱号 → 装箱明细货性（普货/带电/敏货）× 货代大纲报价，并摊实付（若有）。结果同步驱动 Catalog 单位头程。
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <ClearableInput
            className="input"
            style={{ minWidth: 220 }}
            placeholder="箱号，如 2609-477-N3-K"
            value={headhaulBoxNo}
            onChange={(e) => setHeadhaulBoxNo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void loadHeadhaulBox();
            }}
          />
          <button
            className="btn btn-primary"
            type="button"
            disabled={!!busy}
            onClick={() => void loadHeadhaulBox()}
          >
            {busy === "headhaul" ? "计算中…" : "计算头程"}
          </button>
        </div>
        {headhaulBox && (
          <>
            <p style={{ marginTop: 0 }}>
              {headhaulBox.boxNo} · {headhaulBox.forwarder} ·{" "}
              {headhaulBox.mode === "air" ? "空运" : headhaulBox.mode === "sea" ? "海运" : headhaulBox.mode}
              {" · "}报价合计 ¥{headhaulBox.quoteTotalRmb}
              {headhaulBox.actualTotalRmb != null
                ? ` · 实付合计 ¥${headhaulBox.actualTotalRmb}`
                : " · 无箱级实付"}
              {headhaulBox.chargeableKg != null
                ? ` · 计费重 ${headhaulBox.chargeableKg} kg`
                : ""}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>PSKU</th>
                    <th>名称</th>
                    <th>货性</th>
                    <th>数量</th>
                    <th>份额</th>
                    <th>单价(大纲)</th>
                    <th>行报价</th>
                    <th>行实付</th>
                    <th>单位头程</th>
                    <th>置信度</th>
                  </tr>
                </thead>
                <tbody>
                  {headhaulBox.lines.map((l, i) => (
                    <tr key={`${l.partnerSku}-${i}`}>
                      <td>{l.partnerSku || "—"}</td>
                      <td className="muted" style={{ maxWidth: 180 }}>
                        {l.name}
                      </td>
                      <td>{l.cargoLabel}</td>
                      <td>{l.qty}</td>
                      <td>{l.share}</td>
                      <td>{l.rateRmb ?? "—"}</td>
                      <td>{l.quoteRmb}</td>
                      <td>{l.actualRmb ?? "—"}</td>
                      <td>{l.unitHeadhaulRmb}</td>
                      <td>{l.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div
          className="row"
          style={{
            marginBottom: 12,
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>货代面单裁标</h3>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              货代后台打印的 A4 面单 → 按黑框裁成可贴的标签。
            </p>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            打印请选实际大小 / 100%
          </span>
        </div>

        <input
          ref={labelInputRef}
          type="file"
          accept="application/pdf,.pdf"
          disabled={!!busy}
          style={{ display: "none" }}
          onChange={(e) => {
            acceptLabelPdf(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
            alignItems: "stretch",
          }}
        >
          <button
            type="button"
            disabled={!!busy}
            onClick={() => labelInputRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              setLabelDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setLabelDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setLabelDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setLabelDragOver(false);
              acceptLabelPdf(e.dataTransfer.files?.[0] ?? null);
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "flex-start",
              gap: 8,
              minHeight: 118,
              padding: "16px 18px",
              textAlign: "left",
              fontFamily: "inherit",
              fontSize: "inherit",
              boxShadow: "none",
              cursor: busy ? "not-allowed" : "pointer",
              borderRadius: "var(--radius-sm)",
              border: `1.5px dashed ${labelDragOver ? "var(--accent)" : "var(--accent-muted)"}`,
              background: labelDragOver
                ? "var(--accent-soft)"
                : "var(--surface-2)",
              color: "inherit",
            }}
          >
            {labelFile ? (
              <>
                <strong style={{ fontSize: 14 }}>{labelFile.name}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {formatFileSize(labelFile.size)} · 点击或拖入可更换
                </span>
              </>
            ) : (
              <>
                <strong style={{ fontSize: 14 }}>把 PDF 拖到这里，或点击选择</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  仅支持货代打印面单（.pdf）
                </span>
              </>
            )}
          </button>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 10,
              padding: "12px 14px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--line)",
              background: "var(--surface)",
            }}
          >
            <ol
              className="muted"
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: 12,
                lineHeight: 1.7,
              }}
            >
              <li>选择未裁剪的 A4 PDF</li>
              <li>按标签黑框自动裁切</li>
              <li>下载后直接打印贴纸</li>
            </ol>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {labelFile && (
                <button
                  className="btn"
                  type="button"
                  disabled={!!busy}
                  onClick={clearLabelPdf}
                >
                  清除
                </button>
              )}
              <button
                className="btn btn-primary"
                type="button"
                disabled={!!busy || !labelFile}
                onClick={() => void cropLabels()}
              >
                {busy === "labelCrop" ? "裁剪中…" : "裁剪并下载"}
              </button>
            </div>
          </div>
        </div>

        {labelResult && (
          <div
            className="row"
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              background: "var(--ok-soft)",
              border: "1px solid var(--ok-line)",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <span style={{ color: "var(--ok)", fontSize: 13 }}>
              {labelMessage || "已裁剪"} · {labelResult.pageCount} 页 · 约{" "}
              {Math.round((labelResult.widthPt / 72) * 25.4)}×
              {Math.round((labelResult.heightPt / 72) * 25.4)} mm
            </span>
            <button
              className="btn"
              type="button"
              onClick={() =>
                downloadBase64Pdf(labelResult.filename, labelResult.base64)
              }
            >
              再下载 {labelResult.filename}
            </button>
          </div>
        )}
        {!labelResult && labelMessage && (
          <p
            style={{
              margin: "12px 0 0",
              color: "var(--danger)",
              fontSize: 13,
            }}
          >
            {labelMessage}
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div
          className="row"
          style={{
            marginBottom: 8,
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <h3 style={{ margin: 0 }}>货代查轨迹</h3>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {trackPortal.splitShipMode && (
              <label className="shop-switch">
                <span className="shop-switch-label">运输</span>
                <select
                  value={shipMode}
                  disabled={!!busy}
                  onChange={(e) => setShipMode(e.target.value as ShipModeChoice)}
                >
                  <option value="sea">海运</option>
                  <option value="air">空运</option>
                </select>
              </label>
            )}
            <label className="shop-switch">
              <span className="shop-switch-label">货代</span>
              <select
                value={trackPortalId}
                disabled={!!busy}
                onChange={(e) => {
                  setTrackPortalId(e.target.value as TrackPortalId);
                  setTrackNo("");
                }}
              >
                {TRACK_PORTALS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.enabled ? "" : "（待接入）"}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {trackPortal.hint}
          {trackPortal.splitShipMode
            ? ` 当前：${shipMode === "sea" ? "海运链路" : "空运链路"}。`
            : ""}
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <ClearableInput
            className="input"
            style={{ minWidth: 260, maxWidth: 420, flex: 1 }}
            placeholder={trackPortal.placeholder}
            value={trackNo}
            disabled={!!busy || !trackPortal.enabled}
            onChange={(e) => setTrackNo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runTrack(trackNo);
            }}
          />
          <button
            className="btn btn-primary"
            type="button"
            disabled={!!busy || !trackPortal.enabled || !trackNo.trim()}
            onClick={() => void runTrack(trackNo)}
          >
            {busy?.startsWith(`track:${trackPortalId}:`)
              ? "查询中…"
              : trackPortal.enabled
                ? trackPortal.splitShipMode
                  ? `查询${trackPortal.name}${shipMode === "sea" ? "海运" : "空运"}`
                  : `查询${trackPortal.name}轨迹`
                : "尚未接入"}
          </button>
          <button
            className="btn"
            type="button"
            disabled={portalHits.length === 0 || !!busy}
            onClick={clearTrackHits}
            title={`清空${trackPortal.name}的查件记录`}
          >
            清空记录
          </button>
        </div>
        {trackHits.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <p className="muted" style={{ margin: "0 0 6px" }}>
              查询记录 {trackHits.length} 条
              {portalHits.length !== trackHits.length
                ? `（当前货代 ${trackPortal.name} ${portalHits.length} 条）`
                : `（${trackPortal.name}）`}
            </p>
            <div
              style={{
                maxHeight: TRACK_HISTORY_MAX_HEIGHT,
                overflow: "auto",
                border: "1px solid var(--line)",
                borderRadius: 8,
              }}
            >
              <table className="table" style={{ margin: 0 }}>
                <thead
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "var(--surface)",
                    zIndex: 1,
                  }}
                >
                  <tr>
                    <th style={{ width: 72 }}>货代</th>
                    <th>单号</th>
                    <th>箱号</th>
                    <th>最新状态</th>
                    <th>轨迹摘要</th>
                    <th style={{ width: 148 }}>查询时间</th>
                    <th>耗时</th>
                    <th style={{ width: 64 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {trackHits.map((hit) => {
                    const track = hit.track;
                    if (!track) return null;
                    return (
                    <tr
                      key={hit.id}
                      style={
                        hit.portalId === trackPortalId
                          ? undefined
                          : { opacity: 0.85 }
                      }
                    >
                      <td style={{ fontWeight: 650 }}>{trackPortalLabel(hit)}</td>
                      <td style={{ fontWeight: 650 }}>{trackQueryNo(hit)}</td>
                      <td className="muted">{trackPackingBox(hit)}</td>
                      <td
                        style={{
                          fontWeight: 650,
                          color: track.ok ? undefined : "var(--danger)",
                        }}
                      >
                        {track.statusText || track.message}
                        {hit.portalId === "feitan" &&
                        "modeHit" in track &&
                        track.modeHit
                          ? ` · ${track.modeHit === "sea" ? "海运" : "空运"}`
                          : ""}
                        {(hit.portalId === "hansha" ||
                          hit.portalId === "yayouhui" ||
                          hit.portalId === "yite") &&
                        "serviceText" in track &&
                        track.serviceText
                          ? ` · ${track.serviceText}`
                          : ""}
                        {hit.portalId === "qike" &&
                        "transportMode" in track &&
                        track.transportMode
                          ? ` · ${track.transportMode}`
                          : ""}
                      </td>
                      <td className="muted" style={{ maxWidth: 360 }}>
                        {(track.events ?? [])
                          .slice(0, 3)
                          .map((e) =>
                            [e.at, e.name, "reasonInfo" in e ? e.reasonInfo : null]
                              .filter(Boolean)
                              .join(" "),
                          )
                          .join(" → ") ||
                          (track.detailLines ?? []).slice(0, 2).join("；") ||
                          "—"}
                      </td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>
                        {trackQueriedAt(hit)}
                      </td>
                      <td>{Math.round((track.durationMs || 0) / 1000)}s</td>
                      <td>
                        <button
                          className="btn"
                          type="button"
                          style={{ padding: "2px 8px", fontSize: 12 }}
                          disabled={!!busy}
                          onClick={() => removeTrackHit(hit.id)}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
            暂无查询记录。
          </p>
        )}
      </div>

      {!data ? (
        <p className="muted">加载中…</p>
      ) : (
        <>
          <div className="grid-3" style={{ marginBottom: 16 }}>
            <div className="card">
              <h3>装箱在途箱数</h3>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
                {summary?.packingInTransitBoxes ?? packingInTransit.length}
              </p>
              <p className="muted">
                货代 {summary?.forwarderCount ?? 0} 家
                {summary?.packingInTransitTickets
                  ? ` · 本店 ${summary.packingInTransitTickets}票/${summary.packingInTransitPcs ?? 0}件`
                  : ""}
              </p>
            </div>
            <div className="card">
              <h3>飞书日报在途 SKU</h3>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
                {summary?.feishuTransitSkuCount ?? 0}
              </p>
            </div>
            <div className="card">
              <h3>Noon 在途 SKU</h3>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
                {summary?.inTransitSkuCount ?? 0}
              </p>
              <p className="muted">{summary?.gap}</p>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>发货渠道参考</h3>
            <div className="muted" style={{ marginTop: 0, marginBottom: 12, lineHeight: 1.55 }}>
              <p style={{ margin: "0 0 8px" }}>
                <strong style={{ fontWeight: 650, color: "inherit" }}>给谁用：</strong>
                发货时想查「这品以前多走哪家、空还是海」，以及记下「这家货代按什么货性收」。
              </p>
              <ol style={{ margin: "0 0 8px", paddingLeft: 20 }}>
                <li>
                  点上方「同步装箱表」，保证飞书装箱明细是新的（只统计已填「发货时间」的行）。
                </li>
                <li>
                  上看总表：各货代空运/海运箱数·件数、SKU 数、最近发货日——选渠道时先扫一眼整体习惯。
                </li>
                <li>
                  在搜索框输入 PSKU 或品名 →「查 SKU 渠道」：看该品历史货代×空海、件数占比与「最常用」。
                </li>
                <li>
                  在结果表「货性（按货代）」下拉标注：普货 / 带电普货 / 敏货 / 敏货带电 / 灯具 / 其他。
                  同一品在不同货代可标不同；空运与海运行共用该货代标注。选「未标注」即清除。
                </li>
              </ol>
              <p style={{ margin: 0 }}>
                货性只存本机（不写飞书、不自动推断）；与「按箱头程」里的品名推断是两套口径。
                {channelHistory
                  ? ` 当前：已发货 ${channelHistory.source.shippedLineCount} 行 / ${channelHistory.source.shippedPcs} 件 · ${channelHistory.source.forwarderCount} 家货代 · 已标注 ${channelHistory.cargoHints?.length ?? 0} 条`
                  : " 当前：无装箱快照或加载中"}
                {channelHistory && channelHistory.source.missingShipAtCount > 0
                  ? ` · ${channelHistory.source.missingShipAtCount} 行未填发货日未计入`
                  : ""}
                。
              </p>
            </div>
            <div style={{ overflowX: "auto", marginBottom: 14 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>货代</th>
                    <th>空运箱/件</th>
                    <th>海运箱/件</th>
                    <th>SKU 数</th>
                    <th>最近发货</th>
                  </tr>
                </thead>
                <tbody>
                  {!channelHistory || channelHistory.forwarders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        暂无已发货渠道数据。点「同步装箱表」后刷新。
                      </td>
                    </tr>
                  ) : (
                    channelHistory.forwarders.map((f) => (
                      <tr key={f.forwarder}>
                        <td style={{ fontWeight: 650 }}>{f.forwarder}</td>
                        <td>
                          {f.byMode?.air?.boxes ?? 0}/{f.byMode?.air?.pcs ?? 0}
                        </td>
                        <td>
                          {f.byMode?.sea?.boxes ?? 0}/{f.byMode?.sea?.pcs ?? 0}
                        </td>
                        <td>{f.distinctSku}</td>
                        <td>{f.lastShipAt ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <ClearableInput
                className="input"
                style={{ minWidth: 220 }}
                placeholder="PSKU 或品名，查历史渠道"
                value={channelSkuQ}
                onChange={(e) => setChannelSkuQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void searchChannelSku();
                }}
              />
              <button
                className="btn btn-primary"
                type="button"
                disabled={!!busy}
                onClick={() => void searchChannelSku()}
              >
                {busy === "channelSku" ? "查询中…" : "查 SKU 渠道"}
              </button>
            </div>
            {channelSkuError && (
              <p className="muted" style={{ marginTop: 0 }}>
                {channelSkuError}
              </p>
            )}
            {channelSkuHits.map((sku) => (
              <div
                key={sku.partnerSku}
                style={{
                  marginBottom: 12,
                  paddingTop: 8,
                  borderTop: "1px solid var(--border, #e5e7eb)",
                }}
              >
                <p style={{ margin: "0 0 6px", fontWeight: 650 }}>
                  {sku.partnerSku}
                  {sku.name ? ` · ${sku.name}` : ""}
                  {" · "}共 {sku.totalPcs} 件
                  {sku.preferred
                    ? ` · 最常用：${sku.preferred.forwarder} ${shipModeLabel(sku.preferred.mode)}（${sku.preferred.pcs} 件）`
                    : ""}
                </p>
                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>货代</th>
                        <th>方式</th>
                        <th>货性（按货代）</th>
                        <th>件数</th>
                        <th>箱数</th>
                        <th>占比</th>
                        <th>首次</th>
                        <th>最近</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sku.channels.map((c) => {
                        const saveKey = `${sku.partnerSku}\0${c.forwarder}`;
                        return (
                          <tr key={`${c.forwarder}-${c.mode}`}>
                            <td>{c.forwarder}</td>
                            <td>{shipModeLabel(c.mode)}</td>
                            <td>
                              <select
                                className="input"
                                style={{ minWidth: 120, padding: "4px 8px" }}
                                value={c.cargoKind ?? ""}
                                disabled={cargoSavingKey === saveKey}
                                onChange={(e) =>
                                  void saveCargoHint(
                                    sku.partnerSku,
                                    c.forwarder,
                                    e.target.value,
                                  )
                                }
                              >
                                <option value="">未标注</option>
                                {cargoOptions.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>{c.pcs}</td>
                            <td>{c.boxCount}</td>
                            <td>{Math.round(c.share * 100)}%</td>
                            <td>{c.firstShipAt ?? "—"}</td>
                            <td>{c.lastShipAt ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {sku.recentSamples.length > 0 && (
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                    近样：
                    {sku.recentSamples
                      .slice(0, 5)
                      .map(
                        (s) =>
                          `${s.boxNo} ${s.forwarder}/${shipModeLabel(s.mode)}×${s.qty}@${s.shipAt ?? "?"}`,
                      )
                      .join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>货代看板 · 性价比排行</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              装箱实付（空运 RMB/kg、海运 RMB/方、在途天）+ 货代大纲普货报价（区间取中值）。
              {board?.source.pulledAt
                ? ` · 装箱 ${new Date(board.source.pulledAt).toLocaleString()}`
                : " · 无装箱快照"}
              {board?.freightRates?.pulledAt
                ? ` · 大纲 ${new Date(board.freightRates.pulledAt).toLocaleString()}（${board.freightRates.forwarderCount} 家）`
                : " · 大纲未同步"}
            </p>
            {llm && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  background: "var(--bg-muted, #f4f6f8)",
                  borderRadius: 8,
                }}
              >
                <p style={{ margin: "0 0 6px", fontWeight: 650 }}>
                  {llm.judgment.headline}
                  {llm.judgment.topPick ? ` · 首选 ${llm.judgment.topPick}` : ""}
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  置信度 {llm.judgment.confidence} · {llm.model}
                </p>
                {llm.judgment.caveats.length > 0 && (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                    {llm.judgment.caveats.map((c) => (
                      <li key={c} className="muted">
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <table className="table">
              <thead>
                <tr>
                  <th>排名</th>
                  <th>货代</th>
                  <th>得分</th>
                  <th>箱数</th>
                  <th>实收跨境</th>
                  <th>RMB/kg</th>
                  <th>RMB/方</th>
                  <th>大纲空运</th>
                  <th>大纲海运</th>
                  <th>均在途天</th>
                  <th>空/海箱</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {ranking.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="muted">
                      暂无货代数据。点「同步装箱表」或「同步货代大纲」。
                    </td>
                  </tr>
                ) : (
                  ranking.map((r) => {
                    const f = forwarders.find((x) => x.forwarder === r.forwarder);
                    const llmNote = llm?.judgment.rankingNotes.find(
                      (n) => n.forwarder === r.forwarder,
                    )?.note;
                    return (
                      <tr key={r.forwarder}>
                        <td>#{r.rank}</td>
                        <td style={{ fontWeight: 650 }}>{r.forwarder}</td>
                        <td>{r.score}</td>
                        <td>{f?.boxes ?? "—"}</td>
                        <td>
                          {f
                            ? f.boxFreightSum.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })
                            : "—"}
                        </td>
                        <td>{f?.rmbPerKg ?? "—"}</td>
                        <td>{f?.rmbPerCbm ?? "—"}</td>
                        <td>{r.quoteAirMid ?? "—"}</td>
                        <td>{r.quoteSeaMid ?? "—"}</td>
                        <td>{f?.avgTransitDays ?? "—"}</td>
                        <td>
                          {f
                            ? `${f.byMode?.air?.boxes ?? 0}/${f.byMode?.sea?.boxes ?? 0}`
                            : "—"}
                        </td>
                        <td className="muted" style={{ maxWidth: 280 }}>
                          {llmNote || r.reasons.slice(0, 2).join("；")}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginBottom: 16 }} id="packing-in-transit">
            <h3 style={{ marginTop: 0 }}>本店装箱在途明细</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              送仓时间为空视为在途 · 票 → 箱 → 箱内货
              {packingDetail?.storePrefixes?.length
                ? ` · 前缀 ${packingDetail.storePrefixes.join(",")}`
                : ""}
              {packingDetail
                ? ` · ${packingDetail.ticketCount}票 / ${packingDetail.boxCount}箱 / ${packingDetail.qty}件`
                : ""}
            </p>
            {!packingDetail?.tickets?.length ? (
              <p className="muted">暂无本店装箱在途明细（需同步装箱表且 Catalog 有 N 前缀）。</p>
            ) : (
              <div className="dash-transit-tree">
                {packingDetail.tickets.map((ticket) => (
                  <details key={ticket.ticketKey} className="dash-transit-ticket">
                    <summary>
                      <strong>
                        票 {ticket.ticketNo || ticket.logisticsNo || ticket.ticketKey}
                      </strong>
                      <span className="muted">
                        {ticket.boxCount} 箱 · {ticket.pcs} 件
                        {ticket.forwarder ? ` · ${ticket.forwarder}` : ""}
                        {ticket.modeRaw ? ` · ${ticket.modeRaw}` : ""}
                        {ticket.shipAt ? ` · 发货 ${ticket.shipAt}` : ""}
                      </span>
                    </summary>
                    {ticket.boxes.map((box) => (
                      <details key={box.boxNo} className="dash-transit-box">
                        <summary>
                          <code>{box.boxNo}</code>
                          <span className="muted">
                            {box.skuCount} 种货 · {box.pcs} 件
                          </span>
                        </summary>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>PSKU</th>
                              <th>品名</th>
                              <th>件数</th>
                            </tr>
                          </thead>
                          <tbody>
                            {box.items.map((it) => (
                              <tr key={`${box.boxNo}-${it.partnerSku}`}>
                                <td>
                                  <code>{it.partnerSku}</code>
                                </td>
                                <td>{it.title}</td>
                                <td>{it.qty}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    ))}
                  </details>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>装箱在途（查轨迹）</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              来自箱表「送仓时间为空 / 到仓情况含在途」· {packingInTransit.length} 箱 · 已接入货代可一键查轨迹
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>箱号</th>
                  <th>货代</th>
                  <th>方式</th>
                  <th>PCS</th>
                  <th>发货</th>
                  <th>票号</th>
                  <th>物流编号</th>
                  <th>ASN</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {packingInTransit.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="muted">
                      暂无装箱在途。
                    </td>
                  </tr>
                ) : (
                  packingInTransit.slice(0, 150).map((r) => {
                    const isYibang = r.forwarder.includes("亦邦");
                    const isFeitan = r.forwarder.includes("飞坦");
                    const isHansha = r.forwarder.includes("汉沙");
                    const isYayouhui = r.forwarder.includes("亚优汇");
                    const isYite = r.forwarder.includes("义特");
                    const isAnshida = r.forwarder.includes("安时达");
                    const isQike = r.forwarder.includes("起克");
                    const tracked = trackHits.find((h) => {
                      if (isYibang && h.portalId === "yibang") {
                        return trackQueryNo(h) === r.logisticsNo;
                      }
                      if (isFeitan && h.portalId === "feitan") {
                        return trackQueryNo(h) === r.ticketNo;
                      }
                      if (isHansha && h.portalId === "hansha") {
                        return trackQueryNo(h) === r.ticketNo;
                      }
                      if (isYayouhui && h.portalId === "yayouhui") {
                        return trackQueryNo(h) === r.ticketNo;
                      }
                      if (isYite && h.portalId === "yite") {
                        return (
                          trackQueryNo(h) ===
                          yiteWaybillFromLogistics(r.logisticsNo)
                        );
                      }
                      if (isAnshida && h.portalId === "anshida") {
                        return trackQueryNo(h) === r.ticketNo;
                      }
                      if (isQike && h.portalId === "qike") {
                        return trackQueryNo(h) === r.logisticsNo;
                      }
                      return false;
                    });
                    const canTrack =
                      (isYibang && !!r.logisticsNo) ||
                      (isFeitan && !!r.ticketNo) ||
                      (isHansha && !!r.ticketNo) ||
                      (isYayouhui && !!r.ticketNo) ||
                      (isYite && !!r.logisticsNo) ||
                      (isAnshida && !!r.ticketNo) ||
                      (isQike && !!r.logisticsNo);
                    const portalId: TrackPortalId = isYibang
                      ? "yibang"
                      : isFeitan
                        ? "feitan"
                        : isHansha
                          ? "hansha"
                          : isYayouhui
                            ? "yayouhui"
                            : isYite
                              ? "yite"
                              : isAnshida
                                ? "anshida"
                                : "qike";
                    const queryNo =
                      isYibang || isYite || isQike ? r.logisticsNo : r.ticketNo;
                    const trackKey = `track:${portalId}:${queryNo}`;
                    return (
                      <tr key={`${r.boxNo}-${r.logisticsNo}-${r.ticketNo}`}>
                        <td>{r.boxNo || "—"}</td>
                        <td>{r.forwarder}</td>
                        <td>{r.modeRaw || "—"}</td>
                        <td>{r.pcs}</td>
                        <td>{r.shipAt ?? "—"}</td>
                        <td>{r.ticketNo || "—"}</td>
                        <td>{r.logisticsNo || "—"}</td>
                        <td>{r.asn || "—"}</td>
                        <td>
                          {canTrack ? (
                            <button
                              className="btn"
                              type="button"
                              style={{ padding: "4px 10px", fontSize: 12 }}
                              disabled={!!busy}
                              onClick={() =>
                                void runTrack(
                                  queryNo,
                                  portalId,
                                  isFeitan
                                    ? packingModeRawToShip(r.modeRaw || "")
                                    : undefined,
                                )
                              }
                              title={tracked?.track.statusText}
                            >
                              {busy === trackKey
                                ? "查…"
                                : tracked?.track.ok
                                  ? "已查"
                                  : "查轨迹"}
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div
              className="row"
              style={{
                marginBottom: 10,
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <h3 style={{ margin: 0 }}>飞书日报空运 / 海运在途</h3>
              <ClearableInput
                className="input"
                style={{ minWidth: 220, maxWidth: 320 }}
                placeholder="搜索 PSKU / 标题"
                value={feishuQuery}
                onChange={(e) => setFeishuQuery(e.target.value)}
              />
            </div>
            <p className="muted" style={{ marginTop: 0, marginBottom: 10 }}>
              默认只展示有图/有标题的 {feishuView.visible.length}
              {feishuRows.length ? ` / ${feishuRows.length}` : ""} 行
              {feishuView.hiddenCount > 0 && !feishuView.searching
                ? ` · 已隐藏 ${feishuView.hiddenCount}（搜索可召回）`
                : ""}
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ minWidth: 260 }}>产品</th>
                  <th>空运在途</th>
                  <th>海运在途</th>
                  <th>已采购</th>
                  <th>报表日</th>
                </tr>
              </thead>
              <tbody>
                {feishuRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      暂无飞书在途。点上方同步日报。
                    </td>
                  </tr>
                ) : feishuView.visible.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      {feishuView.searching
                        ? "无匹配行。"
                        : "暂无有图/有标题的行；可搜索 PSKU 查看隐藏项。"}
                    </td>
                  </tr>
                ) : (
                  feishuView.visible.map((r) => (
                    <tr key={r.partnerSku}>
                      <td>
                        <ProductCell
                          partnerSku={r.partnerSku}
                          title={r.title}
                          imageUrl={r.imageUrl}
                        />
                      </td>
                      <td>{r.airInTransit}</td>
                      <td>{r.seaInTransit}</td>
                      <td>{r.purchasedQty}</td>
                      <td>{r.reportDate ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div
              className="row"
              style={{
                marginBottom: 10,
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <h3 style={{ margin: 0 }}>Noon 库存在途</h3>
              <ClearableInput
                className="input"
                style={{ minWidth: 220, maxWidth: 320 }}
                placeholder="搜索 PSKU / 标题"
                value={noonQuery}
                onChange={(e) => setNoonQuery(e.target.value)}
              />
            </div>
            <p className="muted" style={{ marginTop: 0, marginBottom: 10 }}>
              默认只展示有图/有标题的 {noonView.visible.length}
              {noonRows.length ? ` / ${noonRows.length}` : ""} 行
              {noonView.hiddenCount > 0 && !noonView.searching
                ? ` · 已隐藏 ${noonView.hiddenCount}（搜索可召回）`
                : ""}
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ minWidth: 260 }}>产品</th>
                  <th>在库</th>
                  <th>在途</th>
                </tr>
              </thead>
              <tbody>
                {noonRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      当前无 inTransitQty &gt; 0 的库存行。
                    </td>
                  </tr>
                ) : noonView.visible.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      {noonView.searching
                        ? "无匹配行。"
                        : "暂无有图/有标题的行；可搜索 PSKU 查看隐藏项。"}
                    </td>
                  </tr>
                ) : (
                  noonView.visible.map((r) => (
                    <tr key={r.partnerSku}>
                      <td>
                        <ProductCell
                          partnerSku={r.partnerSku}
                          title={r.title}
                          imageUrl={r.imageUrl}
                        />
                      </td>
                      <td>{r.onHand}</td>
                      <td>{r.inTransit}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
