import type { Env } from "./lib/env";
import { DurableObject } from "cloudflare:workers";

type SqlCursor<T = Record<string, unknown>> = {
  one(): T | null;
  toArray(): T[];
};

type SqlStorage = {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): SqlCursor<T>;
};

interface AuthUserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  salt: string;
  created_at: string;
}

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
}

export interface AuthTokenPayload extends AuthUser {
  iat: number;
}

function exec(sql: SqlStorage, statement: string, params: unknown[] = []): SqlCursor {
  return sql.exec(statement, ...params);
}

function all<T = Record<string, unknown>>(sql: SqlStorage, statement: string, params: unknown[] = []): T[] {
  const res = exec(sql, statement, params) as any;
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.results)) return res.results;
  if (res && typeof res.toArray === "function") return res.toArray();
  return [];
}

function get<T = Record<string, unknown>>(sql: SqlStorage, statement: string, params: unknown[] = []): T | null {
  return (all<T>(sql, statement, params)[0] ?? null) as T | null;
}

export class AuthGatewaySqlV2 extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const sql = (ctx.storage as any).sql as SqlStorage | undefined;
    if (!sql || typeof sql.exec !== "function") {
      throw new Error("FATAL_SQL_EXEC_MISSING");
    }
    this.sql = sql;

    ctx.blockConcurrencyWhile(async () => {
      exec(
        this.sql,
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/register" && request.method === "POST") {
      try {
        const body = (await request.json()) as { name: string; email: string; password: string };
        const result = await this.register(body.name, body.email, body.password);
        return json(result, 201);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "register_failed" }, 400);
      }
    }

    if (url.pathname === "/login" && request.method === "POST") {
      try {
        const body = (await request.json()) as { email: string; password: string };
        const result = await this.login(body.email, body.password);
        return json(result);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "login_failed" }, 401);
      }
    }

    return json({ ok: false, error: "not_found" }, 404);
  }

  private async register(name: string, email: string, password: string) {
    const normalizedEmail = normalizeEmail(email);
    const trimmedName = name.trim() || normalizedEmail.split("@")[0] || "Researcher";
    validatePassword(password);

    const existing = get<AuthUserRow>(this.sql, "SELECT * FROM users WHERE email = ?", [normalizedEmail]);
    if (existing) {
      throw new Error("email_already_registered");
    }

    const userId = crypto.randomUUID();
    const salt = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const passwordHash = await hashPassword(password, salt);
    exec(
      this.sql,
      "INSERT INTO users (id, email, name, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, normalizedEmail, trimmedName, passwordHash, salt, new Date().toISOString()]
    );

    const user = { userId, email: normalizedEmail, name: trimmedName };
    const token = await signAuthToken(this.env, { ...user, iat: Date.now() });
    return { ok: true, user, token };
  }

  private async login(email: string, password: string) {
    const normalizedEmail = normalizeEmail(email);
    const user = get<AuthUserRow>(this.sql, "SELECT * FROM users WHERE email = ?", [normalizedEmail]);
    if (!user) {
      throw new Error("invalid_credentials");
    }

    const passwordHash = await hashPassword(password, user.salt);
    if (passwordHash !== user.password_hash) {
      throw new Error("invalid_credentials");
    }

    const safeUser = { userId: user.id, email: user.email, name: user.name };
    const token = await signAuthToken(this.env, { ...safeUser, iat: Date.now() });
    return { ok: true, user: safeUser, token };
  }
}

export async function authenticateRequest(request: Request, env: Env): Promise<AuthTokenPayload | null> {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  return verifyAuthToken(env, token);
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  return base64UrlEncode(new Uint8Array(derived));
}

async function signAuthToken(env: Env, payload: AuthTokenPayload): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signString(getAuthSecret(env), encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function verifyAuthToken(env: Env, token: string): Promise<AuthTokenPayload | null> {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expected = await signString(getAuthSecret(env), encodedPayload);
  if (signature !== expected) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as AuthTokenPayload;
    if (!payload?.userId || !payload?.email) return null;
    return payload;
  } catch {
    return null;
  }
}

async function signString(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(sig));
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("invalid_email");
  }
  return normalized;
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new Error("password_too_short");
  }
}

function getAuthSecret(env: Env): string {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("missing_auth_secret");
  }
  return secret;
}

function base64UrlEncode(input: Uint8Array): string {
  let binary = "";
  for (const byte of input) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
