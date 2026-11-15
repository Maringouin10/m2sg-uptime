import { getStatus } from "@/lib/stats";
import { json, preflight } from "@/lib/http";
import { databaseUrl } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!databaseUrl()) return json({ error: "Base de données non configurée (DATABASE_URL)" }, 503);
  const { id } = await params;
  const status = await getStatus(id);
  if (!status) return json({ error: "Service inconnu", id }, 404);
  return json({ generated_at: new Date().toISOString(), ...status });
}

export const OPTIONS = preflight;
