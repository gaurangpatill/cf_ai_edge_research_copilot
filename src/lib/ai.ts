import { LLM_MODEL, EMBED_MODEL } from "./constants";
import type { ChatMessage } from "./prompts";
import type { Env } from "./env";

export interface LlmOptions {
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export async function runChat(
  env: Env,
  messages: ChatMessage[],
  opts: LlmOptions = {}
): Promise<any> {
  if (env.AI_GATEWAY_ENDPOINT && env.AI_GATEWAY_TOKEN) {
    return callAIGateway(env, { model: LLM_MODEL, messages, ...opts });
  }

  try {
    return await env.AI.run(LLM_MODEL, {
      messages,
      stream: opts.stream ?? false,
      max_tokens: opts.maxTokens ?? 800,
      temperature: opts.temperature ?? 0.3
    });
  } catch {
    return { response: "(AI unavailable in local dev)" };
  }
}

export async function embedText(env: Env, inputs: string[]): Promise<number[][]> {
  if (env.AI_GATEWAY_ENDPOINT && env.AI_GATEWAY_TOKEN) {
    const result = await callAIGateway(env, { model: EMBED_MODEL, input: inputs });
    const data = result?.data ?? result?.result?.data ?? [];
    return data.map((item: { embedding: number[] }) => item.embedding);
  }

  const result = await env.AI.run(EMBED_MODEL, { text: inputs });
  const raw =
    (Array.isArray(result) ? result : null) ??
    result?.data ??
    result?.result?.data ??
    result?.results ??
    result?.result?.results ??
    result?.embeddings ??
    result?.result?.embeddings;
  if (!Array.isArray(raw)) {
    const keys = Object.keys(result ?? {}).join(",");
    const sample = JSON.stringify(result ?? {}).slice(0, 400);
    throw new Error(`embedding_invalid:missing_data model=${EMBED_MODEL} keys=${keys} sample=${sample}`);
  }
  const embeddings = raw.map(
    (item: { embedding?: number[]; values?: number[]; vector?: number[] } | number[]) => {
      if (Array.isArray(item)) return item;
      if (item && Array.isArray(item.embedding)) return item.embedding;
      if (item && Array.isArray(item.values)) return item.values;
      if (item && Array.isArray(item.vector)) return item.vector;
      return [];
    }
  );
  const firstLen = embeddings[0]?.length ?? 0;
  console.log("embeddings", { model: EMBED_MODEL, count: embeddings.length, firstLen });
  if (embeddings.length !== inputs.length) {
    const firstKeys =
      !Array.isArray(raw[0]) && raw[0] && typeof raw[0] === "object"
        ? Object.keys(raw[0] as Record<string, unknown>).join(",")
        : "";
    const sample = JSON.stringify(raw[0] ?? {}).slice(0, 200);
    throw new Error(
      `embedding_invalid:count model=${EMBED_MODEL} texts=${inputs.length} embeddings=${embeddings.length} firstKeys=${firstKeys} sample=${sample}`
    );
  }
  for (const emb of embeddings) {
    if (!Array.isArray(emb) || !emb.length) {
      const firstKeys =
        !Array.isArray(raw[0]) && raw[0] && typeof raw[0] === "object"
          ? Object.keys(raw[0] as Record<string, unknown>).join(",")
          : "";
      const sample = JSON.stringify(raw[0] ?? {}).slice(0, 200);
      throw new Error(
        `embedding_invalid:empty model=${EMBED_MODEL} texts=${inputs.length} embeddings=${embeddings.length} firstKeys=${firstKeys} sample=${sample}`
      );
    }
    for (const value of emb) {
      if (!Number.isFinite(value)) {
        const firstKeys =
          !Array.isArray(raw[0]) && raw[0] && typeof raw[0] === "object"
            ? Object.keys(raw[0] as Record<string, unknown>).join(",")
            : "";
        const sample = JSON.stringify(raw[0] ?? {}).slice(0, 200);
        throw new Error(
          `embedding_invalid:non_finite model=${EMBED_MODEL} texts=${inputs.length} embeddings=${embeddings.length} firstKeys=${firstKeys} sample=${sample}`
        );
      }
    }
  }
  return embeddings;
}

async function callAIGateway(env: Env, payload: Record<string, unknown>): Promise<any> {
  // TODO: Align the request/response shape with the latest AI Gateway docs.
  // This intentionally keeps the interface pluggable without guessing undocumented fields.
  const response = await fetch(env.AI_GATEWAY_ENDPOINT as string, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.AI_GATEWAY_TOKEN}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI Gateway error ${response.status}: ${text}`);
  }

  return response.json();
}
