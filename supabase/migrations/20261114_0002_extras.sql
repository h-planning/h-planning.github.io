-- =====================================================================
--  EXTRAS : registre des extras et contrats d'extra
--  Les contrats sont indépendants du planning (un contrat peut être relié à un shift) et ne sont jamais supprimés :
--  « à signer » → « signé » (le manager, après signature papier par les deux parties) ; « annulé » garde la trace.
--  Accès : administrateur (tous les services), manager et assistant de chaque service (droits « extras » et « extras_sign »).
-- =====================================================================
-- Grille des salaires d'extra (taux horaire brut) par niveau et échelon, basique ou qualifié :
-- [{"level":"I","echelon":"1","basic":12.10,"qualified":12.50}, …]
alter table public.settings add column if not exists extra_grid jsonb not null default '[]';

-- droits par défaut : manager (registre + signature), assistant (registre, sans signature)
alter table public.settings alter column rights set default '{
    "manager":   {"planning":true,"publish":true,"copy_week":true,"requests":true,"owed":true,"presence":true,"overtime":true,"team":true,"extras":true,"extras_sign":true},
    "assistant": {"planning":true,"publish":false,"copy_week":true,"requests":false,"owed":false,"presence":false,"overtime":false,"team":false,"extras":true,"extras_sign":false},
    "employee":  {"team_planning":false,"balances":true}}';
update public.settings set rights = rights
  || jsonb_build_object('manager', '{"extras":true,"extras_sign":true}'::jsonb || coalesce(rights -> 'manager', '{}'))
  || jsonb_build_object('assistant', '{"extras":true,"extras_sign":false}'::jsonb || coalesce(rights -> 'assistant', '{}'));

create table if not exists public.extras (
  id uuid primary key default gen_random_uuid(),
  company_id smallint not null references public.companies on delete cascade,
  services smallint[] not null default '{}',        -- services où l'extra intervient
  profile_id uuid references public.profiles on delete set null,  -- sa ligne dans le planning (facultatif)
  last_name text not null,
  first_name text not null,
  address text, postal_code text, city text,
  phone text, email text,
  job_title text,                                    -- poste habituel (repris sur le contrat)
  level text, echelon text,
  qualified boolean not null default false,          -- grille « qualifié » au lieu de « basique »
  notes text,
  archived boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists extras_company on public.extras (company_id);

create table if not exists public.extra_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id smallint not null references public.companies on delete cascade,
  service_id smallint not null references public.services,
  extra_id uuid not null references public.extras on delete restrict,
  shift_id uuid references public.shifts on delete set null,   -- shift du planning à l'origine du contrat (facultatif)
  day date not null,
  start_time time not null,
  end_time time not null,
  break_min smallint not null default 0 check (break_min between 0 and 240),
  job_title text,
  -- copie des informations au moment du contrat (l'historique ne bouge plus si la fiche ou la grille change)
  extra_name text not null,
  extra_address text,
  level text, echelon text,
  qualified boolean not null default false,
  hourly_rate numeric(7,2) not null check (hourly_rate > 0),
  status text not null default 'to_sign' check (status in ('to_sign','signed','cancelled')),
  printed_at timestamptz,
  signed_at timestamptz, signed_by uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists extra_contracts_svc_day on public.extra_contracts (service_id, day);
create index if not exists extra_contracts_shift on public.extra_contracts (shift_id);
create index if not exists extra_contracts_extra on public.extra_contracts (extra_id);

-- Droit sur au moins un des services de la fiche
create or replace function public.can_extra(r text, svcs smallint[]) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select bool_or(public.can(r, s)) from unnest(svcs) s), false) $$;

create or replace function public.extras_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.last_name := upper(trim(new.last_name)); new.first_name := trim(new.first_name);
  if new.last_name = '' or new.first_name = '' then raise exception 'Nom et prénom obligatoires.'; end if;
  if coalesce(array_length(new.services, 1), 0) = 0 then raise exception 'Choisissez au moins un service.'; end if;
  if exists (select 1 from unnest(new.services) s where public.svc_company(s) is distinct from public.svc_company(new.services[1])) then
    raise exception 'Services de deux entreprises différentes.';
  end if;
  new.company_id := public.svc_company(new.services[1]);
  if new.profile_id is not null and public.emp_company(new.profile_id) is distinct from new.company_id then
    raise exception 'Ligne du planning d''une autre entreprise.';
  end if;
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists extras_before on public.extras;
create trigger extras_before before insert or update on public.extras for each row execute function public.extras_before();

-- Taux de la grille pour un niveau / échelon
create or replace function public.extra_rate(p_company smallint, p_level text, p_echelon text, p_qualified boolean) returns numeric
language sql stable security definer set search_path = public as $$
  select (g ->> case when p_qualified then 'qualified' else 'basic' end)::numeric
  from settings st, jsonb_array_elements(st.extra_grid) g
  where st.id = p_company and g ->> 'level' = p_level and g ->> 'echelon' = p_echelon
  limit 1
$$;

