import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, type ShopInfo } from "./api";
import { Sidebar } from "./layout/Sidebar";
import { Topbar } from "./layout/Topbar";
import { MODULES, type AppModule, type ModuleKey } from "./modules";
import { HomePage } from "./pages/HomePage";
import { ModulePlaceholder } from "./pages/ModulePlaceholder";
import { NoonPage } from "./pages/NoonPage";
import { SyncHealthPage } from "./pages/SyncHealthPage";
import { CatalogPage } from "./pages/CatalogPage";
import { ListingPage } from "./pages/ListingPage";
import { SalesPage } from "./pages/SalesPage";
import { BestSellPage } from "./pages/BestSellPage";
import { FinancePage } from "./pages/FinancePage";
import { SessionExpiryGuard } from "./components/SessionExpiryGuard";

function syncTone(status?: string): "ok" | "warn" | "danger" | "idle" {
  if (status === "failed") return "danger";
  if (status === "warning" || status === "running") return "warn";
  if (status === "success") return "ok";
  return "idle";
}

const READY_PAGES: Partial<Record<ModuleKey, React.ReactNode>> = {
  home: <HomePage />,
  "sync-health": <SyncHealthPage />,
  noon: <NoonPage />,
  catalog: <CatalogPage />,
  listing: <ListingPage />,
  sales: <SalesPage />,
  "best-sell": <BestSellPage />,
  finance: <FinancePage />,
};

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const home = MODULES[0];
  const [tabs, setTabs] = useState<AppModule[]>([home]);
  const [overall, setOverall] = useState<string>("idle");
  const [sessionHealth, setSessionHealth] = useState<string>("missing");
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [activeShopId, setActiveShopId] = useState("");
  const [shopBusy, setShopBusy] = useState(false);

  useEffect(() => {
    api
      .getShops()
      .then((res) => {
        setShops(res.data.shops);
        setActiveShopId(res.data.activeShopId);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const tick = () => {
      api
        .getSyncHealth()
        .then((res) => setOverall(res.data.overall))
        .catch(() => setOverall("failed"));
      api
        .getPortalSessionStatus()
        .then((res) => setSessionHealth(res.data.health))
        .catch(() => setSessionHealth("missing"));
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [activeShopId]);

  useEffect(() => {
    const mod = MODULES.find((m) => m.path === location.pathname);
    if (!mod) return;
    setTabs((prev) => (prev.some((t) => t.key === mod.key) ? prev : [...prev, mod]));
  }, [location.pathname]);

  const active = useMemo(
    () => MODULES.find((m) => m.path === location.pathname) ?? home,
    [location.pathname, home],
  );

  function openModule(mod: AppModule) {
    setTabs((prev) => (prev.some((t) => t.key === mod.key) ? prev : [...prev, mod]));
  }

  function closeTab(key: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.key !== key);
      if (active.key === key) {
        const fallback = next[next.length - 1] ?? home;
        navigate(fallback.path);
      }
      return next.length ? next : [home];
    });
  }

  async function switchShop(shopId: string) {
    if (!shopId || shopId === activeShopId) return;
    setShopBusy(true);
    try {
      const res = await api.setActiveShop(shopId);
      setActiveShopId(res.data.activeShopId);
      const list = await api.getShops();
      setShops(list.data.shops);
      navigate(0);
    } catch (e) {
      alert(e instanceof Error ? e.message : "切换店铺失败");
    } finally {
      setShopBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <Sidebar onOpen={openModule} />
      <div className="main">
        <Topbar
          tabs={tabs}
          activePath={active.path}
          onSelect={(mod) => {
            openModule(mod);
            navigate(mod.path);
          }}
          onClose={closeTab}
          shops={shops}
          activeShopId={activeShopId}
          onShopChange={switchShop}
          shopBusy={shopBusy}
          syncBadge={{
            label:
              overall === "failed"
                ? "同步失败"
                : overall === "warning" || overall === "running"
                  ? "同步告警"
                  : overall === "success"
                    ? "同步正常"
                    : "同步未知",
            tone: syncTone(overall),
          }}
          sessionBadge={
            sessionHealth === "expired"
              ? { label: "登录态已过期", tone: "danger" }
              : sessionHealth === "warning"
                ? { label: "登录态将过期", tone: "warn" }
                : sessionHealth === "ok"
                  ? { label: "登录态有效", tone: "ok" }
                  : { label: "未登录 NOON", tone: "idle" }
          }
        />
        <main className="content">
          <Routes>
            {MODULES.map((m) => (
              <Route
                key={m.key}
                path={m.path}
                element={
                  READY_PAGES[m.key] ?? (
                    <ModulePlaceholder
                      title={m.title}
                      description={`${m.group} · 计划阶段 ${m.phase} · 架构位已留，待业务填充`}
                      phase={m.phase}
                    />
                  )
                }
              />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <SessionExpiryGuard />
      </div>
    </div>
  );
}
