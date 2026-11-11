// HPG — fonction « manage-user » (Supabase Edge Function)
// Permet au développeur, à l'administrateur (et à l'encadrement ayant le droit « équipe » pour ses services) de créer les comptes de connexion
// (e-mail + mot de passe) et de redéfinir un mot de passe. Aucune inscription libre n'est nécessaire.
//
// Déploiement : Supabase > Edge Functions > Deploy a new function > Via Editor > nom « manage-user ».
// Laisser « Enforce JWT verification » ACTIVÉ : seule une personne connectée peut l'appeler.
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const asCaller = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } } });
    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

    const { data: u } = await asCaller.auth.getUser();
    if (!u?.user) return json({ error: "Connexion requise." }, 401);
    const { data: me } = await admin.from("profiles").select("id, role, service_id, active, company_id").eq("id", u.user.id).single();
    if (!me || !me.active || !["developer", "admin", "manager", "assistant"].includes(me.role)) return json({ error: "Réservé à l'encadrement." }, 403);

    const b = await req.json();
    const pw = String(b.password ?? "");
    if (pw.length < 8) return json({ error: "Le mot de passe doit contenir au moins 8 caractères." }, 400);

    const isAdmin = ["admin", "developer"].includes(me.role);
    // tout se passe dans l'entreprise de la personne connectée (développeur : l'entreprise ouverte)
    const company = me.company_id;
    if (!company) return json({ error: "Aucune entreprise ouverte." }, 400);
    const { data: st } = await admin.from("settings").select("rights").eq("id", company).single();
    const { data: coSvcRows } = await admin.from("services").select("id").eq("company_id", company);
    const coSvcs = (coSvcRows ?? []).map((r: { id: number }) => r.id);
    const { data: mySvcRows } = await admin.from("profile_services").select("service_id").eq("profile_id", me.id);
    const mySvcs = (mySvcRows ?? []).map((r: { service_id: number }) => r.service_id);
    const canTeam = (svc: number) => coSvcs.includes(svc) && (isAdmin || (["manager", "assistant"].includes(me.role) && mySvcs.includes(svc) && !!st?.rights?.[me.role]?.team));

    if (b.action === "create") {
      const email = String(b.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Adresse e-mail invalide." }, 400);
      if (!b.hire_date) return json({ error: "La date d'entrée est obligatoire." }, 400);
      const role = isAdmin ? (["employee", "assistant", "manager", "admin"].includes(b.role) ? b.role : "employee") : "employee";
      const services: number[] = (Array.isArray(b.services) ? b.services : [b.service_id]).map(Number).filter(Boolean);
      const service_id = Number(b.service_id) || services[0] || null;
      if (role !== "admin" && !service_id) return json({ error: "Choisissez un service." }, 400);
      if (role === "admin" && service_id && !coSvcs.includes(service_id)) return json({ error: "Service d'une autre entreprise." }, 403);
      for (const s of services.concat(service_id ? [service_id] : [])) if (!canTeam(s)) return json({ error: "Vous ne gérez pas tous ces services." }, 403);

      // 1) fiche du salarié (reliée automatiquement au compte par la base à l'étape 2)
      const { data: existing } = await admin.from("profiles").select("id, has_account, company_id").ilike("email", email).maybeSingle();
      if (existing?.has_account) return json({ error: "Un compte existe déjà avec cet e-mail." }, 409);
      if (existing && existing.company_id && existing.company_id !== company) return json({ error: "Cet e-mail appartient à une autre entreprise." }, 409);
      let created = false;
      const fiche = {
        full_name: String(b.full_name ?? "").trim(), role, service_id, company_id: company,
        location: b.location || null, job_title: b.job_title || null, weekly_rest: Array.isArray(b.weekly_rest) ? b.weekly_rest : [],
        contract_type: b.contract_type ?? "cdi", contract_hours: Number(b.contract_hours) || 39, hire_date: b.hire_date,
      };
      let profileId = existing?.id;
      if (!existing) {
        const { data: ins, error } = await admin.from("profiles").insert({ email, has_account: false, ...fiche }).select("id").single();
        if (error) return json({ error: error.message }, 400);
        profileId = ins.id; created = true;
      } else if (isAdmin) {
        await admin.from("profiles").update(fiche).eq("id", existing.id);
      }
      if (services.length) await admin.from("profile_services").upsert(services.map((s) => ({ profile_id: profileId, service_id: s })));
      // 2) compte de connexion (e-mail déjà confirmé)
      const { data: nu, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: b.full_name ?? "" } });
      if (error) {
        if (created) await admin.from("profiles").delete().ilike("email", email).eq("has_account", false);
        return json({ error: /already/i.test(error.message) ? "Un compte existe déjà avec cet e-mail." : error.message }, 400);
      }
      return json({ ok: true, id: nu.user?.id });
    }

    if (b.action === "set_password") {
      const { data: t } = await admin.from("profiles").select("id, email, role, service_id, has_account, full_name, company_id").eq("id", b.profile_id).single();
      if (!t || (t.id !== me.id && t.company_id !== company)) return json({ error: "Salarié introuvable." }, 404);
      if (t.role === "developer" && t.id !== me.id) return json({ error: "Salarié introuvable." }, 404);
      // hiérarchie : développeur > administrateur > manager > assistant > salarié ; on ne change que le mot de passe d'un rang inférieur,
      // et manager / assistant seulement pour les personnes de leurs services
      const RANK: Record<string, number> = { pending: 0, employee: 1, assistant: 2, manager: 3, admin: 4, developer: 5 };
      if (t.id !== me.id && me.role !== "developer") {
        if (!((RANK[me.role] ?? 0) > (RANK[t.role] ?? 0))) return json({ error: "Vous ne pouvez pas changer le mot de passe d'un rôle égal ou supérieur au vôtre." }, 403);
        if (me.role === "admin" && st?.rights?.admin?.passwords === false) return json({ error: "Droit retiré par le développeur." }, 403);
        if (me.role !== "admin") {
          const { data: tSvc } = await admin.from("profile_services").select("service_id").eq("profile_id", t.id);
          if (!(tSvc ?? []).some((r: { service_id: number }) => mySvcs.includes(r.service_id))) return json({ error: "Cette personne n'est pas dans vos services." }, 403);
        }
      }
      if (t.has_account) {
        const { error } = await admin.auth.admin.updateUserById(t.id, { password: pw });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      if (!t.email) return json({ error: "Renseignez d'abord l'e-mail du salarié." }, 400);
      const { error } = await admin.auth.admin.createUser({ email: t.email, password: pw, email_confirm: true, user_metadata: { full_name: t.full_name } });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, created: true });
    }

    return json({ error: "Action inconnue." }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
