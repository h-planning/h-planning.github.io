-- =====================================================================
--  JOURNAL pour les managers et assistants (droit « journal ») : seulement ce qui concerne leurs services
--  ÉCHANGES DE SHIFTS entre salariés d'un même service (collègue → manager/assistant)
--  RETOURS (bugs, améliorations) envoyés au développeur depuis le tableau de bord
-- =====================================================================
update public.settings set rights = rights
  || jsonb_build_object('manager', '{"journal":true}'::jsonb || coalesce(rights -> 'manager', '{}'))
  || jsonb_build_object('assistant', '{"journal":true}'::jsonb || coalesce(rights -> 'assistant', '{}'));
alter table public.settings alter column rights set default '{
    "manager":   {"planning":true,"publish":true,"copy_week":true,"requests":true,"owed":true,"presence":true,"overtime":true,"team":true,"extras":true,"extras_sign":true,"journal":true},
    "assistant": {"planning":true,"publish":false,"copy_week":true,"requests":false,"owed":false,"presence":false,"overtime":false,"team":false,"extras":true,"extras_sign":false,"journal":true},
    "employee":  {"team_planning":false,"balances":true}}';

create or replace function public.audit_entries(p_limit int default 200)
returns table (at timestamptz, actor_name text, table_name text, action text, row_id text, old_data jsonb, new_data jsonb)
language sql stable security definer set search_path = public as $$
  select a.at, case when p.role = 'developer' then 'Développeur' else coalesce(nullif(p.full_name, ''), p.email, 'Système') end,
         a.table_name, a.action, a.row_id, a.old_data, a.new_data
  from audit_log a left join profiles p on p.id = a.actor
  where a.company_id = public.my_company()
    and ((public.is_admin() and public.admin_right('journal'))
      or (public.my_role() in ('manager','assistant') and a.table_name not in ('settings','companies') and (
            public.can('journal', (case when a.table_name = 'services' then a.row_id
                                        else coalesce(a.new_data ->> 'service_id', a.old_data ->> 'service_id') end)::smallint)
         or exists (select 1 from profile_services ps
                    where ps.profile_id = (case when a.table_name = 'profiles' then a.row_id
                                                else coalesce(a.new_data ->> 'employee_id', a.old_data ->> 'employee_id') end)::uuid
                      and public.can('journal', ps.service_id))
         or (a.table_name = 'extras' and public.can_extra('journal',
               (select array_agg(x::smallint) from jsonb_array_elements_text(coalesce(a.new_data -> 'services', a.old_data -> 'services')) x))))))
  order by a.id desc limit least(greatest(p_limit, 1), 1000)
$$;

-- ---------- Échanges de shifts ----------
create table if not exists public.shift_swaps (
  id uuid primary key default gen_random_uuid(),
  company_id smallint not null references public.companies on delete cascade,
  service_id smallint not null references public.services,
  requester_id uuid not null references public.profiles on delete cascade,
  requester_shift_id uuid references public.shifts on delete set null,
  target_id uuid not null references public.profiles on delete cascade,
  target_shift_id uuid references public.shifts on delete set null,
  -- copie de ce qui est échangé (lisible même si le planning change ensuite)
  requester_day date not null, requester_label text,
  target_day date not null, target_label text,
  note text check (char_length(note) <= 300),
  status text not null default 'pending_peer' check (status in ('pending_peer','pending_manager','approved','refused','cancelled')),
  peer_at timestamptz,
  decided_by uuid, decided_at timestamptz, refusal_reason text,
  created_at timestamptz not null default now()
);
create index if not exists shift_swaps_svc on public.shift_swaps (service_id, status);
alter table public.shift_swaps enable row level security;
drop policy if exists "double authentification" on public.shift_swaps;
drop policy if exists "échanges lecture" on public.shift_swaps;
create policy "double authentification" on public.shift_swaps as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());
create policy "échanges lecture" on public.shift_swaps for select to authenticated
  using (company_id = public.my_company() and (requester_id = auth.uid() or target_id = auth.uid() or public.can('planning', service_id)));
-- écritures uniquement par les fonctions ci-dessous
drop trigger if exists audit_swaps on public.shift_swaps;
create trigger audit_swaps after insert or update on public.shift_swaps for each row execute function public.audit();

create or replace function public.swap_label(s shifts) returns text
language sql stable security definer set search_path = public as $$
  select case when s.kind = 'work' then coalesce(nullif(s.label, ''), 'Travail') || ' ' || to_char(s.start_time, 'HH24"h"MI') || '–' || to_char(s.end_time, 'HH24"h"MI')
              else public.type_label(s.kind) end
