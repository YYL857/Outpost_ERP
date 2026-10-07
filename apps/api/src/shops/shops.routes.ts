import { Router } from "express";
import type { AppState } from "../common/types.js";
import { applyEnvToNoon, loadState, saveState } from "../data/store.js";
import { loadEnv } from "../config/env.js";
import { clearNoonApiGatewayCache } from "../platforms/noon/http.js";
import type { AppRepository } from "../data/repo/types.js";
import type { ShopRecord } from "./types.js";
import {
  applyShopEnv,
  getActiveShop,
  loadRegistry,
  registerShopFromCredentials,
  saveRegistry,
} from "./registry.js";

function replaceInMemoryState(
  getState: () => AppState,
  repo: AppRepository & { replaceState?: (s: AppState) => void },
  loaded: AppState,
) {
  if (typeof repo.replaceState === "function") {
    repo.replaceState(loaded);
    return;
  }
  const cur = getState();
  for (const key of Object.keys(cur) as (keyof AppState)[]) {
    delete (cur as Record<string, unknown>)[key as string];
  }
  Object.assign(cur, loaded);
}

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

function switchToShop(
  getState: () => AppState,
  repo: AppRepository & { replaceState?: (s: AppState) => void },
  nextShop: ShopRecord,
  opts?: { persistCurrent?: boolean },
) {
  if (opts?.persistCurrent !== false) {
    saveState(getState());
  }

  const registry = loadRegistry();
  registry.activeShopId = nextShop.id;
  saveRegistry(registry);
  applyShopEnv(nextShop);
  clearNoonApiGatewayCache();

  const env = loadEnv();
  const loaded = applyEnvToNoon(loadState(), env);
  applyShopToState(nextShop, loaded);
  replaceInMemoryState(getState, repo, loaded);
  saveState(getState());
}

export function createShopsRouter(
  getState: () => AppState,
  repo: AppRepository & { replaceState?: (s: AppState) => void },
) {
  const router = Router();

  router.get("/", (_req, res) => {
    const registry = loadRegistry();
    const active = getActiveShop(registry);
    res.json({
      data: {
        activeShopId: active.id,
        shops: registry.shops.map((s) => ({
          id: s.id,
          name: s.name,
          projectCode: s.projectCode,
          credentialsFile: s.credentialsFile,
          rootDir: s.rootDir,
          countryCode: s.countryCode,
          noonMode: s.noonMode,
          isActive: s.id === active.id,
        })),
      },
    });
  });

  /**
   * 店铺录入：前端传入本机 Service Account JSON 绝对路径。
   * 服务端读取 project_code 写入 shops-registry.json，不入库私钥内容。
   */
  router.post("/register", (req, res) => {
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

      let switched = false;
      if (setActive) {
        const active = getActiveShop();
        if (active.id !== result.shop.id) {
          switchToShop(getState, repo, result.shop);
          switched = true;
        } else {
          // 同店更新凭证路径：刷新 env + 网关缓存
          applyShopEnv(result.shop);
          clearNoonApiGatewayCache();
          const env = loadEnv();
          const loaded = applyEnvToNoon(getState(), env);
          applyShopToState(result.shop, loaded);
          saveState(loaded);
        }
      }

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
            isActive: getActiveShop().id === result.shop.id,
          },
          created: result.created,
          updated: result.updated,
          switched,
          activeShopId: getActiveShop().id,
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

  /** 从磁盘重载当前店 state（外部脚本 Impex/影刀入库后刷新内存） */
  router.post("/reload", (_req, res) => {
    const shop = getActiveShop();
    const env = loadEnv();
    const loaded = applyEnvToNoon(loadState(), env);
    applyShopToState(shop, loaded);
    replaceInMemoryState(getState, repo, loaded);
    res.json({
      data: {
        shopId: shop.id,
        catalog: getState().catalog.length,
        salesFacts: getState().salesFacts.length,
        feeSnapshots: getState().feeSnapshots.length,
        adsFacts: getState().adsFacts.length,
        stock: getState().stock.length,
      },
      message: `已从磁盘重载 ${shop.name}`,
    });
  });

  router.post("/active", (req, res) => {
    const shopId = String(req.body?.shopId ?? "").trim();
    const registry = loadRegistry();
    const nextShop = registry.shops.find((s) => s.id === shopId);
    if (!nextShop) {
      res.status(404).json({ error: `未知店铺: ${shopId}` });
      return;
    }
    if (nextShop.id === registry.activeShopId) {
      res.json({
        data: { activeShopId: nextShop.id, switched: false },
        message: `已是当前店铺 ${nextShop.name}`,
      });
      return;
    }

    switchToShop(getState, repo, nextShop);

    res.json({
      data: {
        activeShopId: nextShop.id,
        switched: true,
        catalogCount: getState().catalog.length,
        credentialsFile: nextShop.credentialsFile,
        dataDir: process.env.OUTPOST_DATA_DIR,
      },
      message: `已切换到 ${nextShop.name}（${nextShop.projectCode}）`,
    });
  });

  return router;
}
