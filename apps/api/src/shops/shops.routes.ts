import { Router } from "express";
import type { AppState } from "../common/types.js";
import { applyEnvToNoon, loadState, saveState } from "../data/store.js";
import { loadEnv } from "../config/env.js";
import { clearNoonApiGatewayCache } from "../platforms/noon/http.js";
import type { AppRepository } from "../data/repo/types.js";
import {
  applyShopEnv,
  getActiveShop,
  loadRegistry,
  saveRegistry,
} from "./registry.js";

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

    // 1) 落盘当前店
    saveState(getState());

    // 2) 切换环境（数据目录 / 凭证 / 会话 / 导入）
    registry.activeShopId = nextShop.id;
    saveRegistry(registry);
    applyShopEnv(nextShop);
    clearNoonApiGatewayCache();

    // 3) 加载目标店 state，替换内存引用
    const env = loadEnv();
    const loaded = applyEnvToNoon(loadState(), env);
    // 店铺展示信息写入 StoreInfo
    loaded.store.id = nextShop.id;
    loaded.store.name = nextShop.name;
    loaded.store.account = nextShop.projectCode;
    loaded.store.platform = "NOON";
    loaded.noon.partnerId = nextShop.projectCode;
    if (nextShop.noonMode !== "mock") {
      loaded.noon.mode = nextShop.noonMode;
    }

    if (typeof repo.replaceState === "function") {
      repo.replaceState(loaded);
    } else {
      // 兜底：原地覆盖（保持旧引用）
      const cur = getState();
      for (const key of Object.keys(cur) as (keyof AppState)[]) {
        delete (cur as Record<string, unknown>)[key as string];
      }
      Object.assign(cur, loaded);
    }
    saveState(getState());

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
