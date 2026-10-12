/** Wiki-graph：实体节点 / 边 / Context Pack 类型（Phase 1） */

export type WikiNodeType =
  | "box"
  | "ticket"
  | "logistics"
  | "sku"
  | "forwarder"
  | "doc_sheet"
  | "table"
  | "purchase_order"
  | "tracking"
  | "shop";

export type WikiRel =
  | "in_box"
  | "has_ticket"
  | "tracked_by"
  | "shipped_via"
  | "from_sheet"
  | "ordered_as"
  | "quoted_by"
  | "for_shop"
  | "joins_on";

export type WikiKeyType =
  | "boxNo"
  | "ticketNo"
  | "logisticsNo"
  | "partnerSku"
  | "forwarder"
  | "orderId"
  | "trackingNo";

export type WikiNode = {
  id: string;
  type: WikiNodeType;
  label: string;
  summary: string;
  source: string;
  sourceRef: string | null;
  shopId: string | null;
  payload: Record<string, unknown>;
  updatedAt: string;
};

export type WikiEdge = {
  id: string;
  fromId: string;
  toId: string;
  rel: WikiRel;
  evidence: string | null;
  updatedAt: string;
};

export type WikiLookupHit = {
  keyType: WikiKeyType;
  keyValue: string;
  node: WikiNode;
};

export type ContextPack = {
  seed: { keyType: WikiKeyType; keyValue: string; nodeId: string };
  hops: number;
  entities: WikiNode[];
  edges: Array<{
    from: string;
    rel: WikiRel;
    to: string;
    evidence: string | null;
  }>;
  nextActions: string[];
  markdownCard: string;
  builtAt: string;
};

export type WikiGraphStats = {
  dbPath: string;
  nodes: number;
  edges: number;
  lookups: number;
  lastBuildAt: string | null;
  lastBuildSources: string[];
};

export type BuildReport = {
  ok: boolean;
  sources: string[];
  nodesUpserted: number;
  edgesUpserted: number;
  lookupsUpserted: number;
  snapshotPath: string | null;
  durationMs: number;
  error?: string;
};