$$;

-- shifts d'un collègue du même service qu'on peut proposer en échange (mois publiés, à partir de demain, ±21 jours)
create or replace function public.swap_candidates(p_shift uuid)
returns table (shift_id uuid, employee_id uuid, full_name text, day date, kind text, start_time time, end_time time, label text, color text, template_id smallint)
language plpgsql stable security definer set search_path = public as $$
declare s shifts;
begin
  select * into s from shifts where id = p_shift;
  if s.id is null or s.employee_id <> auth.uid() or not public.employee_right('swaps') then return; end if;
  return query
    select o.id, o.employee_id, p.full_name, o.day, o.kind, o.start_time, o.end_time, o.label, o.color, o.template_id
    from shifts o join profiles p on p.id = o.employee_id
    where o.service_id = s.service_id and o.employee_id <> s.employee_id and p.active and p.role = 'employee'
      and o.kind in ('work','repos') and o.request_id is null and not o.jour_sup and not o.jour_rendu
      and o.day between greatest(current_date + 1, s.day - 21) and s.day + 21
      and public.is_published(o.service_id, o.day)
    order by o.day, p.full_name;
end $$;

create or replace function public.create_swap(p_shift uuid, p_target_shift uuid, p_note text default null) returns shift_swaps
language plpgsql security definer set search_path = public as $$
declare a shifts; b shifts; r shift_swaps; who text;
begin
  if public.my_role() <> 'employee' or not public.employee_right('swaps') then raise exception 'Les échanges de shifts ne sont pas activés pour votre compte.'; end if;
  select * into a from shifts where id = p_shift;
  select * into b from shifts where id = p_target_shift;
  if a.id is null or a.employee_id <> auth.uid() then raise exception 'Choisissez un de vos shifts.'; end if;
  if b.id is null or b.employee_id = auth.uid() then raise exception 'Choisissez le shift d''un collègue.'; end if;
  if a.service_id <> b.service_id then raise exception 'L''échange se fait entre salariés du même service.'; end if;
  if a.day <= current_date or b.day <= current_date then raise exception 'Seuls les jours à venir (à partir de demain) peuvent être échangés.'; end if;
  if a.kind not in ('work','repos') or b.kind not in ('work','repos') or a.request_id is not null or b.request_id is not null
     or a.jour_sup or a.jour_rendu or b.jour_sup or b.jour_rendu then
    raise exception 'Seuls les shifts de travail et les repos peuvent être échangés (pas les congés ni les jours à rendre ou à récupérer).';
  end if;
  if a.kind = 'repos' and b.kind = 'repos' then raise exception 'Échanger deux repos ne change rien.'; end if;
  if not public.is_published(a.service_id, a.day) or not public.is_published(b.service_id, b.day) then raise exception 'Le planning de ces jours n''est pas encore publié.'; end if;
  if exists (select 1 from shift_swaps w where w.status in ('pending_peer','pending_manager')
             and (w.requester_shift_id in (a.id, b.id) or w.target_shift_id in (a.id, b.id))) then
    raise exception 'Un échange est déjà en cours pour l''un de ces shifts.';
  end if;
  insert into shift_swaps (company_id, service_id, requester_id, requester_shift_id, target_id, target_shift_id, requester_day, requester_label, target_day, target_label, note)
  values (public.svc_company(a.service_id), a.service_id, a.employee_id, a.id, b.employee_id, b.id, a.day, public.swap_label(a), b.day, public.swap_label(b), nullif(trim(p_note), ''))
  returning * into r;
  select full_name into who from profiles where id = a.employee_id;
  perform public.notify(b.employee_id, 'Échange de shift proposé',
    who || ' vous propose son ' || r.requester_label || ' du ' || to_char(a.day, 'DD/MM') || ' contre votre ' || r.target_label || ' du ' || to_char(b.day, 'DD/MM') || '. Répondez dans « Mon planning ».');
  return r;
end $$;

