import { db, ensureSchema } from "./db";
import { MONITORS, TIMEZONE, getMonitor, type Monitor } from "./monitors";

export type Uptime = {
  /** Pourcentage (0-100, arrondi vers le bas à 4 décimales) ou null si aucune donnée. */
  percent: number | null;
  up_s: number;
  total_s: number;
  down_s: number;
};

export type UptimeWindows = { "24h": Uptime; "30d": Uptime; "365d": Uptime; all: Uptime };

export type LastCheck = {
  checked_at: string;
  ok: boolean;
  status_code: number | null;
  response_ms: number | null;
  error: string | null;
};

export type Incident = {
  id: number;
  monitor_id: string;
  started_at: string;
  ended_at: string | null;
  duration_s: number;
  ongoing: boolean;
  error: string | null;
};

export type MonitorStatus = {
  id: string;
  name: string;
  url: string;
  status: "up" | "down" | "unknown";
  last_check: LastCheck | null;
  uptime: UptimeWindows;
  /** Premier jour de données (AAAA-MM-JJ, heure de Toronto). */
  since: string | null;
  current_incident: Incident | null;
};

export type DayBar = { day: string; percent: number | null; down_s: number; checks: number };

function uptime(up: number | string | null, total: number | string | null): Uptime {
  const u = Number(up ?? 0);
  const t = Number(total ?? 0);
  return {
    percent: t > 0 ? Math.floor((u / t) * 100 * 10_000) / 10_000 : null,
    up_s: u,
    total_s: t,
    down_s: t - u,
  };
}

/** Date du jour (AAAA-MM-JJ) dans le fuseau configuré. */
export function todayLocal(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type IncidentRow = {
  id: string;
  monitor_id: string;
  started_at: Date;
  ended_at: Date | null;
  error: string | null;
};

function toIncident(r: IncidentRow): Incident {
  const end = r.ended_at ?? new Date();
  return {
    id: Number(r.id),
    monitor_id: r.monitor_id,
    started_at: r.started_at.toISOString(),
    ended_at: r.ended_at ? r.ended_at.toISOString() : null,
    duration_s: Math.max(0, Math.round((end.getTime() - r.started_at.getTime()) / 1000)),
    ongoing: r.ended_at === null,
    error: r.error,
  };
}

export async function getStatuses(monitors: Monitor[] = MONITORS): Promise<MonitorStatus[]> {
  await ensureSchema();
  const sql = db();
  const ids = monitors.map((m) => m.id);
  const today = todayLocal();

  const [lasts, raw, daily, open] = await Promise.all([
    sql<(LastCheck & { monitor_id: string; checked_at: Date })[]>`
      select distinct on (monitor_id) monitor_id, checked_at, ok, status_code, response_ms, error
      from checks where monitor_id = any(${ids})
      order by monitor_id, checked_at desc`,
    sql<{ monitor_id: string; up24: string; t24: string; up30: string; t30: string }[]>`
      select monitor_id,
        sum(duration_s) filter (where ok and checked_at > now() - interval '24 hours') as up24,
        sum(duration_s) filter (where checked_at > now() - interval '24 hours')        as t24,
        sum(duration_s) filter (where ok) as up30,
        sum(duration_s)                   as t30
      from checks
      where monitor_id = any(${ids}) and checked_at > now() - interval '30 days'
      group by monitor_id`,
    sql<{ monitor_id: string; up365: string; t365: string; upall: string; tall: string; since: string }[]>`
      select monitor_id,
        sum(up_s)    filter (where day > ${addDays(today, -365)}::date) as up365,
        sum(total_s) filter (where day > ${addDays(today, -365)}::date) as t365,
        sum(up_s) as upall, sum(total_s) as tall, min(day)::text as since
      from daily_stats where monitor_id = any(${ids})
      group by monitor_id`,
    sql<IncidentRow[]>`
      select id, monitor_id, started_at, ended_at, error from incidents
      where monitor_id = any(${ids}) and ended_at is null`,
  ]);

  return monitors.map((m) => {
    const last = lasts.find((r) => r.monitor_id === m.id);
    const rw = raw.find((r) => r.monitor_id === m.id);
    const dl = daily.find((r) => r.monitor_id === m.id);
    const inc = open.find((r) => r.monitor_id === m.id);
    return {
      id: m.id,
      name: m.name,
      url: m.url,
      status: !last ? "unknown" : last.ok ? "up" : "down",
      last_check: last
        ? {
            checked_at: last.checked_at.toISOString(),
            ok: last.ok,
            status_code: last.status_code,
            response_ms: last.response_ms,
            error: last.error,
          }
        : null,
      uptime: {
        "24h": uptime(rw?.up24 ?? null, rw?.t24 ?? null),
        "30d": uptime(rw?.up30 ?? null, rw?.t30 ?? null),
        "365d": uptime(dl?.up365 ?? null, dl?.t365 ?? null),
        all: uptime(dl?.upall ?? null, dl?.tall ?? null),
      },
      since: dl?.since ?? null,
      current_incident: inc ? toIncident(inc) : null,
    } satisfies MonitorStatus;
  });
}

export async function getStatus(id: string): Promise<MonitorStatus | null> {
  const m = getMonitor(id);
  if (!m) return null;
  const [s] = await getStatuses([m]);
  return s;
}

/** Une entrée par jour sur les `days` derniers jours (le plus ancien d'abord). */
export async function getDailyBars(days = 90): Promise<Record<string, DayBar[]>> {
  await ensureSchema();
  const today = todayLocal();
  const from = addDays(today, -(days - 1));
  const rows = await db()<{ monitor_id: string; day: string; up_s: string; total_s: string; checks: number }[]>`
    select monitor_id, day::text as day, up_s, total_s, checks
    from daily_stats where day >= ${from}::date`;

  const out: Record<string, DayBar[]> = {};
  for (const m of MONITORS) {
    out[m.id] = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      const r = rows.find((x) => x.monitor_id === m.id && x.day === day);
      const u = uptime(r?.up_s ?? null, r?.total_s ?? null);
      out[m.id].push({ day, percent: u.percent, down_s: u.down_s, checks: r?.checks ?? 0 });
    }
  }
  return out;
}

export async function getIncidents(opts: { monitor?: string; limit?: number } = {}): Promise<Incident[]> {
  await ensureSchema();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const sql = db();
  const rows = opts.monitor
    ? await sql<IncidentRow[]>`
        select id, monitor_id, started_at, ended_at, error from incidents
        where monitor_id = ${opts.monitor} order by started_at desc limit ${limit}`
    : await sql<IncidentRow[]>`
        select id, monitor_id, started_at, ended_at, error from incidents
        order by started_at desc limit ${limit}`;
  return rows.map(toIncident);
}

export function overall(statuses: MonitorStatus[]): "up" | "down" | "degraded" | "unknown" {
  const down = statuses.filter((s) => s.status === "down").length;
  if (down > 0) return down === statuses.length ? "down" : "degraded";
  if (statuses.some((s) => s.status === "unknown")) return "unknown";
  return "up";
}
