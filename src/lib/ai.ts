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
    return result?.data?.map((item: { embedding: number[] }) => item.embedding) ?? [];
  }

  try {
    const result = await env.AI.run(EMBED_MODEL, { input: inputs });
    return result?.data?.map((item: { embedding: number[] }) => item.embedding) ?? [];
  } catch {
    return inputs.map(() => []);
  }
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
