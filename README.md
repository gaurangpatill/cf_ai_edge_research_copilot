# Cloudflare Edge Research Copilot

An AI-powered research assistant built entirely on Cloudflare’s edge platform.  
The system combines LLM inference, durable memory, vector search, and workflow orchestration to deliver fast, contextual answers grounded in user-provided documents.

This project was built as part of **Cloudflare’s AI App optional assignment** and demonstrates a full **retrieval-augmented generation (RAG)** system running on **Workers, Durable Objects (SQLite), Vectorize, and Workflows**.

---

## Features

- Chat-based AI assistant powered by **Workers AI (Llama 3.3)**
- Persistent memory and state using **Durable Objects with SQLite**
- Semantic document retrieval using **Vectorize embeddings**
- Per-user isolation via Durable Object instances
- Workflow orchestration for longer-running research tasks
- Fully edge-native (no external servers, databases, or queues)

---

## Architecture Overview

### Core Components

#### Workers AI
- **LLM**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- **Embeddings**: `@cf/baai/bge-base-en-v1.5`

Used for:
- Chat completion
- Embedding user queries
- Embedding document chunks during ingestion

---

#### Durable Objects (SQLite-backed)
- One agent instance per `userId`
- Persistent SQLite database inside each Durable Object

Stores:
- Conversations
- Messages
- Documents
- Document chunks
- Summaries
- Research tasks

State persists across restarts and deployments.

---

#### Vectorize
- Stores embeddings for document chunks
- Metadata-filtered by `userId`
- Used to retrieve semantically relevant context for each query

---

#### Workflows
- Coordinates longer-running or multi-step research tasks
- Decouples orchestration logic from synchronous chat requests

---

#### Workers (HTTP Layer)
- Routes incoming requests
- Resolves the correct Durable Object instance per user
- Acts as the public API surface

---

## How It Works

### Document Ingestion Flow
1. User uploads a document
2. Document is chunked
3. Chunks are stored in SQLite
4. Embeddings are generated using Workers AI
5. Embeddings are upserted into Vectorize with `userId` metadata

---

### Chat Query Flow
1. User sends a message
2. Message is embedded
3. Vectorize retrieves relevant chunks (filtered by `userId`)
4. Chunk content is hydrated from SQLite
5. Context is injected into the LLM prompt
6. LLM generates a grounded response
7. Used documents are returned for traceability

---

### Memory & Persistence
- Conversations and summaries are stored automatically
- Each user’s data is fully isolated
- Memory survives worker restarts and deployments

---

## API Endpoints

### Health & Debug

**GET `/api/health`**  
Health check for bindings and platform features.

**GET `/api/debug/sql?userId=...`**  
Inspect SQLite state for a user.

**POST `/api/debug/vectorQuery?userId=...`**  
Run a raw Vectorize query for debugging.

---

### Core Functionality

**POST `/api/doc?userId=...`**  
Upload and index a document.

**POST `/api/message?userId=...`**  
Send a chat message grounded in stored context.

**GET `/api/memories?userId=...`**  
List stored documents and summaries for a user.

---

## Data Model (SQLite)

All tables are auto-initialized inside the Durable Object.

- `docs` – stored documents  
- `doc_chunks` – chunked document content  
- `messages` – chat history  
- `conversations` – per-user state  
- `tasks` – research workflows  
- `summaries` – conversation summaries  

---

## Example

### Input
```json
{
  "text": "List 3 Cloudflare products from my stored context."
}

### Output
```json
{
  "answer": "Cloudflare offers Workers, R2, and D1.",
  "usedDocs": ["cf-products"]
}

## Tech Stack

- Cloudflare Workers  
- Workers AI  
- Durable Objects (SQLite)  
- Vectorize  
- Workflows  
- TypeScript  

---

## Assignment Requirements Mapping

| Requirement | Implementation |
|-----------|----------------|
| LLM | Workers AI (Llama 3.3) |
| Workflow / Coordination | Workflows + Durable Objects |
| User Input | Chat API (UI planned via Pages) |
| Memory / State | Durable Objects + SQLite |
| Edge-native | Yes (no external services) |

---

## 🧭 UI Status

A UI has not yet been implemented.

The system is fully functional via HTTP APIs and is designed to be paired with a Cloudflare Pages frontend for chat-based interaction.

---

## Deployment

This project is deployed on Cloudflare Workers.

**Important**: This is an API-first application.  
There is currently **no web UI** at the root route (`/`).

Please interact with the application using the API endpoints (for example via `curl`, Postman, or any HTTP client).

### Base URL
https://cf-ai-edge-research-copilot-v2.gaurangrpatil.workers.dev

### Quick Verification
Run:
```json
    { 
        "curl https://cf-ai-edge-research-copilot-v2.gaurangrpatil.workers.dev/api/health",
        "Expected response includes:"
        "ok: true"
        "hasAI: true"
        "hasVectorize: true"
    }

### Example Usage
Set base URL:
```json
    {
        "BASE=https://cf-ai-edge-research-copilot-v2.gaurangrpatil.workers.dev"
    }
Upload a document:
```json
    {
        "curl -X POST $BASE/api/doc?userId=test"
        "-H content-type: application/json"
        "-d '{title:example,content:Cloudflare offers Workers, R2, and D1.}'"
    }
Ask a question grounded in stored context:
```json
    {
        "curl -X POST $BASE/api/message?userId=test"
        "-H content-type: application/json"
        "-d '{text:List Cloudflare products from my stored context.}'"
    }