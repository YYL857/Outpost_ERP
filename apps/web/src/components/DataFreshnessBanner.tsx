/**
 * 数据新鲜度提示：全员可见缺口摘要；明细与一键补齐统一在「数据对齐」页。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type UserRole } from "../api";

const DOMAIN_LABEL: Record<string, string> = {
  sales: "销售",
  orders: "订单",
  ads: "广告",
  catalog: "价库",
  stock: "库存",
  fees: "费用",
};

type Props = {
  /** 紧凑样式（嵌在卡片内） */
  compact?: boolean;
};

export function DataFreshnessBanner({ compact }: Props) {
  const [role, setRole] = useState<UserRole | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [expectedEnd, setExpectedEnd] = useState<string | null>(null);
  const [complete, setComplete] = useState<boolean | null>(null);
  const [gapCount, setGapCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [me, gaps] = await Promise.all([
          api.me(),
          api.getDataGaps().catch(() => null),
        ]);
        if (cancelled) return;
        setRole(me.data.user.role);
        if (!gaps) {
          setComplete(null);
          return;
        }
        setComplete(gaps.data.complete);
        const incomplete = gaps.data.shops.filter(
          (s) => s.countsTowardHealth !== false && !s.complete,
        );
        if (!incomplete.length) {
          setLines([]);
          setGapCount(0);
          setExpectedEnd(
            gaps.data.shops.find((s) => s.countsTowardHealth !== false)
              ?.expectedEnd ??
              gaps.data.shops[0]?.expectedEnd ??
              null,
          );
          return;
        }
        setExpectedEnd(incomplete[0]?.expectedEnd ?? null);
        let n = 0;
        for (const s of incomplete) {
          n += s.domains.filter((d) => !d.ok).length;
        }
        setGapCount(n);
        const summary = incomplete.slice(0, 4).map((s) => {
          const bad = s.domains
            .filter((d) => !d.ok)
            .map((d) => {
              const label = DOMAIN_LABEL[d.domain] ?? d.domain;
              const max = d.maxDate ? `止于 ${d.maxDate}` : "无数据";
              return `${label}${max}`;
            })
            .slice(0, 3)
            .join("、");
          return `${s.shopName || s.shopId}：${bad || "有缺口"}`;
        });
        setLines(summary);
      } catch {
        if (!cancelled) setComplete(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (complete === null) return null;
  if (complete) return null;

  const isAdmin = role === "admin";

  if (compact) {
    return (
      <div className="data-fresh-banner is-compact" role="status">
        <div className="data-fresh-compact-row">
          <p>
            <strong>数据不是最新</strong>
            {expectedEnd ? ` · 期望至 ${expectedEnd}` : ""}
            {gapCount > 0 ? ` · ${gapCount} 项待对齐` : ""}
            {lines.length > 0 ? ` · ${lines[0]}` : ""}
          </p>
          {isAdmin ? (
            <Link className="btn btn-primary" to="/sync-health">
              数据对齐 · 一键补齐
            </Link>
          ) : (
            <span className="muted data-fresh-hint">联系超管更新</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="data-fresh-banner" role="status">
      <p>
        <strong>数据不是最新的</strong>
        {expectedEnd ? `（期望覆盖至 ${expectedEnd}）` : ""}
        {gapCount > 0 ? ` · ${gapCount} 项待对齐` : ""}。
        {isAdmin
          ? "明细、缺天数与补齐链路已汇总到「数据对齐」页。"
          : "请联系超级管理员在「数据对齐」更新，普通账号不能触发同步。"}
      </p>
      {isAdmin ? (
        <p className="data-fresh-actions">
          <Link className="btn btn-primary" to="/sync-health">
            打开数据对齐 · 一键补齐
          </Link>
        </p>
      ) : (
        <p className="muted data-fresh-hint">
          同步管理（一键补齐 / 汇总同步 / Impex / 广告导出）仅超级管理员可操作。
        </p>
      )}
    </div>
  );
}

/** 非超管看到的同步按钮占位提示 */
export function AdminSyncOnlyHint({ action = "同步数据" }: { action?: string }) {
  return (
    <p className="muted" style={{ margin: "0 0 12px" }}>
      「{action}」仅超级管理员可操作。若页面数据偏旧，请联系超管在「数据对齐」更新。
    </p>
  );
}

export function useIsAdmin(): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    void api
      .me()
      .then((r) => setIsAdmin(r.data.user.role === "admin"))
      .catch(() => setIsAdmin(false));
  }, []);
  return isAdmin;
}
