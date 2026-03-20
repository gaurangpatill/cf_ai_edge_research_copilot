import type { Env } from "./lib/env";
import { EdgeResearchAgentSqlSQLite as BaseSqlSQLite } from "./agent";
import { AuthGatewaySqlV2 as BaseAuthGatewaySqlV2, authenticateRequest } from "./auth";
import { ResearchWorkflow } from "./workflows/research";

const BUILD_ID = "v2-clean-003";

export class EdgeResearchAgentSqlSQLite extends BaseSqlSQLite {
  constructor(state: DurableObjectState, env: Env) {
    const sql = state.storage.sql;
    if (!sql) {
      throw new Error("FATAL_SQLITE_NOT_ENABLED");
    }
    super(state, env);
  }
}

export class EdgeResearchAgentSessionSqlV2 extends EdgeResearchAgentSqlSQLite {}
export class AuthGatewaySqlV2 extends BaseAuthGatewaySqlV2 {}
export class EdgeResearchAgentSqlFresh extends EdgeResearchAgentSqlSQLite {}
export class EdgeResearchAgentSqlSQLite1 extends EdgeResearchAgentSqlSQLite {}

export { ResearchWorkflow };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sessionRoute = matchSessionRoute(url.pathname);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      try {
        const body = await request.text();
        return withCors(
          await authStubFor(env).fetch("https://auth/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body
          }),
          request
        );
      } catch (error) {
        return errorJson(error, 400);
      }
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      try {
        const body = await request.text();
        return withCors(
          await authStubFor(env).fetch("https://auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body
          }),
          request
        );
      } catch (error) {
        return errorJson(error, 401);
      }
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

    const auth = await authenticateRequest(request, env);
    if (!auth) {
      return withCors(json({ ok: false, error: "unauthorized" }, 401), request);
    }
    const userId = auth.userId;

    if (url.pathname === "/api/chat") {
      const id = env.AGENT.idFromName(userId);
      const stub = env.AGENT.get(id);
      return withCors(await stub.fetch(request), request);
    }

    if (url.pathname === "/api/sessions" && request.method === "POST") {
      try {
        const body = (await request.json()) as { title?: string };
        return withCors(await stubFor(env, userId).fetch("https://agent/createSession", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, title: body.title })
        }), request);
      } catch (error) {
        return errorJson(error);
      }
    }

    if (url.pathname === "/api/sessions" && request.method === "GET") {
      try {
        return withCors(await stubFor(env, userId).fetch(`https://agent/listSessions?userId=${encodeURIComponent(userId)}`), request);
      } catch (error) {
        return errorJson(error);
      }
    }

    if (sessionRoute && request.method === "GET" && sessionRoute.kind === "session") {
      try {
        return withCors(await stubFor(env, userId).fetch(
          `https://agent/getSession?userId=${encodeURIComponent(userId)}&sessionId=${encodeURIComponent(sessionRoute.sessionId)}`
        ), request);
      } catch (error) {
        return errorJson(error);
      }
    }

    if (sessionRoute && request.method === "PATCH" && sessionRoute.kind === "session") {
      try {
        const body = (await request.json()) as { title: string };
        return withCors(await stubFor(env, userId).fetch("https://agent/updateSession", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, sessionId: sessionRoute.sessionId, title: body.title })
        }), request);
      } catch (error) {
        return errorJson(error);
      }
    }

    if (sessionRoute && request.method === "DELETE" && sessionRoute.kind === "session") {
      try {
        return withCors(await stubFor(env, userId).fetch("https://agent/deleteSession", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, sessionId: sessionRoute.sessionId })
        }), request);
      } catch (error) {
        return errorJson(error);
      }
    }

    if (sessionRoute && request.method === "GET" && sessionRoute.kind === "messages") {
      try {
        return withCors(await stubFor(env, userId).fetch(
          `https://agent/listMessages?userId=${encodeURIComponent(userId)}&sessionId=${encodeURIComponent(sessionRoute.sessionId)}`
        ), request);
      } catch (error) {
        return errorJson(error);
      }
    }

    if (url.pathname === "/api/message" && request.method === "POST") {
      try {
        const body = (await request.json()) as { text: string; sessionId?: string };
        const res = await stubFor(env, userId).fetch("https://agent/sendMessage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, sessionId: body.sessionId ?? userId, text: body.text })
        });
        return withCors(res, request);
      } catch (error) {
        return errorJson(error);
      }
    }

    if (url.pathname === "/api/doc" && request.method === "POST") {
      try {
        const body = (await request.json()) as { title: string; content: string; sessionId?: string };
        const res = await stubFor(env, userId).fetch("https://agent/addDocument", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId,
            sessionId: body.sessionId ?? userId,
            title: body.title,
            content: body.content
          })
        });
        return withCors(res, request);
      } catch (error) {
        return errorJson(error);
      }
    }
    if (url.pathname === "/api/sources" && request.method === "GET") {
      try {
        const sessionId = url.searchParams.get("sessionId") ?? userId;
        return withCors(await stubFor(env, userId).fetch(
          `https://agent/listMemories?userId=${encodeURIComponent(userId)}&sessionId=${encodeURIComponent(sessionId)}`
        ), request);
      } catch (error) {
        return errorJson(error);
      }
    }
    if (url.pathname === "/api/debug/docs" && request.method === "GET") {
      try {
        const sessionId = url.searchParams.get("sessionId");
        const res = await stubFor(env, userId).fetch(
          `https://agent/debug/docs?userId=${encodeURIComponent(userId)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`
        );
        return withCors(res, request);
      } catch (error) {
        return errorJson(error);
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
        return withCors(await stub.fetch("https://do/debug/sql"), request);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        return json({ ok: false, error: message }, 500);
      }
    }
    if (url.pathname === "/api/debug/vectorQuery" && request.method === "POST") {
      try {
        const body = (await request.json()) as { text: string; sessionId?: string };
        const res = await stubFor(env, userId).fetch("https://agent/debug/vectorQuery", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, sessionId: body.sessionId, text: body.text })
        });
        return withCors(res, request);
      } catch (error) {
        return errorJson(error);
      }
    }
    if (url.pathname === "/api/debug/sql" && request.method === "GET") {
      try {
        const id = env.AGENT.idFromName(userId);
        const stub = env.AGENT.get(id);
        const res = await stub.fetch("https://do/debug/sql");
        return withCors(res, request);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        return json({ ok: false, error: message }, 500);
      }
    }

    if (url.pathname === "/chunks" && request.method === "POST") {
      let body: { userId?: unknown; sessionId?: unknown; chunkIds?: unknown };
      try {
        body = (await request.json()) as { userId?: unknown; chunkIds?: unknown };
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      const parsedUserId = typeof body.userId === "string" ? body.userId.trim() : "";
      const effectiveUserId = parsedUserId || userId;
      const parsedSessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
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
        !effectiveUserId ||
        invalidChunkIds ||
        normalizedChunkIds.length < 1 ||
        normalizedChunkIds.length > 50
      ) {
        return json({ error: "invalid_request" }, 400);
      }

      const res = await stubFor(env, effectiveUserId).fetch("https://agent/getChunksByIds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: effectiveUserId, sessionId: parsedSessionId || undefined, chunkIds: normalizedChunkIds })
      });
      return withCors(res, request);
    }

    if (url.pathname === "/api/memories" && request.method === "GET") {
      const sessionId = url.searchParams.get("sessionId");
      return withCors(await stubFor(env, userId).fetch(
        `https://agent/listMemories?userId=${encodeURIComponent(userId)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`
      ), request);
    }

    if (url.pathname === "/api/task" && request.method === "POST") {
      const body = (await request.json()) as { query: string; sessionId?: string };
      const res = await stubFor(env, userId).fetch("https://agent/startResearchTask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, sessionId: body.sessionId ?? userId, query: body.query })
      });
      return withCors(res, request);
    }

    if (url.pathname === "/api/voice" && request.method === "POST") {
      return json({
        ok: false,
        message: "Voice transcription not implemented yet. Endpoint reserved for future STT."
      }, 501);
    }

    return withCors(new Response("Not found", { status: 404 }), request);
  }
};

function matchSessionRoute(pathname: string): { kind: "session" | "messages"; sessionId: string } | null {
  const messagesMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (messagesMatch?.[1]) {
    return { kind: "messages", sessionId: decodeURIComponent(messagesMatch[1]) };
  }
  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch?.[1]) {
    return { kind: "session", sessionId: decodeURIComponent(sessionMatch[1]) };
  }
  return null;
}

function stubFor(env: Env, userId: string): DurableObjectStub {
  const id = env.AGENT.idFromName(userId);
  return env.AGENT.get(id);
}

function authStubFor(env: Env): DurableObjectStub {
  const id = env.AUTH.idFromName("auth");
  return env.AUTH.get(id);
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

function errorJson(error: unknown, status = 500): Response {
  const message = error instanceof Error ? error.message : "unknown_error";
  return json({ ok: false, error: message }, status);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders()
    }
  });
}

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get("origin");
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    vary: "origin"
  };
}

function withCors(response: Response, request?: Request): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
