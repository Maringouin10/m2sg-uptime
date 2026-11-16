import AutoRefresh from "./AutoRefresh";
import { databaseUrl } from "@/lib/db";
import { ago, dateTimeFmt, dayFmt, duration, longDateTimeFmt, pct } from "@/lib/format";
import { getMonitor } from "@/lib/monitors";
import { getDailyBars, getIncidents, getStatuses, overall, type DayBar } from "@/lib/stats";

export const dynamic = "force-dynamic";

const OVERALL_TEXT = {
  up: "Tous les services fonctionnent",
  degraded: "Perturbations en cours",
  down: "Panne majeure",
  unknown: "En attente des premières vérifications",
} as const;

const STATUS_TEXT = {
  up: "Opérationnel",
  degraded: "Dégradé",
  down: "En panne",
  unknown: "Inconnu",
} as const;

function barClass(b: DayBar): string {
  if (b.percent === null) return "bar none";
  if (b.percent >= 100) return "bar ok";
  if (b.percent >= 99) return "bar minor";
  if (b.percent >= 95) return "bar major";
  return "bar critical";
}

function barTitle(b: DayBar): string {
  const d = dayFmt.format(new Date(b.day + "T12:00:00Z"));
  if (b.percent === null) return `${d} — aucune donnée`;
  const p = pct({ percent: b.percent });
  return b.down_s > 0 ? `${d} — ${p} (${duration(b.down_s)} d'arrêt)` : `${d} — ${p}`;
}

export default async function Page() {
  if (!databaseUrl()) {
    return (
      <main>
        <header>
          <h1>M2SG</h1>
          <p className="sub">Statut des services</p>
        </header>
        <div className="banner unknown">
          <span className="dot" />
          Base de données non configurée
        </div>
        <section className="card">
          <p style={{ margin: 0 }}>
            La variable d&apos;environnement <code>DATABASE_URL</code> est absente. Dans Vercel :
            Storage → Neon → connecter la base à ce projet (environnement Production), puis
            redéployer.
          </p>
        </section>
      </main>
    );
  }
  const [statuses, bars, [last]] = await Promise.all([
    getStatuses(),
    getDailyBars(90),
    getIncidents({ limit: 1 }),
  ]);
  const lastMonitor = last ? getMonitor(last.monitor_id) : undefined;
  const global = overall(statuses);

  return (
    <main>
      <AutoRefresh seconds={30} />
      <header>
        <h1>M2SG</h1>
        <p className="sub">Statut des services</p>
      </header>

      <div className={`banner ${global}`}>
        <span className="dot" />
        {OVERALL_TEXT[global]}
      </div>

      <section className={`last-incident ${last ? (last.ongoing ? "ongoing" : "resolved") : "none"}`}>
        <div className="li-top">
          <span className="li-kicker">Dernier incident</span>
          <a href="/historique" className="li-link">
            Voir tout l&apos;historique →
          </a>
        </div>
        {last ? (
          <>
            <div className="li-title">
              {lastMonitor?.name ?? last.monitor_id}{" "}
              {last.ongoing ? "— en panne" : "— résolu"}
            </div>
            <div className="li-duration">
              {last.ongoing ? `En cours depuis ${duration(last.duration_s)}` : `Durée : ${duration(last.duration_s)}`}
            </div>
            <div className="li-details">
              <div>
                <span>Début</span>
                {longDateTimeFmt.format(new Date(last.started_at))}
              </div>
              <div>
                <span>Fin</span>
                {last.ended_at
                  ? `${longDateTimeFmt.format(new Date(last.ended_at))} (${ago(last.ended_at)})`
                  : "Toujours en cours"}
              </div>
              {last.error && (
                <div>
                  <span>Cause</span>
                  {last.error}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="li-title">Aucun incident enregistré</div>
        )}
      </section>

      {statuses.map((s) => (
        <section key={s.id} className="card">
          <div className="card-head">
            <div>
              <h2>{s.name}</h2>
              <a href={s.url} className="url" target="_blank" rel="noreferrer">
                {s.url.replace(/^https?:\/\//, "")}
              </a>
            </div>
            <span className={`pill ${s.status}`}>{STATUS_TEXT[s.status]}</span>
          </div>

          {s.current_incident && (
            <p className="incident">
              En panne depuis {duration(s.current_incident.duration_s)}
              {s.current_incident.error ? ` — ${s.current_incident.error}` : ""}
            </p>
          )}

          <div className="uptimes">
            {(
              [
                ["24h", "24 heures"],
                ["30d", "30 jours"],
                ["365d", "1 an"],
                ["all", "Depuis toujours"],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="uptime">
                <div className="value">{pct(s.uptime[k])}</div>
                <div className="label">{label}</div>
              </div>
            ))}
          </div>

          {s.components && s.components.length > 0 && (
            <ul className="components">
              {s.components.map((c) => (
                <li key={c.id} title={c.description ?? undefined}>
                  <span className={`cdot ${c.status}`} />
                  <span className="cname">{c.name}</span>
                  <span className="cuptime" title="Disponibilité sur 30 jours">
                    {pct(c.uptime_30d)}
                  </span>
                  <span className={`ctext ${c.status}`}>{STATUS_TEXT[c.status]}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="bars" aria-label="Disponibilité des 90 derniers jours">
            {bars[s.id].map((b) => (
              <span key={b.day} className={barClass(b)} title={barTitle(b)} />
            ))}
          </div>
          <div className="bars-legend">
            <span>il y a 90 jours</span>
            <span>aujourd&apos;hui</span>
          </div>

          <p className="meta">
            {s.last_check
              ? `Dernière vérification : ${dateTimeFmt.format(new Date(s.last_check.checked_at))}` +
                (s.last_check.status_code ? ` · HTTP ${s.last_check.status_code}` : "") +
                (s.last_check.response_ms !== null ? ` · ${s.last_check.response_ms} ms` : "")
              : "Aucune vérification pour l'instant"}
            {s.since ? ` · Données depuis le ${dayFmt.format(new Date(s.since + "T12:00:00Z"))}` : ""}
          </p>
        </section>
      ))}

      <footer>
        Vérification toutes les 60 s (toutes les 30 s pendant une panne) · Sous-services : disponibilité
        sur 30 jours · <a href="/historique">Historique des incidents</a> · API :{" "}
        <a href="/api/status">/api/status</a> · <a href="/api/incidents">/api/incidents</a>
      </footer>
    </main>
  );
}
