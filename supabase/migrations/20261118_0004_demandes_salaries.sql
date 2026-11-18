-- Le salarié peut faire lui-même ses demandes de congés si l'option est activée (Paramètres → Droits des rôles → Salarié : « requests »)
create or replace function public.requests_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare me profiles; p profiles; pending numeric; dl smallint; otb int;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.role = 'pending' or not me.active then raise exception 'Compte non activé.'; end if;
  new.employee_id := coalesce(new.employee_id, me.id);
  select * into p from profiles where id = new.employee_id;
  if p.id is null then raise exception 'Salarié introuvable.'; end if;
  new.service_id := coalesce(p.service_id, (select min(service_id) from profile_services where profile_id = p.id));
  if new.service_id is null then raise exception 'Ce salarié n''a pas de service.'; end if;
  new.created_by := me.id;
  new.status := 'pending_manager';
  new.manager_id := null; new.admin_id := null; new.manager_at := null; new.admin_at := null;

  -- les demandes sont saisies par l'encadrement (droit « requests ») pour un salarié, ou par le salarié lui-même
  -- si l'option « Faire ses demandes de congés » est activée (Paramètres → Droits des rôles → Salarié).
  -- La demande d'un manager ou d'un assistant est saisie par l'administrateur.
  if p.id = me.id and not public.is_admin() then
    if not (me.role = 'employee' and public.employee_right('requests')) then
      raise exception 'Les demandes sont saisies par votre manager.';
    end if;
  elsif not exists (select 1 from profile_services ps where ps.profile_id = p.id and public.can('requests', ps.service_id)) then
    raise exception 'Vous ne pouvez saisir des demandes que pour les salariés que vous gérez.';
  elsif p.role in ('manager','assistant','admin') and not public.is_admin() then
    raise exception 'La demande d''un membre de l''encadrement est saisie par l''administrateur.';
  end if;

  -- CP en jours ouvrables (2,5 j par mois) : si le lendemain de la fin est le 1er jour de repos du salarié, il est décompté aussi
  if new.type = 'cp' and extract(isodow from new.end_date + 1)::smallint = public.cp_rest_day(p.id) and public.is_ouvrable(new.end_date + 1) then
    new.end_date := new.end_date + 1;
  end if;
  new.days := case when new.type in ('cp') then public.count_ouvrables(new.start_date, new.end_date)
                   else (new.end_date - new.start_date + 1) end;
  if new.days = 0 then raise exception 'La période choisie ne contient aucun jour ouvrable.'; end if;
  select coalesce(sum(days), 0) into pending from requests
   where employee_id = p.id and type = new.type and status in ('pending_manager','pending_admin');
  if new.type = 'cp' and new.days + pending > p.cp_balance then
    raise exception 'Solde de congés insuffisant (% j disponibles, % j déjà demandés).', trim_scale(p.cp_balance), trim_scale(pending);
  elsif new.type = 'ferie' and new.days + pending > p.ferie_balance then
    raise exception 'Solde de jours fériés insuffisant (% j disponibles).', trim_scale(p.ferie_balance);
  elsif new.type = 'recup' and new.days + pending > p.recup_days then
    raise exception 'Pas assez de jours à récupérer (% j dus).', trim_scale(p.recup_days);
  elsif new.type = 'anciennete' and new.days + pending > p.seniority_balance then
    raise exception 'Solde de jours d''ancienneté insuffisant (% j).', trim_scale(p.seniority_balance);
  elsif new.type = 'ot_day' then
    otb := public.ot_balance(p.id);
    if (new.days + pending) * (select ot_day_minutes from settings where id = p.company_id) > otb then
      raise exception 'Solde d''heures supp insuffisant (% disponibles).', to_char(make_interval(mins => greatest(otb, 0)), 'HH24"h"MI');
    end if;
  end if;
  return new;
end $$;