create or replace function public.extra_contracts_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare x extras; who boolean := auth.uid() is not null;
begin
  if tg_op = 'INSERT' then
    select * into x from extras where id = new.extra_id;
    if x.id is null then raise exception 'Extra introuvable.'; end if;
    new.company_id := public.svc_company(new.service_id);
    if x.company_id <> new.company_id then raise exception 'Extra d''une autre entreprise.'; end if;
    if coalesce(trim(x.address), '') = '' or coalesce(x.level, '') = '' or coalesce(x.echelon, '') = '' then
      raise exception 'Fiche de l''extra incomplète : renseignez l''adresse, le niveau et l''échelon.';
    end if;
    if new.shift_id is not null and not exists (select 1 from shifts where id = new.shift_id and service_id = new.service_id and kind = 'work') then
      raise exception 'Shift introuvable dans ce service.';
    end if;
    new.extra_name := x.last_name || ' ' || x.first_name;
    new.extra_address := concat_ws(', ', nullif(trim(x.address), ''), nullif(trim(concat_ws(' ', x.postal_code, x.city)), ''));
    new.level := x.level; new.echelon := x.echelon; new.qualified := x.qualified;
    new.job_title := coalesce(nullif(trim(new.job_title), ''), x.job_title);
    new.hourly_rate := public.extra_rate(new.company_id, x.level, x.echelon, x.qualified);
    if new.hourly_rate is null then
      raise exception 'Niveau % échelon % (%) absent de la grille des salaires d''extra (Paramètres).', x.level, x.echelon, case when x.qualified then 'qualifié' else 'basique' end;
    end if;
    new.status := 'to_sign'; new.signed_at := null; new.signed_by := null; new.cancelled_at := null; new.cancelled_by := null;
    new.created_by := auth.uid(); new.created_at := now();
    return new;
  end if;

  -- modification
  if old.status = 'cancelled' then raise exception 'Contrat annulé : il ne peut plus être modifié.'; end if;
  new.company_id := old.company_id; new.service_id := old.service_id; new.extra_id := old.extra_id;
  new.created_by := old.created_by; new.created_at := old.created_at;
  if old.status = 'signed' and (new.day, new.start_time, new.end_time, new.break_min, new.job_title, new.hourly_rate, new.extra_name, new.extra_address, new.level, new.echelon, new.qualified)
      is distinct from (old.day, old.start_time, old.end_time, old.break_min, old.job_title, old.hourly_rate, old.extra_name, old.extra_address, old.level, old.echelon, old.qualified) then
    raise exception 'Contrat signé : il ne peut plus être modifié (annulez-le et faites-en un nouveau).';
  end if;
  if new.status is distinct from old.status then
    if new.status = 'signed' then
      if who and not public.can('extras_sign', old.service_id) then raise exception 'Seul le manager du service (ou la direction) peut marquer un contrat signé.'; end if;
      new.signed_at := now(); new.signed_by := auth.uid();
    elsif new.status = 'to_sign' then
      if who and not public.can('extras_sign', old.service_id) then raise exception 'Seul le manager du service (ou la direction) peut retirer la signature.'; end if;
      new.signed_at := null; new.signed_by := null;
    elsif new.status = 'cancelled' then
      if who and old.status = 'signed' and not public.is_admin() then raise exception 'Un contrat signé ne peut être annulé que par la direction.'; end if;
      new.cancelled_at := now(); new.cancelled_by := auth.uid();
    end if;
  else
    new.signed_at := old.signed_at; new.signed_by := old.signed_by;
  end if;
  return new;
end $$;
drop trigger if exists extra_contracts_before on public.extra_contracts;
create trigger extra_contracts_before before insert or update on public.extra_contracts for each row execute function public.extra_contracts_before();

drop trigger if exists audit_extras on public.extras;
create trigger audit_extras after insert or update or delete on public.extras for each row execute function public.audit();
drop trigger if exists audit_extra_contracts on public.extra_contracts;
create trigger audit_extra_contracts after insert or update on public.extra_contracts for each row execute function public.audit();

alter table public.extras enable row level security;
alter table public.extra_contracts enable row level security;
drop policy if exists "double authentification" on public.extras;
drop policy if exists "double authentification" on public.extra_contracts;
drop policy if exists "entreprise" on public.extras;
drop policy if exists "entreprise" on public.extra_contracts;
drop policy if exists "extras lecture" on public.extras;
drop policy if exists "extras ajout" on public.extras;
drop policy if exists "extras modification" on public.extras;
drop policy if exists "extras suppression" on public.extras;
drop policy if exists "contrats extra lecture" on public.extra_contracts;
drop policy if exists "contrats extra ajout" on public.extra_contracts;
drop policy if exists "contrats extra modification" on public.extra_contracts;
create policy "double authentification" on public.extras as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());
create policy "double authentification" on public.extra_contracts as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());
create policy "entreprise" on public.extras as restrictive for all to authenticated using (company_id = public.my_company()) with check (company_id = public.my_company());
create policy "entreprise" on public.extra_contracts as restrictive for all to authenticated using (company_id = public.my_company()) with check (company_id = public.my_company());
create policy "extras lecture" on public.extras for select to authenticated using (public.can_extra('extras', services));
create policy "extras ajout" on public.extras for insert to authenticated with check (public.can_extra('extras', services));
create policy "extras modification" on public.extras for update to authenticated using (public.can_extra('extras', services)) with check (public.can_extra('extras', services));
-- suppression : seulement une fiche sans contrat (les contrats gardent leur extra)
create policy "extras suppression" on public.extras for delete to authenticated using (public.can_extra('extras', services));
create policy "contrats extra lecture" on public.extra_contracts for select to authenticated using (public.can('extras', service_id));
create policy "contrats extra ajout" on public.extra_contracts for insert to authenticated with check (public.can('extras', service_id));
create policy "contrats extra modification" on public.extra_contracts for update to authenticated using (public.can('extras', service_id)) with check (public.can('extras', service_id));
-- pas de suppression : l'historique des contrats est conservé

revoke execute on function public.extra_rate(smallint, text, text, boolean) from anon, public;
grant execute on function public.extra_rate(smallint, text, text, boolean) to authenticated;
revoke execute on function public.can_extra(text, smallint[]) from anon, public;
grant execute on function public.can_extra(text, smallint[]) to authenticated;
