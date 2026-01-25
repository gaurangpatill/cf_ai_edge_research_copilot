import type { Env } from "./lib/env";
import { EdgeResearchAgentSqlSQLite as BaseSqlSQLite } from "./agent";
import { ResearchWorkflow } from "./workflows/research";

const BUILD_ID = "v2-clean-002";

export class EdgeResearchAgentSqlSQLite extends BaseSqlSQLite {
  constructor(state: DurableObjectState, env: Env) {
    const sql = state.storage.sql;
    if (!sql) {
      throw new Error("FATAL_SQLITE_NOT_ENABLED");
    }
    super(state, env);
  }
}

export class EdgeResearchAgentSqlFresh extends EdgeResearchAgentSqlSQLite {}
export class EdgeResearchAgentSqlSQLite1 extends EdgeResearchAgentSqlSQLite {}

export { ResearchWorkflow };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const userId = getUserId(request, url);

    if (url.pathname === "/api/chat") {
      const id = env.AGENT.idFromName(userId);
      const stub = env.AGENT.get(id);
      return stub.fetch(request);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        version: "edge-research-copilot-v2",
        buildId: BUILD_ID,
        hasAI: Boolean(env.AI),
        hasVectorize: Boolean(env.VECTORIZE_INDEX)
      });
    }

    if (url.pathname === "/api/message" && request.method === "POST") {
      try {
        const body = (await request.json()) as { text: string };
        const res = await stubFor(env, userId).fetch("https://agent/sendMessage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, text: body.text })
        });
        return res;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        return json({ ok: false, error: message }, 500);
      }
    }

    if (url.pathname === "/api/doc" && request.method === "POST") {
      try {
        const body = (await request.json()) as { title: string; content: string };
        const res = await stubFor(env, userId).fetch("https://agent/addDocument", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId,
            title: body.title,
            content: body.content
          })
        });
        return res;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        return json({ ok: false, error: message }, 500);
      }
    }
    if (url.pathname === "/api/debug/docs" && request.method === "GET") {
      try {
        const res = await stubFor(env, userId).fetch(
          `https://agent/debug/docs?userId=${encodeURIComponent(userId)}`
        );
        return res;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        return json({ ok: false, error: message }, 500);
      }
    }
    if (url.pathname === "/api/debug/vectorize" && request.method === "GET") {
      return json({
        ok: true,
        userId,
        vectorizeBound: Boolean(env.VECTORIZE_INDEX),
        aiBound: Boolean(env.AI)
      });
    }
    if (url.pathname === "/api/debug/sql" && request.method === "GET") {
      try {
        const id = env.AGENT.idFromName(userId);
        const stub = env.AGENT.get(id);
        return await stub.fetch("https://do/debug/sql");
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        return json({ ok: false, error: message }, 500);
      }
    }
    if (url.pathname === "/api/debug/vectorQuery" && request.method === "POST") {
      try {
        const res = await stubFor(env, userId).fetch("https://agent/debug/vectorQuery", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, text: (await request.json() as { text: string }).text })
        });
        return res;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        return json({ ok: false, error: message }, 500);
      }
    }
    if (url.pathname === "/api/debug/sql" && request.method === "GET") {
      try {
        const id = env.AGENT.idFromName(userId);
        const stub = env.AGENT.get(id);
        const res = await stub.fetch("https://do/debug/sql");
        return res;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        return json({ ok: false, error: message }, 500);
      }
    }

    if (url.pathname === "/chunks" && request.method === "POST") {
      let body: { userId?: unknown; chunkIds?: unknown };
      try {
        body = (await request.json()) as { userId?: unknown; chunkIds?: unknown };
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      const parsedUserId = typeof body.userId === "string" ? body.userId.trim() : "";
      const rawChunkIds = Array.isArray(body.chunkIds) ? body.chunkIds : [];
      const normalizedChunkIds: string[] = [];
      let invalidChunkIds = !Array.isArray(body.chunkIds);

      for (const item of rawChunkIds) {
        if (typeof item !== "string") {
          invalidChunkIds = true;
          continue;
        }
        const trimmed = item.trim();
        if (!trimmed) {
          invalidChunkIds = true;
          continue;
        }
        normalizedChunkIds.push(trimmed);
      }

      if (
        !parsedUserId ||
        invalidChunkIds ||
        normalizedChunkIds.length < 1 ||
        normalizedChunkIds.length > 50
      ) {
        return json({ error: "invalid_request" }, 400);
      }

      const res = await stubFor(env, parsedUserId).fetch("https://agent/getChunksByIds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: parsedUserId, chunkIds: normalizedChunkIds })
      });
      return res;
    }

    if (url.pathname === "/api/memories" && request.method === "GET") {
      const res = await stubFor(env, userId).fetch(
        `https://agent/listMemories?userId=${encodeURIComponent(userId)}`
      );
      return res;
    }

    if (url.pathname === "/api/task" && request.method === "POST") {
      const body = (await request.json()) as { query: string };
      const res = await stubFor(env, userId).fetch("https://agent/startResearchTask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, query: body.query })
      });
      return res;
    }

    if (url.pathname === "/api/voice" && request.method === "POST") {
      return json({
        ok: false,
        message: "Voice transcription not implemented yet. Endpoint reserved for future STT."
      }, 501);
    }

    return new Response("Not found", { status: 404 });
  }
};

function getUserId(request: Request, url: URL): string {
  const header = request.headers.get("x-user-id");
  const query = url.searchParams.get("userId");
  return (header || query || "anonymous").slice(0, 64);
}

function stubFor(env: Env, userId: string): DurableObjectStub {
  const id = env.AGENT.idFromName(userId);
  return env.AGENT.get(id);
}

async function callAgent(stub: DurableObjectStub, path: string, payload: unknown): Promise<void> {
  const res = await stub.fetch(`https://agent${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Agent error: ${text}`);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
