import { useState } from "react";
import { api, type BrowserExtensionId } from "../api";

const LABELS: Record<
  BrowserExtensionId,
  { title: string; short: string; updateHint: string }
> = {
  listing: {
    title: "Listing 采集扩展",
    short: "拉取 Listing 插件",
    updateHint: "解压覆盖 listing-extension → 扩展页点「重新加载」",
  },
  "asn-booking": {
    title: "约仓陪伴扩展",
    short: "拉取约仓插件",
    updateHint: "解压覆盖 asn-booking-extension → 扩展页点「重新加载」",
  },
};

export function ExtensionDownloadBtn(props: {
  extId: BrowserExtensionId;
  /** 紧凑：只显示短文案 */
  compact?: boolean;
  className?: string;
  onError?: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [okHint, setOkHint] = useState("");
  const meta = LABELS[props.extId];

  async function download() {
    setBusy(true);
    setOkHint("");
    try {
      const res = await fetch(api.browserExtensionZipUrl(props.extId), {
        credentials: "include",
      });
      if (!res.ok) {
        let msg = "下载扩展失败";
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const ver = res.headers.get("X-Outpost-Extension-Version") || "";
      const blob = await res.blob();
      const a = document.createElement("a");
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = `outpost-${props.extId}-extension${ver ? `-v${ver}` : ""}.zip`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      setOkHint(ver ? `已下载 v${ver}，请覆盖旧文件夹后重新加载` : "已下载，请覆盖旧文件夹后重新加载");
      window.setTimeout(() => setOkHint(""), 6000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      props.onError?.(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`ext-dl-wrap${props.className ? ` ${props.className}` : ""}`}
    >
      <button
        type="button"
        className="btn-ext-dl"
        disabled={busy}
        title={`${meta.title}：${meta.updateHint}`}
        onClick={() => void download()}
      >
        <span className="btn-ext-dl-icon" aria-hidden>
          ↓
        </span>
        <span className="btn-ext-dl-text">
          {busy ? "正在拉取…" : props.compact ? meta.short : `拉取最新 · ${meta.title}`}
        </span>
        <span className="btn-ext-dl-badge">插件</span>
      </button>
      {!props.compact && (
        <p className="ext-dl-hint muted">
          {okHint || meta.updateHint}
        </p>
      )}
      {props.compact && okHint && (
        <span className="ext-dl-hint-inline muted">{okHint}</span>
      )}
    </div>
  );
}
