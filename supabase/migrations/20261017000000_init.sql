-- Esquema inicial de Centinela para Supabase (Postgres).
-- Es idempotente: se puede aplicar con `supabase db push`, pegar en el SQL Editor
-- o dejar que la app lo aplique sola en el primer arranque.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists organizations (
  id text primary key,
  name text not null
);

create table if not exists users (
  id text primary key,
  name text not null,
  role text not null check (role in ('usuario', 'analista')),
  org_id text references organizations (id) on delete set null
);

create table if not exists incidents (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  title text not null,
  channel text not null check (channel in ('navegador', 'manual')),
  status text not null check (status in ('en_curso', 'finalizado')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  risk_score integer not null default 0,
  risk_level text not null default 'bajo' check (risk_level in ('bajo', 'medio', 'alto')),
  summary text,
  recommendation text,
  shared_org_id text references organizations (id) on delete set null,
  shared_at timestamptz,
  analyst_status text not null default 'nuevo' check (analyst_status in ('nuevo', 'en_revision', 'cerrado'))
);

create table if not exists segments (
  id text primary key,
  incident_id text not null references incidents (id) on delete cascade,
  idx integer not null,
  t_offset double precision not null default 0,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists signals (
  id text primary key,
  incident_id text not null references incidents (id) on delete cascade,
  segment_id text references segments (id) on delete set null,
  type text not null,
  evidence text not null,
  explanation text not null,
  confidence double precision not null,
  source text not null check (source in ('ia', 'reglas')),
  created_at timestamptz not null default now()
);

create table if not exists entities (
  id text primary key,
  incident_id text not null references incidents (id) on delete cascade,
  segment_id text references segments (id) on delete set null,
  kind text not null,
  value text not null,
  normalized text not null,
  provenance text not null
);

-- Embeddings de voz: dato biométrico sensible. Sin dimensión fija para aceptar
-- distintos modelos (p. ej. ECAPA = 192).
create table if not exists voice_samples (
  id text primary key,
  incident_id text not null references incidents (id) on delete cascade,
  embedding extensions.vector not null,
  duration_s double precision,
  created_at timestamptz not null default now()
);

create table if not exists actions (
  id text primary key,
  incident_id text not null references incidents (id) on delete cascade,
  kind text not null,
  detail text not null,
  created_at timestamptz not null default now()
);

create table if not exists notes (
  id text primary key,
  incident_id text not null references incidents (id) on delete cascade,
  author_id text not null,
  author_name text not null,
  author_role text not null,
  kind text not null check (kind in ('correccion', 'observacion', 'conclusion')),
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists links (
  id text primary key,
  incident_a text not null references incidents (id) on delete cascade,
  incident_b text not null references incidents (id) on delete cascade,
  score double precision not null,
  voice_sim double precision,
  content_sim double precision not null,
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'pendiente' check (status in ('pendiente', 'confirmado', 'descartado')),
  reviewed_by text,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (incident_a, incident_b)
);

create index if not exists idx_incidents_user on incidents (user_id, started_at desc);
create index if not exists idx_incidents_org on incidents (shared_org_id, started_at desc);
create index if not exists idx_segments_incident on segments (incident_id, idx);
create index if not exists idx_signals_incident on signals (incident_id);
create index if not exists idx_entities_incident on entities (incident_id);
create index if not exists idx_entities_norm on entities (kind, normalized);
create index if not exists idx_voice_incident on voice_samples (incident_id);
create index if not exists idx_actions_incident on actions (incident_id, created_at);
create index if not exists idx_notes_incident on notes (incident_id, created_at);

-- La app accede desde el servidor con la conexión de Postgres (dueña de las
-- tablas). Activar RLS sin políticas bloquea el acceso público a través de la
-- API de Supabase (anon/authenticated), incluidos los datos biométricos.
alter table organizations enable row level security;
alter table users enable row level security;
alter table incidents enable row level security;
alter table segments enable row level security;
alter table signals enable row level security;
alter table entities enable row level security;
alter table voice_samples enable row level security;
alter table actions enable row level security;
alter table notes enable row level security;
alter table links enable row level security;
