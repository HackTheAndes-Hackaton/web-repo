-- Cada versión fija el material que un analista decidió incluir. El grupo de
-- vínculos es dinámico; el informe no cambia cuando se recalcula ese grupo.
create table if not exists public.report_versions (
  id text primary key,
  org_id text not null references public.organizations(id),
  series_id text not null,
  version integer not null check (version > 0),
  title text not null check (length(btrim(title)) between 1 and 120),
  summary text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_id text references public.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, series_id, version)
);
create index if not exists idx_report_versions_org_created
  on public.report_versions (org_id, created_at desc);
alter table public.report_versions enable row level security;

create or replace function public.protect_report_version() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception using errcode='P0001', message='Una versión de informe es inmutable.';
end $$;
drop trigger if exists protect_report_version on public.report_versions;
create trigger protect_report_version before update or delete on public.report_versions
  for each row execute function public.protect_report_version();
