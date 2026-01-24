export function initSchema(sql: DbSql): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      user_id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS doc_chunks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      query TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export interface DbSql {
  exec(query: string): void;
  prepare(query: string): DbStatement;
}

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  run(): void;
  all<T = Record<string, unknown>>(): { results: T[] };
}

export type DurableObjectSqlStorage = SqlStorage;

export function wrapSql(raw: DurableObjectSqlStorage): DbSql {
  return {
    exec(query: string): void {
      raw.exec(query);
    },
    prepare(query: string): DbStatement {
      let params: unknown[] = [];
      const statement: DbStatement = {
        bind(...values: unknown[]): DbStatement {
          params = values;
          return statement;
        },
        run(): void {
          raw.exec(query, ...params);
        },
        all<T = Record<string, unknown>>(): { results: T[] } {
          const result = raw.exec(query, ...params) as { results?: T[] } | undefined | null;
          return { results: Array.isArray(result?.results) ? result.results : [] };
        }
      };
      return statement;
    }
  };
}
