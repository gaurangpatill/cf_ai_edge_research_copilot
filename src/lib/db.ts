export function initSchema(sql: SqlStorage): void {
  const statements = [
    `CREATE TABLE IF NOT EXISTS conversations (
      user_id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS doc_chunks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      query TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const statement of statements) {
    execSql(sql, statement);
  }
}

declare global {
  interface SqlStorage {
    exec(query: string, ...params: unknown[]): unknown;
    query?(query: string, params?: unknown[]): unknown;
    prepare(query: string): SqlStatement;
  }

  interface SqlStatement {
    bind(...values: unknown[]): SqlStatement;
    run(): unknown;
    all<T = Record<string, unknown>>(): { results: T[] };
  }
}

export {};

export function execSql(sql: SqlStorage, statement: string, params: unknown[] = []): unknown {
  if (typeof sql.exec !== "function") {
    throw new Error("no_sql_exec");
  }
  return sql.exec(statement, ...params);
}

export function allSql<T = Record<string, unknown>>(
  sql: SqlStorage,
  statement: string,
  params: unknown[] = []
): { results: T[] } {
  const result = execSql(sql, statement, params) as { results?: T[] } | T[] | undefined | null;
  if (Array.isArray(result)) return { results: result as T[] };
  return { results: Array.isArray(result?.results) ? result.results : [] };
}

export function ensureSql(sql: SqlStorage): SqlStorage {
  return sql;
}
