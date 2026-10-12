/**
 * 三表字段语义别名：意思相同即可对比，不要求表头字面一致。
 * label = 界面展示的 canonical 名（优先贴近产品表用语）。
 */
export type FieldAliasGroup = {
  id: string;
  label: string;
  aliases: string[];
};

export const FIELD_ALIAS_GROUPS: FieldAliasGroup[] = [
  {
    id: "promo_price",
    label: "活动价",
    aliases: [
      "活动价",
      "活动价格",
      "deal_price",
      "Deal Price",
      "dealPrice",
      "价格", // 信息检查表：业务上即活动价
    ],
  },
  {
    id: "list_price",
    label: "原价",
    aliases: ["原价", "售价", "list_price", "listPrice", "price"],
  },
  {
    id: "name",
    label: "名称",
    aliases: ["名称", "品名", "title", "Title", "product_name"],
  },
  {
    id: "purchase_cost",
    label: "采购单价",
    aliases: ["采购单价", "采购成本", "purchase_cost", "purchaseCost"],
  },
  {
    id: "brand",
    label: "品牌",
    aliases: ["品牌", "brand", "Brand"],
  },
  {
    id: "status",
    label: "产品状态",
    aliases: ["产品状态", "状态", "status", "Status"],
  },
  {
    id: "qty",
    label: "数量",
    aliases: ["数量", "qty", "quantity", "deal_stock"],
  },
];

const aliasToGroup = new Map<string, FieldAliasGroup>();
for (const g of FIELD_ALIAS_GROUPS) {
  for (const a of g.aliases) {
    aliasToGroup.set(a, g);
    aliasToGroup.set(a.toLowerCase(), g);
  }
}

export function groupOfField(field: string): FieldAliasGroup | undefined {
  return aliasToGroup.get(field) ?? aliasToGroup.get(field.toLowerCase());
}

/** 在单表记录里按别名组取值（按 aliases 顺序，跳过空串） */
export function pickByAliases(
  rec: Record<string, string> | null | undefined,
  aliases: string[],
): { value: string; matchedField: string | null } {
  if (!rec) return { value: "", matchedField: null };
  for (const a of aliases) {
    if (a in rec && String(rec[a]).trim() !== "") {
      return { value: String(rec[a]), matchedField: a };
    }
  }
  for (const a of aliases) {
    if (a in rec) return { value: String(rec[a] ?? ""), matchedField: a };
  }
  // 大小写不敏感兜底
  const lowerMap = new Map(
    Object.keys(rec).map((k) => [k.toLowerCase(), k] as const),
  );
  for (const a of aliases) {
    const real = lowerMap.get(a.toLowerCase());
    if (real != null) {
      return { value: String(rec[real] ?? ""), matchedField: real };
    }
  }
  return { value: "", matchedField: null };
}

export function resolveFieldValue(
  rec: Record<string, string> | null | undefined,
  fieldOrLabel: string,
): { value: string; matchedField: string | null } {
  const g = groupOfField(fieldOrLabel);
  if (g) return pickByAliases(rec, g.aliases);
  if (!rec) return { value: "", matchedField: null };
  if (fieldOrLabel in rec) {
    return { value: String(rec[fieldOrLabel] ?? ""), matchedField: fieldOrLabel };
  }
  const hit = Object.keys(rec).find(
    (k) => k.toLowerCase() === fieldOrLabel.toLowerCase(),
  );
  if (hit) return { value: String(rec[hit] ?? ""), matchedField: hit };
  return { value: "", matchedField: null };
}

/**
 * 共有「语义字段」：至少两张表能解析到该组；
 * 另附精确同名交集（不在任一 alias 组内的裸字段）。
 */
export function buildCommonFields(headerSets: string[][]): string[] {
  const nonEmpty = headerSets.filter((h) => h.length > 0);
  const out: string[] = [];
  const usedExact = new Set<string>();

  for (const g of FIELD_ALIAS_GROUPS) {
    let hits = 0;
    for (const headers of nonEmpty) {
      const set = new Set(headers);
      const lower = new Set(headers.map((h) => h.toLowerCase()));
      const ok = g.aliases.some((a) => set.has(a) || lower.has(a.toLowerCase()));
      if (ok) hits += 1;
    }
    if (hits >= 2) {
      out.push(g.label);
      for (const a of g.aliases) usedExact.add(a);
    }
  }

  if (nonEmpty.length >= 2) {
    let acc = new Set(nonEmpty[0]);
    for (let i = 1; i < nonEmpty.length; i++) {
      const next = new Set(nonEmpty[i]);
      acc = new Set([...acc].filter((h) => next.has(h)));
    }
    for (const h of [...acc].sort((a, b) => a.localeCompare(b, "zh"))) {
      if (usedExact.has(h) || groupOfField(h)) continue;
      out.push(h);
    }
  } else if (nonEmpty.length === 1) {
    // 仅一表时仍给出语义组里该表有的 label，便于先筛字段；对比时他表为空
    for (const g of FIELD_ALIAS_GROUPS) {
      const set = new Set(nonEmpty[0]);
      const lower = new Set(nonEmpty[0]!.map((h) => h.toLowerCase()));
      if (g.aliases.some((a) => set.has(a) || lower.has(a.toLowerCase()))) {
        if (!out.includes(g.label)) out.push(g.label);
      }
    }
  }

  return out;
}
