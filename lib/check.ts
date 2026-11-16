import { db } from "./db";
import {
  CHECK_TIMEOUT_MS,
  MAX_GAP_S,
  NORMAL_INTERVAL_S,
  RAW_RETENTION_DAYS,
  TIMEZONE,
  type Monitor,
  type State,
} from "./monitors";
import { sendWebhook, type WebhookEvent, type WebhookEventName } from "./webhook";

export type ComponentResult = { id: string; name: string; description: string | null; state: State };

export type ProbeResult = {
  state: State;
  status_code: number | null;
  response_ms: number;
  error: string | null;
  components?: ComponentResult[];
};

/** Normalise une valeur de statut libre en up / degraded / down. */
export function normalizeState(v: unknown): State {
  const s = String(v ?? "").trim().toLowerCase();
  if (["up", "ok", "operational", "healthy", "online"].includes(s)) return "up";
  if (["degraded", "partial", "warning", "warn", "maintenance"].includes(s)) return "degraded";
  return "down";
}

const RANK: Record<State, number> = { up: 0, degraded: 1, down: 2 };

const STATE_FR: Record<State, string> = { up: "Opérationnel", degraded: "Dégradé", down: "En panne" };

function parseStatusJson(body: string): { state: State; components: ComponentResult[] } | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || !("status" in data)) return null;
  const d = data as { status: unknown; services?: unknown };
  const components: ComponentResult[] = Array.isArray(d.services)
    ? d.services
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && "id" in x)
        .map((x) => ({
          id: String(x.id).slice(0, 64),
          name: String(x.name ?? x.id).slice(0, 120),
          description: x.description ? String(x.description).slice(0, 200) : null,
          state: normalizeState(x.status),
        }))
    : [];
  return { state: normalizeState(d.status), components };
}

/**
 * "http" : panne = erreur réseau, délai > 20 s, ou code HTTP hors 200-399.
 * "status-json" : l'état vient du champ `status` du JSON (même si le code HTTP est une erreur) ;
 * si la réponse n'est pas un JSON de statut lisible, on applique la règle "http"
 * et une réponse illisible avec un code OK compte comme panne.
 */
export async function probe(monitor: Monitor): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const res = await fetch(monitor.url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: {
        "user-agent": "m2sg-uptime/1.0 (+status monitor)",
        accept: monitor.type === "status-json" ? "application/json" : "*/*",
      },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    const body = await res.text().catch(() => "");
    const response_ms = Date.now() - start;
    const httpOk = res.status >= 200 && res.status < 400;

    if (monitor.type === "status-json") {
      const raw = parseStatusJson(body);
      const ignored = new Set(monitor.ignoreComponents ?? []);
      const parsed = raw && {
        ...raw,
        components: raw.components.filter((c) => !ignored.has(c.id)),
      };
      if (parsed && raw) {
        // Avec des sous-services, l'état global = le pire d'entre eux (hors ignorés),
        // car le `status` global du serveur tient compte des sous-services ignorés.
        // Sans sous-services, on garde le `status` global.
        if (raw.components.length > 0) {
          parsed.state = parsed.components.reduce<State>(
            (worst, c) => (RANK[c.state] > RANK[worst] ? c.state : worst),
            "up",
          );
        }
        const bad = parsed.components.filter((c) => c.state !== "up");
        const error =
          parsed.state === "up" && bad.length === 0
            ? null
            : bad.length
              ? bad.map((c) => `${c.name} : ${STATE_FR[c.state]}`).join(", ")
              : `Statut : ${STATE_FR[parsed.state]}`;
        return {
          state: parsed.state,
          status_code: res.status,
          response_ms,
          error,
          components: parsed.components,
        };
      }
      return {
        state: "down",
        status_code: res.status,
        response_ms,
        error: httpOk ? "Réponse de statut illisible" : `HTTP ${res.status}`,
      };
    }

    return {
      state: httpOk ? "up" : "down",
      status_code: res.status,
      response_ms,
      error: httpOk ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    let error: string;
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      error = `Délai dépassé (${CHECK_TIMEOUT_MS / 1000} s)`;
    } else {
      error = e.cause?.code || e.cause?.message || e.message || "Erreur réseau";
    }
    return { state: "down", status_code: null, response_ms: Date.now() - start, error };
  }
}

export type CheckOutcome = {
  monitor: string;
  state: State;
  ok: boolean;
  recorded: boolean;
  status_code: number | null;
  response_ms: number;
  error: string | null;
  event?: WebhookEventName;
};

type IncidentInfo = { id: number; started_at: Date; ended_at: Date | null; error: string | null };

/**
 * Vérifie un service et enregistre le résultat.
 * `minGapS` évite les doublons si deux appels se chevauchent : si une vérif
 * a été enregistrée il y a moins de `minGapS` secondes, on n'enregistre pas.
 * Dans l'uptime, « dégradé » compte comme disponible ; seul « down » est une panne.
 */
