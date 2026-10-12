import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, onSessionReplaced, type AuthUserPublic, type ShopInfo } from "./api";
import { Sidebar } from "./layout/Sidebar";
import { Topbar } from "./layout/Topbar";
import {
  canAccessModule,
  MODULES,
  type AppModule,
  type ModuleKey,
} from "./modules";
import { HomePage } from "./pages/HomePage";
import { ModulePlaceholder } from "./pages/ModulePlaceholder";
import { NoonPage } from "./pages/NoonPage";
import { SyncHealthPage } from "./pages/SyncHealthPage";
import { CatalogPage } from "./pages/CatalogPage";
import { ListingPage } from "./pages/ListingPage";
import { InfoCheckPage } from "./pages/InfoCheckPage";
import { SalesPage } from "./pages/SalesPage";
import { BestSellPage } from "./pages/BestSellPage";
import { FinancePage } from "./pages/FinancePage";
import { BomCostPage } from "./pages/BomCostPage";
import { DocsAssistPage } from "./pages/DocsAssistPage";
import { MarketIntelPage } from "./pages/MarketIntelPage";
import { DailyBriefPage } from "./pages/DailyBriefPage";
import { OpsDailyPage } from "./pages/OpsDailyPage";
import { SchedulersPage } from "./pages/SchedulersPage";
import { AdsPage } from "./pages/AdsPage";
import { PurchasePage } from "./pages/PurchasePage";
import { ReplenishPage } from "./pages/ReplenishPage";
import { ShippingOpsPage } from "./pages/ShippingOpsPage";
import { TicketLedgerPage } from "./pages/TicketLedgerPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { LoginPage } from "./pages/LoginPage";
import { UsersPage } from "./pages/UsersPage";
import { AuditPage } from "./pages/AuditPage";
import { NoonGuidePage } from "./pages/NoonGuidePage";
import { TaskPlanningPage } from "./pages/TaskPlanningPage";
import { PwStudioPage } from "./pages/PwStudioPage";
import { TaskInboxModal } from "./components/TaskInboxModal";
import { AgentHubFloat } from "./components/AgentHubFloat";
import type { TaskInboxItem } from "./api";

function isAuthLost(e: unknown) {
  const code = (e as { code?: string }).code;
  return code === "UNAUTHORIZED" || code === "SESSION_REPLACED";
}

function alertIfNeeded(e: unknown, fallback: string) {
  if ((e as { code?: string }).code === "SESSION_REPLACED") return;
  alert(e instanceof Error ? e.message : fallback);
}

function syncTone(status?: string): "ok" | "warn" | "danger" | "idle" {
  if (status === "failed") return "danger";
  if (status === "warning" || status === "running") return "warn";
  if (status === "success") return "ok";
  return "idle";
}

