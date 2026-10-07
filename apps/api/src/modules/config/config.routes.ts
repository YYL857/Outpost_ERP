import { Router } from "express";
import { z } from "zod";
import type { AppState } from "../../common/types.js";
import { saveState } from "../../data/store.js";

const shippingSchema = z.object({
  airFreightAedPerKg: z.number().nonnegative().optional().default(0),
  airLeadDays: z.number().int().positive(),
  seaFreightAedPerCbm: z.number().nonnegative().optional().default(0),
  seaLeadDays: z.number().int().positive(),
  airFreightRmbPerKg: z.number().nonnegative(),
  seaFreightRmbPerCbmPlug: z.number().nonnegative(),
  seaFreightRmbPerCbmBuiltin: z.number().nonnegative(),
  seaFreightRmbPerCbmGeneral: z.number().nonnegative(),
  buybackRate: z.number().positive(),
  volumetricDivisor: z.number().positive(),
});

const reviewSchema = z.object({
  commissionRmb: z.number().nonnegative(),
  exchangeRate: z.number().positive(),
  expressFeeRmb: z.number().nonnegative(),
  balanceRmb: z.number(),
});

export function createConfigRouter(getState: () => AppState) {
  const router = Router();

  router.get("/shipping", (_req, res) => {
    res.json({ data: getState().shipping });
  });

  router.put("/shipping", (req, res) => {
    const parsed = shippingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "参数无效", details: parsed.error.flatten() });
      return;
    }
    const state = getState();
    state.shipping = { ...parsed.data, updatedAt: new Date().toISOString() };
    saveState(state);
    res.json({ data: state.shipping });
  });

  router.get("/review", (_req, res) => {
    res.json({ data: getState().review });
  });

  router.put("/review", (req, res) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "参数无效", details: parsed.error.flatten() });
      return;
    }
    const state = getState();
    state.review = { ...parsed.data, updatedAt: new Date().toISOString() };
    saveState(state);
    res.json({ data: state.review });
  });

  return router;
}
