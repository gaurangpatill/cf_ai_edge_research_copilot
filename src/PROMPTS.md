# AI Prompts Used During Development

This document contains representative AI prompts used while designing,
implementing, debugging, and iterating on this Cloudflare AI-powered application.
AI was used as a development assistant to speed up implementation and unblock
issues, while architectural decisions and final implementations were made by me.

Prompts are grouped roughly in chronological order and reflect real development
challenges encountered during the project.

---

## 1. Choosing the Cloudflare Architecture

**Prompt:**
> I want to build an AI-powered research copilot on Cloudflare. I expect user chat
> input, long-running research tasks, memory per user, and semantic search over
> documents. I do NOT want a generic server setup. Help me choose between Workers,
> Durable Objects, Workflows, Vectorize, and Pages, and explain why each one would
> be used.

**Purpose:**
To understand Cloudflare-native primitives and make an informed architectural
decision rather than copying a template.

**Outcome:**
I chose:
- Workers for HTTP routing and API endpoints
- Durable Objects for per-user/session state and rate limiting
- Workflows for long-running, multi-step AI research tasks
- Vectorize for embeddings-based document retrieval
- Workers AI (Llama 3.3) for all LLM inference

---

## 2. Designing the Request Flow (Before Writing Code)

**Prompt:**
> Before I write any code, help me define the request lifecycle for a chat-based
> AI app on Cloudflare. I want fast responses for simple queries, but background
> execution for heavy AI tasks. Walk through a request step by step.

**Purpose:**
To avoid rewriting the system later due to poor separation of concerns.

**Outcome:**
I designed the flow so that:
- The Worker validates input and routes requests
- Durable Objects manage state and memory
- Workflows handle slow or multi-stage AI operations
- The client receives a task ID for long-running jobs

---

## 3. Writing the Initial Worker Skeleton

**Prompt:**
> Write a minimal but production-style Cloudflare Worker in TypeScript that
> exposes a /chat endpoint, parses JSON input, and forwards the request to a
> Durable Object. Keep it simple and idiomatic.

**Purpose:**
To bootstrap the Worker correctly instead of starting from scratch.

**Outcome:**
This became the base Worker file, which I later expanded with authentication,
rate limiting, and workflow triggering logic.

---

## 4. Durable Object for Memory & State

**Prompt:**
> Help me write a Durable Object that stores per-user conversation state. I want
> to store recent messages, a rolling summary, and metadata like token usage.
> Show a clean class-based example.

**Purpose:**
To correctly structure a Durable Object and avoid anti-patterns.

**Outcome:**
I implemented a Durable Object that:
- Stores recent messages
- Maintains summarized long-term memory
- Tracks request counts and token usage
- Acts as the single source of truth for user state

---

## 5. Designing the LLM System Prompt

**Prompt:**
> Write a system prompt for a research assistant using Llama 3.3 that prioritizes
> retrieved documents, avoids hallucination, and explicitly says when it does not
> know something. Keep it concise but strict.

**Purpose:**
To lock in consistent AI behavior early.

**Outcome:**
The system prompt produced here is reused across all Workers AI calls and acts
as a behavioral contract for the assistant.

---

## 6. Integrating Vectorize (First Attempt)

**Prompt:**
> Show me how to embed user queries using Workers AI and query a Vectorize index
> for the top-k relevant document chunks. Include TypeScript examples.

**Purpose:**
To implement retrieval-augmented generation (RAG).

**Outcome:**
Initial Vectorize integration worked, but later required debugging when query
results did not match stored chunks.

---

## 7. Debugging Vectorize vs Stored Data Mismatch

**Prompt:**
> I am storing document chunks in SQLite inside a Durable Object and embeddings in
> Vectorize. My Vectorize matches return IDs, but I cannot reliably map them back
> to my stored chunks. What is the correct pattern here?

**Purpose:**
To resolve inconsistency between Vectorize results and local storage.

**Outcome:**
I redesigned chunk IDs to be globally unique and ensured the same IDs were used
for both SQLite storage and Vectorize upserts.

---

## 8. Introducing Cloudflare Workflows

**Prompt:**
> My Worker is timing out when I do multi-step AI reasoning and retrieval in one
> request. Rewrite this flow using Cloudflare Workflows so it is resumable and
> non-blocking.

**Purpose:**
To eliminate execution timeouts and improve reliability.

**Outcome:**
Heavy AI tasks were moved into Workflows with clearly defined steps:
- Query understanding
- Vector search
- Evidence synthesis
- Final answer generation

---

## 9. Writing Workflow Code

**Prompt:**
> Write a Cloudflare Workflow example in TypeScript that runs multiple steps,
> passes data between them, and handles retries safely.

**Purpose:**
To correctly structure workflow logic and state passing.

**Outcome:**
This prompt helped bootstrap the workflow file, which I later customized heavily
to fit the research pipeline.

---

## 10. SQLite Durable Object Issues

**Prompt:**
> I enabled SQLite in my Durable Object but queries are failing at runtime. What
> are the exact requirements for enabling SQLite-backed Durable Objects in
> Cloudflare, including wrangler configuration and migrations?

**Purpose:**
To debug persistent runtime failures.

**Outcome:**
I fixed my wrangler.toml configuration and migrations to explicitly enable SQLite
for the Durable Object, resolving the issue.

---

## 11. Wrangler Deploy & Binding Errors

**Prompt:**
> Wrangler deploy succeeds, but my Worker crashes at runtime due to missing
> bindings. How do I correctly define and verify AI, Vectorize, Durable Object,
> and Workflow bindings?

**Purpose:**
To fix deployment-time vs runtime inconsistencies.

**Outcome:**
I corrected environment bindings and verified them via `wrangler deploy` output
before testing the live endpoint.

---

## 12. Rate Limiting & Token Limits

**Prompt:**
> I want to enforce per-user rate limits and token limits using Durable Objects.
> Show a clean approach that avoids race conditions.

**Purpose:**
To prevent abuse and control AI costs.

**Outcome:**
Rate limiting and token accounting were implemented inside the Durable Object,
checked before invoking Workers AI.

---

## 13. Refining Code & Reducing Boilerplate

**Prompt:**
> Refactor this Worker and Durable Object code to reduce duplication and improve
> readability, but do NOT change the architecture.

**Purpose:**
To clean up code without introducing risk.

**Outcome:**
This helped simplify handlers and shared utilities while preserving behavior.

---