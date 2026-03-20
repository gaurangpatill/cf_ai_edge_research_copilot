import {
  createSessionRecord,
  deleteSessionRecord,
  getMessagesForSession,
  getSessions,
  saveMessagesForSession,
  touchSession
} from "@/lib/local-store";
import { requireAuthSession, setAuthSession } from "@/lib/auth-store";
import { mockSendMessage, mockSources } from "@/lib/mock-data";
import type {
  ChatMessage,
  Citation,
  RetrievalChunk,
  SessionRecord,
  SourceRecord,
  SourceUploadInput,
  WorkerAuthResponse,
  WorkerChatResponse,
  WorkerChunksResponse,
  WorkerIngestResponse,
  WorkerMemoriesResponse,
  WorkerMessagesResponse,
  WorkerSessionResponse,
  WorkerSessionsResponse,
  WorkerVectorQueryResponse
} from "@/lib/types";

const workerBaseUrl = process.env.NEXT_PUBLIC_WORKER_BASE_URL?.replace(/\/$/, "") ?? "";
const allowMockFallback = process.env.NEXT_PUBLIC_ENABLE_MOCK_FALLBACK !== "false";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!workerBaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_WORKER_BASE_URL.");
  }

  const authHeader =
    path.startsWith("/api/auth/") ? undefined : `Bearer ${requireAuthSession().token}`;
  const response = await fetch(`${workerBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(authHeader ? { authorization: authHeader } : {}),
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = await response.text();
    try {
      const parsed = JSON.parse(detail) as { error?: string };
      throw new Error(parsed.error || detail || `Worker request failed for ${path}`);
    } catch {
      throw new Error(detail || `Worker request failed for ${path}`);
    }
  }

  return (await response.json()) as T;
}

export const workerClient = {
  async register(name: string, email: string, password: string) {
    const result = await request<WorkerAuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    });
    setAuthSession({ user: result.user, token: result.token });
    return result.user;
  },

  async login(email: string, password: string) {
    const result = await request<WorkerAuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    setAuthSession({ user: result.user, token: result.token });
    return result.user;
  },

  async createSession(title?: string): Promise<{ session: SessionRecord; mocked: boolean }> {
    try {
      const result = await request<WorkerSessionResponse>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ title })
      });
      return { session: normalizeSession(result.session), mocked: false };
    } catch (error) {
      if (!allowMockFallback) throw error;
      return { session: createSessionRecord({ title: title || "Untitled research session" }), mocked: true };
    }
  },

  async listSessions(): Promise<{ sessions: SessionRecord[]; mocked: boolean }> {
    try {
      const result = await request<WorkerSessionsResponse>("/api/sessions");
      return {
        sessions: (result.sessions ?? []).map(normalizeSession),
        mocked: false
      };
    } catch (error) {
      if (!allowMockFallback) throw error;
      return { sessions: getSessions(), mocked: true };
    }
  },

  async renameSession(sessionId: string, title: string): Promise<{ session: SessionRecord; mocked: boolean }> {
    try {
      const result = await request<WorkerSessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        body: JSON.stringify({ title })
      });
      return { session: normalizeSession(result.session), mocked: false };
    } catch (error) {
      if (!allowMockFallback) throw error;
      touchSession(sessionId, { title });
      const session = getSessions().find((item) => item.id === sessionId);
      if (!session) throw new Error("session_not_found");
      return { session, mocked: true };
    }
  },

  async getSession(sessionId: string): Promise<{ session: SessionRecord | null; mocked: boolean }> {
    try {
      const result = await request<WorkerSessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`);
      return {
        session: result.session ? normalizeSession(result.session) : null,
        mocked: false
      };
    } catch (error) {
      if (!allowMockFallback) {
        if (error instanceof Error && error.message === "session_not_found") {
          return { session: null, mocked: false };
        }
        throw error;
      }
      const session = getSessions().find((item) => item.id === sessionId) ?? null;
      return { session, mocked: true };
    }
  },

  async deleteSession(sessionId: string): Promise<{ mocked: boolean }> {
    try {
      await request<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE"
      });
      return { mocked: false };
    } catch (error) {
      if (!allowMockFallback) throw error;
      deleteSessionRecord(sessionId);
      return { mocked: true };
    }
  },

  async listMessages(sessionId: string): Promise<{ messages: ChatMessage[]; mocked: boolean }> {
    try {
      const result = await request<WorkerMessagesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
      return {
        messages: (result.messages ?? []).map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt ?? message.created_at ?? new Date().toISOString()
        })),
        mocked: false
      };
    } catch (error) {
      if (!allowMockFallback) throw error;
      return { messages: getMessagesForSession(sessionId), mocked: true };
    }
  },

  async sendMessage(sessionId: string, text: string): Promise<{
    answer: string;
    citations: Citation[];
    retrieval: RetrievalChunk[];
    session?: SessionRecord;
    mocked: boolean;
  }> {
    try {
      const result = await request<WorkerChatResponse>("/api/message", {
        method: "POST",
        body: JSON.stringify({ sessionId, text })
      });

      const retrieval =
        result.retrievedChunks && result.retrievedChunks.length > 0
          ? result.retrievedChunks
          : await loadRetrievalContext(sessionId, text);
      const citations =
        result.citations && result.citations.length > 0
          ? result.citations
          : (result.usedDocs ?? []).map((doc, index) => ({
              sourceId: doc.id,
              label: `Source ${index + 1}`,
              title: doc.title,
              snippet: `Retrieved from ${doc.title}`,
              chunkId: retrieval[index]?.chunkId
            }));

      return {
        answer: result.answer,
        citations,
        retrieval,
        session: result.session ? normalizeSession(result.session) : undefined,
        mocked: false
      };
    } catch (error) {
      if (!allowMockFallback) throw error;
      const mock = mockSendMessage(text);
      return { ...mock, session: undefined };
    }
  },

  async ingestSource(sessionId: string, input: SourceUploadInput): Promise<{
    docId: string;
    vectorizeOk: boolean;
    chunkCount?: number;
    session?: SessionRecord;
    mocked: boolean;
  }> {
    try {
      const result = await request<WorkerIngestResponse>("/api/doc", {
        method: "POST",
        body: JSON.stringify({ sessionId, ...input })
      });

      return {
        docId: result.docId,
        vectorizeOk: result.vectorizeOk,
        chunkCount: result.chunkCount ?? estimateChunkCount(input.content),
        session: result.session ? normalizeSession(result.session) : undefined,
        mocked: false
      };
    } catch (error) {
      if (!allowMockFallback) throw error;
      return {
        docId: crypto.randomUUID(),
        vectorizeOk: true,
        chunkCount: estimateChunkCount(input.content),
        mocked: true
      };
    }
  },

  async listSources(sessionId: string): Promise<{ sources: SourceRecord[]; mocked: boolean }> {
    try {
      const result = await request<WorkerMemoriesResponse>(`/api/sources?sessionId=${encodeURIComponent(sessionId)}`);
      return {
        sources: (result.memories?.docs ?? []).map((doc) => ({
          id: doc.id,
          sessionId: doc.sessionId,
          title: doc.title,
          createdAt: doc.createdAt ?? doc.created_at ?? new Date().toISOString(),
          chunkCount: doc.chunkCount ?? doc.chunk_count,
          status: "Indexed in Durable Object storage and available for retrieval."
        })),
        mocked: false
      };
    } catch (error) {
      if (!allowMockFallback) throw error;
      return mockSources();
    }
  }
};

