import { countIncidents, getIncidents } from "@/lib/stats";
import { getMonitor } from "@/lib/monitors";
import { json, preflight } from "@/lib/http";
import { databaseUrl } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!databaseUrl()) return json({ error: "Base de données non configurée (DATABASE_URL)" }, 503);
  const url = new URL(req.url);
  const monitor = url.searchParams.get("monitor") ?? undefined;
  if (monitor && !getMonitor(monitor)) return json({ error: "Service inconnu", id: monitor }, 404);
  const limit = Number(url.searchParams.get("limit") ?? 20) || 20;
  const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
  const [incidents, total] = await Promise.all([
    getIncidents({ monitor, limit, offset }),
    countIncidents(monitor),
  ]);
  return json({ generated_at: new Date().toISOString(), total, offset, incidents });
}

export const OPTIONS = preflight;
