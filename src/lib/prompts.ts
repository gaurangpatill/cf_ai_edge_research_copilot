import { DEFAULT_TOP_K } from "./constants";

export interface RetrievedChunk {
  id: string;
  score: number;
  text: string;
  source: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function buildSystemPrompt(): string {
  return [
    "You are Edge Research Copilot, an expert research assistant.",
    "Use provided context snippets when relevant.",
    "Cite snippets with [doc:chunk] references.",
    "If you are unsure, ask a clarifying question.",
    "Be concise and structured."
  ].join("\n");
}

export function buildContextBlock(chunks: RetrievedChunk[], topK = DEFAULT_TOP_K): string {
  if (!chunks.length) return "No context provided.";
  const selected = chunks.slice(0, topK);
  return selected
    .map(
      (chunk) =>
        `Snippet ${chunk.id} (score ${chunk.score.toFixed(3)}, source ${chunk.source}):\n${chunk.text}`
    )
    .join("\n\n");
}

export function assembleMessages(
  conversation: ChatMessage[],
  contextBlock: string
): ChatMessage[] {
  const system: ChatMessage = {
    role: "system",
    content: `${buildSystemPrompt()}\n\nContext:\n${contextBlock}`
  };
  return [system, ...conversation];
}