async function loadRetrievalContext(sessionId: string, text: string): Promise<RetrievalChunk[]> {
  try {
    const vectorQuery = await request<WorkerVectorQueryResponse>("/api/debug/vectorQuery", {
      method: "POST",
      body: JSON.stringify({ sessionId, text })
    });

    const chunkIds = (vectorQuery.hydration ?? []).filter((row) => row.foundInSql).map((row) => row.id);
    if (!chunkIds.length) return [];

    const chunksResponse = await request<WorkerChunksResponse>("/chunks", {
      method: "POST",
      body: JSON.stringify({ sessionId, chunkIds })
    });

    const scoreByChunkId = new Map(
      (vectorQuery.vectorMatches ?? []).map((match) => {
        const metadataChunkId = typeof match.metadata?.chunkId === "string" ? match.metadata.chunkId : undefined;
        return [metadataChunkId ?? match.id, match.score] as const;
      })
    );

    return (chunksResponse.chunks ?? []).map((chunk) => ({
      ...chunk,
      score: scoreByChunkId.get(chunk.chunkId)
    }));
  } catch {
    return [];
  }
}

function normalizeSession(session?: {
  id: string;
  title: string;
    createdAt?: string;
    created_at?: string;
    updatedAt?: string;
    updated_at?: string;
    lastMessagePreview?: string;
    last_message_preview?: string | null;
}): SessionRecord {
  if (!session) {
    throw new Error("session_missing");
  }

  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt ?? session.created_at ?? new Date().toISOString(),
    updatedAt: session.updatedAt ?? session.updated_at ?? new Date().toISOString(),
    lastMessagePreview: session.lastMessagePreview ?? session.last_message_preview ?? undefined
  };
}

function estimateChunkCount(content: string) {
  return Math.max(1, Math.ceil(content.length / 1200));
}

export function persistMockMessages(sessionId: string, messages: ChatMessage[]) {
  saveMessagesForSession(sessionId, messages);
}
