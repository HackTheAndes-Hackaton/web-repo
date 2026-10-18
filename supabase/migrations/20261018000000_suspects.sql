-- Registro de presuntos responsables. Un analista pone un alias a un grupo de casos
-- que cree obra de la misma persona o banda. El alias es para llevar registro: no
-- identifica a nadie ni prueba que todos los casos tengan el mismo autor.
create table if not exists public.suspects (
  id text primary key,
  org_id text not null references public.organizations(id) on delete cascade,
  alias text not null check (length(btrim(alias)) between 1 and 80),
  notes text not null default '' check (length(notes) <= 2000),
  status text not null default 'en_investigacion' check (status in ('en_investigacion','descartado')),
  created_by text,
  created_by_id text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists suspects_org_alias on public.suspects(org_id, lower(btrim(alias)));
alter table public.suspects enable row level security;

-- Un caso pertenece a lo sumo a un presunto responsable.
alter table public.incidents
  add column if not exists suspect_id text references public.suspects(id) on delete set null;
create index if not exists incidents_suspect on public.incidents(suspect_id) where suspect_id is not null;

create or replace function public.check_suspect_scope() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if NEW.suspect_id is not null and not exists (
    select 1 from public.suspects s where s.id=NEW.suspect_id and s.org_id=NEW.org_id
  ) then
    raise exception using errcode='23514', message='El caso y el presunto responsable deben pertenecer a la misma organización.';
  end if;
  return NEW;
end $$;
drop trigger if exists check_suspect_scope on public.incidents;
create trigger check_suspect_scope before insert or update of suspect_id,org_id on public.incidents
  for each row execute function public.check_suspect_scope();
