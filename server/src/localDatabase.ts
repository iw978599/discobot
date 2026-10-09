import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Database, Statement } from './index.ts';

// An in-memory SQLite with the D1 interface, for tests and local development. It is never
// deployed: the Worker gets the real D1 binding.
export function createLocalDatabase(): Database {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));

  const statement = (sql: string, values: unknown[] = []): Statement => {
    const run = () => sqlite.prepare(sql).run(...(values as never[]));
    return {
      bind: (...next) => statement(sql, next),
      first: async <T>() => (sqlite.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
      all: async <T>() => ({ results: sqlite.prepare(sql).all(...(values as never[])) as T[] }),
      run: async () => ({ meta: { changes: Number(run().changes) } }),
    };
  };
  return {
    prepare: sql => statement(sql),
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