const READY_PAGES: Partial<Record<ModuleKey, React.ReactNode>> = {
  home: <HomePage />,
  "sync-health": <SyncHealthPage />,
  schedulers: <SchedulersPage />,
  noon: <NoonPage />,
  "noon-guide": <NoonGuidePage />,
  catalog: <CatalogPage />,
  listing: <ListingPage />,
  "info-check": <InfoCheckPage />,
  sales: <SalesPage />,
  "best-sell": <BestSellPage />,
  finance: <FinancePage />,
  "bom-cost": <BomCostPage />,
  "docs-assist": <DocsAssistPage />,
  selection: <MarketIntelPage />,
  "daily-brief": <DailyBriefPage />,
  "ops-daily": <OpsDailyPage />,
  ads: <AdsPage />,
  purchase: <PurchasePage />,
  replenish: <ReplenishPage />,
  shipping: <ShippingOpsPage />,
  "ticket-ledger": <TicketLedgerPage />,
  campaigns: <CampaignsPage />,
  users: <UsersPage />,
  audit: <AuditPage />,
};

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tabs, setTabs] = useState<AppModule[]>([MODULES[0]!]);
  const [overall, setOverall] = useState<string>("idle");
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [activeShopId, setActiveShopId] = useState("");
  const [shopBusy, setShopBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<AuthUserPublic | null>(null);
  const [taskInbox, setTaskInbox] = useState<TaskInboxItem[]>([]);
  const [inboxIndex, setInboxIndex] = useState(0);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [showInboxModal, setShowInboxModal] = useState(true);
  const [sessionNotice, setSessionNotice] = useState("");

  useEffect(() => {
    return onSessionReplaced((message) => {
      setSessionNotice(message);
      setUser(null);
      setShops([]);
      setTaskInbox([]);
      window.alert(message);
    });
  }, []);

  useEffect(() => {
    api
      .me()
      .then((res) => {
        setUser(res.data.user);
        setActiveShopId(res.data.selectedShopId);
      })
      .catch(() => setUser(null))
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    api
      .getShops()
      .then((res) => {
        setShops(res.data.shops);
        setActiveShopId(res.data.activeShopId);
      })
      .catch((e) => {
        if (isAuthLost(e)) setUser(null);
      });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const tick = () => {
      api
        .getSyncHealth()
        .then((res) => setOverall(res.data.overall))
        .catch((e) => {
          if (isAuthLost(e)) {
            setUser(null);
            return;
          }
          setOverall("failed");
        });
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [activeShopId, user]);

  useEffect(() => {
    if (!user) return;
    const tick = () => {
      api
        .getTaskInbox()
        .then((res) => {
          setTaskInbox(res.data.items);
          setInboxIndex((i) =>
            res.data.items.length === 0
              ? 0
              : Math.min(i, res.data.items.length - 1),
          );
          if (res.data.items.length > 0) setShowInboxModal(true);
        })
        .catch((e) => {
          if (isAuthLost(e)) setUser(null);
        });
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [user]);

  const userRole = user?.role;
  const landing = useMemo(() => {
    const home = MODULES.find((m) => m.key === "home");
    if (home && canAccessModule(home, userRole)) return home;
    return MODULES.find((m) => canAccessModule(m, userRole)) ?? MODULES[0]!;
  }, [userRole]);
  const visibleTabs = useMemo(() => {
    const next = tabs.filter((t) => canAccessModule(t, userRole));
    return next.length > 0 ? next : [landing];
  }, [tabs, userRole, landing]);

  useEffect(() => {
    const mod = MODULES.find((m) => m.path === location.pathname);
    if (!mod) return;
    if (!canAccessModule(mod, user?.role)) return;
    setTabs((prev) => {
      const withMod = prev.some((t) => t.key === mod.key) ? prev : [...prev, mod];
      const next = withMod.filter((t) => canAccessModule(t, user?.role));
      return next.length > 0 ? next : [landing];
    });
  }, [location.pathname, user, landing]);

  const active = useMemo(
    () => MODULES.find((m) => m.path === location.pathname) ?? landing,
    [location.pathname, landing],
  );

  function openModule(mod: AppModule) {
    if (!canAccessModule(mod, user?.role)) return;
    setTabs((prev) => {
      const withMod = prev.some((t) => t.key === mod.key) ? prev : [...prev, mod];
      const next = withMod.filter((t) => canAccessModule(t, user?.role));
      return next.length > 0 ? next : [landing];
    });
  }

  function closeTab(key: string) {
    setTabs((prev) => {
      const next = prev.filter(
        (t) => t.key !== key && canAccessModule(t, user?.role),
      );
      if (active.key === key) {
        const fallback = next[next.length - 1] ?? landing;
        navigate(fallback.path);
      }
      return next.length ? next : [landing];
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
      alertIfNeeded(e, "切换店铺失败");
    } finally {
      setShopBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setUser(null);
    setShops([]);
    setTaskInbox([]);
    navigate("/");
  }

  const inboxItem = taskInbox[inboxIndex] ?? null;

  function openTasksModule(taskId?: string) {
    const mod = MODULES.find((m) => m.key === "tasks");
    if (!mod) return;
    if (taskId) setFocusTaskId(taskId);
    openModule(mod);
    navigate(mod.path);
  }

  async function refreshInbox() {
    const res = await api.getTaskInbox();
    setTaskInbox(res.data.items);
    setInboxIndex(0);
    if (res.data.items.length === 0) setShowInboxModal(false);
  }

  async function handleInboxAck() {
    if (!inboxItem) return;
    setInboxBusy(true);
    try {
      await api.ackTask(inboxItem.taskId);
      await refreshInbox();
    } catch (e) {
      alertIfNeeded(e, "确认失败");
    } finally {
      setInboxBusy(false);
    }
  }

  async function handleInboxDismissReject() {
    if (!inboxItem) return;
    setInboxBusy(true);
    try {
      await api.dismissTaskReject(inboxItem.taskId);
      openTasksModule(inboxItem.taskId);
      await refreshInbox();
    } catch (e) {
      alertIfNeeded(e, "操作失败");
    } finally {
      setInboxBusy(false);
    }
  }

  function handleInboxGo() {
    if (!inboxItem) return;
    openTasksModule(inboxItem.taskId);
    setShowInboxModal(false);
  }

  function handleInboxSkip() {
    setInboxIndex((i) => (i + 1) % Math.max(taskInbox.length, 1));
  }

  if (!authReady) {
    return (
      <div className="login-page login-page-loading">
        <div className="login-stage" aria-hidden>
          <div className="login-aurora login-aurora-a" />
          <div className="login-vignette" />
        </div>
        <p className="login-loading">加载中…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        notice={sessionNotice}
        onLoggedIn={() => {
          setSessionNotice("");
          api.me().then((res) => {
            setUser(res.data.user);
            setActiveShopId(res.data.selectedShopId);
            const role = res.data.user.role;
            const dash =
              MODULES.find(
                (m) => m.key === "home" && canAccessModule(m, role),
              ) ??
              MODULES.find((m) => canAccessModule(m, role)) ??
              MODULES[0]!;
            setTabs([dash]);
            navigate(dash.path, { replace: true });
          });
        }}
      />
    );
  }

  if (location.pathname === "/pw-studio") {
    if (user.role !== "admin") {
      return <Navigate to={landing.path} replace />;
    }
    return (
      <PwStudioPage
        onExit={() => navigate(landing.path)}
        shops={shops}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar onOpen={openModule} role={user.role} />
      <div className="main">
        <Topbar
          tabs={visibleTabs}
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
          user={user}
          onLogout={handleLogout}
          pinnedKey={landing.key}
          taskInboxCount={taskInbox.length}
          onOpenTasks={() => {
            openTasksModule();
            setShowInboxModal(taskInbox.length > 0);
          }}
          syncBadge={{
            label:
              overall === "failed"
                ? "同步失败 · 去对齐"
                : overall === "warning" || overall === "running"
                  ? "同步告警 · 去对齐"
                  : overall === "success"
                    ? "同步正常"
                    : "同步未知",
            tone: syncTone(overall),
          }}
          onSyncClick={
            user.role === "admin"
              ? () => {
                  const mod = MODULES.find((m) => m.key === "sync-health");
                  if (!mod) return;
                  openModule(mod);
                  navigate(mod.path);
                }
              : undefined
          }
        />
        <main className="content">
          <Routes>
            {MODULES.filter((m) => canAccessModule(m, user.role)).map(
              (m) => (
                <Route
                  key={m.key}
                  path={m.path}
                  element={
                    m.key === "tasks" ? (
                      <TaskPlanningPage
                        focusTaskId={focusTaskId}
                        onFocusConsumed={() => setFocusTaskId(null)}
                      />
                    ) : (
                      READY_PAGES[m.key] ?? (
                        <ModulePlaceholder
                          title={m.title}
                          description={`${m.group} · 计划阶段 ${m.phase} · 架构位已留，待业务填充`}
                          phase={m.phase}
                        />
                      )
                    )
                  }
                />
              ),
            )}
            <Route path="*" element={<Navigate to={landing.path} replace />} />
          </Routes>
        </main>
      </div>
      {showInboxModal && inboxItem && (
        <TaskInboxModal
          item={inboxItem}
          remaining={taskInbox.length}
          busy={inboxBusy}
          onAck={handleInboxAck}
          onGo={handleInboxGo}
          onDismissReject={handleInboxDismissReject}
          onSkip={handleInboxSkip}
        />
      )}
      <AgentHubFloat userId={user?.id} shopId={activeShopId || null} />
    </div>
  );
}
