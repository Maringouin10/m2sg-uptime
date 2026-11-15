import postgres from "postgres";
import { SCHEMA_SQL } from "./schema.mjs";

type Sql = ReturnType<typeof postgres>;

const g = globalThis as unknown as { __sql?: Sql; __schema?: Promise<void> };

export function db(): Sql {
  if (!g.__sql) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL n'est pas défini");
    g.__sql = postgres(url, {
      // Neon "pooled" passe par PgBouncer en mode transaction : pas de requêtes préparées.
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return g.__sql;
}

/** Crée les tables si besoin (une seule fois par instance). */
export function ensureSchema(): Promise<void> {
  if (!g.__schema) {
    g.__schema = db()
      .unsafe(SCHEMA_SQL)
      .then(() => undefined)
      .catch((err) => {
        g.__schema = undefined;
        throw err;
      });
  }
  return g.__schema;
}
