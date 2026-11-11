// HPG — fonction « notify » (Supabase Edge Function)
// Appelée automatiquement à chaque nouvelle ligne de la table notifications (Database Webhook).
// Envoie : 1) un e-mail via Resend, 2) une notification push sur chaque appareil enregistré.
//
// Secrets à définir dans Supabase > Edge Functions > Secrets :
//   WEBHOOK_SECRET     mot de passe libre, recopié dans l'en-tête du webhook (x-webhook-secret)
//   RESEND_API_KEY     clé API Resend (resend.com)
//   MAIL_FROM          ex. "HPG <planning@votre-domaine.fr>" (domaine vérifié dans Resend)
//   APP_URL            adresse de l'application, ex. https://hpg-hotel.netlify.app
//   VAPID_PUBLIC_KEY   clé publique (outils/cles-push.html)
//   VAPID_PRIVATE_KEY  clé privée (outils/cles-push.html)
//   VAPID_SUBJECT      ex. "mailto:it@votre-domaine.fr"
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const env = (k: string) => Deno.env.get(k) ?? "";

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== env("WEBHOOK_SECRET") || !env("WEBHOOK_SECRET")) {
    return new Response("Accès refusé", { status: 401 });
  }
  const payload = await req.json();
  const n = payload.record;
  if (!n?.user_id) return new Response("Rien à envoyer", { status: 200 });

  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: p } = await sb.from("profiles").select("email, full_name, active").eq("id", n.user_id).single();
  if (!p || !p.active || !p.email) return new Response("Destinataire inactif ou sans e-mail", { status: 200 });

  const report: Record<string, unknown> = {};

  // 1) E-mail
  if (env("RESEND_API_KEY") && env("MAIL_FROM")) {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1B2433;max-width:520px">
      <p style="font-size:18px;margin:0 0 8px"><b>${esc(n.title)}</b></p>
      <p style="margin:0 0 16px">${esc(n.body)}</p>
      ${env("APP_URL") ? `<p><a href="${env("APP_URL")}" style="background:#1B2433;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ouvrir HPG</a></p>` : ""}
      <p style="color:#7A8291;font-size:12px">Message automatique de HPG, l'application de planning de l'équipe.</p></div>`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env("MAIL_FROM"), to: [p.email], subject: `HPG · ${n.title}`, html }),
    });
    report.email = r.status;
  }

  // 2) Push
  if (env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY")) {
    webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:admin@example.com", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
    const { data: subs } = await sb.from("push_subscriptions").select("endpoint, subscription").eq("user_id", n.user_id);
    let sent = 0;
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({ title: n.title, body: n.body, tag: `hpg-${n.id}` }));
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // appareil désinscrit ou abonnement expiré : on le supprime
        if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }
    report.push = sent;
  }

  return new Response(JSON.stringify(report), { headers: { "Content-Type": "application/json" } });
});
