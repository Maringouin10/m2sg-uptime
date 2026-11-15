export type Monitor = {
  /** Identifiant stable utilisé dans l'API et la base. */
  id: string;
  /** Nom affiché sur la page de statut. */
  name: string;
  /** URL vérifiée. */
  url: string;
  /** URL affichée sur la page (par défaut : url). */
  displayUrl?: string;
  /**
   * "http" : simple vérification du code HTTP.
   * "status-json" : endpoint qui renvoie { status, services: [{ id, name, description, status }] }.
   */
  type: "http" | "status-json";
};

export type State = "up" | "degraded" | "down";

export const MONITORS: Monitor[] = [
  { id: "website", name: "Site web", url: "https://m2sg.com", type: "http" },
  {
    id: "mail",
    name: "Mail",
    url: "https://mail.m2sg.com/api/status",
    displayUrl: "https://mail.m2sg.com",
    type: "status-json",
  },
];

export const TIMEZONE = "America/Toronto";

/** Délai max d'une vérification avant de la considérer en échec. */
export const CHECK_TIMEOUT_MS = 10_000;
/** Délai entre deux vérifications quand un service est en panne. */
export const DOWN_RECHECK_DELAY_MS = 30_000;
/** Intervalle normal (appel de cron-job.org). */
export const NORMAL_INTERVAL_S = 60;
/** Un écart plus grand que ça entre deux vérifs = surveillance interrompue : on ne compte pas le trou. */
export const MAX_GAP_S = 150;
/** Les vérifs brutes plus vieilles que ça sont supprimées (les agrégats journaliers restent). */
export const RAW_RETENTION_DAYS = 90;

export function getMonitor(id: string): Monitor | undefined {
  return MONITORS.find((m) => m.id === id);
}
