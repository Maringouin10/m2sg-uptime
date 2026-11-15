import { getStatuses, overall } from "@/lib/stats";
import { json, preflight } from "@/lib/http";
import { databaseUrl } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!databaseUrl()) return json({ error: "Base de données non configurée (DATABASE_URL)" }, 503);
  const monitors = await getStatuses();
  return json({ status: overall(monitors), generated_at: new Date().toISOString(), monitors });
}

export const OPTIONS = preflight;