create or replace function public.respond_swap(p_id uuid, p_accept boolean) returns shift_swaps
language plpgsql security definer set search_path = public as $$
declare r shift_swaps; who text;
begin
  select * into r from shift_swaps where id = p_id for update;
  if r.id is null or r.target_id <> auth.uid() then raise exception 'Échange introuvable.'; end if;
  if r.status <> 'pending_peer' then raise exception 'Cet échange n''attend plus votre réponse.'; end if;
  select full_name into who from profiles where id = r.target_id;
  if p_accept then
    update shift_swaps set status = 'pending_manager', peer_at = now() where id = p_id returning * into r;
    perform public.notify(r.requester_id, 'Échange accepté par votre collègue', who || ' a accepté l''échange du ' || to_char(r.requester_day, 'DD/MM') || '. Il attend la validation de votre manager.');
    perform public.notify(p.id, 'Échange de shifts à valider', (select full_name from profiles where id = r.requester_id) || ' et ' || who || ' : '
                          || to_char(r.requester_day, 'DD/MM') || ' ↔ ' || to_char(r.target_day, 'DD/MM') || '.')
      from profiles p where p.active and p.role in ('manager','assistant') and public.works_in(p.id, r.service_id)
        and coalesce(((select rights from settings where id = r.company_id) -> p.role ->> 'planning')::boolean, false);
  else
    update shift_swaps set status = 'refused', peer_at = now(), refusal_reason = 'Refusé par ' || who where id = p_id returning * into r;
    perform public.notify(r.requester_id, 'Échange refusé', who || ' a refusé l''échange du ' || to_char(r.requester_day, 'DD/MM') || '.');
  end if;
  return r;
end $$;

create or replace function public.cancel_swap(p_id uuid) returns shift_swaps
language plpgsql security definer set search_path = public as $$
declare r shift_swaps;
begin
  select * into r from shift_swaps where id = p_id for update;
  if r.id is null or (r.requester_id <> auth.uid() and not public.can('planning', r.service_id)) then raise exception 'Échange introuvable.'; end if;
  if r.status not in ('pending_peer','pending_manager') then raise exception 'Cet échange est déjà terminé.'; end if;
  update shift_swaps set status = 'cancelled', decided_at = now(), decided_by = auth.uid() where id = p_id returning * into r;
  if r.status = 'cancelled' and r.requester_id = auth.uid() then
    perform public.notify(r.target_id, 'Échange annulé', 'L''échange proposé pour le ' || to_char(r.target_day, 'DD/MM') || ' a été annulé.');
  end if;
  return r;
end $$;

-- Validation par le manager ou l'assistant (droit « planning ») : les deux shifts changent de salarié
create or replace function public.decide_swap(p_id uuid, p_approve boolean, p_reason text default null) returns shift_swaps
language plpgsql security definer set search_path = public as $$
declare r shift_swaps; a shifts; b shifts; dn text := coalesce((select nullif(full_name, '') from profiles where id = auth.uid()), 'la direction');
begin
  select * into r from shift_swaps where id = p_id for update;
  if r.id is null or not public.can('planning', r.service_id) then raise exception 'Vous ne pouvez pas valider cet échange.'; end if;
  if r.status <> 'pending_manager' then raise exception 'Cet échange n''attend pas de validation.'; end if;
  if not p_approve then
    if coalesce(trim(p_reason), '') = '' then raise exception 'Indiquez le motif du refus.'; end if;
    update shift_swaps set status = 'refused', decided_by = auth.uid(), decided_at = now(), refusal_reason = trim(p_reason) where id = p_id returning * into r;
    perform public.notify(x, 'Échange refusé', 'L''échange ' || to_char(r.requester_day, 'DD/MM') || ' ↔ ' || to_char(r.target_day, 'DD/MM') || ' a été refusé par ' || dn || ' : ' || r.refusal_reason || '.')
      from unnest(array[r.requester_id, r.target_id]) x;
    return r;
  end if;
  select * into a from shifts where id = r.requester_shift_id for update;
  select * into b from shifts where id = r.target_shift_id for update;
  if a.id is null or b.id is null or a.employee_id <> r.requester_id or b.employee_id <> r.target_id or a.day <> r.requester_day or b.day <> r.target_day then
    raise exception 'Le planning a changé depuis la demande : l''échange ne peut plus être appliqué. Refusez-le et demandez-en un nouveau.';
  end if;
  -- échange des salariés sur les deux shifts, puis contrôle (repos minimum, chevauchement) sur la situation finale
  perform set_config('hpg.silent', '1', true);
  perform set_config('hpg.propagate', '1', true);
  update shifts set employee_id = r.target_id where id = a.id;
  update shifts set employee_id = r.requester_id where id = b.id;
  perform set_config('hpg.propagate', '0', true);
  update shifts set employee_id = employee_id where id in (a.id, b.id);
  perform set_config('hpg.silent', '0', true);
  update shift_swaps set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id returning * into r;
  perform public.notify(x, 'Échange de shifts validé', 'Échange ' || to_char(r.requester_day, 'DD/MM') || ' ↔ ' || to_char(r.target_day, 'DD/MM') || ' validé par ' || dn || ' : votre planning est mis à jour.')
    from unnest(array[r.requester_id, r.target_id]) x;
  return r;
