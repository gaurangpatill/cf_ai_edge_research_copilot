# Cloudflare Edge Research Copilot

An edge-native research assistant built on Cloudflare Workers, Workers AI, Vectorize, Durable Objects, and SQLite-backed persistent state.

The repository now has two layers:

```text
.
├── src/                     # Cloudflare Worker, Durable Object, retrieval and AI logic
├── scripts/                 # smoke tests and local helpers
├── web/                     # Next.js App Router frontend
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── .env.example
├── package.json             # Worker scripts + web passthrough scripts
└── wrangler.toml
```

## Product framing

The web app presents the system as a research workspace:

- create research sessions
- ingest source material
- ask grounded questions
- inspect citations and retrieved chunks
- continue persistent threads backed by Cloudflare Durable Objects

## Existing Cloudflare backend

The core intelligence still lives in Cloudflare:

- Workers AI for chat and embeddings
- Vectorize for semantic retrieval
- Durable Objects with SQLite for persistence
- Workflows for longer-running research tasks

The Next.js frontend is intentionally thin and calls Worker endpoints rather than reimplementing RAG logic.

## Worker endpoints available today

- `GET /api/health`
- `POST /api/sessions`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `PATCH /api/sessions/:id`
- `DELETE /api/sessions/:id`
- `GET /api/sessions/:id/messages`
- `POST /api/doc`
- `POST /api/message`
- `GET /api/sources?sessionId=...`
- `GET /api/memories?sessionId=...`
- `POST /api/debug/vectorQuery`
- `POST /chunks`

## Web MVP setup

1. Install Worker dependencies at the repo root:

```bash
npm install
```

2. Install frontend dependencies:

```bash
cd web
npm install
cp .env.example .env.local
```

3. Set a local or deployed Worker auth secret.

For deployed environments:

```bash
npx wrangler secret put AUTH_SECRET
```

For local Worker development, create a root `.dev.vars` file:

```env
AUTH_SECRET=your-random-local-secret
```

4. Set your Worker URL in `web/.env.local`:

```bash
NEXT_PUBLIC_WORKER_BASE_URL=http://127.0.0.1:8787
NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false
```

5. Run the Worker and the web app in separate terminals:

```bash
npm run dev:worker
```

This runs Wrangler in `--remote` mode on port `8787` so Workers AI and Vectorize are available during local web development. It also uses a versioned local persistence directory for Durable Object state to avoid reusing old non-SQLite dev state.

```bash
npm run dev:web
```

6. Open `http://localhost:3000`.

If you want to point the UI at a deployed Worker instead, replace `NEXT_PUBLIC_WORKER_BASE_URL` with your deployed `workers.dev` URL.

## Backend integration details

The frontend now uses a stable browser-level `userId` sent in the `x-user-id` header. Each user is still mapped to a single Durable Object, but that Durable Object now stores many sessions internally:

- `sessions` table for research threads
- `messages.session_id` for per-session chat history
- `docs.session_id` for per-session source association
- Vectorize metadata includes both `userId` and `sessionId`

`POST /api/message` now returns grounded answer text plus citations and retrieved chunks, so the UI can render attribution without depending on debug-only hydration for the main path.

The mock/local fallback still exists in [`web/lib/worker-client.ts`](/Users/gaurangpatil/Desktop/cloudflare_ai_app_assignment/web/lib/worker-client.ts) so the frontend remains usable if the Worker URL is not configured.