import type { Database } from "sql.js";
import { getWikiDb } from "./db.js";
import { getNodeById, lookupByKeyOn } from "./lookup.js";
import { rowToNode } from "./upsert.js";
import type {
  ContextPack,
  WikiKeyType,
  WikiNode,
  WikiNodeType,
  WikiRel,
} from "./types.js";

/** 这些类型只作为叶子展示，不继续向外扩（避免整表/整货代爆炸） */
const LEAF_TYPES: ReadonlySet<WikiNodeType> = new Set([
  "doc_sheet",
  "forwarder",
  "table",
]);

/** 不沿这些边做 BFS（表归属边会连到所有行） */
const SKIP_RELS_FOR_BFS: ReadonlySet<WikiRel> = new Set([
  "from_sheet",
  "joins_on",
  "quoted_by",
]);

function neighborIds(
  db: Database,
  nodeId: string,
): Array<{
  otherId: string;
  rel: WikiRel;
  evidence: string | null;
  from: string;
  to: string;
}> {
  const out: Array<{
    otherId: string;
    rel: WikiRel;
    evidence: string | null;
    from: string;
    to: string;
  }> = [];
  const stmt = db.prepare(
    `SELECT from_id, to_id, rel, evidence FROM edges
     WHERE from_id = ? OR to_id = ?`,
  );
  stmt.bind([nodeId, nodeId]);
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      from_id: string;
      to_id: string;
      rel: string;
      evidence: string | null;
    };
    const otherId = row.from_id === nodeId ? row.to_id : row.from_id;
    out.push({
      otherId,
      rel: row.rel as WikiRel,
      evidence: row.evidence,
      from: row.from_id,
      to: row.to_id,
    });
  }
  stmt.free();
  return out;
}

function suggestActions(seed: WikiNode, entities: WikiNode[]): string[] {
  const actions: string[] = [];
  const types = new Set(entities.map((e) => e.type));
  if (types.has("logistics") || types.has("ticket")) {
    actions.push("可用物流编号/票号走货代 portal 轨迹，无需再扫整张装箱表");
  }
  if (types.has("sku")) {
    actions.push("已关联 PSKU：可直接查 Catalog/采购/在途，跳过箱表明细全表扫描");
  }
  if (types.has("forwarder")) {
    actions.push("已关联货代：可查 freight-rates 报价或该货代在途箱");
  }
  if (seed.type === "box") {
    actions.push("种子是箱号：邻域含票号/物流/SKU 即可回答多数物流联查");
  }
  if (actions.length === 0) {
    actions.push("未命中更多关联时，再回退飞书装箱快照或原 API");
  }
  return actions;
}

function toMarkdownCard(pack: Omit<ContextPack, "markdownCard">): string {
  const lines = [
    `## Wiki Context Pack`,
    `- seed: \`${pack.seed.keyType}=${pack.seed.keyValue}\` → \`${pack.seed.nodeId}\``,
    `- hops: ${pack.hops} · entities: ${pack.entities.length} · edges: ${pack.edges.length}`,
    "",
    "### Entities",
  ];
  for (const e of pack.entities.slice(0, 40)) {
    lines.push(`- **${e.type}** \`${e.id}\`: ${e.summary}`);
  }
  lines.push("", "### Edges");
  for (const e of pack.edges.slice(0, 60)) {
    lines.push(
      `- \`${e.from}\` -[${e.rel}]-> \`${e.to}\`${e.evidence ? ` (${e.evidence})` : ""}`,
    );
  }
  if (pack.nextActions.length) {
    lines.push("", "### Next");
    for (const a of pack.nextActions) lines.push(`- ${a}`);
  }
  return lines.join("\n");
}

export async function buildContextPack(opts: {
  keyType: WikiKeyType;
  keyValue: string;
  hops?: number;
}): Promise<ContextPack | null> {
  const db = await getWikiDb();
  return buildContextPackOn(db, opts);
}

export function buildContextPackOn(
  db: Database,
  opts: { keyType: WikiKeyType; keyValue: string; hops?: number },
): ContextPack | null {
  const hops = Math.min(Math.max(opts.hops ?? 2, 1), 3);
  const hit = lookupByKeyOn(db, opts.keyType, opts.keyValue);
  if (!hit) return null;

  const entityMap = new Map<string, WikiNode>();
  entityMap.set(hit.node.id, hit.node);
  const edgeSet = new Map<
    string,
    { from: string; rel: WikiRel; to: string; evidence: string | null }
  >();
  const expanded = new Set<string>();

  let frontier = [hit.node.id];
  for (let depth = 0; depth < hops; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (expanded.has(id)) continue;
      expanded.add(id);

      const fromNode = entityMap.get(id) ?? getNodeById(db, id);
      if (!fromNode) continue;
      if (LEAF_TYPES.has(fromNode.type)) continue;

      for (const n of neighborIds(db, id)) {
        if (SKIP_RELS_FOR_BFS.has(n.rel)) continue;

        const ek = `${n.from}|${n.rel}|${n.to}`;
        if (!edgeSet.has(ek)) {
          edgeSet.set(ek, {
            from: n.from,
            rel: n.rel,
            to: n.to,
            evidence: n.evidence,
          });
        }

        let other = entityMap.get(n.otherId);
        if (!other) {
          const loaded = getNodeById(db, n.otherId);
          if (loaded) {
            entityMap.set(loaded.id, loaded);
            other = loaded;
          }
        }
        if (!other) continue;
        if (LEAF_TYPES.has(other.type)) continue;
        if (!expanded.has(other.id)) next.push(other.id);
      }
    }
    frontier = [...new Set(next)];
  }

  // 把 hop1 碰到的叶子（货代等）也收进 pack：再扫一遍种子的直接邻居
  for (const n of neighborIds(db, hit.node.id)) {
    if (SKIP_RELS_FOR_BFS.has(n.rel)) continue;
    const ek = `${n.from}|${n.rel}|${n.to}`;
    if (!edgeSet.has(ek)) {
      edgeSet.set(ek, {
        from: n.from,
        rel: n.rel,
        to: n.to,
        evidence: n.evidence,
      });
    }
    if (!entityMap.has(n.otherId)) {
      const loaded = getNodeById(db, n.otherId);
      if (loaded) entityMap.set(loaded.id, loaded);
    }
  }

  const entities = [...entityMap.values()];
  const edges = [...edgeSet.values()];
  const nextActions = suggestActions(hit.node, entities);
  const base = {
    seed: {
      keyType: opts.keyType,
      keyValue: opts.keyValue.trim(),
      nodeId: hit.node.id,
    },
    hops,
    entities,
    edges,
    nextActions,
    builtAt: new Date().toISOString(),
  };
  return { ...base, markdownCard: toMarkdownCard(base) };
}

/** 调试：按类型拉节点 */
export function listNodesByType(
  db: Database,
  type: string,
  limit = 20,
): WikiNode[] {
  const stmt = db.prepare(`SELECT * FROM nodes WHERE type = ? LIMIT ?`);
  stmt.bind([type, limit]);
  const out: WikiNode[] = [];
  while (stmt.step()) out.push(rowToNode(stmt.getAsObject()));
  stmt.free();
  return out;
}
