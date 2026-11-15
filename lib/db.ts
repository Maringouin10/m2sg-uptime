import postgres from "postgres";
import { SCHEMA_SQL } from "./schema.mjs";

type Sql = ReturnType<typeof postgres>;

const g = globalThis as unknown as { __sql?: Sql; __schema?: Promise<void> };

/**
 * L'intégration Neon de Vercel crée DATABASE_URL, ou <PREFIXE>_DATABASE_URL /
 * <PREFIXE>_POSTGRES_URL si un préfixe a été choisi à la connexion.
 */
export function databaseUrl(): string | undefined {
  const env = process.env;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_URL) return env.POSTGRES_URL;
  const key = Object.keys(env)
    .sort()
    .find((k) => /_(DATABASE_URL|POSTGRES_URL)$/.test(k) && env[k]);
  return key ? env[key] : undefined;
}

export class MissingDatabaseError extends Error {
  constructor() {
    super("DATABASE_URL n'est pas défini");
    this.name = "MissingDatabaseError";
  }
}

export function db(): Sql {
  if (!g.__sql) {
    const url = databaseUrl();
    if (!url) throw new MissingDatabaseError();
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