end $$;

-- ---------- Retours : bugs et améliorations (tableau de bord) ----------
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  company_id smallint references public.companies on delete cascade,
  author_id uuid default auth.uid() references public.profiles on delete set null,
  parent_id bigint references public.feedback on delete cascade,
  kind text not null default 'idea' check (kind in ('bug','idea','question','reply')),
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'open' check (status in ('open','in_progress','done','wontfix')),
  view text,
  created_at timestamptz not null default now()
);
create index if not exists feedback_company on public.feedback (company_id, created_at desc);
alter table public.feedback enable row level security;
drop policy if exists "double authentification" on public.feedback;
drop policy if exists "retours lecture" on public.feedback;
create policy "double authentification" on public.feedback as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());
create policy "retours lecture" on public.feedback for select to authenticated
  using (public.is_dev() or (company_id = public.my_company() and public.my_role() in ('admin','manager','assistant')));

create or replace function public.post_feedback(p_kind text, p_body text, p_parent bigint default null, p_view text default null) returns feedback
language plpgsql security definer set search_path = public as $$
declare r feedback; par feedback; me profiles;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.role not in ('developer','admin','manager','assistant') or not me.active then raise exception 'Réservé à l''encadrement.'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Écrivez votre message.'; end if;
  if p_parent is not null then
    select * into par from feedback where id = p_parent;
    if par.id is null or par.parent_id is not null or (not public.is_dev() and par.company_id is distinct from public.my_company()) then raise exception 'Message introuvable.'; end if;
    insert into feedback (company_id, author_id, parent_id, kind, body) values (par.company_id, me.id, par.id, 'reply', trim(p_body)) returning * into r;
    if me.role = 'developer' then
      perform public.notify(par.author_id, 'Réponse du développeur', left(trim(p_body), 140));
    else
      perform public.notify(d.id, 'Retour HPG : nouvelle réponse', coalesce(me.full_name, '') || ' : ' || left(trim(p_body), 120)) from profiles d where d.role = 'developer' and d.active;
    end if;
  else
    if p_kind not in ('bug','idea','question') then raise exception 'Type inconnu.'; end if;
    insert into feedback (company_id, author_id, kind, body, view) values (public.my_company(), me.id, p_kind, trim(p_body), left(p_view, 40)) returning * into r;
    perform public.notify(d.id, case p_kind when 'bug' then 'Retour HPG : bug signalé' when 'idea' then 'Retour HPG : amélioration proposée' else 'Retour HPG : question' end,
                          coalesce(me.full_name, '') || ' : ' || left(trim(p_body), 120))
      from profiles d where d.role = 'developer' and d.active and d.id <> me.id;
  end if;
  return r;
end $$;

create or replace function public.set_feedback_status(p_id bigint, p_status text) returns feedback
language plpgsql security definer set search_path = public as $$
declare r feedback;
begin
  if not public.is_dev() then raise exception 'Réservé au développeur.'; end if;
  update feedback set status = p_status where id = p_id and parent_id is null returning * into r;
  if r.id is null then raise exception 'Message introuvable.'; end if;
  perform public.notify(r.author_id, 'Votre retour HPG : ' || case p_status when 'open' then 'rouvert' when 'in_progress' then 'en cours' when 'done' then 'traité' else 'non retenu' end, left(r.body, 140));
  return r;
end $$;

