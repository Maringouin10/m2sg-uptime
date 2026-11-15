import AutoRefresh from "./AutoRefresh";
import { TIMEZONE } from "@/lib/monitors";
import { getDailyBars, getStatuses, overall, type DayBar, type Uptime } from "@/lib/stats";

export const dynamic = "force-dynamic";

const OVERALL_TEXT = {
  up: "Tous les services fonctionnent",
  degraded: "Panne partielle",
  down: "Panne majeure",
  unknown: "En attente des premières vérifications",
} as const;

const STATUS_TEXT = { up: "Opérationnel", down: "En panne", unknown: "Inconnu" } as const;

function pct(u: Uptime): string {
  if (u.percent === null) return "—";
  const v = u.percent;
  const digits = v === 100 ? 0 : v >= 99 ? 3 : 2;
  return (
    new Intl.NumberFormat("fr-CA", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
      Math.floor(v * 10 ** digits) / 10 ** digits,
    ) + " %"
  );
}

function duration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} j ${rh} h` : `${d} j`;
}

const dateTimeFmt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: TIMEZONE,
  dateStyle: "medium",
  timeStyle: "medium",
});
const dayFmt = new Intl.DateTimeFormat("fr-CA", { timeZone: "UTC", dateStyle: "medium" });

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
  const p = pct({ percent: b.percent, up_s: 0, total_s: 0, down_s: 0 });
  return b.down_s > 0 ? `${d} — ${p} (${duration(b.down_s)} d'arrêt)` : `${d} — ${p}`;
}

export default async function Page() {
  const [statuses, bars] = await Promise.all([getStatuses(), getDailyBars(90)]);
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
        Vérification toutes les 60 s (toutes les 30 s pendant une panne) · API :{" "}
        <a href="/api/status">/api/status</a> · <a href="/api/incidents">/api/incidents</a>
      </footer>
    </main>
  );
}
