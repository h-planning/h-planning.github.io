-- =====================================================================
--  NOTIFICATIONS SUR TÉLÉPHONE (push) : chaque nouvelle notification d'un salarié qui a activé les alertes
--  sur son téléphone est envoyée à la fonction « notify » (clés VAPID créées par l'action GitHub, jamais dans le dépôt).
-- =====================================================================
do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net indisponible : %', sqlerrm; end $$;

create table if not exists public.app_config (key text primary key, value text);
alter table public.app_config enable row level security;
drop policy if exists "config publique" on public.app_config;
create policy "config publique" on public.app_config for select to authenticated using (key in ('vapid_public_key'));

-- appelée une seule fois par l'action GitHub : clé publique (lisible par l'application) + mot de passe du webhook (coffre Supabase)
create or replace function public.hpg_set_push_config(p_pub text, p_hook text) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  insert into app_config values ('vapid_public_key', p_pub) on conflict (key) do update set value = excluded.value;
  select id into sid from vault.secrets where name = 'hpg_webhook';
  if sid is null then perform vault.create_secret(p_hook, 'hpg_webhook'); else perform vault.update_secret(sid, p_hook); end if;
end $$;
revoke execute on function public.hpg_set_push_config(text, text) from public, anon, authenticated;

create or replace function public.notifications_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare url text; hook text;
begin
  if not exists (select 1 from push_subscriptions where user_id = new.user_id) then return null; end if;
  select value into url from app_config where key = 'functions_url';
  if url is null then return null; end if;
  begin
    select decrypted_secret into hook from vault.decrypted_secrets where name = 'hpg_webhook';
    if hook is null then return null; end if;
    perform net.http_post(url := url || '/notify',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', hook),
      body := jsonb_build_object('record', to_jsonb(new)));
  exception when others then raise warning 'push non envoyé : %', sqlerrm;   -- la notification reste dans HPG
  end;
  return null;
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications for each row execute function public.notifications_push();

insert into public.app_config values ('functions_url', 'https://ndghmjbiztusgmgamfaa.supabase.co/functions/v1') on conflict (key) do update set value = excluded.value;

-- Notification de publication : service, mois en français et nom de la personne qui publie
create or replace function public.publish_month(p_service smallint, p_month date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can('publish', p_service) then raise exception 'Vous n''avez pas le droit de publier ce service.'; end if;
  insert into published_months (service_id, month) values (p_service, public.month_of(p_month))
  on conflict do nothing;
  if public.notify_on('publish') then
    insert into notifications (user_id, title, body)
    select p.id, 'Planning publié', 'Le planning ' || (select name from services where id = p_service) || ' de '
           || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from p_month)::int]
           || ' ' || extract(year from p_month)::int || ' est disponible (publié par '
           || coalesce((select nullif(full_name, '') from profiles where id = auth.uid()), 'la direction') || ').'
    from profiles p where p.active and p.has_account and p.role in ('employee','assistant','manager') and public.works_in(p.id, p_service);
  end if;
end $$;
