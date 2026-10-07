import { Router } from "express";
import type { AppState } from "../../common/types.js";
import { saveState } from "../../data/store.js";

export function createStoreRouter(getState: () => AppState) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ data: getState().store });
  });

  router.patch("/", (req, res) => {
    const state = getState();
    const body = req.body ?? {};
    state.store = {
      ...state.store,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.account === "string" ? { account: body.account } : {}),
      ...(typeof body.site === "string" ? { site: body.site } : {}),
    };
    saveState(state);
    res.json({ data: state.store });
  });

  return router;
}
