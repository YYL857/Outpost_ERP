import type { AppModule } from "../modules";
import type { ShopInfo } from "../api";

type Props = {
  tabs: AppModule[];
  activePath: string;
  onSelect: (mod: AppModule) => void;
  onClose: (key: string) => void;
  syncBadge?: { label: string; tone: "ok" | "warn" | "danger" | "idle" };
  sessionBadge?: { label: string; tone: "ok" | "warn" | "danger" | "idle" };
  shops?: ShopInfo[];
  activeShopId?: string;
  onShopChange?: (shopId: string) => void;
  shopBusy?: boolean;
};

export function Topbar({
  tabs,
  activePath,
  onSelect,
  onClose,
  syncBadge,
  sessionBadge,
  shops,
  activeShopId,
  onShopChange,
  shopBusy,
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
            {tab.key !== "home" && (
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
            <select
              value={activeShopId ?? shops[0]?.id}
              disabled={shopBusy}
              onChange={(e) => onShopChange(e.target.value)}
            >
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.projectCode})
                </option>
              ))}
            </select>
          </label>
        )}
        {sessionBadge && (
          <span className={`badge ${sessionBadge.tone}`}>{sessionBadge.label}</span>
        )}
        {syncBadge && (
          <span className={`badge ${syncBadge.tone}`}>{syncBadge.label}</span>
        )}
      </div>
    </header>
  );
}
