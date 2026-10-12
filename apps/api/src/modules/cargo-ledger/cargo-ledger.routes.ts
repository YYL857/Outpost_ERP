import { Router } from "express";
import { requireCapability } from "../../auth/permissions.js";
import { filterTickets, findTicket, ledgerMeta } from "./query.js";
import {
  loadOrBuildCargoLedger,
  rebuildCargoLedger,
} from "./store.js";

export function createCargoLedgerRouter() {
  const router = Router();
  router.use(requireCapability("shipping.read"));

  router.get("/meta", (_req, res) => {
    try {
      const ledger = loadOrBuildCargoLedger();
      res.json({ data: ledgerMeta(ledger) });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/rebuild", (_req, res) => {
    try {
      const { ledger, path } = rebuildCargoLedger();
      res.json({
        data: ledgerMeta(ledger),
        message: `已清洗写入 ${path}`,
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/tickets", (req, res) => {
    try {
      const ledger = loadOrBuildCargoLedger();
      const transitRaw = String(req.query.transit ?? "all");
      const transit =
        transitRaw === "in_transit" || transitRaw === "arrived"
          ? transitRaw
          : "all";
      const result = filterTickets(ledger, {
        shop: String(req.query.shop ?? ""),
        q: String(req.query.q ?? ""),
        transit,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 50,
      });
      res.json({ data: result.rows, meta: result });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/ticket", (req, res) => {
    try {
      const key = String(req.query.key ?? "").trim();
      if (!key) {
        res.status(400).json({ error: "需要 key=票号" });
        return;
      }
      const ledger = loadOrBuildCargoLedger();
      const ticket = findTicket(ledger, key);
      if (!ticket) {
        res.status(404).json({ error: "未找到该票", code: "NOT_FOUND" });
        return;
      }
      res.json({ data: ticket });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return router;
}
