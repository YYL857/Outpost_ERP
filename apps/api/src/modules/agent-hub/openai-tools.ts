import {
  AGENT_TOOL_CAPABILITY,
  canUseOpsInterpret,
  capabilityForOpsSurface,
  hasCapability,
  type Capability,
} from "../../auth/permissions.js";
import type { UserRole } from "../../auth/types.js";
import { AGENT_TOOLS } from "./catalog.js";
import type { AgentToolDef } from "./types.js";

/** OpenAI/DeepSeek function name 不允许点号 */
export function toolIdToFnName(id: string): string {
  return id.replace(/\./g, "__");
}

export function fnNameToToolId(name: string): string {
  return name.replace(/__/g, ".");
}

export function toolsForAsk(opts?: {
  allowMutate?: boolean;
  allowNavigate?: boolean;
  /** 按角色裁剪工具；缺省视为超管（兼容旧测试） */
  role?: UserRole | string;
}): AgentToolDef[] {
  const role = opts?.role ?? "admin";
  return AGENT_TOOLS.filter((t) => {
    if (t.kind === "mutate" && !opts?.allowMutate) return false;
    if (t.kind === "navigate" && !opts?.allowNavigate) return false;
    if (t.id === "ops.interpret") {
      return canUseOpsInterpret(role);
    }
    const cap: Capability | undefined = AGENT_TOOL_CAPABILITY[t.id];
    if (cap && !hasCapability(role, cap)) return false;
    return true;
  });
}

/** 转 DeepSeek/OpenAI tools 定义（轻量 JSON Schema） */
export function toOpenAiTools(
  defs: AgentToolDef[],
  role: UserRole | string = "admin",
) {
  return defs.map((t) => ({
    type: "function" as const,
    function: {
      name: toolIdToFnName(t.id),
      description: `${t.name}。何时用：${t.when}。调用 ${t.method} ${t.path}。失败时：${t.onMiss}`,
      parameters: buildParameters(t, role),
    },
  }));
}

function buildParameters(
  t: AgentToolDef,
  role: UserRole | string,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required = [...t.required];

  for (const key of [...t.required, ...(t.optional ?? [])]) {
    if (key === "keyType") {
      properties.keyType = {
        type: "string",
        enum: [
          "boxNo",
          "ticketNo",
          "logisticsNo",
          "partnerSku",
          "forwarder",
          "orderId",
          "trackingNo",
        ],
      };
      continue;
    }
    if (key === "surface") {
      const surfaces = (["sales", "replenish", "finance"] as const).filter(
        (s) => {
          const cap = capabilityForOpsSurface(s);
          return Boolean(cap && hasCapability(role, cap));
        },
      );
      properties.surface = {
        type: "string",
        enum: surfaces.length ? surfaces : ["replenish"],
      };
      continue;
    }
    if (key === "hops") {
      properties.hops = { type: "integer", minimum: 1, maximum: 3 };
      continue;
    }
    if (key === "sources") {
      properties.sources = {
        type: "array",
        items: {
          type: "string",
          enum: ["schema", "packing", "accounts", "freight"],
        },
      };
      continue;
    }
    properties[key] = { type: "string" };
  }

  // 常见可选：单 SKU 提示（catalog 客户端过滤用）
  if (t.id === "catalog.query" && !properties.partnerSku) {
    properties.partnerSku = {
      type: "string",
      description: "可选：只保留该 PSKU 行（服务端截断用，非 API query）",
    };
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export function findToolDef(id: string): AgentToolDef | undefined {
  return AGENT_TOOLS.find((t) => t.id === id);
}
