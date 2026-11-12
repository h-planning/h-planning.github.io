// HPG — fonction « manage-user » (Supabase Edge Function)
// Permet au développeur, à l'administrateur (et à l'encadrement ayant le droit « équipe » pour ses services) de créer les comptes de connexion
// et de redonner un accès. Le mot de passe n'est jamais choisi ni envoyé par e-mail : la fonction génère un CODE PROVISOIRE unique,
// renvoyé une seule fois à la personne qui crée l'accès (elle le remet en main propre) ; à la 1re connexion, le salarié choisit son mot de passe.
// À l'ouverture d'un accès, le salarié reçoit un e-mail avec le lien du site et son identifiant (si l'envoi est configuré, voir plus bas).
//
// Envoi des e-mails (facultatif) — Edge Functions > Secrets :
//   SMTP_HOST (ex. smtp.gmail.com), SMTP_PORT (465), SMTP_USER (adresse d'envoi), SMTP_PASS (mot de passe d'application), MAIL_FROM (ex. HPG <adresse>)
//   APP_URL (facultatif : sinon l'adresse du site d'où vient la demande)
//
// Déploiement : Supabase > Edge Functions > Deploy a new function > Via Editor > nom « manage-user ».
// Laisser « Enforce JWT verification » ACTIVÉ : seule une personne connectée peut l'appeler.
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.16";

// code provisoire : 8 caractères sans ambiguïté (pas de 0/O, 1/I/L), présenté XXXX-XXXX
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function genCode() {
  const r = new Uint32Array(8); crypto.getRandomValues(r);
  const c = Array.from(r, (x) => ALPHA[x % ALPHA.length]).join("");
  return c.slice(0, 4) + "-" + c.slice(4);
}
const escH = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// e-mail d'ouverture d'accès : lien + identifiant (jamais le mot de passe)
async function sendWelcome(to: string, name: string, hotel: string, url: string, by: string): Promise<{ mailed: boolean; mail_error?: string }> {
  const host = Deno.env.get("SMTP_HOST"), user = Deno.env.get("SMTP_USER"), pass = Deno.env.get("SMTP_PASS");
  if (!host || !user || !pass) return { mailed: false, mail_error: "not_configured" };
  const port = Number(Deno.env.get("SMTP_PORT") || 465);
  const from = Deno.env.get("MAIL_FROM") || `HPG <${user}>`;
  const subject = `Votre accès au planning — ${hotel}`;
  const text = `Bonjour ${name},\n\nVotre accès au planning de ${hotel} est ouvert.\n\nSite : ${url}\nIdentifiant : ${to}\nMot de passe : le code provisoire que ${by} vous remet en main propre.\n\nÀ la première connexion, vous choisirez votre propre mot de passe.\nConseil : sur votre téléphone, ajoutez le site à l'écran d'accueil.\n\nCet e-mail est automatique, merci de ne pas y répondre.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1b2433;max-width:520px">
<p>Bonjour ${escH(name)},</p><p>Votre accès au planning de <b>${escH(hotel)}</b> est ouvert.</p>
<p style="margin:22px 0"><a href="${escH(url)}" style="background:#1b2433;color:#f3d58a;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Ouvrir le planning</a></p>
<table style="font-size:15px;border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#667">Site</td><td><a href="${escH(url)}">${escH(url)}</a></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#667">Identifiant</td><td><b>${escH(to)}</b></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#667">Mot de passe</td><td>le code provisoire que ${escH(by)} vous remet en main propre</td></tr></table>
<p>À la première connexion, vous choisirez votre propre mot de passe.<br>Conseil : sur votre téléphone, ajoutez le site à l'écran d'accueil.</p>
<p style="color:#889;font-size:12px">E-mail automatique, merci de ne pas y répondre.</p></div>`;
  try {
    const tr = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    await tr.sendMail({ from, to, subject, text, html });
    return { mailed: true };
  } catch (e) {
    return { mailed: false, mail_error: String((e as Error).message ?? e).slice(0, 200) };
  }
}

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
    const pw = genCode();   // code provisoire : jamais choisi par l'encadrement, jamais envoyé par e-mail

    const isAdmin = ["admin", "developer"].includes(me.role);
    // tout se passe dans l'entreprise de la personne connectée (développeur : l'entreprise ouverte)
    const company = me.company_id;
    if (!company) return json({ error: "Aucune entreprise ouverte." }, 400);
    const { data: st } = await admin.from("settings").select("rights").eq("id", company).single();
    const { data: coSvcRows } = await admin.from("services").select("id").eq("company_id", company);
    const coSvcs = (coSvcRows ?? []).map((r: { id: number }) => r.id);
    const { data: mySvcRows } = await admin.from("profile_services").select("service_id").eq("profile_id", me.id);
    const mySvcs = (mySvcRows ?? []).map((r: { service_id: number }) => r.service_id);
    const { data: meFull } = await admin.from("profiles").select("full_name").eq("id", me.id).single();
    const { data: hs } = await admin.from("settings").select("hotel_name").eq("id", company).single();
    const hotel = hs?.hotel_name || "votre établissement";
    const appUrl = Deno.env.get("APP_URL") || (req.headers.get("origin") || "").replace(/\/$/, "") + "/";
    const byName = meFull?.full_name || "votre responsable";
    const welcome = (to: string, name: string) => sendWelcome(to, name || "", hotel, appUrl, byName);
    const mustChange = (id: string) => admin.from("profiles").update({ must_change_pw: true }).eq("id", id);
    const canTeam = (svc: number) => coSvcs.includes(svc) && (isAdmin || (["manager", "assistant"].includes(me.role) && mySvcs.includes(svc) && !!st?.rights?.[me.role]?.team));

    // essai d'envoi : e-mail de bienvenue adressé à soi-même (développeur / administrateur)
    if (b.action === "test_mail") {
      if (!isAdmin) return json({ error: "Réservé à la direction." }, 403);
      const { data: mine } = await admin.from("profiles").select("email, full_name").eq("id", me.id).single();
      if (!mine?.email) return json({ error: "Votre fiche n'a pas d'e-mail." }, 400);
      return json({ ok: true, email: mine.email, ...(await welcome(mine.email, mine.full_name)) });
    }

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
      if (nu.user?.id) await mustChange(nu.user.id);
      const m = await welcome(email, fiche.full_name);
      return json({ ok: true, id: nu.user?.id, temp_password: pw, email, ...m });
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
        await mustChange(t.id);
        return json({ ok: true, temp_password: pw, email: t.email, mailed: false });
      }
      if (!t.email) return json({ error: "Renseignez d'abord l'e-mail du salarié." }, 400);
      const { data: nu2, error } = await admin.auth.admin.createUser({ email: t.email, password: pw, email_confirm: true, user_metadata: { full_name: t.full_name } });
      if (error) return json({ error: error.message }, 400);
      if (nu2.user?.id) await mustChange(nu2.user.id);   // la fiche prend l'identifiant du compte créé
      const m = await welcome(t.email, t.full_name);
      return json({ ok: true, created: true, temp_password: pw, email: t.email, ...m });
    }

    return json({ error: "Action inconnue." }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
