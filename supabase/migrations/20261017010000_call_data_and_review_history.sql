-- Actualización incremental. Conserva conversaciones, muestras y revisiones existentes.
-- También admite el esquema anterior que usaba incidents.shared_org_id.
alter table public.incidents
  add column if not exists external_id text,
  add column if not exists org_id text references public.organizations(id) on delete set null;
alter table public.incidents alter column user_id drop not null;
create unique index if not exists incidents_external_id_key on public.incidents(external_id);
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='incidents' and column_name='shared_org_id') then
    execute 'update public.incidents set org_id = shared_org_id where org_id is null';
  end if;
end $$;
create index if not exists idx_incidents_org on public.incidents(org_id, started_at desc);

-- Preferencias y datos de la llamada: no se deducen tiempos o permisos desconocidos.
alter table public.users add column if not exists settings jsonb not null default '{}';
alter table public.incidents
  add column if not exists client_call_id text,
  add column if not exists provider_call_id text,
  add column if not exists agent_session_id text,
  add column if not exists caller_number_raw text,
  add column if not exists caller_e164 text,
  add column if not exists caller_name text,
  add column if not exists direction text check (direction in ('incoming','outgoing')),
  add column if not exists call_status text check (call_status in ('ringing','active','ended','rejected','missed')),
  add column if not exists answered_at timestamptz,
  add column if not exists talk_duration_s double precision check (talk_duration_s >= 0),
  add column if not exists agent_status text,
  add column if not exists ready_to_answer boolean not null default false,
  add column if not exists simulated boolean,
  add column if not exists blocked boolean not null default false,
  add column if not exists analysis_status text not null default 'pending' check (analysis_status in ('pending','running','completed','failed')),
  add column if not exists verdict text not null default 'none' check (verdict in ('none','safe','suspicious','scam')),
  add column if not exists risk_reasons jsonb not null default '[]' check (jsonb_typeof(risk_reasons) = 'array'),
  add column if not exists scam_type text,
  add column if not exists impersonating text,
  add column if not exists user_feedback text check (user_feedback in ('safe','scam','unsure')),
  add column if not exists user_feedback_at timestamptz,
  add column if not exists consent_snapshot jsonb not null default '{}' check (jsonb_typeof(consent_snapshot) = 'object'),
  add column if not exists analysis_meta jsonb not null default '{}' check (jsonb_typeof(analysis_meta) = 'object'),
  add column if not exists shared_at timestamptz,
  add column if not exists sharing_revoked_at timestamptz;
create unique index if not exists uq_incidents_client_call on public.incidents(user_id, client_call_id) where client_call_id is not null;
-- Los registros anteriores quedan null: no se asume que una demo histórica sea real.
alter table public.incidents alter column simulated set default false;
create index if not exists idx_incidents_agent_session on public.incidents(agent_session_id) where agent_session_id is not null;

alter table public.segments
  add column if not exists speaker text,
  add column if not exists external_segment_id text,
  add column if not exists flagged boolean not null default false,
  add column if not exists is_final boolean not null default true,
  add column if not exists end_offset double precision check (end_offset >= 0),
  add column if not exists source text,
  add column if not exists updated_at timestamptz not null default now();
create unique index if not exists uq_segments_external on public.segments(incident_id, external_segment_id) where external_segment_id is not null;
alter table public.signals add column if not exists analysis_meta jsonb not null default '{}';
alter table public.entities add column if not exists analysis_meta jsonb not null default '{}';

-- Una agrupación vocal con código estable no acredita la identidad de una persona.
create table if not exists public.voice_profiles (
  id text primary key,
  org_id text not null references public.organizations(id) on delete cascade,
  public_code text not null,
  status text not null default 'provisional' check (status in ('provisional','revisado','descartado')),
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  unique(org_id, public_code)
);
alter table public.voice_profiles enable row level security;
alter table public.voice_samples
  add column if not exists profile_id text references public.voice_profiles(id) on delete set null,
  add column if not exists model_id text,
  add column if not exists model_version text,
  add column if not exists embedding_dims integer generated always as (extensions.vector_dims(embedding)) stored,
  add column if not exists speaker text not null default 'unknown' check (speaker in ('caller','agent','user','unknown')),
  add column if not exists quality_status text not null default 'pending' check (quality_status in ('pending','usable','rejected')),
  add column if not exists review_status text not null default 'pendiente' check (review_status in ('pendiente','aprobada','rechazada')),
  add column if not exists reference_enabled boolean not null default false,
  add column if not exists source_session_ref text;
create index if not exists idx_voice_profile on public.voice_samples(profile_id);
create or replace function public.check_voice_profile_scope() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if NEW.profile_id is not null and not exists (
    select 1 from public.voice_profiles p join public.incidents i on i.org_id=p.org_id and i.simulated=p.simulated
    where p.id=NEW.profile_id and i.id=NEW.incident_id
  ) then
    raise exception using errcode='23514', message='El perfil y la muestra deben pertenecer a la misma organización y origen.';
  end if;
  return NEW;
end $$;
drop trigger if exists check_voice_profile_scope on public.voice_samples;
create trigger check_voice_profile_scope before insert or update of profile_id,incident_id on public.voice_samples
  for each row execute function public.check_voice_profile_scope();
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.voice_samples'::regclass and conname='voice_reference_eligible') then
    alter table public.voice_samples add constraint voice_reference_eligible check (
      not reference_enabled or (review_status='aprobada' and quality_status='usable' and speaker='caller'
        and model_id is not null and model_id<>'' and model_version is not null and model_version<>'')
    );
  end if;
