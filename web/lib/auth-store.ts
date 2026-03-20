export interface AuthUser {
  name: string;
  email: string;
  userId: string;
}

export interface AuthSession {
  user: AuthUser;
  token: string;
}

const AUTH_KEY = "edge-research-copilot:auth-session";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getAuthSession(): AuthSession | null {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(AUTH_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function getAuthUser(): AuthUser | null {
  return getAuthSession()?.user ?? null;
}

export function requireAuthSession(): AuthSession {
  const session = getAuthSession();
  if (!session) {
    throw new Error("auth_required");
  }
  return session;
}

export function setAuthSession(session: AuthSession): AuthSession {
  if (canUseStorage()) {
    window.localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  }
  return session;
}

export function clearAuthUser() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(AUTH_KEY);
}
