import { databaseUrl } from "@/lib/db";
import { capitalize, duration, monthFmt, shortDateTimeFmt, timeFmt } from "@/lib/format";
import { MONITORS, getMonitor } from "@/lib/monitors";
import { countIncidents, getIncidents, type Incident } from "@/lib/stats";

export const dynamic = "force-dynamic";
export const metadata = { title: "M2SG — Historique des incidents" };

const PAGE_SIZE = 50;

function sameLocalDay(a: string, b: string): boolean {
  const f = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date(iso));
  return f(a) === f(b);
}

function period(i: Incident): string {
  const start = shortDateTimeFmt.format(new Date(i.started_at));
  if (!i.ended_at) return `${start} → en cours`;
  const end = sameLocalDay(i.started_at, i.ended_at)
    ? timeFmt.format(new Date(i.ended_at))
    : shortDateTimeFmt.format(new Date(i.ended_at));
  return `${start} → ${end}`;
}

export default async function Historique({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; service?: string }>;
}) {
  const sp = await searchParams;
  const service = sp.service && getMonitor(sp.service) ? sp.service : undefined;
  const page = Math.max(1, Math.trunc(Number(sp.page) || 1));

  if (!databaseUrl()) {
    return (
      <main>
        <p>Base de données non configurée.</p>
      </main>
    );
  }

  const [incidents, total] = await Promise.all([
    getIncidents({ monitor: service, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countIncidents(service),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Regroupement par mois (fuseau de Toronto).
  const groups: { month: string; items: Incident[] }[] = [];
  for (const i of incidents) {
    const month = capitalize(monthFmt.format(new Date(i.started_at)));
    const g = groups.at(-1);
    if (g && g.month === month) g.items.push(i);
    else groups.push({ month, items: [i] });
  }

  const href = (p: number, s = service) => {
    const q = new URLSearchParams();
    if (s) q.set("service", s);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return `/historique${qs ? `?${qs}` : ""}`;
  };

  return (
    <main>
      <a href="/" className="back">
        ← Retour au statut
      </a>
      <header>
        <h1>Historique des incidents</h1>
        <p className="sub">
          {total === 0
            ? "Aucun incident enregistré"
            : `${total} incident${total > 1 ? "s" : ""} au total`}
        </p>
      </header>

      <nav className="filters">
        <a href={href(1, undefined)} className={!service ? "active" : ""}>
          Tous
        </a>
        {MONITORS.map((m) => (
          <a key={m.id} href={href(1, m.id)} className={service === m.id ? "active" : ""}>
            {m.name}
          </a>
        ))}
      </nav>

      {incidents.length === 0 && total > 0 && (
        <p className="sub">
          Aucun incident sur cette page. <a href={href(1)}>Revenir à la première page</a>
        </p>
      )}

      {groups.map((g) => (
        <section key={g.month} className="month">
          <h2>{g.month}</h2>
          <ul className="incidents">
            {g.items.map((i) => (
              <li key={i.id} className={i.ongoing ? "ongoing" : ""}>
                <div className="inc-main">
                  <span className={`inc-badge ${i.ongoing ? "down" : "resolved"}`}>
                    {i.ongoing ? "En cours" : "Résolu"}
                  </span>
                  <strong>{getMonitor(i.monitor_id)?.name ?? i.monitor_id}</strong>
                  <span className="inc-duration">{duration(i.duration_s)}</span>
                </div>
                <div className="inc-period">{period(i)}</div>
                {i.error && <div className="inc-error">{i.error}</div>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {pages > 1 && (
        <nav className="pager">
          {page > 1 ? <a href={href(page - 1)}>← Plus récents</a> : <span />}
          <span>
            Page {page} / {pages}
          </span>
          {page < pages ? <a href={href(page + 1)}>Plus anciens →</a> : <span />}
        </nav>
      )}
    </main>
  );
}
