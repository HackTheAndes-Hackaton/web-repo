-- Una sola organización: todo lo de org_vecinal pasa a org_uav y org_vecinal deja
-- de existir. La API sigue aceptando "org_vecinal" como nombre anterior de org_uav.
do $$
begin
  if exists (select 1 from public.organizations where id = 'org_vecinal')
     and exists (select 1 from public.organizations where id = 'org_uav') then
    -- Alias y códigos únicos por organización: si ya existen en org_uav, se distinguen.
    update public.suspects s set org_id = 'org_uav',
      alias = case when exists (select 1 from public.suspects t where t.org_id = 'org_uav'
                                and lower(btrim(t.alias)) = lower(btrim(s.alias))) then left(s.alias, 70) || ' (vecinal)' else s.alias end
      where s.org_id = 'org_vecinal';
    update public.voice_profiles p set org_id = 'org_uav',
      public_code = case when exists (select 1 from public.voice_profiles q where q.org_id = 'org_uav'
                                      and q.public_code = p.public_code) then p.public_code || '-vecinal' else p.public_code end
      where p.org_id = 'org_vecinal';
    -- Las versiones de informe son inmutables: solo cambia la organización a la que pertenecen.
    if exists (select 1 from public.report_versions where org_id = 'org_vecinal') then
      alter table public.report_versions disable trigger protect_report_version;
      update public.report_versions set org_id = 'org_uav' where org_id = 'org_vecinal';
      alter table public.report_versions enable trigger protect_report_version;
    end if;
    update public.incidents set org_id = 'org_uav' where org_id = 'org_vecinal';
    update public.users set org_id = 'org_uav' where org_id = 'org_vecinal';
    delete from public.organizations where id = 'org_vecinal';
  end if;
end $$;

-- "Eliminar reporte" de un número: los reportes y bloqueos anteriores a esta fecha
-- dejan de contar en la reputación. Las llamadas se conservan.
create table if not exists public.number_report_clears (
  number_key text primary key,
  cleared_at timestamptz not null default now(),
  cleared_by text,
  cleared_by_id text references public.users(id) on delete set null
);
alter table public.number_report_clears enable row level security;
