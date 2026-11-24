-- =====================================================================
--  ÉCHANGES DE SHIFTS : activés pour les salariés dans tous les établissements.
--  (Désactivable ensuite dans Paramètres → Droits → Salarié.)
-- =====================================================================
update public.settings
   set rights = jsonb_set(coalesce(rights, '{}'::jsonb), '{employee}', coalesce(rights -> 'employee', '{}'::jsonb) || '{"swaps":true}'::jsonb, true);
