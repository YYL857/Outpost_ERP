import { join } from "node:path";
import { Router } from "express";
import type { AppState } from "../common/types.js";
import { applyEnvToNoon, saveState } from "../data/store.js";
import { loadEnv } from "../config/env.js";
import { clearNoonApiGatewayCache } from "../platforms/noon/http.js";
import type { AppRepository } from "../data/repo/types.js";
import type { ShopRecord } from "./types.js";
import {
  applyShopEnv,
  getActiveShop,
  loadRegistry,
  registerShopFromCredentials,
} from "./registry.js";
import {
  getShopState,
  reloadShopState,
  resolveCurrentShopId,
  setShopState,
  setSystemActiveShop,
} from "./state-cache.js";
import type { AuthedRequest } from "../auth/middleware.js";
import { requireAdmin } from "../auth/middleware.js";
import { setSelectedShopId } from "../auth/workspace.js";

function applyShopToState(shop: ShopRecord, loaded: AppState) {
  loaded.store.id = shop.id;
  loaded.store.name = shop.name;
  loaded.store.account = shop.projectCode;
  loaded.store.platform = "NOON";
  loaded.noon.partnerId = shop.projectCode;
  if (shop.noonMode !== "mock") {
    loaded.noon.mode = shop.noonMode;
  }
}

export function createShopsRouter(
  _getState: () => AppState,
  _repo: AppRepository & { replaceState?: (s: AppState) => void },
) {
  const router = Router();

  router.get("/", (req, res) => {
    const registry = loadRegistry();
    const user = (req as AuthedRequest).user;
    const selectedId = resolveCurrentShopId();
    const syncDefaultId = getActiveShop(registry).id;
    res.json({
      data: {
        activeShopId: selectedId,
        syncDefaultShopId: syncDefaultId,
        shops: registry.shops.map((s) => ({
          id: s.id,
          name: s.name,
          projectCode: s.projectCode,
          credentialsFile: s.credentialsFile,
          rootDir: s.rootDir,
          countryCode: s.countryCode,
          noonMode: s.noonMode,
          isActive: s.id === selectedId,
          isSyncDefault: s.id === syncDefaultId,
        })),
        userId: user?.id ?? null,
      },
    });
  });

  /** 店铺录入：仅超管 */
  router.post("/register", requireAdmin, (req, res) => {
    const credentialsFile = String(req.body?.credentialsFile ?? "").trim();
    const name = String(req.body?.name ?? "").trim();
    const countryCode = String(req.body?.countryCode ?? "sa").trim() as
      | "sa"
      | "ae"
      | "eg";
    const noonMode = String(req.body?.noonMode ?? "live").trim() as
      | "live"
      | "portal"
      | "mock";
    const setActive = req.body?.setActive !== false;
    const setSyncDefault = Boolean(req.body?.setSyncDefault);

    if (!credentialsFile) {
      res.status(400).json({ error: "请填写凭证 JSON 的本机绝对路径" });
      return;
    }
    if (!["sa", "ae", "eg"].includes(countryCode)) {
      res.status(400).json({ error: "countryCode 仅支持 sa / ae / eg" });
      return;
    }
    if (!["live", "portal", "mock"].includes(noonMode)) {
      res.status(400).json({ error: "noonMode 仅支持 live / portal / mock" });
      return;
    }

    try {
      const result = registerShopFromCredentials({
        credentialsFile,
        name: name || undefined,
        countryCode,
        noonMode,
      });

      const user = (req as AuthedRequest).user!;
      let switched = false;
      if (setActive) {
        setSelectedShopId(user.id, result.shop.id);
        switched = true;
      }
      if (setSyncDefault) {
        setSystemActiveShop(result.shop);
      } else if (getActiveShop().id === result.shop.id) {
        applyShopEnv(result.shop);
        clearNoonApiGatewayCache(result.shop.id);
        const env = loadEnv();
        const loaded = applyEnvToNoon(getShopState(result.shop.id), env);
        applyShopToState(result.shop, loaded);
        setShopState(result.shop.id, loaded);
        saveState(loaded, join(result.shop.rootDir, "json"));
      }

      const selectedId = setActive ? result.shop.id : resolveCurrentShopId();

      res.json({
        data: {
          shop: {
            id: result.shop.id,
            name: result.shop.name,
            projectCode: result.shop.projectCode,
            credentialsFile: result.shop.credentialsFile,
            rootDir: result.shop.rootDir,
            countryCode: result.shop.countryCode,
            noonMode: result.shop.noonMode,
            isActive: result.shop.id === selectedId,
            isSyncDefault: getActiveShop().id === result.shop.id,
          },
          created: result.created,
          updated: result.updated,
          switched,
          activeShopId: selectedId,
          syncDefaultShopId: getActiveShop().id,
        },
        message: result.created
          ? `已录入店铺 ${result.shop.name}（${result.shop.projectCode}）`
          : `已更新店铺 ${result.shop.name} 的凭证路径`,
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "店铺录入失败",
      });
    }
  });

  router.post("/reload", (_req, res) => {
    const shopId = resolveCurrentShopId();
    const registry = loadRegistry();
    const shop = registry.shops.find((s) => s.id === shopId) ?? getActiveShop();
    const loaded = reloadShopState(shop.id);
    res.json({
      data: {
        shopId: shop.id,
        catalog: loaded.catalog.length,
        salesFacts: loaded.salesFacts.length,
        feeSnapshots: loaded.feeSnapshots.length,
        adsFacts: loaded.adsFacts.length,
        stock: loaded.stock.length,
      },
      message: `已从磁盘重载 ${shop.name}`,
    });
  });

  router.post("/active", (req, res) => {
    const shopId = String(req.body?.shopId ?? "").trim();
    const setSyncDefault = Boolean(req.body?.setSyncDefault);
    const registry = loadRegistry();
    const nextShop = registry.shops.find((s) => s.id === shopId);
    if (!nextShop) {
      res.status(404).json({ error: `未知店铺: ${shopId}` });
      return;
    }

    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: "未登录" });
      return;
    }

    const prevSelected = resolveCurrentShopId();
    setSelectedShopId(user.id, nextShop.id);

    if (setSyncDefault) {
      if (user.role !== "admin") {
        res.status(403).json({ error: "仅超管可修改系统默认同步店" });
        return;
      }
      setSystemActiveShop(nextShop);
    }

    const state = getShopState(nextShop.id);

    res.json({
      data: {
        activeShopId: nextShop.id,
        switched: prevSelected !== nextShop.id,
        syncDefaultShopId: getActiveShop().id,
        catalogCount: state.catalog.length,
        credentialsFile: nextShop.credentialsFile,
        dataDir: join(nextShop.rootDir, "json"),
      },
      message: `已切换到 ${nextShop.name}（${nextShop.projectCode}）`,
    });
  });

  return router;
}