end $$;

-- Revisiones y acciones estructuradas. El nombre anterior se conserva por compatibilidad.
alter table public.links
  add column if not exists reviewed_by_id text references public.users(id) on delete set null,
  add column if not exists evidence_version integer not null default 1,
  add column if not exists evidence_snapshot jsonb not null default '{}',
  add column if not exists reviewed_evidence_version integer,
  add column if not exists reviewed_evidence jsonb;
alter table public.actions
  add column if not exists actor_id text references public.users(id) on delete set null,
  add column if not exists actor_kind text not null default 'system' check (actor_kind in ('user','analyst','service','system')),
  add column if not exists result text not null default 'applied' check (result in ('requested','applied','failed')),
  add column if not exists request_id text,
  add column if not exists link_id text references public.links(id) on delete set null,
  add column if not exists payload jsonb not null default '{}';
create index if not exists idx_actions_link on public.actions(link_id, created_at);

-- Recupera el identificador del analista solo si su nombre corresponde a un único usuario.
update public.links l set reviewed_by_id=u.id
from (select min(id) as id, name from public.users where role='analista' group by name having count(*)=1) u
where l.reviewed_by_id is null and l.reviewed_by=u.name;
update public.links set reviewed_evidence_version=evidence_version,
  reviewed_evidence=jsonb_build_object('legacy',true,'evidence_version',evidence_version,
    'score',score,'voice_sim',voice_sim,'content_sim',content_sim,'reasons',reasons,'evidence_snapshot',evidence_snapshot)
where status<>'pendiente' and reviewed_evidence is null;

create or replace function public.protect_link_review() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare evidence_changed boolean := false;
begin
  perform set_config('centinela.review_actor_id',coalesce(NEW.reviewed_by_id,''),true);
  if TG_OP='UPDATE' then
    if row(NEW.incident_a,NEW.incident_b) is distinct from row(OLD.incident_a,OLD.incident_b) then
      raise exception using errcode='23514', message='Los extremos de un vínculo existente no se cambian.';
    end if;
    evidence_changed := row(NEW.score,NEW.voice_sim,NEW.content_sim,NEW.reasons,NEW.evidence_snapshot)
      is distinct from row(OLD.score,OLD.voice_sim,OLD.content_sim,OLD.reasons,OLD.evidence_snapshot);
    if OLD.status<>'pendiente' and NEW.status<>'pendiente' and evidence_changed then
      raise exception using errcode='P0001', message='La evidencia revisada está congelada. Vuelve el vínculo a pendiente antes de recalcular.';
    end if;
    NEW.evidence_version := OLD.evidence_version + case when evidence_changed then 1 else 0 end;
  else
    NEW.evidence_version := 1;
  end if;
  if NEW.status='pendiente' then
    NEW.reviewed_by := null; NEW.reviewed_by_id := null; NEW.reviewed_at := null;
    NEW.reviewed_evidence_version := null; NEW.reviewed_evidence := null;
  elsif TG_OP='INSERT' or OLD.status is distinct from NEW.status
      or OLD.reviewed_by is distinct from NEW.reviewed_by or OLD.reviewed_by_id is distinct from NEW.reviewed_by_id then
    NEW.reviewed_at := now();
    NEW.reviewed_evidence_version := NEW.evidence_version;
    NEW.reviewed_evidence := jsonb_build_object('evidence_version',NEW.evidence_version,
      'score',NEW.score,'voice_sim',NEW.voice_sim,'content_sim',NEW.content_sim,
      'reasons',NEW.reasons,'evidence_snapshot',NEW.evidence_snapshot);
  else
    NEW.reviewed_at := OLD.reviewed_at; NEW.reviewed_evidence_version := OLD.reviewed_evidence_version;
    NEW.reviewed_evidence := OLD.reviewed_evidence;
  end if;
  return NEW;
end $$;
drop trigger if exists protect_link_review on public.links;
create trigger protect_link_review before insert or update on public.links for each row execute function public.protect_link_review();

create or replace function public.record_link_review() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if (TG_OP='INSERT' and NEW.status<>'pendiente') or
    (TG_OP='UPDATE' and row(OLD.status,OLD.reviewed_by,OLD.reviewed_by_id,OLD.note)
      is distinct from row(NEW.status,NEW.reviewed_by,NEW.reviewed_by_id,NEW.note)) then
    insert into public.actions(id,incident_id,kind,detail,actor_id,actor_kind,result,link_id,payload)
    values ('act_'||replace(gen_random_uuid()::text,'-',''),NEW.incident_a,'link_review',
      'Revisión de vínculo: '||NEW.status,
      nullif(current_setting('centinela.review_actor_id',true),''),
      case when nullif(current_setting('centinela.review_actor_id',true),'') is null then 'service' else 'analyst' end,
      'applied',NEW.id,jsonb_build_object('before',case when TG_OP='UPDATE' then to_jsonb(OLD) else null end,'after',to_jsonb(NEW)));
  end if;
  return NEW;
end $$;
drop trigger if exists record_link_review on public.links;
create trigger record_link_review after insert or update on public.links for each row execute function public.record_link_review();

-- Compatibilidad si la base se creó antes de incorporar las claves de integración.
create table if not exists public.api_keys (
  id text primary key, name text not null, prefix text not null, key_hash text not null unique,
  created_at timestamptz not null default now(), last_used_at timestamptz, revoked_at timestamptz
);
alter table public.api_keys enable row level security;
