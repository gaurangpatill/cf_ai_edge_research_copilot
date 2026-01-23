import type { Env, VectorizeQueryResult } from "./env";
import type { RetrievedChunk } from "./prompts";

export async function upsertVectors(
  env: Env,
  vectors: { id: string; values: number[]; metadata: Record<string, string> }[]
): Promise<void> {
  if (!vectors.length) return;
  await env.VECTORIZE_INDEX.upsert(vectors);
}

export async function queryVectors(
  env: Env,
  embedding: number[],
  filter: Record<string, string>,
  topK: number
): Promise<VectorizeQueryResult> {
  return env.VECTORIZE_INDEX.query({
    vector: embedding,
    topK,
    filter,
    includeMetadata: true
  });
}

export function mapVectorResults(
  result: VectorizeQueryResult,
  chunkLookup: Map<string, { text: string; source: string }>
): RetrievedChunk[] {
  return result.matches.map((match) => {
    const lookup = chunkLookup.get(match.id);
    return {
      id: match.id,
      score: match.score,
      text: lookup?.text ?? "",
      source: lookup?.source ?? "unknown"
    };
  });
}
