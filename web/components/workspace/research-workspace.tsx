"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import {
  ChevronRight,
  FileText,
  FolderSearch2,
  LoaderCircle,
  LogOut,
  PencilLine,
  Plus,
  SendHorizontal,
  Trash2,
  Upload
} from "lucide-react";
import { clearAuthUser, getAuthUser } from "@/lib/auth-store";
import { cn, formatDateTime, readFileText, truncate } from "@/lib/utils";
import type {
  ChatMessage,
  Citation,
  SessionRecord,
  SourceRecord,
  RetrievalChunk
} from "@/lib/types";
import { WORKSPACE_PROMPTS } from "@/lib/constants";
import { persistMockMessages, workerClient } from "@/lib/worker-client";

type PanelState = "sources" | "retrieval";

export function ResearchWorkspace({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [panelState, setPanelState] = useState<PanelState>("retrieval");
  const [ingestTitle, setIngestTitle] = useState("");
  const [ingestText, setIngestText] = useState("");
  const [fileName, setFileName] = useState("");
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [usingMockBackend, setUsingMockBackend] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === sessionId) ?? currentSession,
    [currentSession, sessionId, sessions]
  );
  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant") ?? null,
    [messages]
  );

  function upsertSession(session: SessionRecord) {
    setCurrentSession(session);
    setSessions((current) => {
      const next = current.filter((item) => item.id !== session.id);
      return [session, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceState() {
      if (!getAuthUser()) {
        router.replace(`/login?next=/chat/${sessionId}`);
        return;
      }

      const [sessionsResult, currentSessionResult, messagesResult] = await Promise.all([
        workerClient.listSessions(),
        workerClient.getSession(sessionId),
        workerClient.listMessages(sessionId)
      ]);

      if (cancelled) return;

      setSessions(sessionsResult.sessions);
      setCurrentSession(currentSessionResult.session);
      setMessages(messagesResult.messages);
      setUsingMockBackend(sessionsResult.mocked || currentSessionResult.mocked || messagesResult.mocked);
      setIsAuthReady(true);

      if (!currentSessionResult.session) {
        if (sessionsResult.sessions[0]) {
          router.replace(`/chat/${sessionsResult.sessions[0].id}`);
          return;
        }

        const created = await workerClient.createSession();
        if (cancelled) return;
        setUsingMockBackend(created.mocked);
        setCurrentSession(created.session);
        router.replace(`/chat/${created.session.id}`);
      }
    }

    void loadWorkspaceState().catch((error: unknown) => {
      if (cancelled) return;
      setWorkspaceError(error instanceof Error ? error.message : "Unable to load session.");
    });

    return () => {
      cancelled = true;
    };
  }, [router, sessionId]);

  useEffect(() => {
    let cancelled = false;

    async function loadSources() {
      if (!hasMounted || !getAuthUser()) {
        setIsLoadingSources(false);
        return;
      }
      setIsLoadingSources(true);
      const result = await workerClient.listSources(sessionId);
      if (cancelled) return;
      setSources(result.sources);
      setUsingMockBackend(result.mocked);
      setIsLoadingSources(false);
    }

    loadSources();
    return () => {
      cancelled = true;
    };
  }, [hasMounted, sessionId]);

  useEffect(() => {
    if (!activeSession) return;
    setRenameDraft(activeSession.title);
  }, [activeSession]);

  if (!hasMounted) {
    return null;
  }

  if (!isAuthReady && !getAuthUser()) {
    return null;
  }

  function syncMessages(nextMessages: ChatMessage[]) {
    setMessages(nextMessages);
    if (usingMockBackend) {
      persistMockMessages(sessionId, nextMessages);
    }
  }

  async function handleSendMessage(prompt?: string) {
    const text = (prompt ?? draft).trim();
    if (!text || isSending) return;

    setWorkspaceError(null);
    setDraft("");
    setIsSending(true);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString()
    };

    const pendingMessages = [...messages, userMessage];
    syncMessages(pendingMessages);

    try {
      const result = await workerClient.sendMessage(sessionId, text);
      setUsingMockBackend(result.mocked);

      const citations = buildCitations(result.citations, result.retrieval);
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.answer,
        citations,
        retrieval: result.retrieval,
        createdAt: new Date().toISOString()
      };

      syncMessages([...pendingMessages, assistantMessage]);
      if (result.session) {
        upsertSession({ ...result.session, lastMessagePreview: truncate(result.answer, 88) });
      } else if (result.mocked) {
        const sessionsResult = await workerClient.listSessions();
        setSessions(sessionsResult.sessions);
      }
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleIngestSource() {
    const content = ingestText.trim();
    const title = ingestTitle.trim() || fileName || "Untitled source";
    if (!content || !title || isIngesting) return;

    setWorkspaceError(null);
    setIsIngesting(true);
    setIngestStatus("Indexing source and creating embeddings...");

    try {
      const result = await workerClient.ingestSource(sessionId, { title, content });
      setUsingMockBackend(result.mocked);
      setIngestStatus(`Indexed ${result.chunkCount ?? "multiple"} chunks successfully.`);
      setIngestTitle("");
      setIngestText("");
      setFileName("");

      const sourcesResult = await workerClient.listSources(sessionId);
      setSources(sourcesResult.sources);
      setUsingMockBackend(sourcesResult.mocked);
      if (result.session) {
        setCurrentSession(result.session);
        setSessions((current) =>
          current
            .map((session) => (session.id === result.session?.id ? { ...session, ...result.session } : session))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        );
      }
      setPanelState("sources");
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Unable to ingest source.");
      setIngestStatus(null);
    } finally {
      setIsIngesting(false);
    }
  }

  async function handleFileChange(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    const text = await readFileText(file);
    setIngestTitle(file.name.replace(/\.[^.]+$/, ""));
    setIngestText(text);
  }

  async function handleRenameSession() {
    const nextTitle = renameDraft.trim();
    if (!nextTitle) return;
    try {
      const result = await workerClient.renameSession(sessionId, nextTitle);
      setUsingMockBackend(result.mocked);
      setCurrentSession(result.session);
      setSessions((current) => current.map((session) => (session.id === sessionId ? { ...session, ...result.session } : session)));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Unable to rename session.");
    }
  }

  async function handleDeleteSession(id: string) {
    try {
      const result = await workerClient.deleteSession(id);
      setUsingMockBackend(result.mocked);
      if (id === sessionId) {
        setCurrentSession(null);
        setMessages([]);
        setSources([]);
      }
      const sessionsResult = await workerClient.listSessions();
      setSessions(sessionsResult.sessions);

      if (id === sessionId) {
        if (sessionsResult.sessions[0]) {
          router.push(`/chat/${sessionsResult.sessions[0].id}`);
          return;
        }

        const next = await workerClient.createSession();
        router.push(`/chat/${next.session.id}`);
      }
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Unable to delete session.");
    }
  }

  return (
    <main className="min-h-screen px-4 py-4 lg:px-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1800px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="panel flex flex-col p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Sessions</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">Research workspace</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                router.push("/new");
              }}
              className="rounded-2xl border border-black/10 bg-white p-2 text-slate-700 transition hover:bg-slate-50"
              aria-label="Create session"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2 overflow-y-auto pr-1">
            {sessions.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-black/10 bg-white/40 px-4 py-5 text-sm leading-6 text-slate-500">
                No saved sessions yet. A session appears here after you send the first message.
              </div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => router.push(`/chat/${session.id}`)}
                  className={cn(
                    "w-full rounded-3xl border px-4 py-3 text-left transition",
                    session.id === sessionId
                      ? "border-slate-900/10 bg-slate-950 text-white"
                      : "border-black/5 bg-white/70 text-slate-700 hover:bg-white"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{session.title}</div>
                      <div className={cn("mt-1 truncate text-xs", session.id === sessionId ? "text-white/70" : "text-slate-500")}>
                        {session.lastMessagePreview || "Saved conversation"}
                      </div>
                    </div>
                    <ChevronRight className={cn("mt-0.5 h-4 w-4 shrink-0", session.id === sessionId ? "text-white/70" : "text-slate-400")} />
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="mt-4 rounded-3xl border border-black/5 bg-white/70 p-4">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Rename current session
            </label>
            <div className="flex gap-2">
              <input
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                className="w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm outline-none ring-0 transition focus:border-slate-400"
                placeholder="Session title"
              />
              <button
                type="button"
                onClick={handleRenameSession}
                className="rounded-2xl border border-black/10 bg-white px-3 text-slate-700 transition hover:bg-slate-50"
                aria-label="Rename session"
              >
                <PencilLine className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => handleDeleteSession(sessionId)}
              className="mt-3 inline-flex items-center gap-2 text-sm text-rose-600 transition hover:text-rose-700"
            >
              <Trash2 className="h-4 w-4" />
              Delete session
            </button>
          </div>
        </aside>

        <section className="panel flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-black/5 px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Edge-native research</p>
                <h1 className="mt-2 text-2xl font-semibold text-slate-950">{activeSession?.title ?? "Research session"}</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {usingMockBackend ? (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
                    Mock fallback active
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900">
                    Connected to Worker API
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPanelState("sources")}
                  className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  Sources
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearAuthUser();
                    router.replace("/login");
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-8 py-12 text-center">
                <div className="space-y-3">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.75rem] bg-slate-950 text-white">
                    <FolderSearch2 className="h-8 w-8" />
                  </div>
                  <h2 className="text-2xl font-semibold text-slate-950">Start with a source, then ask a grounded question.</h2>
                  <p className="max-w-xl text-sm leading-7 text-slate-600">
                    This workspace keeps session-level memory, shows citations, and exposes the retrieved chunks used for each answer.
                  </p>
                </div>
                <div className="grid w-full max-w-2xl gap-3 md:grid-cols-3">
                  {WORKSPACE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void handleSendMessage(prompt)}
                      className="rounded-3xl border border-black/5 bg-white p-4 text-left text-sm leading-6 text-slate-700 transition hover:-translate-y-0.5 hover:bg-slate-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={cn(
                      "rounded-[1.75rem] border p-5",
                      message.role === "assistant"
                        ? "border-black/5 bg-white"
                        : "ml-auto max-w-2xl border-slate-900/10 bg-slate-950 text-white"
                    )}
                  >
                    <div className="mb-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.22em]">
                      <span className={message.role === "assistant" ? "text-slate-500" : "text-white/60"}>
                        {message.role === "assistant" ? "Assistant" : "You"}
                      </span>
                      <span className={message.role === "assistant" ? "text-slate-400" : "text-white/50"}>
                        {formatDateTime(message.createdAt)}
                      </span>
                    </div>

                    {message.role === "assistant" ? (
                      <div className="markdown">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>
                    )}

                    {message.role === "assistant" && (message.citations?.length || 0) > 0 ? (
                      <div className="mt-5 border-t border-black/5 pt-4">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Citations</p>
                        <div className="flex flex-wrap gap-2">
                          {message.citations?.map((citation) => (
                            <button
                              key={`${message.id}-${citation.chunkId ?? citation.sourceId}`}
                              type="button"
                              onClick={() => setPanelState("retrieval")}
                              className="rounded-full border border-emerald-900/10 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900"
                            >
                              {citation.label}: {citation.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}

                {isSending ? (
                  <div className="rounded-[1.75rem] border border-black/5 bg-white p-5">
                    <div className="flex items-center gap-3 text-sm text-slate-500">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      Retrieving context and drafting answer...
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="border-t border-black/5 px-6 py-5">
            {workspaceError ? (
              <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {workspaceError}
              </div>
            ) : null}
            <div className="rounded-[1.75rem] border border-black/10 bg-white p-3 shadow-sm">
              <textarea
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSendMessage();
                  }
                }}
                placeholder="Ask a question about your uploaded material..."
                className="w-full resize-none border-0 bg-transparent px-2 py-1 text-sm leading-7 text-slate-800 outline-none placeholder:text-slate-400"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Enter to send. Shift + Enter for a new line.</p>
                <button
                  type="button"
                  onClick={() => void handleSendMessage()}
                  disabled={!draft.trim() || isSending}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <SendHorizontal className="h-4 w-4" />
                  Send
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="panel flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-black/5 px-5 py-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Workspace details</p>
                <h2 className="mt-2 text-lg font-semibold text-slate-950">Sources and retrieval</h2>
              </div>
              <div className="rounded-full border border-black/10 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setPanelState("sources")}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition",
                    panelState === "sources" ? "bg-slate-950 text-white" : "text-slate-600"
                  )}
                >
                  Sources
                </button>
                <button
                  type="button"
                  onClick={() => setPanelState("retrieval")}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition",
                    panelState === "retrieval" ? "bg-slate-950 text-white" : "text-slate-600"
                  )}
                >
                  Retrieval
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            <section className="mb-6 rounded-[1.5rem] border border-black/5 bg-white p-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-800">
                  <Upload className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Add source material</h3>
                  <p className="text-xs text-slate-500">Text paste works now. Text and markdown file uploads are ready.</p>
                </div>
              </div>
              <div className="space-y-3">
                <input
                  value={ingestTitle}
                  onChange={(event) => setIngestTitle(event.target.value)}
                  placeholder="Source title"
                  className="w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
                <textarea
                  rows={8}
                  value={ingestText}
                  onChange={(event) => setIngestText(event.target.value)}
                  placeholder="Paste notes, excerpts, meeting transcripts, or draft research here..."
                  className="w-full resize-none rounded-[1.25rem] border border-black/10 bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-slate-400"
                />
                <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-black/10 bg-slate-50 px-3 py-3 text-sm text-slate-600 transition hover:bg-slate-100">
                  <FileText className="h-4 w-4" />
                  <span>{fileName || "Attach .txt or .md file"}</span>
                  <input
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      void handleFileChange(file).catch((error: unknown) => {
                        setWorkspaceError(error instanceof Error ? error.message : "Unable to read the selected file.");
                      });
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleIngestSource()}
                  disabled={!ingestText.trim() || isIngesting}
                  className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isIngesting ? "Indexing source..." : "Add to session"}
                </button>
                {ingestStatus ? <p className="text-xs text-emerald-700">{ingestStatus}</p> : null}
              </div>
            </section>

            {panelState === "sources" ? (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Indexed sources</h3>
                  <span className="text-xs text-slate-500">{sources.length} total</span>
                </div>
                <p className="text-xs leading-6 text-slate-500">
                  Sources are the documents currently attached to this session and available for retrieval.
                </p>
                {isLoadingSources ? (
                  <div className="rounded-[1.5rem] border border-black/5 bg-white p-4 text-sm text-slate-500">
                    Loading sources...
                  </div>
                ) : sources.length === 0 ? (
                  <div className="rounded-[1.5rem] border border-black/5 bg-white p-4 text-sm leading-6 text-slate-500">
                    No source material has been indexed for this session yet.
                  </div>
                ) : (
                  sources.map((source) => (
                    <div key={source.id} className="rounded-[1.5rem] border border-black/5 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">{source.title}</h4>
                          <p className="mt-1 text-xs text-slate-500">{formatDateTime(source.createdAt)}</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600">
                          {source.chunkCount ?? "?"} chunks
                        </span>
                      </div>
                      {source.status ? <p className="mt-3 text-xs text-slate-500">{source.status}</p> : null}
                    </div>
                  ))
                )}
              </section>
            ) : (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Retrieved chunks</h3>
                  <span className="text-xs text-slate-500">{latestAssistantMessage?.retrieval?.length ?? 0} hits</span>
                </div>
                <p className="text-xs leading-6 text-slate-500">
                  Retrieval shows the exact chunks pulled into the latest grounded answer, not your full source list.
                </p>
                {latestAssistantMessage?.retrieval?.length ? (
                  latestAssistantMessage.retrieval.map((chunk) => (
                    <details
                      key={chunk.chunkId}
                      className="rounded-[1.5rem] border border-black/5 bg-white p-4"
                      open={latestAssistantMessage.retrieval?.[0]?.chunkId === chunk.chunkId}
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-900">{chunk.title}</h4>
                            <p className="mt-1 text-xs text-slate-500">
                              Chunk {chunk.chunkIndex + 1}
                              {typeof chunk.score === "number" ? ` • score ${chunk.score.toFixed(3)}` : ""}
                            </p>
                          </div>
                          <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-800">
                            {chunk.sourceType ?? "indexed"}
                          </span>
                        </div>
                      </summary>
                      <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-600">{chunk.content}</p>
                    </details>
                  ))
                ) : (
                  <div className="rounded-[1.5rem] border border-black/5 bg-white p-4 text-sm leading-6 text-slate-500">
                    Retrieval context appears here after the assistant answers a question against indexed material.
                  </div>
                )}
              </section>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function buildCitations(base: Citation[], retrieval: RetrievalChunk[]): Citation[] {
  if (retrieval.length > 0) {
    return retrieval.map((chunk, index) => ({
      sourceId: chunk.docId,
      label: `Source ${index + 1}`,
      title: chunk.title,
      snippet: truncate(chunk.content, 140),
      chunkId: chunk.chunkId
    }));
  }

  return base.map((citation, index) => ({
    ...citation,
    label: citation.label || `Source ${index + 1}`
  }));
}
