import { getIncidents } from "@/lib/stats";
import { getMonitor } from "@/lib/monitors";
import { json, preflight } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const monitor = url.searchParams.get("monitor") ?? undefined;
  if (monitor && !getMonitor(monitor)) return json({ error: "Service inconnu", id: monitor }, 404);
  const limit = Number(url.searchParams.get("limit") ?? 20) || 20;
  const incidents = await getIncidents({ monitor, limit });
  return json({ generated_at: new Date().toISOString(), incidents });
}

export const OPTIONS = preflight;
