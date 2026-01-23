import { Agent } from "@cloudflare/agents";
import { initSchema } from "./lib/db";
import { assembleMessages, buildContextBlock, type ChatMessage } from "./lib/prompts";
import { chunkText } from "./lib/chunking";
import { embedText, runChat } from "./lib/ai";
import { DEFAULT_TOP_K } from "./lib/constants";
import { mapVectorResults, queryVectors, upsertVectors } from "./lib/vectorize";
import type { Env } from "./lib/env";

interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

interface SocketEnvelope {
  type: string;
  userId?: string;
  text?: string;
  title?: string;
  content?: string;
  query?: string;
}

export class EdgeResearchAgent extends Agent<Env> {
  private sessions = new Map<string, Set<WebSocket>>();
  private socketUsers = new Map<WebSocket, string>();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    initSchema(state.storage.sql);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request, url);
    }

    if (url.pathname === "/sendMessage" && request.method === "POST") {
      const body = (await request.json()) as { userId: string; text: string };
      await this.sendMessage(body.userId, body.text);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/addDocument" && request.method === "POST") {
      const body = (await request.json()) as { userId: string; title: string; content: string };
      await this.addDocument(body.userId, body.title, body.content);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/listMemories" && request.method === "GET") {
      const userId = url.searchParams.get("userId") ?? "";
      const memories = await this.listMemories(userId);
      return new Response(JSON.stringify({ memories }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/startResearchTask" && request.method === "POST") {
      const body = (await request.json()) as { userId: string; query: string };
      const taskId = await this.startResearchTask(body.userId, body.query);
      return new Response(JSON.stringify({ taskId }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/emit" && request.method === "POST") {
      const body = (await request.json()) as { userId: string; event: unknown };
      await this.emitEvent(body.userId, body.event);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/task" && request.method === "POST") {
      const body = (await request.json()) as { userId: string; taskId: string; status: string };
      await this.updateTaskStatus(body.userId, body.taskId, body.status);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/task/create" && request.method === "POST") {
      const body = (await request.json()) as { userId: string; taskId: string; query: string };
      await this.createTask(body.userId, body.taskId, body.query);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/summary" && request.method === "POST") {
      const body = (await request.json()) as { userId: string; summary: string };
      await this.storeSummary(body.userId, body.summary);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    return new Response("Not found", { status: 404 });
  }

  async sendMessage(userId: string, text: string): Promise<void> {
    this.ensureUser(userId);
    await this.rateLimit(userId);
    await this.storeMessage(userId, "user", text);

    await this.emitEvent(userId, { type: "status", message: "retrieving_context" });

    const embedding = await embedText(this.env, [text]);
    const vectorResult = await queryVectors(this.env, embedding[0] ?? [], { userId }, DEFAULT_TOP_K);
    const chunkLookup = await this.loadChunkLookup(userId);
    const retrieved = mapVectorResults(vectorResult, chunkLookup);
    const contextBlock = buildContextBlock(retrieved, DEFAULT_TOP_K);

    const conversation = await this.loadConversation(userId, 12);
    const messages = assembleMessages(conversation, contextBlock);

    await this.emitEvent(userId, { type: "status", message: "generating_response" });

    const result = await runChat(this.env, messages, { stream: false });
    const output = result?.response ?? result?.result ?? result?.output ?? "";

    await this.streamText(userId, output || "(no response)");
    await this.storeMessage(userId, "assistant", output || "");

    await this.emitEvent(userId, { type: "status", message: "done" });
    await this.maybeSummarize(userId);
  }

  async addDocument(userId: string, title: string, content: string): Promise<void> {
    this.ensureUser(userId);
    const docId = crypto.randomUUID();
    const sql = this.state.storage.sql;

    sql
      .prepare("INSERT INTO docs (id, user_id, title, content) VALUES (?, ?, ?, ?)")
      .bind(docId, userId, title, content)
      .run();

    const chunks = chunkText(content);
    const embeddings = await embedText(this.env, chunks.map((chunk) => chunk.text));

    const vectors = chunks.map((chunk, index) => {
      const chunkId = `${docId}:${chunk.index}`;
      sql
        .prepare(
          "INSERT INTO doc_chunks (id, doc_id, user_id, chunk_index, content) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(chunkId, docId, userId, chunk.index, chunk.text)
        .run();

      return {
        id: chunkId,
        values: embeddings[index] ?? [],
        metadata: {
          userId,
          docId,
          chunkId,
          title
        }
      };
    });

    await upsertVectors(this.env, vectors);
    await this.emitEvent(userId, { type: "memory", action: "added_doc", docId, title });
  }

  async listMemories(userId: string): Promise<{ docs: unknown[]; summaries: unknown[] }> {
    const sql = this.state.storage.sql;
    const docs = sql
      .prepare("SELECT id, title, created_at FROM docs WHERE user_id = ? ORDER BY created_at DESC")
      .bind(userId)
      .all().results;

    const summaries = sql
      .prepare("SELECT id, content, created_at FROM summaries WHERE user_id = ? ORDER BY created_at DESC")
      .bind(userId)
      .all().results;

    return { docs, summaries };
  }

  async startResearchTask(userId: string, query: string): Promise<string> {
    this.ensureUser(userId);
    const taskId = crypto.randomUUID();
    await this.createTask(userId, taskId, query);

    await this.emitEvent(userId, { type: "task", status: "started", taskId, query });

    const handle = await this.env.RESEARCH_WORKFLOW.start({ userId, query, taskId });
    await this.updateTaskStatus(userId, taskId, "running");

    await this.emitEvent(userId, {
      type: "task",
      status: "workflow_started",
      taskId,
      workflowId: handle.id
    });

    return taskId;
  }

  async emitEvent(userId: string, event: unknown): Promise<void> {
    const sockets = this.sessions.get(userId);
    if (!sockets) return;
    const payload = JSON.stringify(event);
    for (const socket of sockets) {
      socket.send(payload);
    }
  }

  async updateTaskStatus(userId: string, taskId: string, status: string): Promise<void> {
    const sql = this.state.storage.sql;
    sql
      .prepare("UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(status, taskId)
      .run();

    await this.emitEvent(userId, { type: "task", status, taskId });
  }

  async createTask(userId: string, taskId: string, query: string): Promise<void> {
    const sql = this.state.storage.sql;
    sql
      .prepare("INSERT INTO tasks (id, user_id, query, status) VALUES (?, ?, ?, ?)")
      .bind(taskId, userId, query, "queued")
      .run();
  }

  private async loadChunkLookup(
    userId: string
  ): Promise<Map<string, { text: string; source: string }>> {
    const sql = this.state.storage.sql;
    const rows = sql
      .prepare("SELECT id, content, doc_id FROM doc_chunks WHERE user_id = ?")
      .bind(userId)
      .all().results as Array<{ id: string; content: string; doc_id: string }>;

    const docs = sql
      .prepare("SELECT id, title FROM docs WHERE user_id = ?")
      .bind(userId)
      .all().results as Array<{ id: string; title: string }>;

    const docMap = new Map(docs.map((doc) => [doc.id, doc.title]));
    const lookup = new Map<string, { text: string; source: string }>();

    for (const row of rows) {
      lookup.set(row.id, { text: row.content, source: docMap.get(row.doc_id) ?? "doc" });
    }

    return lookup;
  }

  private async loadConversation(userId: string, limit: number): Promise<ChatMessage[]> {
    const sql = this.state.storage.sql;
    const rows = sql
      .prepare(
        "SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
      )
      .bind(userId, limit)
      .all().results as Array<{ role: "user" | "assistant"; content: string }>;

    return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
  }

  private async storeMessage(userId: string, role: "user" | "assistant", content: string): Promise<void> {
    const sql = this.state.storage.sql;
    sql
      .prepare("INSERT INTO messages (id, user_id, role, content) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), userId, role, content)
      .run();
  }

  private ensureUser(userId: string): void {
    const sql = this.state.storage.sql;
    sql
      .prepare("INSERT OR IGNORE INTO conversations (user_id) VALUES (?)")
      .bind(userId)
      .run();
  }

  private async maybeSummarize(userId: string): Promise<void> {
    const sql = this.state.storage.sql;
    const count = sql
      .prepare("SELECT COUNT(*) as total FROM messages WHERE user_id = ?")
      .bind(userId)
      .all().results[0] as { total: number };

    if ((count?.total ?? 0) < 18) return;

    const rows = sql
      .prepare("SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 12")
      .bind(userId)
      .all().results as Array<{ role: string; content: string }>;

    const summaryPrompt: ChatMessage[] = [
      {
        role: "system",
        content: "Summarize the recent conversation into 5-7 bullet points."
      },
      {
        role: "user",
        content: rows.map((row) => `${row.role}: ${row.content}`).reverse().join("\n")
      }
    ];

    const result = await runChat(this.env, summaryPrompt, { stream: false, maxTokens: 300 });
    const summary = result?.response ?? result?.result ?? "";
    if (!summary) return;

    await this.storeSummary(userId, summary);
  }

  private async storeSummary(userId: string, summary: string): Promise<void> {
    const sql = this.state.storage.sql;
    sql
      .prepare("INSERT INTO summaries (id, user_id, content) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), userId, summary)
      .run();
  }

  private async streamText(userId: string, text: string): Promise<void> {
    const sockets = this.sessions.get(userId);
    if (!sockets) return;

    const chunks = splitForStream(text, 48);
    for (const chunk of chunks) {
      const payload = JSON.stringify({ type: "assistant_chunk", text: chunk });
      for (const socket of sockets) socket.send(payload);
    }
    for (const socket of sockets) socket.send(JSON.stringify({ type: "assistant_done" }));
  }

  private async rateLimit(userId: string): Promise<void> {
    const tokensMax = Number(this.env.RATE_LIMIT_TOKENS ?? "20");
    const refillPerSec = Number(this.env.RATE_LIMIT_REFILL_PER_SEC ?? "0.2");
    const key = `rate:${userId}`;
    const existing = (await this.state.storage.get<RateLimitState>(key)) ?? {
      tokens: tokensMax,
      lastRefill: Date.now()
    };

    const now = Date.now();
    const delta = Math.max(0, now - existing.lastRefill) / 1000;
    const nextTokens = Math.min(tokensMax, existing.tokens + delta * refillPerSec);
    if (nextTokens < 1) {
      throw new Error("rate_limited");
    }

    const updated: RateLimitState = { tokens: nextTokens - 1, lastRefill: now };
    await this.state.storage.put(key, updated);
  }

  private handleWebSocket(request: Request, url: URL): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);
    const userId = url.searchParams.get("userId") ?? "";
    if (userId) this.bindSocket(userId, server);

    client.addEventListener("close", () => {
      const user = this.socketUsers.get(server);
      if (user) this.unbindSocket(user, server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string): Promise<void> {
    let data: SocketEnvelope;
    try {
      data = JSON.parse(message) as SocketEnvelope;
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "invalid_json" }));
      return;
    }

    if (data.type === "hello" && data.userId) {
      this.bindSocket(data.userId, socket);
      socket.send(JSON.stringify({ type: "ready" }));
      return;
    }

    if (data.type === "user_message" && data.userId && data.text) {
      await this.sendMessage(data.userId, data.text);
      return;
    }

    if (data.type === "add_document" && data.userId && data.title && data.content) {
      await this.addDocument(data.userId, data.title, data.content);
      return;
    }

    if (data.type === "start_task" && data.userId && data.query) {
      await this.startResearchTask(data.userId, data.query);
      return;
    }

    socket.send(JSON.stringify({ type: "error", message: "unknown_command" }));
  }

  private bindSocket(userId: string, socket: WebSocket): void {
    const set = this.sessions.get(userId) ?? new Set<WebSocket>();
    set.add(socket);
    this.sessions.set(userId, set);
    this.socketUsers.set(socket, userId);
  }

  private unbindSocket(userId: string, socket: WebSocket): void {
    const set = this.sessions.get(userId);
    if (!set) return;
    set.delete(socket);
    if (!set.size) this.sessions.delete(userId);
    this.socketUsers.delete(socket);
  }
}

function splitForStream(text: string, size: number): string[] {
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    chunks.push(text.slice(index, index + size));
    index += size;
  }
  return chunks;
}
