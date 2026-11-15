import { getStatuses, overall } from "@/lib/stats";
import { json, preflight } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const monitors = await getStatuses();
  return json({ status: overall(monitors), generated_at: new Date().toISOString(), monitors });
}

export const OPTIONS = preflight;
