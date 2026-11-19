-- =====================================================================
--  ÉCHANGES DE SHIFTS : aussi pour les assistants (droit « swaps » du rôle Assistant, activé par défaut).
--  Un échange qui concerne un assistant est validé par le manager ou l'administrateur, jamais par un assistant ;
--  personne ne valide un échange dont il fait partie.
-- =====================================================================
update public.settings set rights = rights || jsonb_build_object('assistant', '{"swaps":true}'::jsonb || coalesce(rights -> 'assistant', '{}'));

create or replace function public.swap_allowed(p_svc smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.my_role()
    when 'employee' then public.employee_right('swaps')
    when 'assistant' then public.can('swaps', p_svc)
    else false end
$$;
revoke execute on function public.swap_allowed(smallint) from public, anon;
grant execute on function public.swap_allowed(smallint) to authenticated;

create or replace function public.swap_candidates(p_shift uuid)
returns table (shift_id uuid, employee_id uuid, full_name text, day date, kind text, start_time time, end_time time, label text, color text, template_id smallint)
language plpgsql stable security definer set search_path = public as $$
declare s shifts;
begin
  select * into s from shifts where id = p_shift;
  if s.id is null or s.employee_id <> auth.uid() or not public.swap_allowed(s.service_id) then return; end if;
  return query
    select o.id, o.employee_id, p.full_name, o.day, o.kind, o.start_time, o.end_time, o.label, o.color, o.template_id
    from shifts o join profiles p on p.id = o.employee_id
    where o.service_id = s.service_id and o.employee_id <> s.employee_id and p.active and p.role in ('employee','assistant')
      and o.kind in ('work','repos') and o.request_id is null and not o.jour_sup and not o.jour_rendu
      and o.day between greatest(current_date + 1, s.day - 21) and s.day + 21
      and public.is_published(o.service_id, o.day)
    order by o.day, p.full_name;
end $$;

create or replace function public.create_swap(p_shift uuid, p_target_shift uuid, p_note text default null) returns shift_swaps
language plpgsql security definer set search_path = public as $$
declare a shifts; b shifts; r shift_swaps; who text;
begin
  select * into a from shifts where id = p_shift;
  select * into b from shifts where id = p_target_shift;
  if a.id is null or a.employee_id <> auth.uid() then raise exception 'Choisissez un de vos shifts.'; end if;
  if not public.swap_allowed(a.service_id) then raise exception 'Les échanges de shifts ne sont pas activés pour votre compte.'; end if;
  if b.id is null or b.employee_id = auth.uid() then raise exception 'Choisissez le shift d''un collègue.'; end if;
  if (select role from profiles where id = b.employee_id) not in ('employee','assistant') then raise exception 'L''échange se fait avec un salarié ou un assistant du service.'; end if;
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

-- un assistant est-il concerné par l'échange ? (alors seuls le manager et l'administrateur valident)
create or replace function public.swap_has_assistant(r shift_swaps) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id in (r.requester_id, r.target_id) and role = 'assistant')
$$;
revoke execute on function public.swap_has_assistant(shift_swaps) from public, anon, authenticated;

create or replace function public.respond_swap(p_id uuid, p_accept boolean) returns shift_swaps
language plpgsql security definer set search_path = public as $$
declare r shift_swaps; who text; asst boolean;
begin
  select * into r from shift_swaps where id = p_id for update;
  if r.id is null or r.target_id <> auth.uid() then raise exception 'Échange introuvable.'; end if;
  if r.status <> 'pending_peer' then raise exception 'Cet échange n''attend plus votre réponse.'; end if;
  select full_name into who from profiles where id = r.target_id;
  if p_accept then
    update shift_swaps set status = 'pending_manager', peer_at = now() where id = p_id returning * into r;
    asst := public.swap_has_assistant(r);
    perform public.notify(r.requester_id, 'Échange accepté par ' || who, who || ' a accepté l''échange du ' || to_char(r.requester_day, 'DD/MM') || '. Il attend la validation ' || case when asst then 'du manager.' else 'de votre manager.' end);
    perform public.notify(p.id, 'Échange de shifts à valider', (select full_name from profiles where id = r.requester_id) || ' et ' || who || ' : '
                          || to_char(r.requester_day, 'DD/MM') || ' ↔ ' || to_char(r.target_day, 'DD/MM') || '.')
      from profiles p where p.active and p.id not in (r.requester_id, r.target_id) and public.works_in(p.id, r.service_id)
        and (p.role = 'manager' or (p.role = 'assistant' and not asst))
        and coalesce(((select rights from settings where id = r.company_id) -> p.role ->> 'planning')::boolean, false);
  else
    update shift_swaps set status = 'refused', peer_at = now(), refusal_reason = 'Refusé par ' || who where id = p_id returning * into r;
    perform public.notify(r.requester_id, 'Échange refusé par ' || who, who || ' a refusé l''échange du ' || to_char(r.requester_day, 'DD/MM') || '.');
  end if;
  return r;
end $$;

create or replace function public.decide_swap(p_id uuid, p_approve boolean, p_reason text default null) returns shift_swaps
language plpgsql security definer set search_path = public as $$
declare r shift_swaps; a shifts; b shifts; dn text := coalesce((select nullif(full_name, '') from profiles where id = auth.uid()), 'la direction');
begin
  select * into r from shift_swaps where id = p_id for update;
  if r.id is null or not public.can('planning', r.service_id) then raise exception 'Vous ne pouvez pas valider cet échange.'; end if;
  if auth.uid() in (r.requester_id, r.target_id) then raise exception 'Vous ne pouvez pas valider un échange dont vous faites partie.'; end if;
  if public.my_role() = 'assistant' and public.swap_has_assistant(r) then raise exception 'Un échange qui concerne un assistant est validé par le manager ou l''administrateur.'; end if;
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
