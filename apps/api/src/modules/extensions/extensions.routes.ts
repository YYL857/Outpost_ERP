import { Router } from "express";
import {
  buildBrowserExtensionZip,
  isBrowserExtensionId,
  listBrowserExtensions,
} from "../../common/browser-extensions.js";

export function createExtensionsRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      data: listBrowserExtensions(),
      message:
        "下载 zip → 解压覆盖本机文件夹 → chrome://extensions 点「重新加载」即可更新",
    });
  });

  function sendExtensionZip(idRaw: string, res: import("express").Response) {
    const id = String(idRaw || "").trim().replace(/\.zip$/i, "");
    if (!isBrowserExtensionId(id)) {
      res.status(404).json({
        error: `未知扩展：${id}（可选 listing / asn-booking）`,
      });
      return;
    }
    try {
      const pack = buildBrowserExtensionZip(id);
      if (!pack) {
        res.status(404).json({ error: `扩展目录不存在：${id}` });
        return;
      }
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${pack.filename}"`,
      );
      res.setHeader("X-Outpost-Extension-Version", pack.version);
      res.send(pack.zip);
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  router.get("/:id/zip", (req, res) => {
    sendExtensionZip(String(req.params.id), res);
  });

  return router;
}
