/**
 * 中枢 Agent：工具定义与反幻觉约束类型
 */

export type AgentToolKind =
  | "navigate"
  | "lookup"
  | "query"
  | "judge"
  | "mutate";

export type AgentToolDef = {
  id: string;
  name: string;
  kind: AgentToolKind;
  /** 何时选用 */
  when: string;
  method: "GET" | "POST";
  path: string;
  /** 调用前必须具备的参数 */
  required: string[];
  optional?: string[];
  /** 工具返回里可作为「证据」引用的字段路径 */
  evidenceFields: string[];
  /** 禁止模型在无工具结果时编造的标识 */
  neverInvent: string[];
  /** 失败/404 时必须怎么说 */
  onMiss: string;
  notes?: string[];
};

export type AntiHallucinationRules = {
  version: 1;
  title: string;
  hardRules: string[];
  /** 允许模型自由发挥的范围（非事实） */
  softAllowed: string[];
  /** 事实类回答必须带的结构 */
  answerContract: {
    requiredFields: string[];
    description: string;
  };
  /** 置信度降级条件 */
  downgradeConfidenceWhen: string[];
};

export type HubAnswerEvidence = {
  toolId: string;
  source: string;
  key?: string;
  excerpt: string;
};

/** 中枢对外回答契约（防幻觉：无 evidence 不得写死数字/单号） */
export type HubAnswer = {
  verdict: string;
  confidence: "high" | "medium" | "low" | "none";
  evidence: HubAnswerEvidence[];
  openQuestions: string[];
  toolsUsed: string[];
  /** 模型推断，必须可与 evidence 区分 */
  inferences?: string[];
  /** 明确未查到的键 */
  notFound?: string[];
};

export type AgentHubManifest = {
  version: 1;
  title: string;
  principle: string;
  protocolPath: string;
  preloadPath: string;
  tools: AgentToolDef[];
  antiHallucination: AntiHallucinationRules;
};
