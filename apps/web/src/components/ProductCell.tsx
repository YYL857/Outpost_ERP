import { useState } from "react";
import { copyText } from "../lib/clipboard";

type Props = {
  partnerSku: string;
  title?: string | null;
  imageUrl?: string | null;
  /** 额外副标题，如 noonSku */
  sub?: string | null;
  /** 次要说明行（如 Catalog 英文名 / 供应商） */
  detail?: string | null;
  /** 缩略图边长，默认 56 */
  thumbSize?: number;
};

function ProductThumb({
  url,
  title,
  size = 56,
}: {
  url: string;
  title: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (!url || broken) {
    return (
      <div
        className="cat-thumb cat-thumb-empty"
        style={style}
        title="暂无图片"
      >
        !
      </div>
    );
  }
  return (
    <img
      className="cat-thumb"
      style={style}
      src={url}
      alt={title || "product"}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

function CopyableId({
  value,
  title,
}: {
  value: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="cat-id-chip" title={title}>
      <span>{value}</span>
      <button
        type="button"
        className="cat-copy-btn"
        title={`复制 ${value}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void copyText(value).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "已复制" : "复制"}
      </button>
    </span>
  );
}

/** 表格内产品展示：缩略图 + 名称 + SKU（复用 Catalog 样式） */
export function ProductCell({
  partnerSku,
  title,
  imageUrl,
  sub,
  detail,
  thumbSize,
}: Props) {
  const name = (title || "").trim() || "—";
  const detailText = (detail || "").trim();
  const sku = (partnerSku || "").trim();
  const subText = (sub || "").trim();
  return (
    <div className="cat-product">
      <ProductThumb url={imageUrl || ""} title={name} size={thumbSize} />
      <div className="cat-product-body">
        <div className="cat-title" title={name}>
          {name}
        </div>
        {detailText ? (
          <div className="cat-detail" title={detailText}>
            {detailText}
          </div>
        ) : null}
        <div className="cat-ids">
          {sku ? (
            <CopyableId value={sku} title="Partner SKU / 关联键" />
          ) : null}
          {subText ? (
            <CopyableId value={subText} title={subText} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
