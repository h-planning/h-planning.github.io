-- =====================================================================
--  RECOPIE D'UN AUTRE PLANNING (Housekeeping) : les shifts d'un autre service dont le nom contient un mot
--  (ex. « Direction » au planning Réception) s'affichent à l'identique, en lecture seule, dans une localisation
--  du planning (ex. DIRECTION). Réglage : services.staffing -> 'mirror' = {"from": <service>, "match": "direction", "location": "DIRECTION"}.
--  Rien n'est copié dans la base : aucun double compte d'heures, de présence ou de fiche.
-- =====================================================================
create or replace function public.mirror_shifts(p_svc smallint, p_from date, p_to date)
returns table (id uuid, employee_id uuid, full_name text, service_id smallint, day date, kind text, template_id smallint,
               start_time time, end_time time, break_min smallint, color text, label text, note text, location text)
language sql stable security definer set search_path = public as $$
  with m as (
    select (sv.staffing -> 'mirror' ->> 'from')::smallint as src,
           '%' || (sv.staffing -> 'mirror' ->> 'match') || '%' as pat,
           coalesce(nullif(trim(sv.staffing -> 'mirror' ->> 'location'), ''), 'DIRECTION') as loc
    from services sv
    where sv.id = p_svc and public.staff_of(p_svc)
      and coalesce(sv.staffing -> 'mirror' ->> 'from', '') ~ '^[0-9]+$'
      and coalesce(trim(sv.staffing -> 'mirror' ->> 'match'), '') <> '')
  select s.id, s.employee_id, p.full_name, s.service_id, s.day, s.kind, s.template_id, s.start_time, s.end_time, s.break_min, s.color, s.label, s.note, m.loc
  from m
  join shifts s on s.service_id = m.src
  join profiles p on p.id = s.employee_id
  left join shift_templates t on t.id = s.template_id
  where m.src <> p_svc
    and public.svc_company(m.src) = public.svc_company(p_svc)
    and s.day between p_from and p_to
    and s.kind = 'work'
    and (t.name ilike m.pat or s.label ilike m.pat)
  order by s.day, s.start_time
$$;
revoke execute on function public.mirror_shifts(smallint, date, date) from anon, public;
grant execute on function public.mirror_shifts(smallint, date, date) to authenticated;
-- Housekeeping : recopie des shifts « Direction » du planning Réception dans la localisation DIRECTION
update public.services h set
  staffing = coalesce(h.staffing, '{"inputs":[],"combine":"max","tiers":[],"base":null}'::jsonb)
             || jsonb_build_object('mirror', jsonb_build_object('from', r.id, 'match', 'direction', 'location', 'DIRECTION')),
  locations = case when exists (select 1 from unnest(h.locations) l where upper(l) = 'DIRECTION') then h.locations else array_prepend('DIRECTION', h.locations) end
from public.services r
where h.name ilike 'housekeeping' and r.company_id = h.company_id and r.name ilike 'r_ception'
  and not coalesce(h.staffing ? 'mirror', false);
