# Edge Research Copilot Web

Next.js frontend for the Cloudflare Worker-based research assistant.

## What this layer does

- Preserves the Cloudflare backend as the source of intelligence
- Calls existing Worker endpoints for ingest, chat, memory listing, and retrieval inspection
- Adds a product-grade browser UI with sessions, source management, citations, and retrieval visibility
- Uses local browser storage only for session metadata and chat history until full session endpoints exist in the Worker

## Current backend assumptions

- Each browser session maps to `userId=<sessionId>` when calling the Worker
- `POST /api/doc` ingests source material for that session
- `POST /api/message` returns the grounded answer
- `GET /api/memories` lists indexed docs
- `POST /api/debug/vectorQuery` and `POST /chunks` are used to hydrate retrieval snippets for UI inspection

## Required backend TODOs for full production parity

- Add true session CRUD routes:
  - `POST /api/sessions`
  - `GET /api/sessions`
  - `GET /api/sessions/:id`
  - `PATCH /api/sessions/:id`
  - `DELETE /api/sessions/:id`
- Add `GET /api/sessions/:id/messages` so chat history can reload from Durable Objects instead of local storage
- Extend `POST /api/message` to return citations and retrieved chunks directly
- Add streaming chat responses if you want token-by-token rendering in the UI
