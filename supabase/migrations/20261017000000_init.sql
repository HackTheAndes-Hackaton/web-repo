-- Esquema inicial de Centinela para Supabase (Postgres).
-- Es idempotente: se puede aplicar con `npm run db:migrate`, `supabase db push`,
-- pegarlo en el SQL Editor o dejar que la app lo aplique sola en el primer arranque.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

-- Personas: quienes tuvieron la conversación (rol "usuario") y analistas del panel.
create table if not exists users (
  id text primary key,
  name text not null,
  role text not null default 'usuario' check (role in ('usuario', 'analista')),
  org_id text references organizations (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Un incidente es una conversación analizada. Solo aparece en el panel de la
-- organización indicada en org_id (null = no compartido con nadie).
create table if not exists incidents (
  id text primary key,
  external_id text unique,
  user_id text references users (id) on delete set null,
  org_id text references organizations (id) on delete set null,
  title text not null default 'Conversación',
  channel text not null default 'llamada',
  status text not null default 'en_curso' check (status in ('en_curso', 'finalizado')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  risk_level text not null default 'bajo' check (risk_level in ('bajo', 'medio', 'alto')),
  summary text,
  recommendation text,
  analyst_status text not null default 'nuevo' check (analyst_status in ('nuevo', 'en_revision', 'cerrado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fragmentos de la transcripción.
create table if not exists segments (
  id text primary key,
  incident_id text not null references incidents (id) on delete cascade,
  idx integer not null,
  t_offset double precision not null default 0,
  speaker text,
  text text not null,
  created_at timestamptz not null default now()
);

-- Señales de riesgo inferidas por la IA.
create table if not exists signals (
  id text primary key,
  incident_id text not null references incidents (id) on delete cascade,
  segment_id text references segments (id) on delete set null,
  type text not null,
  evidence text not null,
  explanation text not null,
  confidence double precision not null default 0.5 check (confidence between 0 and 1),
  source text not null default 'ia',
  created_at timestamptz not null default now()
);

-- Datos observados: teléfonos, cuentas, montos, nombres, organizaciones, lugares.
create table if not exists entities (
  id text primary key,
  incident_id text not null references incidents (id) on delete cascade,
  segment_id text references segments (id) on delete set null,
  kind text not null,
  value text not null,
  normalized text not null,
  provenance text not null default 'mencionado',
  created_at timestamptz not null default now()
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

-- Bitácora de acciones y permisos del incidente.
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
  author_id text,
  author_name text not null,
  author_role text not null default 'sistema',
  kind text not null default 'observacion' check (kind in ('correccion', 'observacion', 'conclusion')),
  text text not null,
  created_at timestamptz not null default now()
);

-- Posibles vínculos entre incidentes de la misma organización.
create table if not exists links (
  id text primary key,
  incident_a text not null references incidents (id) on delete cascade,
  incident_b text not null references incidents (id) on delete cascade,
  score double precision not null,
  voice_sim double precision,
  content_sim double precision not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'pendiente' check (status in ('pendiente', 'confirmado', 'descartado')),
  reviewed_by text,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (incident_a, incident_b),
  check (incident_a < incident_b)
);

-- Claves para los servicios que consumen la API (servidor de llamadas, IA).
-- Solo se guarda el hash SHA-256; la clave completa se muestra una sola vez.
create table if not exists api_keys (
  id text primary key,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_incidents_user on incidents (user_id, started_at desc);
create index if not exists idx_incidents_org on incidents (org_id, started_at desc);
create index if not exists idx_segments_incident on segments (incident_id, idx);
create index if not exists idx_signals_incident on signals (incident_id);
create index if not exists idx_entities_incident on entities (incident_id);
create index if not exists idx_entities_norm on entities (kind, normalized);
-- Un mismo dato no se repite dentro de un incidente (la API lo ignora si ya existe).
create unique index if not exists uq_entities_incident on entities (incident_id, kind, normalized);
create index if not exists idx_voice_incident on voice_samples (incident_id);
create index if not exists idx_actions_incident on actions (incident_id, created_at);
create index if not exists idx_notes_incident on notes (incident_id, created_at);
create index if not exists idx_links_a on links (incident_a);
create index if not exists idx_links_b on links (incident_b);

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
alter table api_keys enable row level security;
