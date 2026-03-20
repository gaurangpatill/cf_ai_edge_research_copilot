export interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview?: string;
}

export interface Citation {
  sourceId: string;
  label: string;
  title: string;
  snippet: string;
  chunkId?: string;
}

export interface RetrievalChunk {
  chunkId: string;
  docId: string;
  title: string;
  chunkIndex: number;
  content: string;
  createdAt: string;
  score?: number;
  sourceType?: string | null;
  sourceName?: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: Citation[];
  retrieval?: RetrievalChunk[];
}

export interface SourceRecord {
  id: string;
  sessionId?: string;
  title: string;
  createdAt: string;
  chunkCount?: number;
  status?: string;
}

export interface SourceUploadInput {
  title: string;
  content: string;
}

export interface WorkerChatResponse {
  ok?: boolean;
  answer: string;
  usedDocs?: Array<{ id: string; title: string }>;
  citations?: Citation[];
  retrievedChunks?: RetrievalChunk[];
  session?: SessionRecord;
}

export interface WorkerIngestResponse {
  ok?: boolean;
  docId: string;
  vectorizeOk: boolean;
  chunkCount?: number;
  session?: SessionRecord;
}

export interface WorkerMemoriesResponse {
  memories?: {
    docs?: Array<{ id: string; title: string; createdAt?: string; created_at?: string; sessionId?: string; chunkCount?: number; chunk_count?: number }>;
    summaries?: Array<{ id: string; content: string; created_at: string }>;
  };
}

export interface WorkerSessionsResponse {
  sessions?: Array<{
    id: string;
    title: string;
    createdAt?: string;
    created_at?: string;
    updatedAt?: string;
    updated_at?: string;
    lastMessagePreview?: string;
    last_message_preview?: string | null;
  }>;
}

export interface WorkerSessionResponse {
  session?: {
    id: string;
    title: string;
    createdAt?: string;
    created_at?: string;
    updatedAt?: string;
    updated_at?: string;
    lastMessagePreview?: string;
    last_message_preview?: string | null;
  };
}

export interface WorkerMessagesResponse {
  messages?: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt?: string; created_at?: string }>;
}

export interface WorkerAuthResponse {
  ok?: boolean;
  user: {
    userId: string;
    email: string;
    name: string;
  };
  token: string;
}

export interface WorkerVectorQueryResponse {
  ok?: boolean;
  vectorMatches?: Array<{
    id: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
  hydration?: Array<{ id: string; foundInSql: boolean; textLen: number }>;
  missingChunkIds?: string[];
}

export interface WorkerChunksResponse {
  chunks?: Array<{
    chunkId: string;
    docId: string;
    title: string;
    sourceType: string | null;
    sourceName: string | null;
    chunkIndex: number;
    content: string;
    createdAt: string;
  }>;
}
