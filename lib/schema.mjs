// Schéma partagé par l'app (création auto au démarrage) et scripts/migrate.mjs.
export const SCHEMA_SQL = `
create table if not exists checks (
  id          bigserial primary key,
  monitor_id  text        not null,
  checked_at  timestamptz not null default now(),
  ok          boolean     not null,
  status_code integer,
  response_ms integer,
  error       text,
  -- Nombre de secondes couvertes par cette vérif (temps écoulé depuis la précédente).
  duration_s  integer     not null
);
create index if not exists checks_monitor_time on checks (monitor_id, checked_at desc);
create index if not exists checks_time on checks (checked_at);

create table if not exists daily_stats (
  monitor_id text   not null,
  day        date   not null,
  up_s       bigint not null default 0,
  total_s    bigint not null default 0,
  checks     integer not null default 0,
  failures   integer not null default 0,
  primary key (monitor_id, day)
);

create table if not exists incidents (
  id         bigserial primary key,
  monitor_id text        not null,
  started_at timestamptz not null,
  ended_at   timestamptz,
  error      text
);
create index if not exists incidents_monitor_started on incidents (monitor_id, started_at desc);
create unique index if not exists incidents_one_open on incidents (monitor_id) where ended_at is null;

-- 'up' | 'degraded' | 'down'. Null sur les anciennes lignes (on se rabat sur ok).
alter table checks add column if not exists state text;

-- Sous-services rapportés par un endpoint de statut détaillé (ex. le mail).
-- On ne stocke volontairement ni les messages ni les chiffres, seulement l'état.
create table if not exists components (
  monitor_id   text        not null,
  component_id text        not null,
  name         text        not null,
  description  text,
  state        text        not null,
  position     integer     not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (monitor_id, component_id)
);

create table if not exists component_daily (
  monitor_id   text   not null,
  component_id text   not null,
  day          date   not null,
  up_s         bigint not null default 0,
  total_s      bigint not null default 0,
  primary key (monitor_id, component_id, day)
);
`;
