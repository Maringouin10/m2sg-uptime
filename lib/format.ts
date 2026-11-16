import { TIMEZONE } from "./monitors";
import type { Uptime } from "./stats";

export function pct(u: Pick<Uptime, "percent">): string {
  if (u.percent === null) return "—";
  const v = u.percent;
  const digits = v === 100 ? 0 : v >= 99 ? 3 : 2;
  return (
    new Intl.NumberFormat("fr-CA", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
      Math.floor(v * 10 ** digits) / 10 ** digits,
    ) + " %"
  );
}

export function duration(s: number): string {
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

export const dateTimeFmt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: TIMEZONE,
  dateStyle: "medium",
  timeStyle: "medium",
});

export const longDateTimeFmt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: TIMEZONE,
  dateStyle: "full",
  timeStyle: "short",
});

export const shortDateTimeFmt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: TIMEZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const timeFmt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
});

export const monthFmt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: TIMEZONE,
  month: "long",
  year: "numeric",
});

/** Pour les dates « jour » (AAAA-MM-JJ) déjà exprimées dans le fuseau local. */
export const dayFmt = new Intl.DateTimeFormat("fr-CA", { timeZone: "UTC", dateStyle: "medium" });

/** « il y a 3 h », « il y a 2 j »… */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  return `il y a ${duration(s)}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
