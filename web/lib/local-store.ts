import { STORAGE_KEYS } from "@/lib/constants";
import type { ChatMessage, SessionRecord } from "@/lib/types";

const USER_KEY = "edge-research-copilot:user-id";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getSessionMessagesKey(sessionId: string) {
  return `edge-research-copilot:messages:${sessionId}`;
}

export function getSessions(): SessionRecord[] {
  if (!canUseStorage()) return [];
  const raw = window.localStorage.getItem(STORAGE_KEYS.sessions);
  if (!raw) return [];

  try {
    return (JSON.parse(raw) as SessionRecord[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

function saveSessions(items: SessionRecord[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(items));
}

export function createSessionRecord(overrides?: Partial<SessionRecord>): SessionRecord {
  const now = new Date().toISOString();
  const session: SessionRecord = {
    id: overrides?.id ?? crypto.randomUUID(),
    title: overrides?.title ?? "Untitled research session",
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
    lastMessagePreview: overrides?.lastMessagePreview
  };

  const existing = getSessions().filter((item) => item.id !== session.id);
  saveSessions([session, ...existing]);
  return session;
}

export function touchSession(sessionId: string, updates: Partial<Pick<SessionRecord, "title" | "lastMessagePreview">>) {
  const sessions = getSessions();
  const now = new Date().toISOString();
  const updated = sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          ...updates,
          updatedAt: now
        }
      : session
  );

  saveSessions(updated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

export function deleteSessionRecord(sessionId: string) {
  const next = getSessions().filter((session) => session.id !== sessionId);
  saveSessions(next);
  if (canUseStorage()) {
    window.localStorage.removeItem(getSessionMessagesKey(sessionId));
  }
}

export function getMessagesForSession(sessionId: string): ChatMessage[] {
  if (!canUseStorage()) return [];
  const raw = window.localStorage.getItem(getSessionMessagesKey(sessionId));
  if (!raw) return [];

  try {
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return [];
  }
}

export function saveMessagesForSession(sessionId: string, messages: ChatMessage[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(getSessionMessagesKey(sessionId), JSON.stringify(messages));
}

export function getBrowserUserId() {
  if (!canUseStorage()) return "anonymous";
  const existing = window.localStorage.getItem(USER_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  window.localStorage.setItem(USER_KEY, next);
  return next;
}
