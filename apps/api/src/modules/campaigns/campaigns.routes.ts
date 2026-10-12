import { Router } from "express";
import type { AppState } from "../../common/types.js";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * 活动管理（当前可展示层）：从 adsFacts.campaign 汇总广告活动名。
 * 这不是 Seller Lab 促销/Deal；正式 campaigns 域尚未映射。
 */
export function createCampaignsRouter(getState: () => AppState) {
  const router = Router();

  router.get("/overview", (_req, res) => {
    const map = new Map<
      string,
      {
        campaign: string;
        spend: number;
        revenue: number;
        orders: number;
        clicks: number;
        skus: Set<string>;
        fromDate: string;
        toDate: string;
      }
    >();
    for (const f of getState().adsFacts) {
      const name = f.campaign?.trim() || "(未标注活动)";
      const row = map.get(name) ?? {
        campaign: name,
        spend: 0,
        revenue: 0,
        orders: 0,
        clicks: 0,
        skus: new Set<string>(),
        fromDate: f.fromDate,
        toDate: f.toDate,
      };
      row.spend += f.spend;
      row.revenue += f.revenue;
      row.orders += f.orders;
      row.clicks += f.clicks;
      row.skus.add(f.partnerSku);
      if (f.fromDate < row.fromDate) row.fromDate = f.fromDate;
      if (f.toDate > row.toDate) row.toDate = f.toDate;
      map.set(name, row);
    }

    const rows = [...map.values()]
      .map((r) => ({
        campaign: r.campaign,
        spend: round2(r.spend),
        revenue: round2(r.revenue),
        orders: r.orders,
        clicks: r.clicks,
        skuCount: r.skus.size,
        roas: r.spend > 0 ? round2(r.revenue / r.spend) : null,
        fromDate: r.fromDate,
        toDate: r.toDate,
      }))
      .sort((a, b) => b.spend - a.spend);

    res.json({
      data: {
        rows,
        summary: {
          campaignCount: rows.length,
          source: "adsFacts.campaign（广告活动名）",
          caveat:
            "当前仅为广告 Campaign Overview 中的活动名汇总，不是平台促销/Deal 活动管理。",
          gap: "Noon Campaigns / promos 域未探测入库；无活动报名、折扣、库存锁定实体",
        },
      },
    });
  });

  return router;
}
