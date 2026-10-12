import { ChevronSelect } from "../components/ChevronSelect";
import { ThemeToggle } from "../components/ThemeToggle";
import type { AppModule } from "../modules";
import type { AuthUserPublic, ShopInfo } from "../api";

type Props = {
  tabs: AppModule[];
  activePath: string;
  onSelect: (mod: AppModule) => void;
  onClose: (key: string) => void;
  syncBadge?: { label: string; tone: "ok" | "warn" | "danger" | "idle" };
  /** 点击同步徽章：打开数据对齐页（超管） */
  onSyncClick?: () => void;
  shops?: ShopInfo[];
  activeShopId?: string;
  onShopChange?: (shopId: string) => void;
  shopBusy?: boolean;
  user?: AuthUserPublic | null;
  onLogout?: () => void;
  /** 不能关掉的默认页签（超管是数据看板，普通用户是第一个可见模块） */
  pinnedKey?: string;
  taskInboxCount?: number;
  onOpenTasks?: () => void;
};

export function Topbar({
  tabs,
  activePath,
  onSelect,
  onClose,
  syncBadge,
  onSyncClick,
  shops,
  activeShopId,
  onShopChange,
  shopBusy,
  user,
  onLogout,
  pinnedKey = "home",
  taskInboxCount = 0,
  onOpenTasks,
}: Props) {
  return (
    <header className="topbar">
      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab${tab.path === activePath ? " active" : ""}`}
            onClick={() => onSelect(tab)}
          >
            <span>{tab.title}</span>
            {tab.key !== pinnedKey && (
              <span
                className="tab-close"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.key);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    onClose(tab.key);
                  }
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="topbar-badges">
        {shops && shops.length > 0 && onShopChange && (
          <label className="shop-switch">
            <span className="shop-switch-label">店铺</span>
            <ChevronSelect
              value={activeShopId ?? shops[0]?.id ?? ""}
              disabled={shopBusy}
              options={shops.map((s) => ({
                value: s.id,
                label: `${s.name} (${s.projectCode})`,
              }))}
              onChange={onShopChange}
            />
          </label>
        )}
        <ThemeToggle />
        {user && (
          <span className="user-chip">
            {user.username}
            {user.role === "admin"
              ? " · 超管"
              : user.role === "ops_lead"
                ? " · 运营主管"
                : user.role === "purchase"
                  ? " · 采购"
                  : " · 运营"}
          </span>
        )}
        {user && onLogout && (
          <button type="button" className="btn-ghost" onClick={onLogout}>
            退出
          </button>
        )}
        {onOpenTasks && (
          <button
            type="button"
            className={`badge ${taskInboxCount > 0 ? "warn" : "idle"} task-inbox-chip`}
            onClick={onOpenTasks}
            title="任务规划"
          >
            任务{taskInboxCount > 0 ? ` ${taskInboxCount}` : ""}
          </button>
        )}
        {syncBadge &&
          (onSyncClick ? (
            <button
              type="button"
              className={`badge sync-badge-btn ${syncBadge.tone}`}
              onClick={onSyncClick}
              title="打开数据对齐 · 一键补齐"
            >
              {syncBadge.label}
            </button>
          ) : (
            <span className={`badge ${syncBadge.tone}`}>{syncBadge.label}</span>
          ))}
      </div>
    </header>
  );
}
