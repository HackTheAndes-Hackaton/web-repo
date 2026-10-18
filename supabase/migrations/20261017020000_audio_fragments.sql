-- Audio original separado de los embeddings. Nunca se convierte automáticamente
-- en una referencia de identidad ni se incluye en los vínculos por voz.
create table public.audio_fragments (
  id text primary key,
  incident_id text not null references public.incidents(id) on delete cascade,
  request_id uuid not null,
  audio bytea not null check (octet_length(audio) between 32044 and 480044),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  duration_s double precision not null check (duration_s between 1 and 15),
  source text not null check (source in ('webrtc_microphone','provider_mixed')),
  speaker text not null default 'unknown' check (speaker = 'unknown'),
  review_status text not null default 'pendiente' check (review_status = 'pendiente'),
  created_at timestamptz not null default now(),
  unique (incident_id, request_id)
);
create index audio_fragments_incident on public.audio_fragments(incident_id, created_at);
alter table public.audio_fragments enable row level security;
