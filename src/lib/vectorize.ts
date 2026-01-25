import type { Env, VectorizeQueryResult } from "./env";
import type { RetrievedChunk } from "./prompts";

export async function upsertVectors(
  env: Env,
  vectors: { id: string; values: number[]; metadata: Record<string, string | number> }[]
): Promise<void> {
  if (!env.VECTORIZE_INDEX) {
    throw new Error("vectorize_binding_missing");
  }
  const valid = vectors.filter((vector) => {
    if (!vector.id || !Array.isArray(vector.values) || !vector.values.length) return false;
    return vector.values.every((value) => Number.isFinite(value));
  });
  if (!valid.length) {
    throw new Error("vectorize_no_valid_vectors");
  }
  const dimension = valid[0]?.values.length ?? 0;
  if (!dimension || valid.some((vector) => vector.values.length !== dimension)) {
    throw new Error("vectorize_dimension_mismatch");
  }
  try {
    await env.VECTORIZE_INDEX.upsert(valid);
  } catch (err) {
    console.error("vectorize upsert failed", err);
    throw new Error("vectorize_upsert_failed");
  }
}

export async function queryVectors(
  env: Env,
  embedding: number[],
  filter: Record<string, string>,
  topK: number,
  options: { throwOnError?: boolean } = {}
): Promise<VectorizeQueryResult> {
  // Vectorize metadata filtering requires a metadata index on userId (string):
  // npx wrangler vectorize create-metadata-index edge-research-copilot --property-name=userId --type=string
  if (!embedding.length) return { matches: [] };
  const hasFilter = Object.keys(filter).length > 0;
  const mappedFilter = hasFilter
    ? Object.fromEntries(
        Object.entries(filter).map(([key, value]) => [key, { $eq: value }])
      )
    : undefined;
  try {
    return await env.VECTORIZE_INDEX.query(embedding, {
      topK,
      ...(mappedFilter ? { filter: mappedFilter } : {}),
      returnMetadata: "all"
    });
  } catch (err) {
    console.error("vectorize query failed", err);
    if (options.throwOnError) throw err;
    return { matches: [] };
  }
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
