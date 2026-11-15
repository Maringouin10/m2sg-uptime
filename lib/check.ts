import { db } from "./db";
import {
  CHECK_TIMEOUT_MS,
  MAX_GAP_S,
  NORMAL_INTERVAL_S,
  RAW_RETENTION_DAYS,
  TIMEZONE,
  type Monitor,
} from "./monitors";
import { sendWebhook, type WebhookEvent } from "./webhook";

export type ProbeResult = {
  ok: boolean;
  status_code: number | null;
  response_ms: number;
  error: string | null;
};

/** Panne = erreur réseau, délai > 10 s, ou code HTTP hors 200-399 (redirections suivies). */
export async function probe(url: string): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: { "user-agent": "m2sg-uptime/1.0 (+status monitor)" },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    // On lit le corps pour mesurer la réponse complète et libérer la connexion.
    await res.arrayBuffer().catch(() => undefined);
    const ok = res.status >= 200 && res.status < 400;
    return {
      ok,
      status_code: res.status,
      response_ms: Date.now() - start,
      error: ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    let error: string;
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      error = `Délai dépassé (${CHECK_TIMEOUT_MS / 1000} s)`;
    } else {
      error = e.cause?.code || e.cause?.message || e.message || "Erreur réseau";
    }
    return { ok: false, status_code: null, response_ms: Date.now() - start, error };
  }
}

export type CheckOutcome = {
  monitor: string;
  ok: boolean;
  recorded: boolean;
  status_code: number | null;
  response_ms: number;
  error: string | null;
  event?: WebhookEvent["event"];
};

/**
 * Vérifie un service et enregistre le résultat.
 * `minGapS` évite les doublons si deux appels se chevauchent : si une vérif
 * a été enregistrée il y a moins de `minGapS` secondes, on n'enregistre pas.
 */
export async function runCheck(monitor: Monitor, minGapS = 20): Promise<CheckOutcome> {
  const r = await probe(monitor.url);
  const sql = db();

  const result = await sql.begin(async (tx) => {
    // Sérialise les écritures pour ce service.
    await tx`select pg_advisory_xact_lock(hashtext(${"m2sg:" + monitor.id}))`;

    const [last] = await tx<{ gap_s: number }[]>`
      select extract(epoch from (now() - checked_at))::float8 as gap_s
      from checks where monitor_id = ${monitor.id}
      order by checked_at desc limit 1`;

    if (last && last.gap_s < minGapS) return { recorded: false as const };

    // Durée couverte par cette vérif = temps écoulé depuis la précédente.
    const duration =
      last && last.gap_s <= MAX_GAP_S ? Math.max(1, Math.round(last.gap_s)) : NORMAL_INTERVAL_S;

    await tx`
      insert into checks (monitor_id, ok, status_code, response_ms, error, duration_s)
      values (${monitor.id}, ${r.ok}, ${r.status_code}, ${r.response_ms}, ${r.error}, ${duration})`;

    await tx`
      insert into daily_stats (monitor_id, day, up_s, total_s, checks, failures)
      values (
        ${monitor.id},
        (now() at time zone ${TIMEZONE})::date,
        ${r.ok ? duration : 0}, ${duration}, 1, ${r.ok ? 0 : 1}
      )
      on conflict (monitor_id, day) do update set
        up_s     = daily_stats.up_s + excluded.up_s,
        total_s  = daily_stats.total_s + excluded.total_s,
        checks   = daily_stats.checks + 1,
        failures = daily_stats.failures + excluded.failures`;

    const [open] = await tx<{ id: string; started_at: Date; error: string | null }[]>`
      select id, started_at, error from incidents
      where monitor_id = ${monitor.id} and ended_at is null limit 1`;

    if (!r.ok && !open) {
      const [inc] = await tx<{ id: string; started_at: Date }[]>`
        insert into incidents (monitor_id, started_at, error)
        values (${monitor.id}, now(), ${r.error}) returning id, started_at`;
      return {
        recorded: true as const,
        event: "monitor.down" as const,
        incident: { id: Number(inc.id), started_at: inc.started_at, ended_at: null, error: r.error },
      };
    }
    if (r.ok && open) {
      const [inc] = await tx<{ ended_at: Date }[]>`
        update incidents set ended_at = now() where id = ${open.id} returning ended_at`;
      return {
        recorded: true as const,
        event: "monitor.up" as const,
        incident: {
          id: Number(open.id),
          started_at: open.started_at,
          ended_at: inc.ended_at,
          error: open.error,
        },
      };
    }
    return { recorded: true as const };
  });

  const outcome: CheckOutcome = {
    monitor: monitor.id,
    ok: r.ok,
    recorded: result.recorded,
    status_code: r.status_code,
    response_ms: r.response_ms,
    error: r.error,
  };

  if ("event" in result && result.event) {
    outcome.event = result.event;
    const inc = result.incident;
    await sendWebhook({
      event: result.event,
      timestamp: new Date().toISOString(),
      monitor: { id: monitor.id, name: monitor.name, url: monitor.url },
      incident: {
        id: inc.id,
        started_at: inc.started_at.toISOString(),
        ended_at: inc.ended_at ? inc.ended_at.toISOString() : null,
        duration_s: inc.ended_at
          ? Math.round((inc.ended_at.getTime() - inc.started_at.getTime()) / 1000)
          : null,
        error: inc.error,
      },
      check: { status_code: r.status_code, response_ms: r.response_ms, error: r.error },
    });
  }

  return outcome;
}

export async function purgeOldChecks(): Promise<number> {
  const res = await db()`
    delete from checks where checked_at < now() - make_interval(days => ${RAW_RETENTION_DAYS})`;
  return res.count;
}
