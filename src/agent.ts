import type { Env } from "./lib/env";
import { assembleMessages, buildContextBlock, type ChatMessage, type RetrievedChunk } from "./lib/prompts";
import { chunkText } from "./lib/chunking";
import { embedText, runChat } from "./lib/ai";
import { DEFAULT_TOP_K } from "./lib/constants";
import { queryVectors, upsertVectors } from "./lib/vectorize";

// Durable Object base
import { DurableObject } from "cloudflare:workers";

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

type SqlCursor<T = Record<string, unknown>> = {
  one(): T | null;
  toArray(): T[];
};

type SqlStorage = {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): SqlCursor<T>;
};

function col(sql: SqlStorage, table: string, name: string): any | undefined {
  const rows = all(sql, `PRAGMA table_info(${table})`) as Array<any>;
  return rows.find((r) => r?.name === name);
}

async function migrateDocChunks(sql: SqlStorage): Promise<void> {
  const tables = all(sql, "SELECT name FROM sqlite_master WHERE type='table' AND name='doc_chunks'");
  if (!tables.length) return;

  const createdAtCol = col(sql, "doc_chunks", "created_at");
  const hasDefault =
    createdAtCol && createdAtCol.dflt_value && String(createdAtCol.dflt_value).length > 0;
  if (hasDefault) return;

  exec(
    sql,
    `CREATE TABLE IF NOT EXISTS doc_chunks_v2 (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );

  exec(
    sql,
    `INSERT INTO doc_chunks_v2 (id, doc_id, user_id, chunk_index, content, created_at)
     SELECT id, doc_id, user_id, chunk_index, content,
            COALESCE(created_at, CURRENT_TIMESTAMP)
     FROM doc_chunks`
  );

  exec(sql, "DROP TABLE doc_chunks");
  exec(sql, "ALTER TABLE doc_chunks_v2 RENAME TO doc_chunks");
}

function exec(sql: SqlStorage, statement: string, params: unknown[] = []): SqlCursor {
  if (typeof sql.exec !== "function") throw new Error("FATAL_SQL_EXEC_MISSING");
  return sql.exec(statement, ...params);
}

function all<T = Record<string, unknown>>(sql: SqlStorage, statement: string, params: unknown[] = []): T[] {
  const res = exec(sql, statement, params) as any;
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.results)) return res.results;
  if (res && typeof res.toArray === "function") return res.toArray();
  return [];
}

function get<T = Record<string, unknown>>(sql: SqlStorage, statement: string, params: unknown[] = []): T | null {
  return (all<T>(sql, statement, params)[0] ?? null) as T | null;
}

export class EdgeResearchAgentSqlSQLite extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  private sessions = new Map<string, Set<WebSocket>>();
  private socketUsers = new Map<WebSocket, string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const sql = (ctx.storage as any).sql as SqlStorage | undefined;
    if (!sql || typeof sql.exec !== "function") {
      throw new Error("FATAL_SQL_EXEC_MISSING");
    }
    this.sql = sql;

    // Create schema exactly once
    ctx.blockConcurrencyWhile(async () => {
      exec(
        this.sql,
        `CREATE TABLE IF NOT EXISTS conversations (
          user_id TEXT PRIMARY KEY,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`
      );

      exec(
        this.sql,
        `CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`
      );

      exec(
        this.sql,
        `CREATE TABLE IF NOT EXISTS docs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`
      );

      exec(
        this.sql,
        `CREATE TABLE IF NOT EXISTS doc_chunks (
          id TEXT PRIMARY KEY,
          doc_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`
      );

      await migrateDocChunks(this.sql);

      exec(
        this.sql,
        `CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          query TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`
      );

      exec(
        this.sql,
        `CREATE TABLE IF NOT EXISTS summaries (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`
      );
    });
  }


  // -------------------- DO fetch -----------------------
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request, url);
    }

    // /sendMessage (POST)
    if (url.pathname === "/sendMessage" && request.method === "POST") {
      try {
        const body = (await request.json()) as { userId: string; text: string };
        const result = await this.sendMessage(body.userId, body.text);
        if ((result as any)?.ok === false) {
          return new Response(JSON.stringify(result), {
            status: 500,
            headers: { "content-type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { "content-type": "application/json" }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown_error";
        return new Response(JSON.stringify({ ok: false, error: message }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }
    }

    // /addDocument (POST)
    if (url.pathname === "/addDocument" && request.method === "POST") {
      try {
        const body = (await request.json()) as { userId: string; title: string; content: string };
        const result = await this.addDocument(body.userId, body.title, body.content);
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { "content-type": "application/json" }
        });
      } catch (error) {
        console.error("addDocument failed", error);
        if (error && typeof error === "object" && "error" in (error as any)) {
          return new Response(JSON.stringify({ ok: false, ...(error as any) }), {
            status: 500,
            headers: { "content-type": "application/json" }
          });
        }
        const message = error instanceof Error ? error.message : "unknown_error";
        const stack = error instanceof Error ? error.stack : undefined;
        return new Response(JSON.stringify({ ok: false, error: message, detail: message, stack }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }
    }

    // /debug/sql (GET)
    if (url.pathname === "/debug/sql" && request.method === "GET") {
      const buildId = "v2-sqlcursor-001";
      const className = this.constructor?.name ?? "unknown";

      const tables = all<{ name: string }>(this.sql, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .map((r) => r.name);

      // These tables should exist after schema init
      const docsCount = get<{ n: number }>(this.sql, "SELECT COUNT(*) AS n FROM docs")?.n ?? 0;
      const chunksCount = get<{ n: number }>(this.sql, "SELECT COUNT(*) AS n FROM doc_chunks")?.n ?? 0;

      return new Response(
        JSON.stringify({
          ok: true,
          className,
          buildId,
          hasSql: true,
          tables,
          counts: { docsCount, chunksCount }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    // /debug/docs (GET)
    if (url.pathname === "/debug/docs" && request.method === "GET") {
      const userId = url.searchParams.get("userId") ?? "";
      const docs = this.loadRecentDocs(userId, 50);
      return new Response(JSON.stringify({ ok: true, docs }), {
        headers: { "content-type": "application/json" }
      });
    }

    // /getChunksByIds (POST)
    if (url.pathname === "/getChunksByIds" && request.method === "POST") {
      const body = (await request.json()) as { userId: string; chunkIds: string[] };
      const chunks = this.getChunksByIds(body.userId, body.chunkIds);
      return new Response(JSON.stringify({ chunks }), { headers: { "content-type": "application/json" } });
    }

    // /listMemories (GET)
    if (url.pathname === "/listMemories" && request.method === "GET") {
      const userId = url.searchParams.get("userId") ?? "";
      const memories = this.listMemories(userId);
      return new Response(JSON.stringify({ memories }), { headers: { "content-type": "application/json" } });
    }

    // /startResearchTask (POST)
    if (url.pathname === "/startResearchTask" && request.method === "POST") {
      const body = (await request.json()) as { userId: string; query: string };
      const taskId = await this.startResearchTask(body.userId, body.query);
      return new Response(JSON.stringify({ taskId }), { headers: { "content-type": "application/json" } });
    }

    // /debug/vectorQuery (POST)
    if (url.pathname === "/debug/vectorQuery" && request.method === "POST") {
      try {
        const body = (await request.json()) as { userId: string; text: string; noFilter?: boolean };
        const embedding = await embedText(this.env, [body.text]);
        const filter = body.noFilter ? {} : { userId: body.userId };
        const vectorResult = await queryVectors(this.env, embedding[0] ?? [], filter, DEFAULT_TOP_K, {
          throwOnError: true
        });

        const matches = (vectorResult.matches ?? []).slice(0, 5).map((m) => ({
          id: m.id,
          score: m.score,
          metadata: m.metadata
        }));

        const matchIds = matches
          .map((match) => {
            const meta = match.metadata as Record<string, unknown> | undefined;
            const metaChunkId = typeof meta?.chunkId === "string" ? meta.chunkId : undefined;
            return metaChunkId ?? match.id;
          })
          .filter(Boolean) as string[];

        const rows = matchIds.length ? this.getChunksByIds(body.userId, matchIds) : [];
        const byId = new Map(rows.map((r) => [r.chunkId, r]));

        const hydration = matchIds.map((id) => {
          const row = byId.get(id);
          return { id, foundInSql: Boolean(row), textLen: row?.content?.length ?? 0 };
        });

        const missingChunkIds = matchIds.filter((id) => !byId.has(id));

        return new Response(
          JSON.stringify({
            ok: true,
            userId: body.userId,
            noFilter: Boolean(body.noFilter),
            vectorMatches: matches,
            hydration,
            missingChunkIds
          }),
          { headers: { "content-type": "application/json" } }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ ok: false, error: message }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }
    }

    return new Response("Not found", { status: 404 });
  }

  // ---------------- business logic ---------------------

  private ensureUser(userId: string): void {
    if (!userId) throw new Error("missing_userId");
    exec(this.sql, "INSERT OR IGNORE INTO conversations (user_id) VALUES (?)", [userId]);
  }

  private storeMessage(userId: string, role: "user" | "assistant", content: string): void {
    exec(this.sql, "INSERT INTO messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)", [
      crypto.randomUUID(),
      userId,
      role,
      content,
      new Date().toISOString()
    ]);
  }

  private loadConversation(userId: string, limit: number): ChatMessage[] {
    const rows = all<{ role: "user" | "assistant"; content: string }>(
      this.sql,
      "SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
      [userId, limit]
    );
    return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
  }

  private loadRecentDocs(userId: string, limit: number): Array<{ id: string; title: string; content: string }> {
    return all<{ id: string; title: string; content: string }>(
      this.sql,
      "SELECT id, title, content FROM docs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
      [userId, limit]
    );
  }

  private getChunksByIds(
    userId: string,
    chunkIds: string[]
  ): Array<{
    chunkId: string;
    docId: string;
    title: string;
    sourceType: string | null;
    sourceName: string | null;
    chunkIndex: number;
    content: string;
    createdAt: string;
  }> {
    if (!userId) return [];
    if (!Array.isArray(chunkIds) || chunkIds.length === 0) return [];

    const placeholders = chunkIds.map(() => "?").join(", ");
    const rows = all<{
      chunk_id: string;
      doc_id: string;
      title: string;
      chunk_index: number;
      content: string;
      created_at: string;
    }>(
      this.sql,
      `SELECT c.id as chunk_id,
              c.doc_id as doc_id,
              d.title as title,
              c.chunk_index as chunk_index,
              c.content as content,
              c.created_at as created_at
         FROM doc_chunks c
         JOIN docs d ON d.id = c.doc_id AND d.user_id = c.user_id
        WHERE c.user_id = ? AND c.id IN (${placeholders})`,
      [userId, ...chunkIds]
    );

    const byId = new Map(rows.map((r) => [r.chunk_id, r]));
    const ordered: Array<any> = [];
    for (const id of chunkIds) {
      const row = byId.get(id);
      if (!row) continue;
      ordered.push({
        chunkId: row.chunk_id,
        docId: row.doc_id,
        title: row.title,
        sourceType: null,
        sourceName: null,
        chunkIndex: row.chunk_index,
        content: row.content,
        createdAt: row.created_at
      });
    }
    return ordered;
  }

  private listMemories(userId: string): { docs: unknown[]; summaries: unknown[] } {
    const docs = all(
      this.sql,
      "SELECT id, title, created_at FROM docs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      [userId]
    );
    const summaries = all(
      this.sql,
      "SELECT id, content, created_at FROM summaries WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );
    return { docs, summaries };
  }

  private async rateLimit(userId: string): Promise<void> {
    const tokensMax = Number(this.env.RATE_LIMIT_TOKENS ?? "20");
    const refillPerSec = Number(this.env.RATE_LIMIT_REFILL_PER_SEC ?? "0.2");
    const key = `rate:${userId}`;

    const existing = ((await this.ctx.storage.get(key)) as RateLimitState | undefined) ?? {
      tokens: tokensMax,
      lastRefill: Date.now()
    };

    const now = Date.now();
    const delta = Math.max(0, now - existing.lastRefill) / 1000;
    const nextTokens = Math.min(tokensMax, existing.tokens + delta * refillPerSec);

    if (nextTokens < 1) throw new Error("rate_limited");

    const updated: RateLimitState = { tokens: nextTokens - 1, lastRefill: now };
    await this.ctx.storage.put(key, updated);
  }

  async sendMessage(
    userId: string,
    text: string
  ): Promise<{ answer: string; usedDocs: Array<{ id: string; title: string }> }> {
    this.ensureUser(userId);
    await this.rateLimit(userId);
    this.storeMessage(userId, "user", text);

    const embedding = await embedText(this.env, [text]);
    const vectorResult = await queryVectors(this.env, embedding[0] ?? [], { userId }, DEFAULT_TOP_K);

    const matchIds = (vectorResult.matches ?? [])
      .map((match) => {
        const meta = match.metadata as Record<string, unknown> | undefined;
        const metaChunkId = typeof meta?.chunkId === "string" ? meta.chunkId : undefined;
        return metaChunkId ?? match.id;
      })
      .filter(Boolean) as string[];

    const rows = matchIds.length ? this.getChunksByIds(userId, matchIds) : [];
    const byId = new Map(rows.map((r) => [r.chunkId, r]));
    const scoreById = new Map((vectorResult.matches ?? []).map((m) => [m.id, m.score]));

    const retrieved: RetrievedChunk[] = [];
    for (const id of matchIds) {
      const row = byId.get(id);
      if (!row) continue;
      retrieved.push({
        id,
        score: scoreById.get(id) ?? 0,
        text: row.content ?? "",
        source: row.title ?? "doc"
      });
    }

    const nonEmpty = retrieved.filter((c) => c.text && c.text.trim());
    if (!nonEmpty.length) {
      return {
        answer: "(No stored context yet — add a doc first.)",
        usedDocs: []
      };
    }

    const usedDocsMap = new Map<string, { id: string; title: string }>();
    for (const chunk of nonEmpty) {
      const [docIdPart] = chunk.id.split(":");
      const docId = docIdPart || chunk.id;
      if (!usedDocsMap.has(docId)) usedDocsMap.set(docId, { id: docId, title: chunk.source });
    }

    const contextBlock = buildContextBlock(nonEmpty, DEFAULT_TOP_K);
    const conversation = this.loadConversation(userId, 12);
    const messages = assembleMessages(conversation, contextBlock);

    const result = await runChat(this.env, messages, { stream: false });
    const output = result?.response ?? result?.result ?? result?.output ?? "";
    const answer = output || "(no response)";

    this.storeMessage(userId, "assistant", output || "");
    return { answer, usedDocs: Array.from(usedDocsMap.values()) };
  }

  async addDocument(userId: string, title: string, content: string): Promise<{ docId: string; vectorizeOk: boolean }> {
    this.ensureUser(userId);

    const docId = crypto.randomUUID();

    const createdAt = new Date().toISOString();
    // Insert doc
    try {
      exec(
        this.sql,
        "INSERT INTO docs (id, user_id, title, content, created_at) VALUES (?, ?, ?, ?, ?)",
        [docId, userId, title, content, createdAt]
      );
    } catch (err) {
      throw {
        ok: false,
        error: "docs_insert_failed",
        sqliteError: err instanceof Error ? err.message : String(err)
      };
    }

    // Insert chunks
    const chunks = chunkText(content);
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const chunkId = `${docId}:${i}`;
      try {
        exec(
          this.sql,
          "INSERT INTO doc_chunks (id, doc_id, user_id, chunk_index, content) VALUES (?, ?, ?, ?, ?)",
          [chunkId, docId, userId, i, chunk?.text ?? ""]
        );
      } catch (err) {
        throw {
          ok: false,
          error: "doc_chunks_insert_failed",
          failingChunkIndex: i,
          failingChunkId: chunkId,
          contentLen: (chunk?.text ?? "").length,
          sqliteError: err instanceof Error ? err.message : String(err)
        };
      }
    }

    // Verify write
    const countRow = get<{ n: number }>(
      this.sql,
      "SELECT COUNT(*) AS n FROM doc_chunks WHERE user_id = ? AND doc_id = ?",
      [userId, docId]
    );
    const n = countRow?.n ?? 0;
    if (n < 1) {
      throw { ok: false, error: "doc_chunks_insert_failed", detail: "inserted_zero_chunks" };
    }

    // Embed + vectorize
    const embeddings = await embedText(this.env, chunks.map((c) => c.text));
    const vectors = chunks.map((chunk, index) => {
      const chunkId = `${docId}:${index}`;
      return {
        id: chunkId,
        values: embeddings[index] ?? [],
        metadata: { userId, docId, chunkId, chunkIndex: index, title }
      };
    });

    const validVectors = vectors.filter((v) => Array.isArray(v.values) && v.values.length);
    if (!validVectors.length) throw new Error("vectorize_no_valid_vectors");

    let vectorizeOk = true;
    try {
      await upsertVectors(this.env, validVectors);
    } catch (err) {
      vectorizeOk = false;
      throw new Error(`vectorize_upsert_failed:${err instanceof Error ? err.message : String(err)}`);
    }

    return { docId, vectorizeOk };
  }

  async startResearchTask(userId: string, query: string): Promise<string> {
    this.ensureUser(userId);

    const taskId = crypto.randomUUID();
    exec(this.sql, "INSERT INTO tasks (id, user_id, query, status) VALUES (?, ?, ?, ?)", [
      taskId,
      userId,
      query,
      "queued"
    ]);

    const handle = await this.env.RESEARCH_WORKFLOW.start({ userId, query, taskId });
    exec(this.sql, "UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", ["running", taskId]);

    // optional: broadcast
    await this.emitEvent(userId, { type: "task", status: "workflow_started", taskId, workflowId: handle.id });

    return taskId;
  }

  // ---------------- WebSocket plumbing -----------------

  private handleWebSocket(request: Request, url: URL): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);

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

  private async emitEvent(userId: string, event: unknown): Promise<void> {
    const sockets = this.sessions.get(userId);
    if (!sockets) return;
    const payload = JSON.stringify(event);
    for (const socket of sockets) socket.send(payload);
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

// Keep legacy export if any old instances depend on it
export class EdgeResearchAgentSqlSQLite1 extends EdgeResearchAgentSqlSQLite {}
