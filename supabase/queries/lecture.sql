-- requête de lecture ponctuelle (aucun nom affiché)
select r.id, r.type, r.start_date, r.end_date, r.status, r.created_at::date as cree_le, (r.created_by = r.employee_id) as faite_par_salariee,
       (select count(*) from public.shifts s where s.request_id = r.id) as jours_poses,
       (select count(*) from public.profiles where full_name ilike '%inès%' or full_name ilike '%ines%') as personnes_ines
from public.requests r join public.profiles p on p.id = r.employee_id
where p.full_name ilike '%inès%' or p.full_name ilike '%ines%'
order by r.created_at desc;
