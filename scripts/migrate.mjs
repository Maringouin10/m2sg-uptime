import postgres from "postgres";
import { SCHEMA_SQL } from "../lib/schema.mjs";

const url =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  Object.entries(process.env).find(([k, v]) => /_(DATABASE_URL|POSTGRES_URL)$/.test(k) && v)?.[1];
if (!url) {
  console.error("DATABASE_URL n'est pas défini");
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 1 });
await sql.unsafe(SCHEMA_SQL);
await sql.end();
console.log("Schéma OK");
