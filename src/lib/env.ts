export interface Env {
  AI: any;
  VECTORIZE_INDEX: VectorizeIndex;
  AGENT: DurableObjectNamespace;
  AUTH: DurableObjectNamespace;
  RESEARCH_WORKFLOW: WorkflowBinding;
  AI_GATEWAY_ENDPOINT?: string;
  AI_GATEWAY_TOKEN?: string;
  AUTH_SECRET?: string;
  DEBUG?: string;
  MAX_MESSAGE_CHARS?: string;
  MAX_DOC_CHARS?: string;
  RATE_LIMIT_TOKENS?: string;
  RATE_LIMIT_REFILL_PER_SEC?: string;
}

export interface VectorizeIndex {
  upsert(vectors: Array<VectorizeVector>): Promise<void>;
  query(vector: number[], options: VectorizeQueryOptions): Promise<VectorizeQueryResult>;
}

export interface VectorizeVector {
  id: string;
  values: number[];
  metadata?: Record<string, string | number>;
}

export interface VectorizeQuery {
  vector: number[];
  topK: number;
  filter?: Record<string, string>;
  includeMetadata?: boolean;
}

export interface VectorizeQueryOptions {
  topK: number;
  filter?: Record<string, string | { $eq: string }>;
  returnMetadata?: "none" | "all";
}

export interface VectorizeQueryResult {
  matches: Array<{ id: string; score: number; metadata?: Record<string, string> }>;
}

export interface WorkflowBinding {
  start(params: unknown): Promise<{ id: string }>;
}
