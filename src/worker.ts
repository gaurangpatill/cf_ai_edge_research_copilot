import type { Env } from "./lib/env";
import { EdgeResearchAgent } from "./agent";

export { EdgeResearchAgent };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const userId = getUserId(request, url);

    if (url.pathname === "/api/chat") {
      const id = env.AGENT.idFromName(userId);
      const stub = env.AGENT.get(id);
      return stub.fetch(request);
    }

    if (url.pathname === "/api/message" && request.method === "POST") {
      const body = (await request.json()) as { text: string };
      await callAgent(stubFor(env, userId), "/sendMessage", { userId, text: body.text });
      return json({ ok: true });
    }

    if (url.pathname === "/api/doc" && request.method === "POST") {
      const body = (await request.json()) as { title: string; content: string };
      await callAgent(stubFor(env, userId), "/addDocument", {
        userId,
        title: body.title,
        content: body.content
      });
      return json({ ok: true });
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
