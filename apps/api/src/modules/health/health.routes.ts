import { Router } from "express";

export function createHealthRouter() {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "outpost-api",
      version: "0.1.0",
      time: new Date().toISOString(),
    });
  });
  return router;
}