revoke execute on function public.swap_label(shifts) from anon, public, authenticated;
do $$ declare f text; begin
  foreach f in array array['swap_candidates(uuid)','create_swap(uuid, uuid, text)','respond_swap(uuid, boolean)','cancel_swap(uuid)','decide_swap(uuid, boolean, text)',
                           'post_feedback(text, text, bigint, text)','set_feedback_status(bigint, text)'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- Tableau de bord : personnel par type de contrat (effectif ayant travaillé, jours, heures) ----------
create or replace function public.staff_mix(p_from date, p_to date)
returns table (service_id smallint, contract_type text, people bigint, shifts bigint, minutes bigint)
language sql stable security definer set search_path = public as $$
  with st as (select coalesce(break_threshold_min, 360) as th, coalesce(break_min, 30) as br from settings where id = public.my_company()),
  w as (
    select s.service_id, s.employee_id, p.contract_type, s.break_min as eb,
           (extract(epoch from s.end_time)::int / 60 + case when s.end_time <= s.start_time then 1440 else 0 end) - extract(epoch from s.start_time)::int / 60 as gross
    from shifts s join profiles p on p.id = s.employee_id
    where s.kind = 'work' and s.day between p_from and p_to and public.staff_of(s.service_id))
  select w.service_id, w.contract_type, count(distinct w.employee_id), count(*),
         sum(w.gross - least(w.gross, coalesce(w.eb, case when w.gross > st.th then st.br else 0 end)))::bigint
  from w, st
  group by w.service_id, w.contract_type
$$;
revoke execute on function public.staff_mix(date, date) from anon, public;
grant execute on function public.staff_mix(date, date) to authenticated;

-- Notifications de décision : avec le nom de la personne qui a décidé
create or replace function public.decide_request(p_id uuid, p_approve boolean, p_reason text default null)
returns requests language plpgsql security definer set search_path = public as $$
declare r requests; lbl text;
begin
  select * into r from requests where id = p_id for update;
  if r.id is null or not public.in_my_company(r.service_id) then raise exception 'Demande introuvable.'; end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then raise exception 'Indiquez le motif du refus.'; end if;
  lbl := public.type_label(r.type) || ' du ' || to_char(r.start_date, 'DD/MM') || ' au ' || to_char(r.end_date, 'DD/MM');

  if r.status = 'pending_manager' then
    if not public.can('requests', r.service_id) then raise exception 'Vous ne gérez pas les demandes de ce service.'; end if;
    if r.employee_id = auth.uid() and not public.is_admin() then raise exception 'Vous ne pouvez pas valider votre propre demande.'; end if;
    -- la demande d'un manager ou d'un assistant est validée par l'administrateur
    if not public.is_admin() and (select role from profiles where id = r.employee_id) in ('manager','assistant','admin') then
      raise exception 'Les demandes de l''encadrement sont validées par l''administrateur.';
    end if;
    update requests set manager_id = auth.uid(), manager_at = now() where id = r.id;
    if not p_approve then
      update requests set status = 'refused', refusal_reason = p_reason where id = r.id;
      if public.notify_on('decision') then perform public.notify(r.employee_id, 'Demande refusée par ' || coalesce((select nullif(full_name, '') from profiles where id = auth.uid()), 'la direction'), lbl || ' — ' || p_reason); end if;
    elsif r.type = 'cp' and not public.is_admin() then
      update requests set status = 'pending_admin' where id = r.id;
      if public.notify_on('decision') then
        perform public.notify(r.employee_id, 'Demande validée par ' || coalesce((select nullif(full_name, '') from profiles where id = auth.uid()), 'la direction'), lbl || ' : en attente de la validation finale de la direction.');
        insert into notifications (user_id, title, body)
        select id, 'Congés à valider', lbl || ' — validé par le manager.' from profiles where role = 'admin' and active and has_account and company_id = public.svc_company(r.service_id);
      end if;
    else
      update requests set status = 'approved', admin_id = case when r.type = 'cp' then auth.uid() end,
                          admin_at = case when r.type = 'cp' then now() end where id = r.id;
      select * into r from requests where id = p_id;
      perform public.apply_request(r);
      if public.notify_on('decision') then perform public.notify(r.employee_id, 'Demande acceptée par ' || coalesce((select nullif(full_name, '') from profiles where id = auth.uid()), 'la direction'), lbl); end if;
    end if;

  elsif r.status = 'pending_admin' then
    if not public.is_admin() then raise exception 'Seul l''administrateur peut donner la validation finale.'; end if;
    update requests set admin_id = auth.uid(), admin_at = now() where id = r.id;
    if p_approve then
      update requests set status = 'approved' where id = r.id;
      select * into r from requests where id = p_id;
      perform public.apply_request(r);
      if public.notify_on('decision') then perform public.notify(r.employee_id, 'Congés acceptés', lbl); end if;
    else
      update requests set status = 'refused', refusal_reason = p_reason where id = r.id;
      if public.notify_on('decision') then perform public.notify(r.employee_id, 'Congés refusés', lbl || ' — ' || p_reason); end if;
    end if;
  else
    raise exception 'Cette demande a déjà été traitée.';
  end if;
  select * into r from requests where id = p_id;
  return r;
end $$;
