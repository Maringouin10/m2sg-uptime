import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { databaseUrl, ensureSchema } from "@/lib/db";
import { purgeOldChecks, runCheck } from "@/lib/check";
import { DOWN_RECHECK_DELAY_MS, MONITORS } from "@/lib/monitors";

export const dynamic = "force-dynamic";
// La re-vérification à +30 s en cas de panne tourne après la réponse (after()).
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const given =
    (header.startsWith("Bearer ") ? header.slice(7) : "") ||
    new URL(req.url).searchParams.get("key") ||
    "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handler(req: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET n'est pas configuré" }, { status: 500 });
  }
  if (!authorized(req)) return Response.json({ error: "Non autorisé" }, { status: 401 });

  if (!databaseUrl()) {
    return Response.json({ error: "Base de données non configurée (DATABASE_URL)" }, { status: 503 });
  }
  await ensureSchema();
  const results = await Promise.all(MONITORS.map((m) => runCheck(m)));

  const down = MONITORS.filter((m) => results.find((r) => r.monitor === m.id && !r.ok));
  const purge = new Date().getUTCMinutes() === 0;

  if (down.length > 0 || purge) {
    after(async () => {
      if (down.length > 0) {
        await sleep(DOWN_RECHECK_DELAY_MS);
        await Promise.all(down.map((m) => runCheck(m).catch((e) => console.error("[recheck]", m.id, e))));
      }
      if (purge) await purgeOldChecks().catch((e) => console.error("[purge]", e));
    });
  }

  return Response.json(
    { ok: true, results, recheck_in_s: down.length ? DOWN_RECHECK_DELAY_MS / 1000 : null },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = handler;
export const POST = handler;