export async function runCheck(monitor: Monitor, minGapS = 20): Promise<CheckOutcome> {
  const r = await probe(monitor);
  const ok = r.state !== "down";
  const sql = db();

  const result = await sql.begin(async (tx) => {
    // Sérialise les écritures pour ce service.
    await tx`select pg_advisory_xact_lock(hashtext(${"m2sg:" + monitor.id}))`;

    const [last] = await tx<{ gap_s: number; state: State }[]>`
      select extract(epoch from (now() - checked_at))::float8 as gap_s,
             coalesce(state, case when ok then 'up' else 'down' end) as state
      from checks where monitor_id = ${monitor.id}
      order by checked_at desc limit 1`;

    if (last && last.gap_s < minGapS) return { recorded: false as const };

    // Durée couverte par cette vérif = temps écoulé depuis la précédente.
    const duration =
      last && last.gap_s <= MAX_GAP_S ? Math.max(1, Math.round(last.gap_s)) : NORMAL_INTERVAL_S;

    await tx`
      insert into checks (monitor_id, ok, state, status_code, response_ms, error, duration_s)
      values (${monitor.id}, ${ok}, ${r.state}, ${r.status_code}, ${r.response_ms}, ${r.error}, ${duration})`;

    await tx`
      insert into daily_stats (monitor_id, day, up_s, total_s, checks, failures)
      values (
        ${monitor.id},
        (now() at time zone ${TIMEZONE})::date,
        ${ok ? duration : 0}, ${duration}, 1, ${ok ? 0 : 1}
      )
      on conflict (monitor_id, day) do update set
        up_s     = daily_stats.up_s + excluded.up_s,
        total_s  = daily_stats.total_s + excluded.total_s,
        checks   = daily_stats.checks + 1,
        failures = daily_stats.failures + excluded.failures`;

    // Sous-services : seulement quand l'endpoint a répondu (sinon leur état est inconnu).
    if (r.components) {
      for (const [i, c] of r.components.entries()) {
        await tx`
          insert into components (monitor_id, component_id, name, description, state, position, updated_at)
          values (${monitor.id}, ${c.id}, ${c.name}, ${c.description}, ${c.state}, ${i}, now())
          on conflict (monitor_id, component_id) do update set
            name = excluded.name, description = excluded.description, state = excluded.state,
            position = excluded.position, updated_at = now()`;
        await tx`
          insert into component_daily (monitor_id, component_id, day, up_s, total_s)
          values (
            ${monitor.id}, ${c.id}, (now() at time zone ${TIMEZONE})::date,
            ${c.state === "down" ? 0 : duration}, ${duration}
          )
          on conflict (monitor_id, component_id, day) do update set
            up_s    = component_daily.up_s + excluded.up_s,
            total_s = component_daily.total_s + excluded.total_s`;
      }
    }

    const prev: State | null = last?.state ?? null;
    const [open] = await tx<{ id: string; started_at: Date; error: string | null }[]>`
      select id, started_at, error from incidents
      where monitor_id = ${monitor.id} and ended_at is null limit 1`;

    let event: WebhookEventName | undefined;
    let incident: IncidentInfo | null = null;

    if (r.state === "down") {
      if (!open) {
        const [inc] = await tx<{ id: string; started_at: Date }[]>`
          insert into incidents (monitor_id, started_at, error)
          values (${monitor.id}, now(), ${r.error}) returning id, started_at`;
        event = "monitor.down";
        incident = { id: Number(inc.id), started_at: inc.started_at, ended_at: null, error: r.error };
      }
    } else {
      if (open) {
        const [inc] = await tx<{ ended_at: Date }[]>`
          update incidents set ended_at = now() where id = ${open.id} returning ended_at`;
        incident = {
          id: Number(open.id),
          started_at: open.started_at,
          ended_at: inc.ended_at,
          error: open.error,
        };
        event = r.state === "up" ? "monitor.up" : "monitor.degraded";
      } else if (r.state === "degraded" && prev !== "degraded") {
        event = "monitor.degraded";
      } else if (r.state === "up" && prev === "degraded") {
        event = "monitor.up";
      }
    }

    return { recorded: true as const, event, incident, prev };
  });

  const outcome: CheckOutcome = {
    monitor: monitor.id,
    state: r.state,
    ok,
    recorded: result.recorded,
    status_code: r.status_code,
    response_ms: r.response_ms,
    error: r.error,
  };

  if (result.recorded && result.event) {
    outcome.event = result.event;
    const inc = result.incident;
    await sendWebhook({
      event: result.event,
      timestamp: new Date().toISOString(),
      monitor: { id: monitor.id, name: monitor.name, url: monitor.displayUrl ?? monitor.url },
      state: r.state,
      previous_state: result.prev,
      incident: inc
        ? {
            id: inc.id,
            started_at: inc.started_at.toISOString(),
            ended_at: inc.ended_at ? inc.ended_at.toISOString() : null,
            duration_s: inc.ended_at
              ? Math.round((inc.ended_at.getTime() - inc.started_at.getTime()) / 1000)
              : null,
            error: inc.error,
          }
        : null,
      check: { status_code: r.status_code, response_ms: r.response_ms, error: r.error },
      ...(r.components
        ? { components: r.components.map((c) => ({ id: c.id, name: c.name, state: c.state })) }
        : {}),
    });
  }

  return outcome;
}

export async function purgeOldChecks(): Promise<number> {
  const res = await db()`
    delete from checks where checked_at < now() - make_interval(days => ${RAW_RETENTION_DAYS})`;
  return res.count;
}
