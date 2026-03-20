import type { Citation, RetrievalChunk, SourceRecord } from "@/lib/types";

const MOCK_SOURCE: SourceRecord = {
  id: "mock-source-1",
  title: "Research workspace overview",
  createdAt: new Date().toISOString(),
  chunkCount: 3,
  status: "Mock source returned because the Worker base URL is not configured."
};

const MOCK_RETRIEVAL: RetrievalChunk[] = [
  {
    chunkId: "mock-source-1:0",
    docId: "mock-source-1",
    title: "Research workspace overview",
    chunkIndex: 0,
    content:
      "This app is designed as a research workspace. Users can upload material, ask grounded questions, inspect citations, and continue conversations with persistent memory.",
    createdAt: new Date().toISOString(),
    score: 0.92,
    sourceType: "mock"
  }
];

const MOCK_CITATIONS: Citation[] = [
  {
    sourceId: "mock-source-1",
    label: "Source 1",
    title: "Research workspace overview",
    snippet: "Users can upload material, ask grounded questions, inspect citations, and continue conversations.",
    chunkId: "mock-source-1:0"
  }
];

export function mockSendMessage(prompt: string) {
  return {
    answer: `Mock response for: "${prompt}"\n\nSet \`NEXT_PUBLIC_WORKER_BASE_URL\` to your Worker URL to use real retrieval and persistence.`,
    citations: MOCK_CITATIONS,
    retrieval: MOCK_RETRIEVAL,
    mocked: true
  };
}

export function mockSources() {
  return {
    sources: [MOCK_SOURCE],
    mocked: true
  };
}
