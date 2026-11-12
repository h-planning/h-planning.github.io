/* HPG (Hotelplanning) — interface. Fonctionne avec Store (démo ou Supabase), Calc et MiniPdf. */
(function () {
  'use strict';
  var C = window.Calc, Store = window.Store, RealStore = window.Store, cfg = window.RELEVE_CONFIG || {};
  var app = document.getElementById('app'), dlg = document.getElementById('dlg');
  var S = { me: null, services: [], templates: [], profiles: [], settings: {}, view: null, week: null, svc: null, notifs: [], notifOpen: false, authMode: 'login', cache: {} };

  /* ---------- Outils ---------- */
  var JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  var JOURS_L = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var MOIS_L = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var ROLES = { pending: 'En attente', employee: 'Salarié', assistant: 'Assistant', manager: 'Manager', admin: 'Administrateur', developer: 'Développeur' };
  var TYPES = { cp: 'Congés payés', ferie: 'Jour férié', recup: 'Jour récupéré', anciennete: "Jour d'ancienneté", ot_day: 'Récup heures supp' };
  /* Journées à poser dans le planning (autres que le travail) : [type, libellé, code] */
  var DAYKINDS0 = [['repos', 'Repos', 'R'], ['formation', 'Formation', 'F'], ['cp', 'Congé payé', 'CP'], ['ferie', 'Jour férié', 'JF'], ['recup', 'Jour récupéré', 'JR'],
    ['rendre', 'Jour à rendre', 'AR'], ['anciennete', "Jour d'ancienneté", 'JA'], ['ot_day', 'Récup heures supp', 'HS'], ['maladie', 'Arrêt maladie', 'AM'],
    ['at', 'Accident du travail', 'AT'], ['css', 'Congé sans solde', 'CSS'], ['absence', 'Absence', 'ABS']];
  var DAYKINDS = DAYKINDS0, KLABEL = {}, ABBR = {};
  /* libellés et codes personnalisables dans les Paramètres */
  function applyDayTypes() {
    var o = (S.settings && S.settings.day_types) || {};
    DAYKINDS = DAYKINDS0.map(function (k) { var c = o[k[0]] || {}; return [k[0], c.label || k[1], c.code || k[2]]; });
    KLABEL = { work: 'Travail' }; ABBR = {};
    DAYKINDS.forEach(function (k) { KLABEL[k[0]] = k[1]; ABBR[k[0]] = k[2]; });
  }
  applyDayTypes();
  function dayStyle(kind) { var c = ((S.settings && S.settings.day_types) || {})[kind] || {}; return c.bg ? ' style="background:' + esc(c.bg) + ';color:' + esc(c.fg || '#1B2433') + '"' : ''; }
  var SOFT = ['repos', 'formation']; // journées remplacées automatiquement quand on pose autre chose
  function contractTypes() { return (S.settings && S.settings.contract_types) || [['cdi', 'CDI'], ['cdd', 'CDD'], ['alternant', 'Alternant'], ['stagiaire', 'Stagiaire'], ['extra', 'Extra'], ['interim', 'Intérimaire']]; }
  var CONTRATS = new Proxy({}, { get: function (t, k) { var f = contractTypes().find(function (x) { return x[0] === k; }); return f ? f[1] : String(k || '').toUpperCase(); } });
  function cpEligible(p) { return ((S.settings && S.settings.cp_contracts) || ['cdi', 'cdd', 'alternant']).indexOf(p.contract_type) >= 0; }
  function otDayMin() { return S.settings.ot_day_minutes == null ? 450 : +S.settings.ot_day_minutes; }
  var STATUS = { pending_manager: ['En attente du manager', 'warn'], pending_admin: ['En attente de la direction', 'warn'], approved: ['Acceptée', 'ok'], refused: ['Refusée', 'bad'], cancelled: ['Annulée', 'neutral'] };
  var COLORS = { open: 'Ouverture (orange foncé)', am: 'Matin (vert foncé)', mid: 'Middle (violet)', sky: 'Réservation (bleu ciel)', pm: 'Soir (rose)', night: 'Nuit (bleu foncé)' };
  /* couleurs du PDF (identiques à l'écran) : [fond, texte] */
  var PDFC = { open: ['#C2410C', '#FFFFFF'], am: ['#166534', '#FFFFFF'], mid: ['#6D28D9', '#FFFFFF'], sky: ['#7DD3FC', '#0C4A6E'], pm: ['#DB2777', '#FFFFFF'], night: ['#1E3A8A', '#FFFFFF'],
    cp: ['#CDEDE9', '#0D5652'], recup: ['#EADDF2', '#582D70'], ferie: ['#F6D8D4', '#872A20'], repos: ['#FFFFFF', '#7A8291'], rendre: ['#FDE2C8', '#8A3B00'], anciennete: ['#E7E1F8', '#4B3A8C'],
    formation: ['#E3EAF4', '#2F4A6B'], ot_day: ['#FCEBC8', '#7A4B00'], maladie: ['#FBDDE4', '#9F1239'], at: ['#F9D3D3', '#8B1C1C'], css: ['#E9E7E1', '#57534E'], absence: ['#F9E0D2', '#9A3412'] };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { var d = new Date(); return C.iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))); }
  function dayShort(s) { var d = C.parseDate(s); return JOURS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MOIS[d.getUTCMonth()]; }
  function dayLong(s) { var d = C.parseDate(s); return JOURS_L[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MOIS[d.getUTCMonth()]; }
  function isoWeek(s) { var d = C.parseDate(s); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); var y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return Math.ceil(((d - y) / 864e5 + 1) / 7); }
  function weekRange(ws) {
    var a = C.parseDate(ws), b = C.parseDate(C.addDays(ws, 6));
    var left = a.getUTCDate() + (a.getUTCMonth() !== b.getUTCMonth() ? ' ' + MOIS[a.getUTCMonth()] : '');
    return left + ' – ' + b.getUTCDate() + ' ' + MOIS[b.getUTCMonth()] + ' ' + b.getUTCFullYear();
  }
  function fmt(m) { return C.fmt(m); }
  function hhmm(t) { return t ? String(t).slice(0, 5).replace(':', 'h') : ''; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(d) { d = d || new Date(); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' à ' + pad(d.getHours()) + 'h' + pad(d.getMinutes()); }
  function name(id) { var p = S.profiles.find(function (x) { return x.id === id; }); return p ? (p.full_name || p.email) : '—'; }
  function svcName(id) { var s = S.services.find(function (x) { return x.id === id; }); return s ? s.name : 'Sans service'; }
  function role() { return S.me ? S.me.role : null; }
  function isAdmin() { return role() === 'admin' || role() === 'developer'; }
  function isDev() { return role() === 'developer'; }
  /* entreprise ouverte (le développeur peut en changer ; tout le reste de l'application suit) */
  function coName() { var c = (S.companies || []).find(function (x) { return x.id === (S.me && S.me.company_id); }); return (c && c.name) || (S.settings && S.settings.hotel_name) || 'HPG'; }
  function isBoss() { return isAdmin() || role() === 'manager' || role() === 'assistant'; }
  function rights(r) { return ((S.settings && S.settings.rights) || {})[r] || {}; }
  /* Droit « r » sur le service « svc » (même règle que la base) */
  /* ---------- Aperçu « voir comme » (développeur seulement) : l'interface telle qu'un salarié, un assistant,
     un manager ou un administrateur la voit ; lecture seule, rien n'est enregistré ---------- */
  function isRealDev() { return ((S.realMe || S.me) || {}).role === 'developer'; }
  function previewStore(p) {
    var W = /^(save|delete|create|update|add|set|replace|publish|unpublish|decide|cancel|credit|accrue|apply|switch|reset|resend|verify|mark|manage)/, READ = { publishedMonths: 1, settings: 1 }, st = {};
    Object.keys(RealStore).forEach(function (k) {
      var f = RealStore[k];
      if (typeof f !== 'function') { st[k] = f; return; }
      st[k] = W.test(k) && !READ[k] && k !== 'markAllRead' ? function () { return Promise.reject(new Error('Mode aperçu : lecture seule. Revenez à votre compte pour modifier.')); }
        : k === 'markAllRead' ? function () { return Promise.resolve(); } : f.bind(RealStore);
    });
    var svcs = p.services || [], emp = p.role === 'employee', staff = p.role === 'manager' || p.role === 'assistant';
    function inSvc(x) { return svcs.indexOf(x) >= 0; }
    var visibleIds = null;
    async function ids() { if (!visibleIds) visibleIds = (await st.profiles()).map(function (x) { return x.id; }); return visibleIds; }
    st.profiles = async function () {
      var all = await RealStore.profiles();
      if (emp) return all.filter(function (x) { return x.id === p.id; });
      if (staff) return all.filter(function (x) { return x.id === p.id || (x.role !== 'admin' && x.role !== 'developer' && (x.services || []).some(inSvc)); });
      return all.filter(function (x) { return x.role !== 'developer'; });
    };
    st.shifts = async function (a, b, o) {
      var list = await RealStore.shifts(a, b, o);
      if (emp) {
        var pub = await RealStore.publishedMonths();
        return list.filter(function (x) { return x.employee_id === p.id && (x.request_id || pub.some(function (m) { return m.service_id === x.service_id && m.month === x.day.slice(0, 8) + '01'; })); });
      }
      if (staff) return list.filter(function (x) { return inSvc(x.service_id) || x.employee_id === p.id; });
      return list;
    };
    st.requests = async function () { var l = await RealStore.requests(); return emp ? l.filter(function (x) { return x.employee_id === p.id; }) : staff ? l.filter(function (x) { return inSvc(x.service_id) || x.employee_id === p.id; }) : l; };
    st.owedDays = async function (o) { var l = await RealStore.owedDays(o), v = await ids(); return l.filter(function (x) { return v.indexOf(x.employee_id) >= 0; }); };
    st.overtime = async function (a, b, o) { var l = await RealStore.overtime(a, b, o); return emp ? l.filter(function (x) { return x.employee_id === p.id; }) : staff ? l.filter(function (x) { return inSvc(x.service_id); }) : l; };
    st.auditEntries = async function (n) { return p.role === 'admin' ? RealStore.auditEntries(n) : []; };
    st.notifications = async function () { return []; };
    st.companies = async function () { return (await RealStore.companies()).filter(function (c) { return c.id === (S.realMe || S.me).company_id; }); };
    return st;
  }
  async function enterPreview(id) {
    var real = S.realMe || S.me, p = (await RealStore.profiles()).find(function (x) { return x.id === id; });
    if (!p) { toast('Personne introuvable', true); return; }
    S.realMe = real; S.me = Object.assign({}, p); Store = previewStore(p);
    S.cache = {}; S.svc = myServices()[0]; S.menuOpen = false; S.notifOpen = false;
    S.view = p.role === 'employee' ? 'moi' : 'planning';
    render(); window.scrollTo(0, 0);
  }
  function exitPreview() {
    if (!S.realMe) return;
    S.me = S.realMe; S.realMe = null; Store = RealStore; S.cache = {}; S.svc = myServices()[0]; S.view = 'planning';
    render(); window.scrollTo(0, 0);
  }
  function previewSelect() {
    if (!isRealDev()) return '';
    var ppl = (S.realMe ? S.previewPeople : S.profiles) || [];
    if (!S.realMe) S.previewPeople = ppl;
    var groups = [['admin', 'Administrateur'], ['manager', 'Manager'], ['assistant', 'Assistant'], ['employee', 'Salarié']];
    return '<label class="co-switch view-as" title="Voir HPG comme un autre statut (lecture seule)"><span class="sr-only">Voir comme</span><select data-change="view-as">' +
      '<option value="">👁 Voir comme : moi (développeur)</option>' + groups.map(function (g) {
        var l = ppl.filter(function (x) { return x.role === g[0] && x.active !== false; }).sort(function (a, b) { return (a.full_name || '').localeCompare(b.full_name || ''); });
        return l.length ? '<optgroup label="' + g[1] + '">' + l.map(function (x) { return '<option value="' + x.id + '"' + (S.realMe && S.me.id === x.id ? ' selected' : '') + '>' + esc(g[1] + ' · ' + x.full_name) + '</option>'; }).join('') + '</optgroup>' : '';
      }).join('') + '</select></label>';
  }
  function previewBanner() {
    return S.realMe ? '<div class="preview-bar" role="status">Aperçu : vous voyez HPG comme <b>' + esc(S.me.full_name) + '</b> (' + esc(ROLES[S.me.role] || S.me.role) + '). Lecture seule, rien n\'est enregistré. <button type="button" class="btn sm" data-act="preview-exit">Revenir à mon compte</button></div>' : '';
  }
  /* droits de l'administrateur, réglés par le développeur seul (tous accordés par défaut) */
  function adminRight(r) { return isDev() || (role() === 'admin' && rights('admin')[r] !== false); }
  function can(r, svc) {
    if (isDev()) return true;
    if (role() === 'admin') return adminRight(r);
    if ((role() === 'manager' || role() === 'assistant') && (S.me.services || []).indexOf(svc) >= 0) return !!rights(role())[r];
    return false;
  }
  function empRight(r) { return !!rights('employee')[r]; }
  /* Options de l'entreprise (fiche Entreprise, réglées par le développeur). Une option absente de la fiche est activée :
     chaque nouvelle option ajoutée ici apparaît d'elle-même dans la liste, cochée, pour toutes les entreprises. */
  var FEATURES = [
    ['Onglets', [['demandes', 'Demandes (congés, repos…)'], ['soldes', 'Mes soldes'], ['equipe_planning', 'Planning équipe (vue salarié)'], ['jours', 'Jours à rendre / récup.'], ['feries', 'Jours fériés'], ['heures', 'Heures supp'], ['presence', 'Fiches de présence'], ['pointage', 'Pointage'], ['journal', 'Journal des modifications']]],
    ['Planning', [['staffing', 'Lignes de calcul d\'effectif et couleurs de la ligne « Présents »'], ['extra', 'Ligne « Demande extra StaffHôtel »'], ['delivery', 'Ligne « Jour de livraison »'], ['rooms', 'Chambres (Housekeeping) : chambres par shift et « Chambres restant à faire »'], ['by_location', 'Totaux par localisation'], ['rest_month', 'Bouton « Poser les repos habituels »'], ['print', 'Impression du planning (PDF)']]],
    ['Salariés', [['pw_reset', 'Changement de mot de passe par la hiérarchie (Équipe)'], ['rest_auto', 'Repos habituels posés automatiquement à la création / modification'], ['push', 'Notifications sur téléphone']]]
  ];
  function curCompany() { return (S.companies || []).find(function (x) { return x.id === (S.me && S.me.company_id); }) || {}; }
  function feat(k) { return (curCompany().features || {})[k] !== false; }
  function myServices() {
    if (isAdmin()) return S.services.filter(function (s) { return !s.archived; }).map(function (s) { return s.id; });
    return (S.me.services || []).slice();
  }
  function hasRight(r) { return myServices().some(function (s) { return can(r, s); }); }
  function rightServices(r) { return myServices().filter(function (s) { return can(r, s); }); }
  function isEmployeeToo() { return !isDev() && (S.me.services || []).length > 0; }
  function minRest() { return S.settings.min_rest_hours == null ? 11 : +S.settings.min_rest_hours; }

  var ICON = {
    building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20.5V5.5l8-2.5v17.5M12 8.5l8 2.5v9.5M2.5 20.5h19M7 8h2M7 11.5h2M7 15h2M15 13h2M15 16.5h2"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 13.5l2.2-7.4A1.5 1.5 0 0 1 7.6 5h8.8a1.5 1.5 0 0 1 1.4 1.1l2.2 7.4V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13.5h4.5l1 2h5l1-2H20"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17 14.4c1.9.5 3.1 2 3.5 4.6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8.5" r="3.7"/><path d="M4.5 20c.9-3.6 3.8-5.6 7.5-5.6s6.6 2 7.5 5.6"/></svg>',
    sheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M4 9h16M4 14.5h16M10 3.5v17"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 8l-4 4 4 4M6 12h9"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/></svg>',
    left: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 6l-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.5 6l6 6-6 6"/></svg>'
  };

  function toast(msg, bad) {
    var t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
  }
  async function attempt(fn, okMsg) {
    try { var r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { toast(e.message || String(e), true); throw e; }
  }

  /* ---------- Shifts : couleur, libellé, rendu ---------- */
  function templateFor(sh) {
    if (sh.template_id) { var byId = S.templates.find(function (x) { return x.id === sh.template_id; }); if (byId) return byId; }
    return S.templates.find(function (x) { return hhmm(x.start_time) === hhmm(sh.start_time) && hhmm(x.end_time) === hhmm(sh.end_time); });
  }
  function colorKey(sh) {
    if (sh.kind !== 'work') return sh.kind;
    if (sh.color) return sh.color;
    var t = templateFor(sh); if (t && t.color) return t.color;
    var s = C.toMin(sh.start_time), e = C.toMin(sh.end_time);
    if (e <= s || s >= 21 * 60) return 'night';
    if (s < 7 * 60) return 'open';
    if (s < 9 * 60) return 'am';
    if (s < 13 * 60) return 'mid';
    return 'pm';
  }
  function shiftLabel(sh) {
    if (sh.kind !== 'work') return KLABEL[sh.kind] || sh.kind;
    if (sh.label) return sh.label;
    var t = templateFor(sh); return t ? t.name : 'Horaire libre';
  }
  function chip(sh, attrs) {
    var d = C.shiftDetail(sh), marks = '';
    if (d.corrected) marks += '<span class="mark" title="Heures réelles saisies par le manager">corrigé</span>';
    if (d.night) marks += '<span class="mark" title="Heures de nuit (22 h – 7 h)">nuit ' + fmt(d.night) + '</span>';
    if (d.holiday) marks += '<span class="mark">férié</span>';
    var ot = S.cache.otByShift && sh.id && S.cache.otByShift[sh.id];
    if (ot) marks += '<span class="mark ot" title="Heures supp inscrites sur ce shift">+' + fmt(ot.minutes) + ' supp</span>';
    if (sh.extra_pay) marks += '<span class="mark xp" title="Jour à payer en extra">extra à payer</span>';
    if (sh.jour_rendu) marks += '<span class="mark jd" title="Ce shift rend un jour dû par le salarié">jour rendu</span>';
    if (sh.jour_sup) marks += '<span class="mark jd" title="Shift supplémentaire : +1 jour à récupérer">+1 j à récup.</span>';
    var times = sh.kind === 'work'
      ? (d.corrected ? '<s>' + hhmm(sh.start_time) + '–' + hhmm(sh.end_time) + '</s> ' + hhmm(sh.actual_start) + '–' + hhmm(sh.actual_end) : hhmm(sh.start_time) + '–' + hhmm(sh.end_time))
      : sh.kind === 'ot_day' ? '−' + fmt(otDayMin()) : (sh.note ? esc(sh.note.length > 28 ? sh.note.slice(0, 27) + '…' : sh.note) : '');
    return '<button type="button" class="chip k-' + colorKey(sh) + '" ' + (sh.kind !== 'work' ? dayStyle(sh.kind) + ' ' : tplStyle(tplOf(sh)) + ' ') + (attrs || '') + '><b>' + esc(sh.kind === 'work' ? shiftLabel(sh) : (ABBR[sh.kind] || '') + ' · ' + shiftLabel(sh)) + '</b>' +
      (times ? '<span class="t">' + times + '</span>' : '') + (marks ? '<div>' + marks + '</div>' : '') + '</button>';
  }
  function weekNav() {
    var ws = S.week, cur = C.weekStart(today());
    return '<div class="week-nav"><button class="btn sm" data-act="week" data-d="-7" aria-label="Semaine précédente">' + ICON.left + '</button>' +
      '<div class="lbl"><b>Semaine ' + isoWeek(ws) + (ws === cur ? ' · cette semaine' : '') + '</b><span class="small muted">' + weekRange(ws) + '</span></div>' +
      '<button class="btn sm" data-act="week" data-d="7" aria-label="Semaine suivante">' + ICON.right + '</button>' +
      (ws !== cur ? '<button class="btn sm ghost" data-act="week-today">Aujourd\'hui</button>' : '') + '</div>';
  }
  function svcSelect(id, list) {
    list = list || myServices();
    if (list.length < 2) return '';
    return '<label class="f" style="min-width:160px">Service<select id="' + (id || 'svc-select') + '" data-change="svc">' +
      list.map(function (sid) { return '<option value="' + sid + '"' + (sid === S.svc ? ' selected' : '') + '>' + esc(svcName(sid)) + '</option>'; }).join('') + '</select></label>';
  }
  /* Sélecteur de durée (heures + minutes) pour les heures supp */
  function durSel(id, minutes) {
    var h = minutes ? Math.floor(minutes / 60) : 0, m = minutes ? minutes % 60 : 0, hs = '', ms = '';
    for (var i = 0; i <= 12; i++) hs += '<option value="' + i + '"' + (i === h ? ' selected' : '') + '>' + i + ' h</option>';
    for (var j = 0; j < 60; j += 5) ms += '<option value="' + j + '"' + (j === m - (m % 5) ? ' selected' : '') + '>' + pad(j) + ' min</option>';
    return '<span class="dur-sel"><select id="' + id + '-h" aria-label="Heures">' + hs + '</select><select id="' + id + '-m" aria-label="Minutes">' + ms + '</select></span>';
  }
  function readDur(root, id) { var h = root.querySelector('#' + id + '-h'), m = root.querySelector('#' + id + '-m'); return h ? (+h.value) * 60 + (+m.value) : 0; }
  function num(v) { return String(v).replace('.', ','); }
  function yearBounds(y) { return [C.weekStart(y + '-01-01'), C.addDays(C.weekStart(y + '-12-31'), 6)]; }
  function recupMinPerDay(p) { return Math.round((p.contract_hours || 39) * 60 / 5); }
  function otAsShifts(list) { return list.map(function (o) { return { kind: 'ot', day: o.day, minutes: o.minutes, employee_id: o.employee_id }; }); }

  /* ---------- Coque ---------- */
  function tabsFor() {
    var t = [];
    if (isBoss()) {
      t.push(['planning', 'Planning', ICON.cal]);
      if (isEmployeeToo()) t.push(['moi', 'Mon planning', ICON.user]);
      if ((hasRight('requests') || isAdmin()) && feat('demandes')) t.push(['demandes', 'Demandes', ICON.inbox]);
      if (isEmployeeToo() && feat('soldes')) t.push(['mes-demandes', 'Mes soldes', ICON.inbox]);
      if (hasRight('team') || myServices().length) t.push(['equipe', 'Équipe', ICON.users]);
      if (hasRight('owed')) { if (feat('jours')) t.push(['jours', 'Jours à rendre / récup.', ICON.cal]); if (feat('feries')) t.push(['feries', 'Jours fériés', ICON.cal]); }
      if (hasRight('overtime') && feat('heures')) t.push(['heures', 'Heures supp', ICON.clock]);
      if (hasRight('presence')) { if (feat('presence')) t.push(['presence', 'Fiches de présence', ICON.sheet]); if (feat('pointage')) t.push(['pointage', 'Pointage', ICON.sheet]); }
      if (isAdmin()) {
        if (adminRight('settings')) t.push(['parametres', 'Paramètres', ICON.gear]);
        if (adminRight('journal') && feat('journal')) t.push(['journal', 'Journal', ICON.sheet]);
        if (adminRight('company')) t.push(['entreprises', isDev() ? 'Entreprises' : 'Entreprise', ICON.building]);
      }
      return t;
    }
    t.push(['planning', 'Mon planning', ICON.cal]);
    if (empRight('team_planning') && feat('equipe_planning')) t.push(['equipe-planning', 'Planning équipe', ICON.users]);
    if (empRight('balances') && feat('soldes')) t.push(['mes-demandes', 'Mes soldes', ICON.inbox]);
    return t;
  }
  function demoBar() {
    if (Store.mode !== 'demo') return '';
    return '<div class="demo-bar"><div class="in"><span><b>Démonstration</b> · données fictives</span>' +
      '<button class="linkish" data-act="demo-reset">Remettre la démo à zéro</button></div></div>';
  }
  function shell(inner, pendingCount) {
    var unread = S.notifs.filter(function (n) { return !n.read_at; }).length;
    var tabs = S.me.role === 'pending' ? [] : tabsFor();
    var curTab = tabs.find(function (t) { return t[0] === S.view; });
    return '<header class="top"><div class="top-in">' +
      (tabs.length ? '<button class="menu-btn" data-act="menu" aria-label="Menu" aria-expanded="' + !!S.menuOpen + '" aria-controls="side-menu">' + ICON.menu + '<span>' + esc(curTab ? (curTab[0] === 'presence' ? 'Présences' : curTab[1]) : 'Menu') + '</span>' + (pendingCount ? '<span class="badge">' + pendingCount + '</span>' : '') + '</button>' : '') +
      '<div class="brand"><img class="brand-logo" src="icons/logo-80.png" width="36" height="36" alt="HPG"><small>' + esc(coName()) + (isAdmin() ? '' : ' · ' + (S.me.services || []).map(svcName).join(' · ')) + '</small></div>' +
      previewSelect() +
      (isDev() && (S.companies || []).length ? '<label class="co-switch" title="Entreprise ouverte : tout HPG suit (planning, équipe, paramètres, exports)"><span class="sr-only">Entreprise</span><select data-change="co-switch">' + S.companies.map(function (c) { return '<option value="' + c.id + '"' + (c.id === S.me.company_id ? ' selected' : '') + '>' + esc(c.name) + (c.active === false ? ' (inactive)' : '') + '</option>'; }).join('') + '</select></label>' : '') +
      '<div class="spacer"></div>' +
      '<div class="who"><b>' + esc(S.me.full_name || S.me.email) + '</b><span>' + (isDev() ? '<span class="pill brass">Développeur</span>' : ROLES[S.me.role]) + '</span></div>' +
      '<div class="notif-wrap"><button class="icon-btn" data-act="notif" aria-label="Notifications" aria-expanded="' + S.notifOpen + '">' + ICON.bell + (unread ? '<span class="badge">' + unread + '</span>' : '') + '</button>' +
      (S.notifOpen ? notifPanel() : '') + '</div>' +
      '<button class="icon-btn" data-act="account" aria-label="Mon compte et mot de passe">' + ICON.user + '</button>' +
      '<button class="icon-btn logout-btn" data-act="logout" aria-label="Se déconnecter" title="Se déconnecter">' + ICON.logout + '<span>Déconnexion</span></button>' +
      '</div></header>' + demoBar() + previewBanner() +
      (tabs.length ? '<div class="menu-scrim"' + (S.menuOpen ? '' : ' hidden') + ' data-act="menu-close"></div><nav id="side-menu" class="side-menu' + (S.menuOpen ? ' open' : '') + '" aria-label="Sections"' + (S.menuOpen ? '' : ' hidden') + '><div class="tabs">' + tabs.map(function (t) {
        var c = t[0] === 'demandes' && pendingCount ? '<span class="count">' + pendingCount + '</span>' : '';
        if (t[0] === 'presence') return '<button data-act="go" data-v="presence"' + (S.view === 'presence' ? ' aria-current="page"' : '') + '>' + t[2] + '<span>Présences</span></button>';
        return '<button data-act="go" data-v="' + t[0] + '"' + (S.view === t[0] ? ' aria-current="page"' : '') + '>' + t[2] + '<span>' + t[1] + '</span>' + c + '</button>';
      }).join('') + '</div></nav>' : '') +
      '<main id="main"' + ((S.view === 'planning' && isBoss()) || S.view === 'equipe-planning' ? ' class="wide"' : '') + '>' + inner + '</main>';
  }
  function notifPanel() {
    if (!S.notifs.length) return '<div class="notif-panel"><div class="empty">Aucune notification.</div></div>';
    return '<div class="notif-panel">' + S.notifs.map(function (n) {
      var d = new Date(n.created_at);
      return '<div class="n' + (n.read_at ? '' : ' unread') + '"><b>' + esc(n.title) + '</b><p>' + esc(n.body) + '</p><time>' +
        d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '</time></div>';
    }).join('') + '</div>';
  }

  function canDecide(r) {
    if (r.status === 'pending_admin') return isAdmin();
    if (r.status !== 'pending_manager' || !can('requests', r.service_id)) return false;
    if (isAdmin()) return true;
    if (r.employee_id === S.me.id) return false;
    var p = S.profiles.find(function (x) { return x.id === r.employee_id; });
    return !p || p.role === 'employee';
  }
  async function pendingRequestsCount() {
    if (!isBoss()) return 0;
    var r = await Store.requests();
    return r.filter(canDecide).length;
  }

  var renderSeq = 0;
  async function render() {
    var seq = ++renderSeq;
    if (S.me.role === 'pending') { app.innerHTML = shell(pendingView()); return; }
    var allowed = tabsFor().map(function (t) { return t[0]; });
    var views = isBoss()
      ? { planning: vTeamPlanning, moi: vMyPlanning, demandes: vValidate, 'mes-demandes': vMyRequests, equipe: vTeam, jours: vOwedAll, feries: vFeries, heures: vOvertime, presence: vPresence, pointage: vPointage, parametres: vSettings, journal: vJournal, entreprises: vCompanies }
      : { planning: vMyPlanning, 'equipe-planning': vTeamPlanning, 'mes-demandes': vMyRequests };
    if (allowed.indexOf(S.view) < 0 || !views[S.view]) S.view = 'planning';
    try {
      var html = await views[S.view](), pc = await pendingRequestsCount();
      if (seq !== renderSeq) return;
      app.innerHTML = shell(html, pc);
    } catch (e) {
      app.innerHTML = shell('<div class="banner warn">Impossible de charger cette page : ' + esc(e.message) + '</div>');
    }
  }
  async function refreshNotifs() { try { S.notifs = await Store.notifications(); } catch (e) {} }

  /* ---------- EMPLOYÉ : mon planning ---------- */
  async function vMyPlanning() { return vMyMonth(); }

  /* ---------- EMPLOYÉ : demandes ---------- */
  function delay() { return S.settings.request_delay_days == null ? 7 : +S.settings.request_delay_days; }
  function firstAllowed(min) { var d = min; while (!C.countOuvrables(d, d)) d = C.addDays(d, 1); return d; }
  function signedFmt(m) { return m === 0 ? '0h00' : (m > 0 ? '+' : '') + C.fmt(m); }
  function balanceStats(p, ot) {
    return '<div class="stat"><div class="v">' + num(p.cp_balance) + ' j</div><div class="l">congés payés</div></div>' +
      '<div class="stat"><div class="v">' + num(p.ferie_balance || 0) + ' j</div><div class="l">jours fériés dus</div></div>' +
      '<div class="stat"><div class="v">' + num(p.seniority_balance || 0) + ' j</div><div class="l">jours d\'ancienneté</div></div>' +
      '<div class="stat"><div class="v">' + num(p.recup_days || 0) + ' j</div><div class="l">jours à récupérer (dus par l\'entreprise)</div></div>' +
      '<div class="stat"><div class="v' + ((p.rendre_days || 0) > 0 ? ' over' : '') + '">' + num(p.rendre_days || 0) + ' j</div><div class="l">jours à rendre (dus à l\'entreprise)</div></div>' +
      (ot == null ? '' : '<div class="stat"><div class="v' + (ot < 0 ? ' over' : '') + '">' + signedFmt(ot) + '</div><div class="l">heures supp (solde)</div></div>') + cpProgressStat(p);
  }
  /* Jours à rendre / à récupérer : un seul tableau pour le service, deux parties MOINS (le salarié doit) et PLUS (l'entreprise doit) */
  function owedD(x) { return x ? x.split('-').reverse().join('/') : '—'; }
  function owedNb(o) { return o.days < 1 ? '½ j' : '1 j'; }
  function owedSt(o, take) { return o.rendered_shift_id ? '<span class="pill ok">' + take + ' le ' + owedD(o.rendered_on) + '</span>' : '<span class="pill warn">' + (take === 'Rendu' ? 'À rendre' : 'À prendre') + '</span>'; }
  function owedOpen(l) { return l.filter(function (o) { return !o.rendered_shift_id; }).reduce(function (a, o) { return a + (+o.days || 1); }, 0); }
  function owedOrd(a, b) { return (a.rendered_shift_id ? 1 : 0) - (b.rendered_shift_id ? 1 : 0) || String(a.origin_date).localeCompare(String(b.origin_date)); }
  function owedSplitTable(team, owed) {
    var body = team.map(function (p) {
      var mine = owed.filter(function (o) { return o.employee_id === p.id; });
      var minus = mine.filter(function (o) { return o.type === 'rendre'; }).sort(owedOrd), plus = mine.filter(function (o) { return o.type === 'recup'; }).sort(owedOrd);
      var mOpen = owedOpen(minus), pOpen = owedOpen(plus), bal = pOpen - mOpen, n = Math.max(minus.length, plus.length), rows = '';
      for (var i = 0; i < n; i++) {
        var m = minus[i], q = plus[i];
        rows += '<tr>' + (m ? '<td>' + owedD(m.origin_date) + '</td><td>' + owedNb(m) + '</td><td>' + esc(m.reason || '') + '</td><td>' + owedSt(m, 'Rendu') + '</td>' : '<td colspan="4"></td>') +
          (q ? '<td class="ow-sep">' + owedD(q.origin_date) + '</td><td>' + owedNb(q) + '</td><td>' + esc(q.reason || '') + '</td><td>' + owedSt(q, 'Pris') + '</td>' : '<td colspan="4" class="ow-sep"></td>') + '</tr>';
      }
      return '<tr class="ow-emp"><th colspan="8"><div class="row" style="justify-content:space-between"><span><b>' + esc(p.full_name) + '</b> <span class="muted small">' + esc(CONTRATS[p.contract_type]) + '</span></span>' +
        '<span class="row"><span class="small">− <b>' + num(mOpen) + ' j</b> à rendre · + <b>' + num(pOpen) + ' j</b> à récupérer · <b class="' + (bal < 0 ? 'neg' : 'pos') + '">solde ' + (bal > 0 ? '+' : '') + num(bal) + ' j</b></span>' +
        '<button class="btn sm" data-act="owed" data-id="' + p.id + '">Gérer</button></span></div></th></tr>' +
        (rows || '<tr><td colspan="8" class="muted small">Aucun jour.</td></tr>');
    }).join('');
    return '<div class="table-wrap"><table class="owsplit"><colgroup>' + [11, 6, 21, 12, 11, 6, 21, 12].map(function (w) { return '<col style="width:' + w + '%">'; }).join('') + '</colgroup><thead>' +
      '<tr><th colspan="4" class="ow-minus">MOINS · jours à rendre (le salarié doit)</th><th colspan="4" class="ow-plus ow-sep">PLUS · jours à récupérer (l\'entreprise doit)</th></tr>' +
      '<tr><th>Origine</th><th>Nb</th><th>Motif</th><th>Statut</th><th class="ow-sep">Origine</th><th>Nb</th><th>Motif</th><th>Statut</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  /* Jours fériés dus : un tableau à part (onglet « Jours fériés ») */
  function feriesTable(team, owed) {
    var body = team.map(function (p) {
      var mine = owed.filter(function (o) { return o.employee_id === p.id && o.type === 'ferie'; }).sort(owedOrd), open = owedOpen(mine), taken = mine.length - mine.filter(function (o) { return !o.rendered_shift_id; }).length;
      return '<tr class="ow-emp"><th colspan="5"><div class="row" style="justify-content:space-between"><span><b>' + esc(p.full_name) + '</b> <span class="muted small">' + esc(CONTRATS[p.contract_type]) + '</span></span>' +
        '<span class="row"><span class="small"><b>' + num(open) + ' j</b> à prendre · ' + taken + ' pris</span><button class="btn sm" data-act="owed" data-id="' + p.id + '">Gérer</button></span></div></th></tr>' +
        (mine.length ? mine.map(function (o) {
          return '<tr><td>' + esc(C.holidayName(o.origin_date) || 'Jour férié') + '</td><td>' + owedD(o.origin_date) + '</td><td>' + owedNb(o) + '</td><td>' + esc(o.reason || '') + '</td><td>' + owedSt(o, 'Pris') + '</td></tr>';
        }).join('') : '<tr><td colspan="5" class="muted small">Aucun jour férié dû.</td></tr>');
    }).join('');
    return '<div class="table-wrap"><table class="owsplit ferie"><colgroup>' + [24, 14, 8, 34, 20].map(function (w) { return '<col style="width:' + w + '%">'; }).join('') + '</colgroup><thead>' +
      '<tr><th colspan="5" class="ow-plus">JOURS FÉRIÉS DUS (l\'entreprise doit)</th></tr><tr><th>Jour férié</th><th>Date</th><th>Nb</th><th>Motif</th><th>Statut</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  async function vFeries() {
    var list = rightServices('owed'); if (list.indexOf(S.svc) < 0) S.svc = list[0];
    var svc = S.svc, team = teamOf(svc), owed = (await Store.owedDays({ serviceId: svc })).filter(function (o) { return o.type === 'ferie'; });
    return '<div class="page-head"><div><div class="eyebrow">' + esc(svcName(svc)) + '</div><h2>Jours fériés</h2></div><div class="row">' + svcSelect(null, list) +
      '<button class="btn brass" data-act="credit-ferie">Créditer des jours fériés</button></div></div>' +
      '<p class="hint">Jour férié dû : l\'entreprise doit ce jour au salarié (férié travaillé ou tombé sur un repos). Il le prend avec « JF » dans le planning ou par une demande « Jour férié ».</p>' +
      feriesTable(team, owed);
  }
  function owedTable(list, withActions) {
    function d(x) { return x ? x.split('-').reverse().join('/') : '—'; }
    var TL = { ferie: 'Jour férié dû', recup: 'Jour à récupérer', rendre: 'Jour à rendre' };
    var open = list.filter(function (o) { return !o.rendered_shift_id; }), done = list.filter(function (o) { return o.rendered_shift_id; });
    if (!list.length) return '<div class="empty">Aucun jour dans la liste.</div>';
    return '<div class="table-wrap"><table><thead><tr><th>Type</th><th>Origine</th><th>Motif</th><th>Statut</th>' + (withActions ? '<th></th>' : '') + '</tr></thead><tbody>' +
      open.concat(done).map(function (o) {
        return '<tr><td>' + TL[o.type] + (o.days < 1 ? ' (½ j)' : '') + '</td><td>' + d(o.origin_date) + '</td><td>' + esc(o.reason || '') + (o.source_shift_id ? ' <span class="muted small">(planning)</span>' : '') + '</td>' +
          '<td>' + (o.rendered_shift_id ? '<span class="pill ok">' + (o.type === 'rendre' ? 'Rendu' : 'Pris') + ' le ' + d(o.rendered_on) + '</span>' + (o.rendered_note ? '<div class="small muted">' + esc(o.rendered_note) + '</div>' : '') : '<span class="pill warn">' + (o.type === 'rendre' ? 'À rendre' : 'Dû') + '</span>') + '</td>' +
          (withActions ? '<td>' + (o.rendered_shift_id || o.source_shift_id ? '' : '<button type="button" class="btn sm ghost danger" data-owed-del="' + o.id + '">Supprimer</button>') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  async function vMyRequests() {
    var me = S.me = (await Store.profiles()).find(function (p) { return p.id === S.me.id; }) || S.me;
    var res = await Promise.all([Store.requests(), Store.otBalance(me.id).catch(function () { return null; }), Store.owedDays({ employeeId: me.id })]);
    var mine = res[0].filter(function (r) { return r.employee_id === me.id; });
    var list = mine.length ? mine.map(function (r) { return requestItem(r, false); }).join('') : '<div class="empty">Aucune demande enregistrée.</div>';
    return '<div class="page-head"><div><div class="eyebrow">Absences et compteurs</div><h2>Mes soldes</h2></div></div>' +
      '<div class="stats">' + balanceStats(me, res[1]) + '</div>' +
      '<div class="banner info">Pour un congé ou un jour à récupérer, adressez-vous à votre manager : c\'est lui qui saisit et valide la demande dans HPG.</div>' +
      '<section class="list" aria-label="Mes demandes"><h3>Mes demandes</h3>' + list + '</section>' +
      '<section class="panel"><h3>Mes jours fériés, à récupérer et à rendre</h3>' + owedTable(res[2], false) + '</section>';
  }
  function cpPeriod() {
    var st = S.settings, last = C.cpLastCredit(today(), st.cp_credit_month || 5, st.cp_credit_day || 1);
    return { start: last, next: C.addMonths(last, 12), end: C.addDays(C.addMonths(last, 12), -1) };
  }
  function cpProgressStat(p) {
    if (!cpEligible(p) || !p.hire_date) return '';
    var per = cpPeriod(), now = C.cpEarned(p.hire_date, per.start, C.addDays(today(), -1), +S.settings.cp_monthly_days || 2.5, true, +S.settings.cp_cap || 30);
    return '<div class="stat"><div class="v">' + String(now).replace('.', ',') + ' j</div><div class="l">en cours d\'acquisition, crédités le ' + per.next.split('-').reverse().join('/') + '</div></div>';
  }
  function previewText(type, a, b) {
    if (!a || !b || b < a) return 'Choisissez une période valide.';
    if (type !== 'cp') { var nd = C.daysBetween(a, b) + 1; return nd + ' jour' + (nd > 1 ? 's' : '') + (type === 'ot_day' ? ' · soit ' + fmt(nd * otDayMin()) + ' déduites de vos heures supp' : '') + '.'; }
    var n = C.countOuvrables(a, b);
    return n + ' jour' + (n > 1 ? 's' : '') + ' ouvrable' + (n > 1 ? 's' : '') + ' de CP (lundi → samedi, hors fériés).';
  }
  function requestItem(r, boss, extra) {
    var st = STATUS[r.status], who = boss ? '<div class="sub">' + esc(name(r.employee_id)) + ' · ' + esc(svcName(r.service_id)) + '</div>' : '';
    var steps = r.type === 'cp'
      ? '<div class="steps"><span class="' + (r.manager_at ? 'on' : r.status === 'pending_manager' ? 'cur' : '') + '">Manager</span><span>→</span><span class="' + (r.admin_at ? 'on' : r.status === 'pending_admin' ? 'cur' : '') + '">Direction</span></div>' : '';
    var acts = '';
    if (boss && /^pending/.test(r.status) && can('requests', r.service_id)) acts = '<button class="btn sm ghost danger" data-act="cancel" data-id="' + r.id + '">Annuler</button>';
    if (boss && canDecide(r)) acts += '<button class="btn sm" data-act="refuse" data-id="' + r.id + '">Refuser</button><button class="btn sm primary" data-act="approve" data-id="' + r.id + '">' + (r.status === 'pending_manager' && r.type === 'cp' && !isAdmin() ? 'Valider (→ direction)' : 'Accepter') + '</button>';
    if (r.created_by && r.created_by !== r.employee_id) who += '<div class="sub muted">Saisie par ' + esc(name(r.created_by)) + '</div>';
    return '<div class="item"><div><div class="title">' + (TYPES[r.type] || r.type) + ' · ' + num(r.days) + ' j</div>' + who +
      '<div class="sub">du ' + dayLong(r.start_date) + ' au ' + dayLong(r.end_date) + '</div>' +
      (r.comment ? '<div class="sub">« ' + esc(r.comment) + ' »</div>' : '') +
      (r.refusal_reason ? '<div class="sub" style="color:var(--bad)">Motif : ' + esc(r.refusal_reason) + '</div>' : '') + (extra || '') + steps + '</div>' +
      '<div class="acts"><span class="pill ' + st[1] + '">' + st[0] + '</span>' + acts + '</div></div>';
  }

  /* ---------- MANAGER : planning du service (glisser-déposer) ---------- */
  function locIndex(svc, loc) { var sv = S.services.find(function (x) { return x.id === svc; }), l = (sv && sv.locations) || []; var i = l.indexOf(loc); return i < 0 ? (loc ? l.length : l.length + 1) : i; }
  function teamOf(svc) {
    return S.profiles.filter(function (p) { return (p.services || []).indexOf(svc) >= 0 && ['employee', 'assistant', 'manager', 'admin'].indexOf(p.role) >= 0 && p.active; })
      .sort(function (a, b) {
        var la = locIndex(svc, a.service_id === svc ? a.location : null), lb = locIndex(svc, b.service_id === svc ? b.location : null);
        if (la !== lb) return la - lb;
        var ea = a.contract_type === 'extra' || a.contract_type === 'interim', eb = b.contract_type === 'extra' || b.contract_type === 'interim';
        return ea !== eb ? (ea ? 1 : -1) : (a.full_name || '').localeCompare(b.full_name || '');
      });
  }
  function groupOf(p, svc) { return p.service_id === svc && p.location ? p.location : (p.service_id !== svc ? 'Renfort (autre service)' : ''); }
  function counters(p) { return 'CP ' + num(p.cp_balance) + ' j · fériés ' + num(p.ferie_balance || 0) + ' · ancienneté ' + num(p.seniority_balance || 0) + ' · à récupérer ' + num(p.recup_days || 0) + ' · à rendre ' + num(p.rendre_days || 0); }
  function contractPill(p) {
    if (['cdi', 'cdd'].indexOf(p.contract_type) < 0) return '<span class="pill brass">' + esc(CONTRATS[p.contract_type]) + '</span>';
    return '';
  }
  function svcTemplates(svc) { return S.templates.filter(function (t) { return t.active !== false && (!t.service_id || t.service_id === svc); }); }
  function palette() {
    var tpls = svcTemplates(S.svc).map(function (t) {
      return '<button type="button" class="chip k-' + (t.color || 'am') + ' pal' + (S.armedKey === String(t.id) ? ' armed' : '') + '" data-act="arm" data-drag="tpl" data-tpl="' + t.id + '"' + tplStyle(t) + '><b>' + esc(t.name) + '</b><span class="t">' + hhmm(t.start_time) + '–' + hhmm(t.end_time) + '</span></button>';
    }).join('');
    var days = DAYKINDS.map(function (k) {
      return '<button type="button" class="chip k-' + k[0] + ' pal' + (S.armedKey === 'kind:' + k[0] ? ' armed' : '') + '" data-act="arm" data-drag="tpl" data-tpl="kind:' + k[0] + '"' + dayStyle(k[0]) + '><b>' + esc(k[2]) + ' · ' + esc(k[1]) + '</b><span class="t">' + (k[0] === 'ot_day' ? '−' + fmt(otDayMin()) + ' supp' : 'journée') + '</span></button>';
    }).join('');
    if (!tpls) tpls = '<span class="small muted">Aucun shift créé pour ' + esc(svcName(S.svc)) + '.' + (isAdmin() ? ' <button type="button" class="linkish" data-act="go" data-v="parametres">Créer les shifts de ce service dans les Paramètres</button>' : ' Demandez à l\'administrateur de les créer dans les Paramètres.') + '</span>';
    return '<div class="palette" aria-label="Créneaux à glisser dans le planning"><div class="pal-row"><span class="pal-lbl">Shifts</span>' + tpls + '</div>' +
      '<div class="pal-row"><span class="pal-lbl">Journées</span>' + days + '</div>' +
      '<p class="hint" style="margin:6px 0 0">Glissez sur une case : ce qui s\'y trouve est remplacé automatiquement. Maj = ajouter un second shift · Ctrl/Alt = copier · clic = modifier. Sur téléphone : touchez un modèle puis la case.</p></div>';
  }
  /* ---------- Vue mensuelle du planning ---------- */
  function curMonth() { return S.month || S.week.slice(0, 7); }
  function viewToggle() { return ''; }
  function viewToggleOld() {
    var v = S.planView || 'week';
    return '<span class="seg" role="group" aria-label="Affichage"><button data-act="pview" data-v="week" aria-pressed="' + (v === 'week') + '">Semaine</button><button data-act="pview" data-v="month" aria-pressed="' + (v === 'month') + '">Mois</button></span>';
  }
  function monthNav() {
    var m = curMonth(), cur = today().slice(0, 7);
    return '<div class="week-nav"><button class="btn sm" data-act="month" data-d="-1" aria-label="Mois précédent">' + ICON.left + '</button>' +
      '<div class="lbl"><b>' + MOIS_L[+m.slice(5, 7) - 1].replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + m.slice(0, 4) + '</b><span class="small muted">' + (m === cur ? 'ce mois-ci' : '&nbsp;') + '</span></div>' +
      '<button class="btn sm" data-act="month" data-d="1" aria-label="Mois suivant">' + ICON.right + '</button>' +
      (m !== cur ? '<button class="btn sm ghost" data-act="month-today">Aujourd\'hui</button>' : '') + '</div>';
  }
  /* Vue mois : lettre par shift (ouverture M rouge sur orange fluo, matin M noir, soir S sur rose fluo, nuit N) ; middle = heure de début */
  var MLETTER = { open: 'M', am: 'M', pm: 'S', night: 'N' };
  /* heure de début affichée dans la case : middle = heure seule (9, 12, 13) ; autres = 9h, 9h30 */
  /* chambres faites avec ce shift (modèle du service, ex. Housekeeping 12 / 8 / 5) : affichées dans la case */
  /* couleurs et texte propres à un shift (Paramètres → Shifts par service) : fond, texte, texte affiché */
  function tplOf(sh) { return sh && sh.kind === 'work' ? templateFor(sh) : null; }
  function tplStyle(t) { return t && t.bg ? ' style="background:' + esc(t.bg) + ';color:' + esc(t.fg || '#000000') + ';border-color:' + esc(t.bg) + '"' : ''; }
  function shiftRooms(sh) { if (!sh || sh.kind !== 'work') return null; var t = templateFor(sh); return t && t.rooms != null && t.rooms !== '' ? +t.rooms : null; }
  /* total de la ligne d'un salarié : nombre de jours travaillés dans le mois (jours avec au moins un shift) */
  function workedDays(list, days) { var seen = {}; list.forEach(function (s) { if (s.kind === 'work' && days.indexOf(s.day) >= 0) seen[s.day] = 1; }); return Object.keys(seen).length; }
  function daysTxt(n) { return n + ' j'; }
  function startCode(t, k) { var h = hhmm(t).replace(/^0/, ''); return k === 'mid' ? h.split('h')[0] : h.replace(/h00$/, 'h'); }
  function miniChip(sh, attrs) {
    var k = colorKey(sh), letter = sh.kind === 'work' && MLETTER[k];
    var rm = shiftRooms(sh), tp = tplOf(sh), own = tp && tp.label ? tp.label : null;
    if (rm != null) { letter = String(rm); } else if (own) letter = own;
    var code = sh.kind === 'work' ? (letter || startCode(sh.actual_start && sh.actual_end ? sh.actual_start : sh.start_time, k)) : ABBR[sh.kind] || '?';
    if (letter && rm == null && !own) k = 'm-' + k;
    var ot = S.cache.otByShift && sh.id && S.cache.otByShift[sh.id];
    var title = shiftLabel(sh) + (sh.kind === 'work' ? ' ' + hhmm(sh.start_time) + '–' + hhmm(sh.end_time) : '') + (sh.extra_pay ? ' · extra à payer' : '') + (sh.jour_rendu ? ' · jour rendu' : '') + (sh.jour_sup ? ' · jour sup. à récupérer' : '') + (ot ? ' · +' + fmt(ot.minutes) + ' supp' : '') + (sh.note ? ' · ' + sh.note : '');
    return '<button type="button" class="mchip k-' + k + (sh.extra_pay ? ' xp' : '') + (ot ? ' ot' : '') + (sh.jour_rendu || sh.jour_sup ? ' jd' : '') + '" title="' + esc(title) + '" ' + (sh.kind !== 'work' ? dayStyle(sh.kind) + ' ' : tplStyle(tp) + ' ') + (attrs || '') + '>' + esc(code) + '</button>';
  }
  function readOnly() { return !can('planning', S.svc); }
  function groupRow(label, cols) { return '<tr class="grp"><td colspan="' + cols + '">' + esc(label) + '</td></tr>'; }
  function nameCell(p, cls, sub) {
    return '<td class="' + cls + ' emp-name" title="' + esc(counters(p)) + '"><b>' + esc(p.full_name) + '</b><span>' + sub + '</span></td>';
  }
  /* ---------- Effectif requis (Lingerie, Cafétéria…) : barème du service ---------- */
  function staffingCfg(svc) {
    var sv = S.services.find(function (x) { return x.id === svc; }); var c = sv && sv.staffing; if (c && !c.inputs) c.inputs = [];
    if (c) {   /* options désactivées pour l'entreprise : on retire les lignes correspondantes */
      c = Object.assign({}, c);
      if (!feat('staffing')) { c.inputs = []; c.tiers = []; c.base = null; c.min_staff = null; c.total = null; }
      if (!feat('extra')) delete c.extra;
      if (!feat('delivery')) c.delivery = false;
      if (!feat('rooms') || !feat('staffing')) c.rooms_left = false;
      if (!feat('by_location')) c.by_location = false;
    }
    return c && (c.inputs.length || c.min_staff != null || c.extra) ? c : null;
  }
  /* valeur sur laquelle s'applique le barème :
     sum = somme des lignes (Lingerie) · max = plus grande valeur (Cafétéria) ·
     formula = total.keys du jour + total.prev de la veille (Housekeeping : recouches + départs + bloquées la veille) */
  function staffTotal(cfg, vals, prev) {
    vals = vals || {}; prev = prev || {};
    if (cfg.combine === 'formula') {
      var t = cfg.total || {}, got = false, sum = 0;
      (t.keys || []).forEach(function (k) { if (vals[k] != null && vals[k] !== '') { got = true; sum += +vals[k]; } });
      (t.prev || []).forEach(function (k) { if (prev[k] != null && prev[k] !== '') { got = true; sum += +prev[k]; } });
      return got ? sum : null;
    }
    var nums = (cfg.inputs || []).map(function (i) { return vals[i.key]; }).filter(function (v) { return v != null && v !== ''; }).map(Number);
    if (!nums.length) return null;
    return cfg.combine === 'sum' ? nums.reduce(function (a, b) { return a + b; }, 0) : Math.max.apply(null, nums);
  }
  function formulaText(cfg) {
    var t = cfg.total || {}, lb = function (k) { var i = (cfg.inputs || []).find(function (x) { return x.key === k; }); return esc(i ? i.label : k).toLowerCase(); };
    return (t.keys || []).map(lb).concat((t.prev || []).map(function (k) { return lb(k) + ' de la veille'; })).join(' + ');
  }
  /* « Demande extra StaffHôtel » : extras demandés à l'agence, comptés comme des présents (simulation) ;
     au Housekeeping chaque extra fait cfg.extra.rooms chambres et compte dans la localisation cfg.extra.location */
  function extraN(cfg, d, get) { return cfg && cfg.extra ? Math.max(0, +((get(d) || {})._extra) || 0) : 0; }
  function presTxt(n, ex) { return ex ? n + '<small class="xtra">+' + ex + '</small>' : String(n); }
  function hasRule(cfg) { return !!((cfg.tiers || []).length || cfg.base != null || (cfg.min_staff != null && cfg.min_staff !== '')); }
  /* chambres restant à faire = total à faire − chambres des shifts posés ce jour-là (option « rooms_left ») */
  function roomsLeft(cfg, d, get, done) { var t = staffTotal(cfg, get(d) || {}, get(C.addDays(d, -1)) || {}); return t == null ? null : t - (done || 0); }
  function roomsCell(rem, d) { return '<td class="cnt' + (rem != null && rem > 0 ? ' short' : rem != null && rem < 0 ? ' extra' : '') + '" data-rem-day="' + d + '"' + (rem != null ? ' title="' + (rem > 0 ? rem + ' chambre(s) sans personne pour les faire' : rem < 0 ? 'capacité supérieure de ' + (-rem) + ' chambre(s)' : 'toutes les chambres sont couvertes') + '"' : '') + '><b>' + (rem == null ? '' : rem) + '</b></td>'; }
  function hasTotalRow(cfg) { return cfg.combine === 'formula' || (cfg.combine === 'sum' && cfg.inputs.length > 1); }
  function totalLabel(cfg) { return cfg.combine === 'formula' ? ((cfg.total || {}).label || 'Total') : 'Total'; }
  function prevCarry(cfg, prev) { return cfg.combine === 'formula' ? ((cfg.total || {}).prev || []).reduce(function (a, k) { return a + (+(prev || {})[k] || 0); }, 0) : 0; }
  function requiredFor(cfg, vals, prev) {
    var v = staffTotal(cfg, vals, prev);
    if (v == null) return null;
    var tiers = (cfg.tiers || []).slice().sort(function (a, b) { return b.over - a.over; });
    if (!tiers.length && cfg.base == null) return null;   // pas encore de barème : pas de contrôle
    for (var i = 0; i < tiers.length; i++) if (v > tiers[i].over) return tiers[i].n;
    return cfg.base == null ? 0 : +cfg.base;
  }
  /* effectif requis du jour d : barème + 1 personne si le jour d-2 est coché « Jour de livraison » */
  function requiredDay(cfg, d, get) {
    var base = requiredFor(cfg, get(d) || {}, get(C.addDays(d, -1)) || {});
    if (cfg.min_staff != null && cfg.min_staff !== '') base = base == null ? +cfg.min_staff : Math.max(base, +cfg.min_staff);   // minimum de présents chaque jour
    if (base == null) return null;
    var livr = !!cfg.delivery && !!(get(C.addDays(d, -2)) || {})._livr;
    return { n: base + (livr ? 1 : 0), base: base, livr: livr };
  }
  function reqLabel(r) { return r == null ? '' : r.livr ? r.base + '+1' : String(r.n); }
  function staffTitle(n, req) { return req == null ? '' : n + ' présent(s) pour ' + req + ' requis' + (n < req ? ' : il manque ' + (req - n) + ' personne(s)' : n > req ? ' : ' + (n - req) + ' personne(s) en trop' : ''); }
  function staffVals(day) { return (S.cache.staffVals || {})[day] || {}; }
  function refreshStaffDay(day) {
    var cfg = staffingCfg(S.svc); if (!cfg) return;
    var ex = extraN(cfg, day, staffVals), rq = requiredDay(cfg, day, staffVals), req = rq && rq.n, pres0 = (S.cache.presentByDay || {})[day] || 0, pres = pres0 + ex;
    var tc = document.querySelector('[data-tot-day="' + day + '"]'); if (tc) { var pv = staffVals(C.addDays(day, -1)), tv = staffTotal(cfg, staffVals(day), pv), cr = prevCarry(cfg, pv); tc.textContent = tv == null ? '' : tv; tc.title = cr ? 'dont ' + cr + ' chambre(s) bloquée(s) la veille' : ''; }
    var rc = document.querySelector('[data-req-day="' + day + '"]'), pc = document.querySelector('[data-pres-day="' + day + '"]');
    if (rc) { rc.textContent = reqLabel(rq); rc.title = rq && rq.livr ? 'Barème ' + rq.base + ' + 1 personne (livraison 2 jours avant) = ' + rq.n : ''; rc.classList.toggle('plus', !!(rq && rq.livr)); }
    var rmc = document.querySelector('[data-rem-day="' + day + '"]');
    if (rmc && cfg.rooms_left) { var tmp = document.createElement('tbody'); tmp.innerHTML = '<tr>' + roomsCell(roomsLeft(cfg, day, staffVals, ((S.cache.roomsByDay || {})[day] || 0) + ex * (+(cfg.extra || {}).rooms || 0)), day) + '</tr>'; rmc.replaceWith(tmp.querySelector('td')); }
    if (pc) { pc.innerHTML = '<b>' + presTxt(pres0, ex) + '</b>'; pc.classList.toggle('short', req != null && pres < req); pc.classList.toggle('extra', req != null && pres > req); pc.title = staffTitle(pres, req) + (ex ? ' (dont ' + ex + ' extra)' : ''); }
    document.querySelectorAll('[data-locx-day="' + day + '"]').forEach(function (c) { c.innerHTML = '<b>' + presTxt(+c.dataset.base, ex) + '</b>'; });
  }
  async function vTeamMonth() {
    var svc = S.svc, m = curMonth(), days = monthDays(m), first = days[0], last = days[days.length - 1], t = today(), ro = readOnly();
    var cfg = role() === 'employee' ? null : staffingCfg(svc);
    var res = await Promise.all([Store.shifts(C.addDays(first, -1), C.addDays(last, 1), { serviceId: svc }), Store.publishedMonths(svc), can('overtime', svc) ? Store.overtime(first, last, { serviceId: svc }) : [], role() !== 'employee' ? Store.staffingValues(svc, C.addDays(first, -2), last) : []]);
    var around = res[0], shifts = around.filter(function (s) { return s.day >= first && s.day <= last; });
    var pubs = res[1].map(function (p) { return p.month; }), published = pubs.indexOf(first) >= 0, team = teamOf(svc);
    S.cache.staffVals = {}; res[3].forEach(function (v) { (S.cache.staffVals[v.day] = S.cache.staffVals[v.day] || {})[v.key] = v.value; });
    if (role() === 'employee') team = team.filter(function (p) { return shifts.some(function (s) { return s.employee_id === p.id; }) || p.id === S.me.id; });
    S.cache.weekShifts = shifts; S.cache.around = around;
    S.cache.otByShift = {}; res[2].forEach(function (o) { if (o.shift_id) S.cache.otByShift[o.shift_id] = o; });
    // le mois suivant doit être publié N semaines avant son début
    var ahead = S.settings.publish_weeks_ahead == null ? 2 : +S.settings.publish_weeks_ahead;
    var next = C.addMonths(t.slice(0, 7) + '-01', 1), dueMissing = can('publish', svc) && ahead > 0 && t >= C.addDays(next, -7 * ahead) && pubs.indexOf(next) < 0;
    var livr = role() === 'employee' || !(cfg && cfg.delivery) ? '' : '<tr class="livrow"><th class="mname" title="Cochez les jours de livraison : « Livr. » s\'imprime au-dessus de la date">Jour de livraison</th>' + days.map(function (d) {
      var on = !!staffVals(d)._livr;
      return '<th class="mday lv">' + (ro ? (on ? '✓' : '') : '<input type="checkbox" data-change="livr" data-day="' + d + '"' + (on ? ' checked' : '') + ' aria-label="Livraison le ' + dayLong(d) + '">') + '</th>';
    }).join('') + '<th class="mtot"></th></tr>';
    var head = '<th class="mname">Salarié</th>' + days.map(function (d) {
      var dw = C.dow(d), hol = C.holidayName(d);
      return '<th class="mday' + (dw === 0 || dw === 6 ? ' we' : '') + (hol ? ' hol' : '') + (d === t ? ' today-col' : '') + '" title="' + dayLong(d) + (hol ? ' · ' + esc(hol) : '') + '">' +
        '<span>' + JOURS[dw].slice(0, 1).toUpperCase() + '</span><b>' + +d.slice(8, 10) + '</b></th>';
    }).join('') + '<th class="n mtot" title="Nombre de jours travaillés dans le mois">Jours</th>';
    var grp = null, locSplit = byLocation(svc) && team.some(function (q) { return groupOf(q, svc); });
    var body = team.map(function (p) {
      var mine = shifts.filter(function (s) { return s.employee_id === p.id; });
      var worked = mine.reduce(function (a, s) { return a + C.shiftDetail(s).worked; }, 0);
      var supp = res[2].filter(function (o) { return o.employee_id === p.id; }).reduce(function (a, o) { return a + o.minutes; }, 0);
      var cells = days.map(function (d) {
        var ds = mine.filter(function (s) { return s.day === d; }), dw = C.dow(d);
        return '<td class="cell mcell' + (dw === 0 || dw === 6 ? ' we' : '') + '"' + (ro ? '' : ' tabindex="0" data-act="cell"') + ' data-emp="' + p.id + '" data-day="' + d + '" aria-label="' + esc(p.full_name) + ', ' + dayLong(d) + '">' +
          ds.map(function (s) { return miniChip(s, ro ? 'tabindex="-1"' : 'data-act="edit" data-id="' + s.id + '"' + (s.request_id ? '' : ' data-drag="move"')); }).join('') + '</td>';
      }).join('');
      var g = groupOf(p, svc), gr = '';
      if (g !== grp) { grp = g; if (g) gr = groupRow(g, days.length + 2); }
      var row = gr + '<tr>' + nameCell(p, 'mname', esc(CONTRATS[p.contract_type])) + cells +
        '<td class="n mtot" title="' + fmt(worked) + ' prévues' + (supp ? ' · +' + fmt(supp) + ' supp' : '') + '"><div>' + daysTxt(workedDays(mine, days)) + '</div></td></tr>';
      // totaux de la localisation, sous son dernier salarié
      var nx = team[team.indexOf(p) + 1];
      if (locSplit && (!nx || groupOf(nx, svc) !== g)) row += locTotalRows(g || 'sans localisation', team.filter(function (q) { return groupOf(q, svc) === g; }).map(function (q) { return q.id; }), shifts, days);
      return row;
    }).join('');
    var foot = monthCounts(shifts, team, days, cfg);
    var staffRows = '';
    if (cfg) {
      staffRows = cfg.inputs.map(function (inp) {
        return '<tr class="staffrow"><th class="mname">' + esc(inp.label) + '</th>' + days.map(function (d) {
          var v = staffVals(d)[inp.key];
          return '<th class="mday sin">' + (ro ? (v == null ? '' : v) : '<input type="number" min="0" inputmode="numeric" data-change="staff" data-day="' + d + '" data-key="' + inp.key + '" value="' + (v == null ? '' : v) + '" aria-label="' + esc(inp.label) + ' le ' + dayLong(d) + '">') + '</th>';
        }).join('') + '<th class="mtot"></th></tr>';
      }).join('') +
      (hasTotalRow(cfg) ? '<tr class="staffrow tot"><th class="mname">' + esc(totalLabel(cfg)) + '</th>' + days.map(function (d) { var pv = staffVals(C.addDays(d, -1)), t = staffTotal(cfg, staffVals(d), pv), cr = prevCarry(cfg, pv); return '<th class="mday" data-tot-day="' + d + '"' + (cr ? ' title="dont ' + cr + ' chambre(s) bloquée(s) la veille"' : '') + '>' + (t == null ? '' : t) + '</th>'; }).join('') + '<th class="mtot"></th></tr>' : '') +
      (cfg.extra ? '<tr class="staffrow xrow"><th class="mname">' + esc(cfg.extra.label || 'Demande extra StaffHôtel') + '</th>' + days.map(function (d) {
          var v = staffVals(d)._extra;
          return '<th class="mday sin">' + (ro ? (v == null ? '' : v) : '<input type="number" min="0" max="20" inputmode="numeric" data-change="staff" data-day="' + d + '" data-key="_extra" value="' + (v == null ? '' : v) + '" aria-label="' + esc(cfg.extra.label || 'Demande extra StaffHôtel') + ' le ' + d + '">') + '</th>';
        }).join('') + '<th class="mtot"></th></tr>' : '') +
      (!hasRule(cfg) ? '' : '<tr class="staffrow req"><th class="mname">Effectif requis</th>' + days.map(function (d) { var r = requiredDay(cfg, d, staffVals); return '<th class="mday' + (r && r.livr ? ' plus' : '') + '" data-req-day="' + d + '"' + (r && r.livr ? ' title="Barème ' + r.base + ' + 1 personne (livraison 2 jours avant) = ' + r.n + '"' : '') + '>' + reqLabel(r) + '</th>'; }).join('') + '<th class="mtot"></th></tr>');
    }
    return '<div class="page-head"><div><div class="eyebrow">' + esc(svcName(svc)) + (ro ? ' · lecture seule' : '') + '</div><h2>Planning ' + esc(svcName(svc)) + '</h2></div>' +
      '<div class="row">' + svcSelect() + monthNav() + '</div></div>' +
      (dueMissing ? '<div class="banner warn">Attention : le planning de ' + MOIS_L[+next.slice(5, 7) - 1] + ' n\'est pas encore publié (publication attendue ' + ahead + ' semaine' + (ahead > 1 ? 's' : '') + ' avant le début du mois).' + (m !== next.slice(0, 7) ? ' <button class="btn sm" data-act="goto-month" data-m="' + next.slice(0, 7) + '">Ouvrir ce mois</button>' : '') + '</div>' : '') +
      (ro ? '' : '<div class="row" style="justify-content:space-between"><div class="row">' +
      (published ? '<span class="pill ok">Mois publié · visible par l\'équipe</span>' : '<span class="pill warn">Brouillon · invisible pour l\'équipe</span>') +
      '<span class="pill neutral">Repos minimum ' + minRest() + ' h entre deux shifts</span></div><div class="row">' +
      (feat('print') ? '<button class="btn sm" data-act="export">' + ICON.pdf + ' Imprimer le mois (PDF, 1 page)</button>' : '') +
      (can('planning', svc) && feat('rest_month') ? '<button class="btn sm" data-act="rest-month" title="Pose « Repos » sur les jours de repos habituels de chaque salarié (fiche Équipe), seulement sur les cases vides, à partir d\'aujourd\'hui">Poser les repos habituels</button>' : '') +
      (can('copy_week', svc) ? '<button class="btn sm" data-act="copy-month" title="Recopie, jour de semaine par jour de semaine, les shifts d\'il y a 4 ou 5 semaines sur les jours encore vides">Recopier les semaines précédentes</button>' : '') +
      (can('publish', svc) ? (published ? '<button class="btn sm ghost" data-act="unpublish">Dépublier le mois</button>' : '<button class="btn sm brass" data-act="publish">Publier le mois</button>') : '') + '</div></div>' + palette()) +
      (cfg && !cfg.inputs.length && cfg.min_staff == null ? '<p class="hint" style="margin:0">« ' + esc((cfg.extra || {}).label || 'Demande extra StaffHôtel') + ' » : chaque extra saisi compte comme une personne présente (simulation).</p>' : cfg && !cfg.inputs.length ? '<p class="hint" style="margin:0">Minimum ' + esc(cfg.min_staff) + ' présents chaque jour : la case « Présents » passe en jaune (chiffre rouge) s\'il en manque, en orange s\'il y en a plus.</p>' : cfg ? '<p class="hint" style="margin:0">Saisissez chaque jour ' + (cfg.combine === 'formula' ? 'les lignes ' + cfg.inputs.map(function (i) { return esc(i.label); }).join(', ') + ' (« ' + esc(totalLabel(cfg)) + ' » = ' + formulaText(cfg) + ')' : cfg.combine === 'sum' && cfg.inputs.length > 1 ? 'les lignes ' + cfg.inputs.map(function (i) { return esc(i.label); }).join(', ') + ' (le Total les additionne)' : cfg.inputs.map(function (i) { return '« ' + esc(i.label) + ' »'; }).join(' et ')) + ' : ou collez une ligne copiée depuis Excel dans la case du 1er jour (elle remplit tout le mois ; plusieurs lignes copiées remplissent aussi les lignes du dessous). HPG calcule l\'effectif requis (barème du service) : la case « Présents » passe en jaune (chiffre rouge) s\'il manque du personnel, en orange s\'il y a du personnel en trop.</p>' : '') +
      (team.length ? '<div class="table-wrap mwrap"><table class="grid mgrid"><thead>' + livr + '<tr>' + head + '</tr>' + staffRows + '</thead><tbody>' + body + '</tbody>' + foot + '</table></div>'
        : '<div class="panel empty">Aucun salarié actif dans ce service. Ajoutez-en dans l\'onglet Équipe.</div>') + monthLegend();
  }
  /* Totaux par localisation (option du service) : nombre de personnes par shift et présents de chaque localisation */
  function byLocation(svc) { var sv = S.services.find(function (x) { return x.id === svc; }); return !!(sv && sv.staffing && sv.staffing.by_location) && feat('by_location'); }
  function locStats(shifts, ids, days) {
    var groups = {}, pres = {};
    shifts.forEach(function (s) {
      if (s.kind !== 'work' || ids.indexOf(s.employee_id) < 0) return;
      var g = shiftGroup(s); groups[g.key] = groups[g.key] || Object.assign(g, { days: {} });
      groups[g.key].days[s.day] = (groups[g.key].days[s.day] || 0) + 1;
      (pres[s.day] = pres[s.day] || {})[s.employee_id] = 1;
    });
    var list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return a.order - b.order || a.label.localeCompare(b.label); });
    return { list: list, pres: days.map(function (d) { return Object.keys(pres[d] || {}).length; }) };
  }
  function locTotalRows(label, ids, shifts, days) {
    var st = locStats(shifts, ids, days);
    return [].map(function (g) {
      return '<tr class="loc-tot"><td class="mname cnt-lbl"><span class="chip k-' + g.color + '" style="display:inline-block;width:auto;padding:1px 6px;font-size:.68rem">' + esc(g.label) + '</span></td>' +
        days.map(function (d) { var n = g.days[d] || 0; return '<td class="cnt">' + (n ? n : '<span class="muted">·</span>') + '</td>'; }).join('') + '<td></td></tr>';
    }).join('') + '<tr class="loc-tot loc-pres"><td class="mname cnt-lbl"><b>Présents ' + esc(label) + '</b></td>' + st.pres.map(function (n, i) {
      var cfgX = staffingCfg(S.svc), mine = cfgX && cfgX.extra && cfgX.extra.location && String(cfgX.extra.location).toUpperCase() === String(label).toUpperCase();
      return mine ? '<td class="cnt" data-locx-day="' + days[i] + '" data-base="' + n + '"><b>' + presTxt(n, extraN(cfgX, days[i], staffVals)) + '</b></td>' : '<td class="cnt"><b>' + n + '</b></td>';
    }).join('') + '<td></td></tr>';
  }
  /* Pied du planning mensuel : nombre de personnes par shift et par jour + présents */
  function monthCounts(shifts, team, days, cfg) {
    var ids = team.map(function (p) { return p.id; }), groups = {};
    shifts.forEach(function (s) {
      if (s.kind !== 'work' || ids.indexOf(s.employee_id) < 0) return;
      var g = shiftGroup(s); groups[g.key] = groups[g.key] || Object.assign(g, { days: {} });
      groups[g.key].days[s.day] = (groups[g.key].days[s.day] || 0) + 1;
    });
    var list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return a.order - b.order || a.label.localeCompare(b.label); });
    var rows = list.map(function (g) {
      return '<tr><td class="mname cnt-lbl"><span class="chip k-' + g.color + '" style="display:inline-block;width:auto;padding:1px 6px;font-size:.7rem">' + esc(g.label) + '</span></td>' +
        days.map(function (d) { var n = g.days[d] || 0; return '<td class="cnt">' + (n ? n : '<span class="muted">·</span>') + '</td>'; }).join('') + '<td></td></tr>';
    }).join('');
    S.cache.presentByDay = {};
    var all = days.map(function (d) {
      var ppl = {}; shifts.forEach(function (s) { if (s.kind === 'work' && s.day === d && ids.indexOf(s.employee_id) >= 0) ppl[s.employee_id] = 1; });
      var n0 = Object.keys(ppl).length, ex = extraN(cfg, d, staffVals), n = n0 + ex, rq = cfg ? requiredDay(cfg, d, staffVals) : null, req = rq ? rq.n : null, short = req != null && n < req, extra = req != null && n > req;
      S.cache.presentByDay[d] = n0;
      return '<td class="cnt' + (short ? ' short' : extra ? ' extra' : '') + '" data-pres-day="' + d + '"' + (req != null ? ' title="' + staffTitle(n, req) + (ex ? ' (dont ' + ex + ' extra)' : '') + '"' : '') + '><b>' + presTxt(n0, ex) + '</b></td>';
    }).join('');
    var roomsRow = '';
    S.cache.roomsByDay = {};
    if (cfg && cfg.rooms_left) {
      roomsRow = '<tr class="foot-total rooms-left"><td class="mname cnt-lbl"><b>Chambres restant à faire</b></td>' + days.map(function (d) {
        var done = 0; shifts.forEach(function (s) { if (s.day === d && ids.indexOf(s.employee_id) >= 0) done += shiftRooms(s) || 0; });
        S.cache.roomsByDay[d] = done;
        return roomsCell(roomsLeft(cfg, d, staffVals, done + extraN(cfg, d, staffVals) * (+(cfg.extra || {}).rooms || 0)), d);
      }).join('') + '<td></td></tr>';
    }
    return '<tfoot><tr class="foot-total"><td class="mname cnt-lbl"><b>Présents</b></td>' + all + '<td></td></tr>' + roomsRow + '</tfoot>';
  }
  /* légende tirée des shifts du service (Paramètres → Shifts par service) : toujours à jour */
  function tplSample(t) { return { kind: 'work', template_id: t.id, start_time: t.start_time, end_time: t.end_time }; }
  function monthLegend() {
    var tl = svcTemplates(S.svc).slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    return '<div class="row muted mlegend">Shifts : ' + (tl.length ? tl.map(function (t) { return miniChip(tplSample(t), 'tabindex="-1" style="pointer-events:none"') + ' ' + esc(t.name) + ' ' + hhmm(t.start_time) + '–' + hhmm(t.end_time); }).join(' · ') : 'aucun shift défini pour ce service') + '</div>' +
      '<div class="row muted mlegend">Journées : ' + DAYKINDS.map(function (k) { return '<span class="mchip k-' + k[0] + '" style="pointer-events:none"' + dayStyle(k[0]) + '>' + esc(k[2]) + '</span> ' + esc(k[1]); }).join(' · ') + '</div>';
  }
  async function vMyMonth() {
    var me = S.me, m = curMonth(), days = monthDays(m), first = days[0], last = days[days.length - 1], t = today();
    var res = await Promise.all([Store.shifts(first, last, { employeeId: me.id }), Store.publishedMonths()]);
    var shifts = res[0], published = res[1].some(function (p) { return p.month === first && (me.services || []).indexOf(p.service_id) >= 0; });
    var worked = shifts.reduce(function (a, s) { return a + C.shiftDetail(s).worked; }, 0);
    var start = C.weekStart(first), end = C.addDays(C.weekStart(last), 6), cells = '';
    for (var d = start; d <= end; d = C.addDays(d, 1)) {
      var inM = d >= first && d <= last, ds = shifts.filter(function (s) { return s.day === d; }), hol = C.holidayName(d);
      cells += '<div class="cal-day' + (inM ? '' : ' out') + (d === t ? ' today' : '') + '"><div class="cal-n">' + +d.slice(8, 10) + (hol && inM ? ' <span class="hol">' + esc(hol) + '</span>' : '') + '</div>' +
        (inM ? ds.map(function (s) { return chip(s, 'tabindex="-1"'); }).join('') : '') + '</div>';
    }
    return '<div class="page-head"><div><div class="eyebrow">' + esc((me.services || []).map(svcName).join(' · ')) + '</div><h2>Mon planning</h2></div><div class="row">' + monthNav() + '</div></div>' +
      (!published ? '<div class="banner info">Le planning de ce mois n\'est pas encore publié. Vous recevrez une notification dès sa publication.</div>' : '') +
      '<div class="stats"><div class="stat"><div class="v">' + fmt(worked) + '</div><div class="l">heures prévues ce mois</div></div>' +
      '<div class="stat"><div class="v">' + shifts.filter(function (s) { return s.kind === 'work'; }).length + '</div><div class="l">jours travaillés</div></div></div>' +
      '<div class="cal"><div class="cal-h">' + ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(function (x) { return '<div>' + x + '</div>'; }).join('') + '</div><div class="cal-g">' + cells + '</div></div>' +
      '<p class="hint">Seuls les mois publiés par votre manager apparaissent, avec vos congés validés.</p>' + legend();
  }
  async function vTeamPlanning() { return vTeamMonth(); }
  /* Effectif par shift et par jour (pied du tableau du planning) */
  function shiftGroup(s) { var t = (s.template_id && S.templates.find(function (x) { return x.id === s.template_id; })) || templateFor(s); return t ? { key: 't' + t.id, label: t.name, color: t.color, order: t.sort || 0 } : { key: 'x' + (s.label || 'libre'), label: s.label || 'Horaire libre', color: colorKey(s), order: 999 }; }
  function staffCounts(shifts, team, ws) {
    var ids = team.map(function (p) { return p.id; }), groups = {};
    shifts.forEach(function (s) {
      if (s.kind !== 'work' || ids.indexOf(s.employee_id) < 0) return;
      var g = shiftGroup(s); groups[g.key] = groups[g.key] || Object.assign(g, { days: {} });
      groups[g.key].days[s.day] = (groups[g.key].days[s.day] || 0) + 1;
    });
    var list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return a.order - b.order || a.label.localeCompare(b.label); });
    if (!list.length) return '';
    var rows = list.map(function (g) {
      var cells = '', tot = 0;
      for (var i = 0; i < 7; i++) { var d = C.addDays(ws, i), n = g.days[d] || 0; tot += n; cells += '<td class="cnt">' + (n ? '<b>' + n + '</b>' : '<span class="muted">–</span>') + '</td>'; }
      return '<tr><td class="cnt-lbl"><span class="chip k-' + g.color + '" style="display:inline-block;width:auto;padding:2px 8px">' + esc(g.label) + '</span></td>' + cells + '<td class="n muted small">' + tot + '</td></tr>';
    }).join('');
    var all = '';
    for (var i = 0; i < 7; i++) {
      var d = C.addDays(ws, i), people = {};
      shifts.forEach(function (s) { if (s.kind === 'work' && s.day === d && ids.indexOf(s.employee_id) >= 0) people[s.employee_id] = 1; });
      all += '<td class="cnt"><b>' + Object.keys(people).length + '</b></td>';
    }
    return '<tfoot><tr class="foot-title"><td colspan="9">Nombre de personnes par shift</td></tr>' + rows +
      '<tr class="foot-total"><td class="cnt-lbl"><b>Présents / jour</b></td>' + all + '<td></td></tr></tfoot>';
  }
  function legend() {
    var seen = {}, tl = [];
    ((S.me && S.me.services) || [S.svc]).forEach(function (sv) { svcTemplates(sv).forEach(function (t) { if (!seen[t.id]) { seen[t.id] = 1; tl.push(t); } }); });
    var k = DAYKINDS;
    return '<div class="row mlegend">' + tl.map(function (t) { return '<span class="chip k-' + (t.color || 'am') + '" style="width:auto;display:inline-block;padding:1px 6px;font-size:.62rem' + (t.bg ? ';background:' + esc(t.bg) + ';color:' + esc(t.fg || '#000') : '') + '">' + esc((t.label ? t.label + ' · ' : '') + t.name + ' ' + hhmm(t.start_time) + '–' + hhmm(t.end_time)) + '</span>'; }).join('') + k.map(function (x) { return '<span class="chip k-' + x[0] + '" style="width:auto;display:inline-block;padding:1px 6px;font-size:.62rem"' + dayStyle(x[0]) + '>' + esc(x[1]) + '</span>'; }).join('') + '</div>';
  }

  /* Vérifie le repos minimum avant d'envoyer (la base le vérifie aussi) */
  function restMessage(sh, ignore) {
    var others = (S.cache.around || []).filter(function (s) { return s.employee_id === sh.employee_id && s.id !== sh.id && !(ignore && ignore.indexOf(s.id) >= 0); });
    var r = C.restCheck(sh, others, minRest());
    if (!r) return null;
    var o = r.other;
    if (r.type === 'overlap') return 'Ce shift chevauche l\'horaire du ' + dayShort(o.day) + ' (' + hhmm(o.start_time) + ' – ' + hhmm(o.end_time) + ').';
    return 'Repos de ' + minRest() + ' h non respecté pour ' + name(sh.employee_id) + ' : seulement ' + fmt(r.gap) + ' entre ce shift et celui du ' + dayShort(o.day) + ' (' + hhmm(o.start_time) + ' – ' + hhmm(o.end_time) + ').';
  }
  /* Poser un shift ou une journée : ce qui occupe déjà la case est remplacé automatiquement.
     Exceptions : une journée posée par une demande validée (à retirer à la main) ; Maj enfoncée = ajouter sans remplacer. */
  function replacedBy(sh, opts) {
    var cell = (S.cache.weekShifts || []).filter(function (s) { return s.employee_id === sh.employee_id && s.day === sh.day && s.id !== sh.id; });
    if (opts && opts.add) return { cell: cell, gone: cell.filter(function (s) { return SOFT.indexOf(s.kind) >= 0; }), locked: [] };
    return { cell: cell, gone: cell.filter(function (s) { return !s.request_id; }), locked: cell.filter(function (s) { return s.request_id; }) };
  }
  async function placeShift(sh, opts) {
    opts = opts || {};
    var r = replacedBy(sh, opts), goneIds = r.gone.map(function (s) { return s.id; });
    if (r.locked.length) { toast(name(sh.employee_id) + ' a « ' + shiftLabel(r.locked[0]) + ' » validé par une demande ce jour-là : retirez-le d\'abord.', true); return false; }
    if (opts.add) {
      var hard = r.cell.filter(function (s) { return SOFT.indexOf(s.kind) < 0; });
      if (sh.kind !== 'work' && hard.length) { toast(name(sh.employee_id) + ' a déjà « ' + shiftLabel(hard[0]) + ' » ce jour-là.', true); return false; }
      if (sh.kind === 'work' && hard.some(function (s) { return s.kind !== 'work'; })) { toast(name(sh.employee_id) + ' est absent ce jour-là.', true); return false; }
    }
    if (sh.kind === 'work') { var msg = restMessage(sh, goneIds); if (msg) { toast(msg, true); return false; } }
    if ((sh.kind === 'ferie' || sh.kind === 'recup') && !sh.owed_id && !opts.picked) return openOwedPicker(sh, opts);
    var lostOt = r.gone.filter(function (s) { return S.cache.otByShift && S.cache.otByShift[s.id]; }).length;
    var movedOt = sh.id && S.cache.otByShift && S.cache.otByShift[sh.id];
    try {
      if (!goneIds.length) await Store.saveShift(sh);              // case vide (ou déplacement simple)
      else {
        // remplacement en une seule opération : si la pose est refusée, rien ne change
        var row = await Store.replaceCell(sh.id ? goneIds.concat([sh.id]) : goneIds, sh);
        if (movedOt) { try { await Store.saveOvertime({ shift_id: row.id, minutes: movedOt.minutes, reason: movedOt.reason }); } catch (e2) {} }
      }
      var replaced = r.gone.filter(function (s) { return SOFT.indexOf(s.kind) < 0; });
      toast((opts.ok || (sh.kind === 'work' ? 'Shift attribué' : shiftLabel(sh) + ' posé')) +
        (replaced.length ? ' · remplace « ' + replaced.map(shiftLabel).join(', ') + ' »' : '') + (lostOt ? ' · heures supp du shift remplacé retirées' : ''));
    } catch (e) { toast(e.message || String(e), true); }
    S.profiles = await Store.profiles();
    render(); return true;
  }
  /* Jour férié ou jour à récupérer : choisir dans la liste du salarié quel jour est rendu */
  async function openOwedPicker(sh, opts) {
    var list = (await Store.owedDays({ employeeId: sh.employee_id })).filter(function (o) { return o.type === sh.kind && (!o.rendered_shift_id || o.rendered_shift_id === sh.id); });
    var what = sh.kind === 'ferie' ? 'jour férié dû' : 'jour à récupérer';
    if (!list.length) { toast(name(sh.employee_id) + ' n\'a aucun ' + what + '. Créditez-le d\'abord (Équipe → Jours dus).', true); render(); return false; }
    if (list.length === 1) return placeShift(Object.assign({}, sh, { owed_id: list[0].id }), Object.assign({}, opts, { picked: true }));
    dlg.innerHTML = '<form id="op" class="form" novalidate><div class="dlg-h"><div><div class="eyebrow">' + esc(name(sh.employee_id)) + ' · ' + dayLong(sh.day) + '</div><h3>Quel ' + what + ' est rendu ?</h3></div><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div><div class="dlg-b">' +
      '<div class="list">' + list.map(function (o, i) {
        return '<label class="item pick"><div><div class="title">' + (o.origin_date ? (sh.kind === 'ferie' ? 'Férié du ' : 'Dû pour le ') + dayLong(o.origin_date) + ' ' + o.origin_date.slice(0, 4) : 'Sans date') + (o.days < 1 ? ' · ½ j' : '') + '</div>' +
          '<div class="sub">' + esc(o.reason || '') + '</div></div><div class="acts"><input type="radio" name="owed" value="' + o.id + '"' + (i === 0 ? ' checked' : '') + '></div></label>';
      }).join('') + '</div>' +
      '<label class="f">Note (visible dans le planning et la liste du salarié)<input type="text" id="op-note" maxlength="120" value="' + esc(sh.note || '') + '" placeholder="Ex. : rendu pour le férié du 11/11"></label>' +
      '</div><div class="dlg-f"><span></span><div class="row"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary" type="submit">Poser le jour</button></div></div></form>';
    var f = dlg.querySelector('#op');
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var id = (f.querySelector('input[name=owed]:checked') || {}).value, note = f.querySelector('#op-note').value.trim();
      dlg.close();
      placeShift(Object.assign({}, sh, { owed_id: id, note: note || sh.note || null }), Object.assign({}, opts, { picked: true }));
    });
    dlg.showModal();
    return false;
  }

  /* Glisser-déposer (souris, stylet ; au doigt depuis la palette) */
  var drag = null, swallowClick = false;
  function cellAt(x, y) { var el = document.elementFromPoint(x, y); return el && el.closest && el.closest('td.cell'); }
  function dragShift(kind, src) {
    if (kind === 'tpl') {
      if (src.dataset.tpl.indexOf('kind:') === 0) { var k = src.dataset.tpl.slice(5); return { kind: k, label: KLABEL[k] }; }
      var t = S.templates.find(function (x) { return String(x.id) === src.dataset.tpl; });
      return { kind: 'work', template_id: t.id, start_time: t.start_time.slice(0, 5), end_time: t.end_time.slice(0, 5), label: t.name, color: t.color, break_min: null };
    }
    var s = (S.cache.weekShifts || []).find(function (x) { return x.id === src.dataset.id; });
    return s ? Object.assign({}, s) : null;
  }
  app.addEventListener('pointerdown', function (e) {
    var src = e.target.closest('[data-drag]');
    if (!src || e.button > 0) return;
    if (src.dataset.drag === 'move' && e.pointerType === 'touch') return;
    drag = { src: src, kind: src.dataset.drag, x: e.clientX, y: e.clientY, active: false, target: null };
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 6) return;
      drag.active = true; drag.shift = dragShift(drag.kind, drag.src);
      if (!drag.shift) { drag = null; return; }
      drag.ghost = drag.src.cloneNode(true); drag.ghost.className += ' drag-ghost'; drag.ghost.style.width = drag.src.offsetWidth + 'px';
      document.body.appendChild(drag.ghost); document.body.classList.add('dragging');
      if (drag.kind === 'move') drag.src.classList.add('lifted');
    }
    e.preventDefault();
    // défilement automatique près des bords pendant le glisser
    if (e.clientY > window.innerHeight - 50) window.scrollBy(0, 14); else if (e.clientY < 70) window.scrollBy(0, -14);
    var wrap = document.querySelector('.table-wrap');
    if (wrap) { var r = wrap.getBoundingClientRect(); if (e.clientY > r.top && e.clientY < r.bottom) { if (e.clientX > r.right - 40) wrap.scrollLeft += 14; else if (e.clientX < r.left + 40) wrap.scrollLeft -= 14; } }
    drag.ghost.style.transform = 'translate(' + (e.clientX + 8) + 'px,' + (e.clientY + 8) + 'px)';
    var c = cellAt(e.clientX, e.clientY);
    if (c !== drag.target) {
      if (drag.target) drag.target.classList.remove('drop-ok', 'drop-bad', 'drop-replace');
      drag.target = c;
      if (c) {
        var cand = Object.assign({}, drag.shift, { employee_id: c.dataset.emp, day: c.dataset.day, service_id: S.svc });
        if (drag.kind === 'move' && (e.ctrlKey || e.altKey)) delete cand.id;
        var rb = replacedBy(cand, { add: e.shiftKey });
        c.classList.add(rb.locked.length || (cand.kind === 'work' && restMessage(cand, rb.gone.map(function (x) { return x.id; }))) ? 'drop-bad' : rb.gone.some(function (x) { return SOFT.indexOf(x.kind) < 0; }) ? 'drop-replace' : 'drop-ok');
      }
    }
  }, { passive: false });
  function endDrag(e, cancel) {
    if (!drag) return;
    var d = drag; drag = null;
    if (!d.active) return;
    swallowClick = true; setTimeout(function () { swallowClick = false; }, 50);
    d.ghost.remove(); document.body.classList.remove('dragging'); d.src.classList.remove('lifted');
    if (d.target) d.target.classList.remove('drop-ok', 'drop-bad', 'drop-replace');
    if (cancel || !d.target) return;
    var copy = d.kind === 'move' && (e.ctrlKey || e.altKey);
    var sh = Object.assign({}, d.shift, { employee_id: d.target.dataset.emp, day: d.target.dataset.day, service_id: S.svc });
    if (d.kind === 'tpl' || copy) { delete sh.id; delete sh.updated_at; delete sh.updated_by; delete sh.owed_id; delete sh.request_id; sh.jour_rendu = false; sh.jour_sup = false; }
    if (d.kind === 'move' && !copy && sh.employee_id !== d.shift.employee_id) { sh.owed_id = null; sh.jour_rendu = false; sh.jour_sup = false; }
    if (d.kind === 'move' && !copy && sh.employee_id === d.shift.employee_id && sh.day === d.shift.day) return;
    placeShift(sh, { ok: copy ? 'Copié' : d.kind === 'move' ? 'Déplacé' : null, add: e.shiftKey });
  }
  window.addEventListener('pointerup', function (e) { endDrag(e, false); });
  window.addEventListener('pointercancel', function (e) { endDrag(e, true); });
  app.addEventListener('click', function (e) { if (swallowClick) { e.stopPropagation(); e.preventDefault(); } }, true);

  /* Éditeur d'une case (clic) : modèle de shift ou type de journée — horaires et couleurs viennent des modèles */
  async function openEditor(sh) {
    var emp = S.profiles.find(function (p) { return p.id === sh.employee_id; });
    var isNew = !sh.id, fromRequest = !!sh.request_id, kind = sh.kind || 'work';
    var owedAll = await Store.owedDays({ employeeId: sh.employee_id });
    var tplList = svcTemplates(S.svc), curTpl = sh.kind === 'work' ? templateFor(sh) : null;
    if (sh.kind === 'work' && curTpl && tplList.indexOf(curTpl) < 0) tplList = tplList.concat([curTpl]);
    var tplSel = '<select id="ed-tpl">' + tplList.map(function (t) { return '<option value="' + t.id + '"' + (curTpl && curTpl.id === t.id ? ' selected' : '') + '>' + esc(t.name) + ' · ' + hhmm(t.start_time) + '–' + hhmm(t.end_time) + '</option>'; }).join('') +
      (sh.kind === 'work' && !curTpl && sh.start_time ? '<option value="" selected>Horaire actuel ' + hhmm(sh.start_time) + '–' + hhmm(sh.end_time) + '</option>' : '') + '</select>';
    var kindSel = '<select id="ed-kind"><option value="work"' + (kind === 'work' ? ' selected' : '') + '>Shift de travail</option>' +
      DAYKINDS.map(function (k) { return '<option value="' + k[0] + '"' + (kind === k[0] ? ' selected' : '') + '>' + esc(k[2] + ' · ' + k[1]) + '</option>'; }).join('') + '</select>';
    var team = teamOf(S.svc);
    var empOpts = team.map(function (p) { return '<option value="' + p.id + '"' + (p.id === sh.employee_id ? ' selected' : '') + '>' + esc(p.full_name) + '</option>'; }).join('');
    var curOt = sh.id && S.cache.otByShift ? S.cache.otByShift[sh.id] : null, canOt = can('overtime', S.svc);
    var others = team.filter(function (p) { return p.id !== sh.employee_id; });
    var workDays = {}; (S.cache.around || S.cache.weekShifts || []).forEach(function (s) { if (s.employee_id === sh.employee_id && s.kind === 'work' && s.id !== sh.id && C.weekStart(s.day) === C.weekStart(sh.day)) workDays[s.day] = 1; });
    workDays[sh.day] = 1;
    var nthDay = Object.keys(workDays).length;
    var rendreOpen = owedAll.filter(function (o) { return o.type === 'rendre' && (!o.rendered_shift_id || o.rendered_shift_id === sh.id); });
    function d(x) { return x ? x.split('-').reverse().join('/') : 'sans date'; }
    var showRendu = rendreOpen.length > 0 || sh.jour_rendu, showSup = !rendreOpen.filter(function (o) { return !o.rendered_shift_id; }).length || sh.jour_sup;
    dlg.innerHTML = '<form method="dialog" id="ed" novalidate><div class="dlg-h"><div><div class="eyebrow">' + esc(emp ? emp.full_name : '') + '</div><h3>' + dayLong(sh.day) + '</h3></div>' +
      '<button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div><div class="dlg-b">' +
      (fromRequest ? '<div class="banner info">Journée posée par une demande validée (' + esc(shiftLabel(sh)) + '). Vous pouvez la retirer si besoin.</div>' :
      '<label class="f">Modèle de shift ou type de journée' + kindSel + '</label>' +
      '<div id="work-fields"' + (kind === 'work' ? '' : ' hidden') + ' class="form">' +
      '<label class="f">Modèle (horaires et couleur définis par l\'administrateur)' + tplSel + '</label>' +
      (canOt ? '<div class="otbox"><div class="eyebrow">Heures supp sur ce shift</div><div class="two">' +
      '<label class="f">Durée' + durSel('ed-ot', curOt ? curOt.minutes : 0) + '</label>' +
      '<label class="f">Motif<input type="text" id="ed-ot-reason" maxlength="120" value="' + esc(curOt && curOt.reason || '') + '" placeholder="Remplacement, rush…"></label></div>' +
      '<div class="hint">Inscrites à la date du shift (encadré « +1h30 » sur le planning). Laissez 0 h 00 s\'il n\'y en a pas.</div></div>' : '') +
      '<label class="xpbox"><input type="checkbox" id="ed-xp"' + (sh.extra_pay ? ' checked' : '') + '> <span><b>Extra à payer</b>' +
      (nthDay >= 6 ? ' · <span style="color:var(--warn)">' + nthDay + 'e jour travaillé cette semaine</span>' : '') +
      '<br><span class="hint">Apparaît « extra à payer » dans le planning et dans la colonne Observations de la fiche de présence.</span></span></label>' +
      (showRendu ? '<label class="xpbox"><input type="checkbox" id="ed-rendu"' + (sh.jour_rendu ? ' checked' : '') + '> <span><b>Jour rendu</b> — ce shift rend un jour que ' + esc(emp ? emp.full_name : 'le salarié') + ' doit à l\'entreprise<br>' +
        '<select id="ed-rendu-owed"' + (sh.jour_rendu ? '' : ' disabled') + '><option value="">— Choisir le jour rendu (obligatoire) —</option>' + rendreOpen.map(function (o) { return '<option value="' + o.id + '"' + (o.id === sh.owed_id ? ' selected' : '') + '>Jour à rendre du ' + d(o.origin_date) + (o.reason ? ' · ' + esc(o.reason) : '') + '</option>'; }).join('') + '</select></span></label>' : '') +
      (showSup ? '<label class="xpbox"><input type="checkbox" id="ed-sup"' + (sh.jour_sup ? ' checked' : '') + '> <span><b>Jour supplémentaire à récupérer</b> — ajoute 1 jour à sa liste « jours à récupérer »' +
        (rendreOpen.length && !sh.jour_sup ? '' : '') + '</span></label>' : '') +
      '</div>' +
      '<div id="owed-box" class="form"' + (kind === 'ferie' || kind === 'recup' ? '' : ' hidden') + '><label class="f">Jour pris dans la liste du salarié<select id="ed-owed"></select></label></div>' +
      '<div class="hint" id="kind-hint"></div>' +
      '<label class="f">Note<input type="text" id="ed-note" maxlength="120" value="' + esc(sh.note || '') + '" placeholder="Ex. : échange avec un collègue"></label>' +
      (others.length ? '<details class="real"><summary>Attribuer aussi à d\'autres salariés le même jour</summary><div class="checks">' +
        others.map(function (p) { return '<label class="row"><input type="checkbox" name="also" value="' + p.id + '"> ' + esc(p.full_name) + '</label>'; }).join('') + '</div></details>' : '') +
      (isNew ? '' : '<details class="real"><summary>Déplacer vers un autre jour ou un autre salarié</summary><div class="two" style="margin-top:10px"><label class="f">Salarié<select id="ed-emp">' + empOpts + '</select></label><label class="f">Date<input type="date" id="ed-day" value="' + sh.day + '"></label></div></details>') +
      '<div class="hint" id="ed-calc"></div>') +
      '<div class="err" id="ed-err" role="alert"></div></div><div class="dlg-f"><div>' + (isNew ? '' : '<button type="button" class="btn danger" data-del>Supprimer</button>') + '</div>' +
      '<div class="row"><button type="button" class="btn ghost" data-close>Annuler</button>' + (fromRequest ? '' : '<button type="submit" class="btn primary">Enregistrer</button>') + '</div></div></form>';
    var f = dlg.querySelector('#ed'), cur = Object.assign({}, sh, { kind: kind });
    var HINTS = { cp: 'Retire 1 jour de congés payés (sauf dimanche et férié). Rendu si la journée est retirée ou remplacée.', ferie: 'Prend un jour férié dû dans la liste du salarié.',
      recup: 'Prend un jour à récupérer dans la liste du salarié. Compté comme travaillé sur la fiche de présence.', rendre: 'Le salarié devra rendre ce jour : +1 dans sa liste « jours à rendre ». Compté comme travaillé sur la fiche de présence.',
      anciennete: 'Retire 1 jour d\'ancienneté.', ot_day: 'Retire ' + fmt(otDayMin()) + ' du compteur d\'heures supp (réglable dans les Paramètres).',
      formation: 'Comme un repos : aucune heure comptée.', maladie: 'Colonne « M » de la fiche de présence.', at: 'Colonne « AT » de la fiche de présence.',
      css: 'Colonne « _ » (absent) de la fiche de présence, avec « congé sans solde » en observation.', absence: 'Colonne « _ » (absent) de la fiche de présence.' };
    function loadOwed() {
      var sel = f.querySelector('#ed-owed'); if (!sel) return;
      var k = f.querySelector('#ed-kind').value;
      var list = owedAll.filter(function (o) { return o.type === k && (!o.rendered_shift_id || o.rendered_shift_id === sh.id); });
      sel.innerHTML = list.length ? list.map(function (o) {
        return '<option value="' + o.id + '"' + (o.id === sh.owed_id ? ' selected' : '') + '>' + (k === 'ferie' ? 'Férié du ' : 'Dû pour le ') + d(o.origin_date) + (o.reason ? ' · ' + esc(o.reason) : '') + (o.days < 1 ? ' (½ j)' : '') + '</option>';
      }).join('') : '<option value="">Aucun jour dû : créditez-le dans Équipe → Jours dus</option>';
    }
    function sync() {
      var k = f.querySelector('#ed-kind'); if (!k) return;
      cur.kind = k.value;
      f.querySelector('#work-fields').hidden = cur.kind !== 'work';
      f.querySelector('#owed-box').hidden = !(cur.kind === 'ferie' || cur.kind === 'recup');
      f.querySelector('#kind-hint').textContent = HINTS[cur.kind] || '';
      if (cur.kind === 'ferie' || cur.kind === 'recup') loadOwed();
      var ru = f.querySelector('#ed-rendu'), su = f.querySelector('#ed-sup'), rs = f.querySelector('#ed-rendu-owed');
      if (ru && rs) rs.disabled = !ru.checked;
      if (ru && su) { if (ru.checked) su.checked = false; su.disabled = ru.checked; }
    }
    function read() {
      var v = function (id) { var el = f.querySelector('#' + id); return el ? el.value : ''; };
      var o = Object.assign({}, cur);
      if (o.kind === 'work') {
        var t = S.templates.find(function (x) { return String(x.id) === v('ed-tpl'); });
        if (t) { o.template_id = t.id; o.start_time = t.start_time.slice(0, 5); o.end_time = t.end_time.slice(0, 5); o.label = t.name; o.color = t.color; }
        o.extra_pay = !!(f.querySelector('#ed-xp') || {}).checked;
        o.jour_rendu = !!(f.querySelector('#ed-rendu') || {}).checked;
        o.jour_sup = !o.jour_rendu && !!(f.querySelector('#ed-sup') || {}).checked;
        o.owed_id = o.jour_rendu ? (v('ed-rendu-owed') || null) : null;
      } else {
        o.start_time = o.end_time = o.break_min = o.template_id = null; o.label = KLABEL[o.kind]; o.color = null; o.extra_pay = false; o.jour_rendu = false; o.jour_sup = false;
        o.owed_id = (o.kind === 'ferie' || o.kind === 'recup') ? (v('ed-owed') || null) : null;
      }
      o.note = v('ed-note').trim() || null;
      if (v('ed-emp')) o.employee_id = v('ed-emp');
      if (v('ed-day')) o.day = v('ed-day');
      return o;
    }
    function calc() {
      var out = f.querySelector('#ed-calc'); if (!out) return;
      var o = read();
      if (o.kind !== 'work' || !o.start_time || !o.end_time) { out.textContent = ''; return; }
      var dd = C.shiftDetail(o), rest = restMessage(o);
      out.innerHTML = esc(hhmm(o.start_time) + '–' + hhmm(o.end_time) + ' · ' + fmt(dd.worked) + ' travaillées (pause ' + dd.breakMin + ' min)' + (dd.night ? ' · ' + fmt(dd.night) + ' de nuit' : '') + (dd.holiday ? ' · jour férié' : '')) +
        (rest ? '<div class="err" style="margin-top:4px">' + esc(rest) + '</div>' : '');
    }
    f.addEventListener('input', calc);
    f.addEventListener('change', function (e) { sync(); calc(); });
    f.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-close')) { dlg.close(); return; }
      if (b.hasAttribute('data-del')) {
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmer la suppression'; return; }
        try { await attempt(function () { return Store.deleteShift(sh.id); }, 'Supprimé'); dlg.close(); S.profiles = await Store.profiles(); render(); } catch (err) {}
      }
    });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var o = read(), err = f.querySelector('#ed-err');
      if (o.kind === 'work' && (!o.start_time || !o.end_time)) { err.textContent = 'Choisissez un modèle de shift.'; return; }
      if (o.kind === 'work' && o.jour_rendu && !o.owed_id) { err.textContent = 'Choisissez dans la liste le jour à rendre qui est rendu.'; return; }
      if (o.kind === 'work') { var rest = restMessage(o); if (rest) { err.textContent = rest; return; } }
      var cell = (S.cache.weekShifts || []).filter(function (s) { return s.employee_id === o.employee_id && s.day === o.day && s.id !== o.id && SOFT.indexOf(s.kind) < 0; });
      if (o.kind !== 'work' && cell.length) { err.textContent = name(o.employee_id) + ' a déjà « ' + shiftLabel(cell[0]) + ' » ce jour-là : glissez la journée sur la case pour remplacer.'; return; }
      var otMin = o.kind === 'work' && canOt ? readDur(f, 'ed-ot') : 0, otReason = o.kind === 'work' && canOt ? f.querySelector('#ed-ot-reason').value.trim() : '';
      var also = [].slice.call(f.querySelectorAll('input[name=also]:checked')).map(function (x) { return x.value; });
      var saved;
      try {
        var soft = (S.cache.weekShifts || []).filter(function (s) { return s.employee_id === o.employee_id && s.day === o.day && s.id !== o.id && SOFT.indexOf(s.kind) >= 0; });
        if (soft.length && o.kind !== 'repos' && !o.id) saved = await Store.replaceCell(soft.map(function (x) { return x.id; }), o);
        else { if (o.kind !== 'repos') for (var k = 0; k < soft.length; k++) await Store.deleteShift(soft[k].id); saved = await Store.saveShift(o); }
      } catch (ex) { err.textContent = ex.message; return; }
      var msgs = [o.kind === 'work' ? 'Shift enregistré' : shiftLabel(o) + ' enregistré'], bad = [];
      if (canOt) try {
        if (otMin > 0) { await Store.saveOvertime({ shift_id: saved.id, minutes: otMin, reason: otReason }); msgs.push('+' + fmt(otMin) + ' supp'); }
        else if (curOt && o.kind === 'work') { await Store.deleteOvertime(curOt.id); msgs.push('heures supp retirées'); }
      } catch (ex) { bad.push('Heures supp : ' + ex.message); }
      for (var i = 0; i < also.length; i++) {
        var copy = Object.assign({}, o, { employee_id: also[i], jour_rendu: false, jour_sup: false, owed_id: null }); delete copy.id; delete copy.updated_at;
        if (copy.kind === 'work') { var rm = restMessage(copy); if (rm) { bad.push(rm); continue; } }
        try { await Store.saveShift(copy); msgs.push('aussi pour ' + name(also[i])); } catch (ex) { bad.push(name(also[i]) + ' : ' + ex.message); }
      }
      toast(msgs.join(' · ')); if (bad.length) setTimeout(function () { toast(bad.join(' '), true); }, 300);
      dlg.close(); S.profiles = await Store.profiles(); render();
    });
    sync(); calc();
    dlg.showModal();
  }

  /* ---------- MANAGER / DIRECTION : espace heures supplémentaires ---------- */
  /* Compteur = heures supp inscrites sur les shifts − jours « Récup heures supp » posés × (7h30 par défaut) */
  async function vOvertime() {
    if (!can('overtime', S.svc)) S.svc = rightServices('overtime')[0];
    var svc = S.svc, y = S.otYear || +S.week.slice(0, 4), team = teamOf(svc), per = otDayMin(), contMin = (+S.settings.contingent_hours || 360) * 60;
    var MOISC = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];
    var res = await Promise.all([Store.overtime(y + '-01-01', y + '-12-31', { serviceId: svc }), Store.shifts(y + '-01-01', y + '-12-31', { serviceId: svc })]);
    var entries = res[0], shiftById = {}; res[1].forEach(function (x) { shiftById[x.id] = x; });
    var taken = res[1].filter(function (x) { return x.kind === 'ot_day'; }).map(function (x) { return { id: x.id, day: x.day, employee_id: x.employee_id, minutes: per, note: x.note, taken: true }; });
    var ids = team.map(function (p) { return p.id; });
    entries.concat(taken).forEach(function (o) { if (ids.indexOf(o.employee_id) < 0) { var p = S.profiles.find(function (x) { return x.id === o.employee_id; }); if (p) { team.push(p); ids.push(p.id); } } });
    function sum(list) { return list.reduce(function (a, o) { return a + o.minutes; }, 0); }
    function ofMonth(list, m) { return list.filter(function (o) { return +o.day.slice(5, 7) === m; }); }
    function signed(m) { return m === 0 ? '0h00' : (m > 0 ? '+' : '') + C.fmt(m); }
    function red(m, html) { return m < 0 ? '<span class="over">' + html + '</span>' : html; }
    var open = S.otOpen || {}, curM = +today().slice(5, 7), curY = +today().slice(0, 4);
    var head = '<th>Salarié</th>' + MOISC.map(function (m, k) { return '<th class="n' + (y === curY && k + 1 === curM ? ' today-col' : '') + '">' + m + '</th>'; }).join('') +
      '<th class="n">Inscrites</th><th class="n">Récupérées</th><th class="n">Solde ' + y + '</th>';
    var body = team.map(function (p) {
      var mineIn = entries.filter(function (o) { return o.employee_id === p.id; }), mineOut = taken.filter(function (o) { return o.employee_id === p.id; });
      var cells = '';
      for (var m = 1; m <= 12; m++) {
        var pin = sum(ofMonth(mineIn, m)), pout = sum(ofMonth(mineOut, m)), net = pin - pout, isOpen = open.emp === p.id && open.m === m;
        cells += '<td class="n">' + (pin || pout ? '<button class="otm' + (isOpen ? ' on' : '') + (net < 0 ? ' neg' : '') + '" data-act="ot-open" data-emp="' + p.id + '" data-m="' + m + '" aria-expanded="' + isOpen + '" title="Voir le détail par jour">' + signed(net) + '</button>' : '<span class="muted">–</span>') + '</td>';
      }
      var tin = sum(mineIn), tout = sum(mineOut), bal = tin - tout;
      var row = '<tr><td class="emp-name"><b>' + esc(p.full_name) + '</b><span>' + esc(CONTRATS[p.contract_type]) + (tin > contMin ? ' · <span class="over">contingent dépassé</span>' : '') + '</span></td>' + cells +
        '<td class="n">' + (tin ? '+' + fmt(tin) : '–') + '</td><td class="n">' + (tout ? '<span class="over">−' + fmt(tout) + '</span>' : '–') + '</td><td class="n"><b' + (bal < 0 ? ' class="over"' : '') + '>' + (tin || tout ? signed(bal) : '–') + '</b></td></tr>';
      if (open.emp === p.id) {
        var days = ofMonth(mineIn, open.m).concat(ofMonth(mineOut, open.m)).sort(function (a, b) { return a.day.localeCompare(b.day); });
        row += '<tr class="ot-detail"><td colspan="16"><div class="ot-days"><div class="eyebrow">' + esc(p.full_name) + ' · ' + MOIS_L[open.m - 1] + ' ' + y + ' · ' + signed(sum(ofMonth(mineIn, open.m)) - sum(ofMonth(mineOut, open.m))) + '</div>' +
          days.map(function (o) {
            if (o.taken) return '<div class="ot-day"><span class="d">' + dayLong(o.day) + '</span><span class="muted">Jour « Récup heures supp »</span><b class="mono over">−' + fmt(o.minutes) + '</b><span class="muted">' + esc(o.note || '') + '</span><span></span></div>';
            var sh = shiftById[o.shift_id];
            return '<div class="ot-day"><span class="d">' + dayLong(o.day) + '</span><span class="muted">' + (sh ? esc(shiftLabel(sh)) + ' ' + hhmm(sh.start_time) + '–' + hhmm(sh.end_time) : '') + '</span>' +
              '<b class="mono">+' + fmt(o.minutes) + '</b><span class="muted">' + esc(o.reason || '') + '</span>' +
              '<button class="btn sm ghost danger" data-act="ot-del" data-id="' + o.id + '">Supprimer</button></div>';
          }).join('') + '</div></td></tr>';
      }
      return row;
    }).join('');
    var footCells = '';
    for (var m = 1; m <= 12; m++) { var t = sum(ofMonth(entries, m)) - sum(ofMonth(taken, m)); footCells += '<td class="n"><b>' + (sum(ofMonth(entries, m)) || sum(ofMonth(taken, m)) ? red(t, signed(t)) : '–') + '</b></td>'; }
    var monthIn = y === curY ? sum(ofMonth(entries, curM)) : 0;
    return '<div class="page-head"><div><div class="eyebrow">' + esc(svcName(svc)) + ' · réservé aux managers et à la direction</div><h2>Heures supplémentaires</h2></div>' +
      '<div class="row">' + svcSelect(null, rightServices('overtime')) + '<div class="week-nav"><button class="btn sm" data-act="ot-year" data-d="-1" aria-label="Année précédente">' + ICON.left + '</button><div class="lbl"><b>' + y + '</b></div><button class="btn sm" data-act="ot-year" data-d="1" aria-label="Année suivante">' + ICON.right + '</button></div></div></div>' +
      '<div class="stats"><div class="stat hl"><div class="v">' + red(sum(entries) - sum(taken), signed(sum(entries) - sum(taken))) + '</div><div class="l">solde du service en ' + y + '</div></div>' +
      '<div class="stat"><div class="v">' + fmt(sum(entries)) + '</div><div class="l">heures supp inscrites en ' + y + '</div></div>' +
      '<div class="stat"><div class="v">−' + fmt(sum(taken)) + '</div><div class="l">récupérées (' + taken.length + ' jour' + (taken.length > 1 ? 's' : '') + ' × ' + fmt(per) + ')</div></div>' +
      (y === curY ? '<div class="stat"><div class="v">' + fmt(monthIn) + '</div><div class="l">inscrites en ' + MOIS_L[curM - 1] + '</div></div>' : '') + '</div>' +
      '<div class="table-wrap"><table class="ot-table"><thead><tr>' + head + '</tr></thead><tbody>' +
      (team.length ? body : '<tr><td colspan="16" class="empty">Aucun salarié dans ce service.</td></tr>') + '</tbody>' +
      '<tfoot><tr class="foot-total"><td><b>Total service</b></td>' + footCells + '<td class="n"><b>+' + fmt(sum(entries)) + '</b></td><td class="n"><b>' + (sum(taken) ? '<span class="over">−' + fmt(sum(taken)) + '</span>' : '–') + '</b></td><td class="n"><b>' + red(sum(entries) - sum(taken), signed(sum(entries) - sum(taken))) + '</b></td></tr></tfoot></table></div>' +
      '<p class="hint">Chaque case de mois montre le solde du mois (heures inscrites moins récupérations, en négatif). Cliquez dessus pour le détail jour par jour. Les heures supp s\'inscrivent sur un shift du planning ; un jour « Récup heures supp » posé dans le planning retire ' + fmt(per) + ' (réglable dans les Paramètres). Aucun pourcentage ni heure de nuit, de dimanche ou de jour férié n\'est compté ici. Contingent annuel : ' + (contMin / 60) + ' h.</p>';
  }

  /* ---------- FICHES DE PRÉSENCE (modèle Excel de l'hôtel) ---------- */
  /* colonnes du modèle : X présent · _ absent · O repos · R récupération · M maladie · AT · JF · CP · F formation · AN ancienneté */
  var PCOLS = [['X', 'D', 'Présent'], ['_', 'E', 'Absent'], ['O', 'F', 'Repos hebdomadaire'], ['R', 'G', 'Récupération'], ['M', 'H', 'Maladie'], ['AT', 'I', 'Accident du travail'],
    ['JF', 'J', 'Jours fériés'], ['CP', 'K', 'Congés payés'], ['F', 'L', 'Formation prof.'], ['AN', 'M', 'Ancienneté']];
  var JOURS_C = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  function monthDays(month) { var first = month + '-01', last = C.addDays(C.iso(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1))), -1), out = []; for (var d = first; d <= last; d = C.addDays(d, 1)) out.push(d); return out; }
  function monthsBetween(a, b) { var out = []; for (var m = a; m <= b; m = C.addMonths(m + '-01', 1).slice(0, 7)) { out.push(m); if (out.length > 24) break; } return out; }
  function restLabel(p) { return (p.weekly_rest || []).slice().sort().map(function (k) { return JOURS_C[k % 7]; }).join(' - '); }
  /* Une journée → { col: X|_|O…, val: 1|'x', obs: [...], yellow } (même règle que le prompt validé) */
  function presenceDay(list, d, owedById) {
    var r = { col: null, val: null, obs: [], yellow: false }, hol = C.holidayName(d);
    function set(c) { if (!r.col || c === 'X') { r.col = c; r.val = c === 'X' ? 1 : 'x'; } }
    list.forEach(function (s) {
      if (s.kind === 'work') {
        set('X');
        if (s.extra_pay) { r.obs.push('extra à payer'); r.yellow = true; }
        if (s.jour_rendu) { var o = owedById[s.owed_id]; r.obs.push('jour rendu' + (o && o.origin_date ? ' (dû du ' + o.origin_date.slice(8, 10) + '/' + o.origin_date.slice(5, 7) + ')' : '')); }
        if (s.jour_sup) r.obs.push('jour sup. à récupérer');
        if (hol) r.obs.push('férié travaillé');
      }
      else if (s.kind === 'recup') { set('X'); r.obs.push('jour récupéré'); }
      else if (s.kind === 'rendre') { set('X'); r.obs.push('jour à rendre'); }
      else if (s.kind === 'repos') set('O');
      else if (s.kind === 'ot_day') { set('R'); r.obs.push('récup heures supp'); }
      else if (s.kind === 'maladie') set('M');
      else if (s.kind === 'at') set('AT');
      else if (s.kind === 'ferie') set('JF');
      else if (s.kind === 'cp') set('CP');
      else if (s.kind === 'formation') set('F');
      else if (s.kind === 'anciennete') set('AN');
      else if (s.kind === 'absence') set('_');
      else if (s.kind === 'css') { set('_'); r.obs.push('congé sans solde'); }
    });
    r.obs = r.obs.filter(function (x, i, a) { return a.indexOf(x) === i; });
    return r;
  }
  function prevMonthDays(month) {
    var prev = C.addMonths(month + '-01', -1).slice(0, 7), days = monthDays(prev), start = +S.settings.prev_month_start_day || 25;
    var list = days.filter(function (d) { return +d.slice(8, 10) >= start; });
    return list.slice(-7);
  }
  function presenceData(p, month, shifts, owedById) {
    function rowsFor(days) {
      return days.map(function (d) { var x = presenceDay(shifts.filter(function (s) { return s.employee_id === p.id && s.day === d; }), d, owedById); x.day = d; x.n = +d.slice(8, 10); return x; });
    }
    var cur = rowsFor(monthDays(month)), prev = rowsFor(prevMonthDays(month)), tot = {};
    PCOLS.forEach(function (c) { tot[c[0]] = cur.filter(function (r) { return r.col === c[0]; }).length; });
    var cpDays = cur.filter(function (r) { return r.col === 'CP'; }).map(function (r) { return r.day; });
    return { p: p, month: month, cur: cur, prev: prev, tot: tot, cpFrom: cpDays[0], cpTo: cpDays[cpDays.length - 1] };
  }
  function excelSerial(iso) { return Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 864e5); }
  function presenceCells(data) {
    var st = S.settings, cells = { G3: excelSerial(data.month + '-01'), H6: data.p.full_name, H12: data.p.job_title || '', H15: restLabel(data.p),
      O1: st.company_name || 'S. A.  ELYSEES GESTION', O2: st.presence_hotel_label || 'HOTEL ROCHESTER C,ELYSEES' };
    function fill(rows, firstRow) {
      rows.forEach(function (r, i) {
        var row = firstRow + i;
        cells['B' + row] = r.n;
        if (r.col) { var c = PCOLS.find(function (x) { return x[0] === r.col; }); cells[c[1] + row] = r.val; }
        if (r.obs.length) cells['N' + row] = r.yellow ? { v: r.obs.join(' · '), s: (window.HPG_PRESENCE || {}).yellow } : r.obs.join(' · ');
      });
    }
    fill(data.prev, 22); fill(data.cur, 33);
    if (data.cpFrom) { cells.R29 = data.cpFrom.split('-').reverse().join('/'); cells.R30 = data.cpTo.split('-').reverse().join('/'); }
    return cells;
  }
  function presenceTable(data) {
    function rows(list) {
      return list.map(function (r) {
        var off = C.dow(r.day) === 0 || !!C.holidayName(r.day);
        return '<tr class="' + (off ? 'off' : '') + '"><td class="n">' + pad(r.n) + '</td>' + PCOLS.map(function (c) { return '<td class="c">' + (r.col === c[0] ? '<b>' + r.val + '</b>' : '') + '</td>'; }).join('') +
          '<td class="obs' + (r.yellow ? ' yel' : '') + '">' + esc(r.obs.join(' · ')) + '</td></tr>';
      }).join('');
    }
    var h = '<tr><th>Jour</th>' + PCOLS.map(function (c) { return '<th class="c" title="' + c[2] + '">' + c[0] + '</th>'; }).join('') + '<th>Observations</th></tr>';
    var t = data.tot, absMin = t['_'] * 7.8;
    var paie = [['100', 'Absence maladie', t.M], ['120', 'Absence congés payés', t.CP], ['251', 'Absences ancienneté', t.AN], ['358', 'Absences jours fériés', t.JF], ['', 'Activité partielle', t['_']], ['', 'Total X + _', t.X + t['_']]];
    return '<div class="fp"><div class="fp-head"><div><b>FEUILLE DE PRÉSENCE INDIVIDUELLE</b><div>Mois de présence : <b class="fp-red">' + MOIS_L[+data.month.slice(5, 7) - 1] + '-' + data.month.slice(2, 4) + '</b></div></div>' +
      '<div class="fp-co"><b>' + esc(S.settings.company_name || '') + '</b><br><b>' + esc(S.settings.presence_hotel_label || '') + '</b></div></div>' +
      '<div class="fp-id"><div><span class="muted small">Nom et prénom</span><b class="fp-red">' + esc(data.p.full_name) + '</b></div><div><span class="muted small">Code</span><b class="fp-red">' + esc(data.p.job_title || '—') + '</b></div><div><span class="muted small">Repos hebdomadaire</span><b class="fp-red">' + esc(restLabel(data.p) || '—') + '</b></div></div>' +
      '<div class="fp-cols"><div class="table-wrap"><table class="pr-table"><thead><tr><th colspan="12" class="pr-title">Mois précédent</th></tr>' + h + '</thead><tbody>' + rows(data.prev) + '</tbody></table>' +
      '<table class="pr-table" style="margin-top:10px"><thead><tr><th colspan="12" class="pr-title">Mois en cours</th></tr>' + h + '</thead><tbody>' + rows(data.cur) + '</tbody>' +
      '<tfoot><tr><td><b>Total</b></td>' + PCOLS.map(function (c) { return '<td class="c"><b>' + t[c[0]] + '</b></td>'; }).join('') + '<td class="small">Heures d\'absence (_ × 7,8) : ' + num(+absMin.toFixed(1)) + '</td></tr></tfoot></table></div>' +
      '<div class="fp-paie"><div class="eyebrow">Bloc paie (calculé)</div>' + paie.map(function (x) { return '<div class="row" style="justify-content:space-between"><span><span class="muted mono">' + x[0] + '</span> ' + x[1] + '</span><b>' + x[2] + '</b></div>'; }).join('') +
      '<div class="row" style="justify-content:space-between"><span>Dates CP</span><b>' + (data.cpFrom ? data.cpFrom.split('-').reverse().join('/') + ' → ' + data.cpTo.split('-').reverse().join('/') : '—') + '</b></div>' +
      '<p class="hint">Les autres lignes de paie (fixe mensuel, primes, acomptes…) restent à remplir par la paie, comme sur le modèle.</p></div></div></div>';
  }
  async function vPresence() {
    var list = rightServices('presence'); if (list.indexOf(S.svc) < 0) S.svc = list[0];
    var svc = S.svc, team = teamOf(svc), m0 = today().slice(0, 7);
    if (!S.prEmp || !team.some(function (p) { return p.id === S.prEmp; })) S.prEmp = team[0] && team[0].id;
    S.prFrom = S.prFrom || m0; S.prTo = S.prTo || S.prFrom;
    var p = team.find(function (x) { return x.id === S.prEmp; });
    var empOpts = team.map(function (x) { return '<option value="' + x.id + '"' + (x.id === S.prEmp ? ' selected' : '') + '>' + esc(x.full_name) + ' · ' + esc(CONTRATS[x.contract_type]) + '</option>'; }).join('');
    var nMonths = monthsBetween(S.prFrom, S.prTo).length;
    var controls = '<div class="panel"><div class="row pr-controls">' + svcSelect(null, list) +
      '<label class="f">Salarié<select id="pr-emp" data-change="pr">' + empOpts + '</select></label>' +
      '<label class="f">Du mois<input type="month" id="pr-from" value="' + S.prFrom + '" data-change="pr"></label>' +
      '<label class="f">Au mois<input type="month" id="pr-to" value="' + S.prTo + '" data-change="pr"></label></div>' +
      '<div class="row" style="margin-top:10px"><span class="eyebrow">Ce salarié</span><button class="btn brass" data-act="pr-export" data-scope="one" data-fmt="xlsx"' + (p ? '' : ' disabled') + '>' + ICON.pdf + ' Excel</button><button class="btn" data-act="pr-export" data-scope="one" data-fmt="pdf"' + (p ? '' : ' disabled') + '>' + ICON.pdf + ' PDF</button>' +
      '<span class="eyebrow" style="margin-left:12px">Tout le service (' + team.length + ')</span><button class="btn brass" data-act="pr-export" data-scope="all" data-fmt="xlsx"' + (team.length ? '' : ' disabled') + '>' + ICON.pdf + ' Excel, un onglet par salarié</button><button class="btn" data-act="pr-export" data-scope="all" data-fmt="pdf"' + (team.length ? '' : ' disabled') + '>' + ICON.pdf + ' PDF, une page par salarié</button></div>' +
      (nMonths > 1 ? '<div class="hint">Période de ' + nMonths + ' mois : l\'Excel contiendra un onglet par salarié et par mois.</div>' : '') + '</div>';
    var head = '<div class="page-head"><div><div class="eyebrow">' + esc(svcName(svc)) + ' · réservé aux managers et à la direction</div><h2>Fiches de présence</h2></div></div>';
    if (!p) return head + controls + '<div class="panel empty">Aucun salarié dans ce service.</div>';
    var month = S.prFrom, days = monthDays(month), prevD = prevMonthDays(month);
    var res = await Promise.all([Store.shifts(prevD[0] || days[0], days[days.length - 1], { employeeId: p.id }), Store.owedDays({ employeeId: p.id })]);
    var owedById = {}; res[1].forEach(function (o) { owedById[o.id] = o; });
    var data = presenceData(p, month, res[0], owedById);
    return head + controls + presenceTable(data) +
      '<p class="hint">Remplissage : un shift travaillé, un jour récupéré ou un jour à rendre = « 1 » dans X ; repos = O ; récup heures supp = R ; maladie = M ; accident du travail = AT ; jour férié = JF ; congé payé = CP ; formation = F ; jour d\'ancienneté = AN ; absence et congé sans solde = _ . « extra à payer » est surligné en jaune dans Observations.' + (window.HPG_PRESENCE ? '' : ' <b>Modèle Excel de l\'hôtel introuvable (modele-presence.js) : l\'export ne peut pas se faire.</b>') + '</p>';
  }
  async function exportPresence(scope, fmtType) {
    await refreshConfig(true);
    var svc = S.svc, team = teamOf(svc), people = scope === 'all' ? team : team.filter(function (p) { return p.id === S.prEmp; });
    if (!people.length) return;
    var months = monthsBetween(S.prFrom || today().slice(0, 7), S.prTo || S.prFrom || today().slice(0, 7));
    var first = prevMonthDays(months[0])[0] || months[0] + '-01', lastDays = monthDays(months[months.length - 1]), last = lastDays[lastDays.length - 1];
    try {
      var res = await Promise.all([Store.shifts(first, last, { serviceId: null }), Store.owedDays({})]);
      var owedById = {}; res[1].forEach(function (o) { owedById[o.id] = o; });
      var datas = [];
      people.forEach(function (p) { months.forEach(function (m) { datas.push(presenceData(p, m, res[0], owedById)); }); });
      var svcLabel = svcName(svc).toUpperCase(), mm = months[0].slice(5, 7) + '_' + months[0].slice(2, 4);
      var base = scope === 'all' ? mm + ' F. PRESENCE ' + svcLabel : mm + ' F. PRESENCE ' + people[0].full_name;
      if (fmtType === 'pdf') { await saveFile(presencePdf(datas), base + '.pdf'); return; }
      if (!window.HPG_PRESENCE) throw new Error('modèle Excel de l\'hôtel introuvable (modele-presence.js).');
      var sheets = datas.map(function (d) { return { name: d.p.full_name + (months.length > 1 ? ' ' + d.month.slice(5, 7) + '-' + d.month.slice(2, 4) : ''), cells: presenceCells(d) }; });
      await saveFile(MiniXlsx.buildFromTemplate(window.HPG_PRESENCE, sheets), base + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) { toast('Export impossible : ' + e.message, true); }
  }
  /* PDF : une page A4 par fiche, même disposition que le modèle Excel */
  function presencePdf(datas) {
    var doc = new window.MiniPdf(595.28, 841.89), PW = doc.w, M = 28, RED = '#9B1C1C', INK = '#111111', G = '#9AA0A6';
    var colX = [M, M + 34], cw = 21, obsX = 0, obsW = 0, rowH = 13.4;
    datas.forEach(function (d) {
      doc.addPage();
      doc.text('FEUILLE   DE   PRÉSENCE   INDIVIDUELLE', M, 40, { size: 12, bold: true, color: INK });
      doc.text(S.settings.company_name || '', PW - M, 34, { size: 10, bold: true, align: 'right', color: INK });
      doc.text(S.settings.presence_hotel_label || '', PW - M, 48, { size: 10, bold: true, align: 'right', color: INK });
      doc.text('Mois de présence :', M, 66, { size: 10, bold: true, color: INK });
      doc.rect(M + 112, 54, 120, 18, null, INK, 1); doc.text(MOIS_L[+d.month.slice(5, 7) - 1] + '-' + d.month.slice(2, 4), M + 172, 67, { size: 11, bold: true, align: 'center', color: RED });
      // légende et identité
      var ly = 84;
      PCOLS.forEach(function (c, i) { doc.text(c[0], M + 4, ly + 10 + i * 11, { size: 7.5, bold: true, color: INK }); doc.text(c[2], M + 26, ly + 10 + i * 11, { size: 7.5, color: INK }); });
      doc.rect(M, ly, 150, 116, null, INK, 0.6);
      var ix = M + 162;
      [['Nom et prénom', d.p.full_name], ['Code', d.p.job_title || ''], ['Repos hebdomadaire', restLabel(d.p)]].forEach(function (x, i) {
        doc.text(x[0], ix + 4, ly + 10 + i * 38, { size: 7.5, color: '#4A5363' });
        doc.text(x[1], ix + 110, ly + 26 + i * 38, { size: 10, bold: true, align: 'center', color: RED, maxWidth: 210 });
      });
      doc.rect(ix, ly, 220, 116, null, INK, 0.6);
      // bloc paie (à droite)
      var px = ix + 228, pw = PW - M - px;
      doc.rect(px, ly, pw, 116, null, INK, 0.6);
      doc.text('Bloc paie', px + 4, ly + 10, { size: 7.5, bold: true, color: INK });
      var t = d.tot;
      [['100', 'Absence Maladie', t.M], ['120', 'Absence CP', t.CP], ['251', 'Absences Ancienneté', t.AN], ['358', 'Absences Fériés', t.JF], ['', 'Activité partielle', t['_']], ['', 'Total X + _', t.X + t['_']]].forEach(function (x, i) {
        doc.text(x[0] + ' ' + x[1], px + 4, ly + 24 + i * 12, { size: 7, color: INK }); doc.text(String(x[2]), px + pw - 6, ly + 24 + i * 12, { size: 7.5, bold: true, align: 'right', color: RED });
      });
      if (d.cpFrom) doc.text('CP du ' + d.cpFrom.split('-').reverse().join('/') + ' au ' + d.cpTo.split('-').reverse().join('/'), px + 4, ly + 106, { size: 7, bold: true, color: INK });
      // grilles
      obsX = M + 34 + PCOLS.length * cw; obsW = PW - M - obsX;
      function grid(title, rows, y0, totals) {
        doc.rect(M, y0, PW - 2 * M, 14, '#E5E7EB'); doc.text(title, M + (PW - 2 * M) / 2, y0 + 10, { size: 9, bold: true, align: 'center', color: INK });
        var y = y0 + 14;
        doc.text('Jour', M + 17, y + 9, { size: 7, bold: true, align: 'center', color: INK });
        PCOLS.forEach(function (c, i) { doc.text(c[0], M + 34 + i * cw + cw / 2, y + 9, { size: 7, bold: true, align: 'center', color: INK }); });
        doc.text('Observations', obsX + obsW / 2, y + 9, { size: 7, bold: true, align: 'center', color: INK });
        y += 12;
        rows.forEach(function (r) {
          var off = C.dow(r.day) === 0 || !!C.holidayName(r.day);
          if (off) doc.rect(M, y, 34 + PCOLS.length * cw, rowH, '#F3F4F6');
          if (r.yellow) doc.rect(obsX, y, obsW, rowH, '#FFFF00');
          doc.text(pad(r.n), M + 17, y + 9.5, { size: 7.5, align: 'center', color: INK });
          if (r.col) { var i = PCOLS.findIndex(function (c) { return c[0] === r.col; }); doc.text(String(r.val), M + 34 + i * cw + cw / 2, y + 9.5, { size: 8, bold: true, align: 'center', color: RED }); }
          if (r.obs.length) doc.text(r.obs.join(' · '), obsX + 4, y + 9.5, { size: 7, color: INK, maxWidth: obsW - 8 });
          doc.line(M, y + rowH, PW - M, y + rowH, '#D1D5DB', 0.3);
          y += rowH;
        });
        for (var i = 0; i <= PCOLS.length; i++) doc.line(M + 34 + i * cw, y0 + 14, M + 34 + i * cw, y, G, 0.3);
        doc.rect(M, y0, PW - 2 * M, y - y0, null, INK, 0.6);
        if (totals) {
          doc.rect(M, y, PW - 2 * M, 14, '#E5E7EB');
          doc.text('Total', M + 17, y + 10, { size: 7, bold: true, align: 'center', color: INK });
          PCOLS.forEach(function (c, i) { doc.text(String(d.tot[c[0]]), M + 34 + i * cw + cw / 2, y + 10, { size: 7.5, bold: true, align: 'center', color: INK }); });
          doc.text('Heures d\'absence (_ × 7,8) : ' + num(+(d.tot['_'] * 7.8).toFixed(1)), obsX + 4, y + 10, { size: 7, color: INK });
          y += 14;
        }
        return y;
      }
      var y = grid('Mois précédent', d.prev, ly + 128, false);
      y = grid('Mois en cours', d.cur, y + 10, true);
      doc.text('Signature du salarié', M, y + 26, { size: 8, color: INK }); doc.text('Signature du responsable', PW - M, y + 26, { size: 8, align: 'right', color: INK });
      doc.text('Extrait de HPG le ' + stamp(new Date()), M, 830, { size: 6.5, color: '#7A8291' });
    });
    return doc.output();
  }

  /* ---------- FICHE DE POINTAGE : export annuel, un onglet par salarié ---------- */
  async function vPointage() {
    var list = rightServices('presence'); if (list.indexOf(S.svc) < 0) S.svc = list[0];
    var svc = S.svc, y = S.ptYear || +today().slice(0, 4), team = teamOf(svc).filter(function (p) { return cpEligible(p); });
    return '<div class="page-head"><div><div class="eyebrow">' + esc(svcName(svc)) + '</div><h2>Fiche de pointage</h2></div><div class="row">' + svcSelect(null, list) +
      '<div class="week-nav"><button class="btn sm" data-act="pt-year" data-d="-1" aria-label="Année précédente">' + ICON.left + '</button><div class="lbl"><b>' + y + '</b></div><button class="btn sm" data-act="pt-year" data-d="1" aria-label="Année suivante">' + ICON.right + '</button></div>' +
      '<button class="btn brass" data-act="pt-export"' + (team.length ? '' : ' disabled') + '>' + ICON.pdf + ' Excel (.xlsx)</button></div></div>' +
      '<p class="hint">Export annuel au format de la fiche de pointage de l\'hôtel : un onglet par salarié (' + ((S.settings.cp_contracts || []).map(function (k) { return CONTRATS[k]; }).join(', ')) + '), chaque onglet s\'imprime sur une seule page. Les 12 mois, semaines du dimanche au samedi, entrée et sortie de chaque jour (un jour de repos affiche OFF, un congé le nom de la journée, sur les deux cases fusionnées), total d\'heures par semaine et par mois, et une case Signature par mois.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Salarié</th><th>Contrat</th><th>Localisation</th><th>Poste</th></tr></thead><tbody>' +
      (team.length ? team.map(function (p) { return '<tr><td>' + esc(p.full_name) + '</td><td>' + esc(CONTRATS[p.contract_type]) + '</td><td>' + esc(p.location || '') + '</td><td>' + esc(p.job_title || '') + '</td></tr>'; }).join('') : '<tr><td colspan="4" class="empty">Aucun salarié concerné.</td></tr>') +
      '</tbody></table></div>';
  }
  /* Fiche de pointage annuelle, au format de l'hôtel (modele-pointage.js) : une feuille = un salarié = une page,
     12 mois, semaines du dimanche au samedi, entrée / sortie de chaque jour, total par semaine et par mois, une case signature par mois */
  function ptTime(t) { return t ? String(t).slice(0, 5).replace(/^0(\d)/, '$1').replace(':', 'H') : ''; }
  function ptName(full) {
    var w = String(full || '').trim().split(/\s+/), nom = [], pre = [];
    w.forEach(function (x) { (x === x.toUpperCase() && /[A-ZÀ-Ý]/.test(x) ? nom : pre).push(x); });
    if (!nom.length && pre.length) nom.push(pre.pop());
    return { nom: nom.join(' '), prenom: pre.join(' ') };
  }
  function ptPause() { var m = S.settings.break_min == null ? 30 : +S.settings.break_min; return m === 30 ? '1/2H' : m && m % 60 === 0 ? (m / 60) + 'H' : m + ' min'; }
  function pointageXml(T, p, y, mine) {
    var X = MiniXlsx, L = 'BCDEFGHIJKLMNO', rows = [], h1 = T.headRows - 1, r = h1 - 1;
    // l'en-tête des jours (2 dernières lignes du modèle) est recopié au-dessus de chaque mois, sous le nom du mois
    var merges = T.merges.filter(function (mg) { return +/(\d+)$/.exec(mg)[1] < h1; });
    var titleSt = (/<c r="B\d+" s="(\d+)"/.exec((new RegExp('<row r="' + h1 + '"[^>]*>[\\s\\S]*?</row>').exec(T.head) || [''])[0]) || [0, T.week.A])[1];
    function xe(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function c(ref, st, v) {
      var a = '<c r="' + ref + '" s="' + st + '"';
      if (v == null || v === '') return a + '/>';
      if (typeof v === 'number') return a + '><v>' + v + '</v></c>';
      if (typeof v === 'object') return a + '><f>' + v.f + '</f>' + (v.v != null ? '<v>' + v.v + '</v>' : '') + '</c>';
      return a + ' t="inlineStr"><is><t xml:space="preserve">' + xe(v) + '</t></is></c>';
    }
    function dd(d) { return d.slice(8, 10); }
    for (var mo = 0; mo < 12; mo++) {
      { // en haut de chaque mois : nom du mois, puis Semaine du / jours de la semaine / Entrées – Sorties / TOTAL / Signature
        r++;
        var tr = [c('A' + r, titleSt, MOIS_L[mo].toUpperCase() + ' ' + y)]; for (var kt = 0; kt < L.length; kt++) tr.push(c(L[kt] + r, titleSt, '')); tr.push(c('P' + r, titleSt, ''), c('Q' + r, titleSt, ''));
        rows.push('<row r="' + r + '" ht="18" customHeight="1">' + tr.join('') + '</row>'); merges.push('A' + r + ':Q' + r);
        [h1, h1 + 1].forEach(function (hr) {
          r++;
          var m = new RegExp('<row r="' + hr + '"[^>]*>[\\s\\S]*?</row>').exec(T.head);
          if (m) rows.push(m[0].replace(/<row r="\d+"[^>]*>/, '<row r="' + r + '" ht="16" customHeight="1">').replace(new RegExp('r="([A-Z]+)' + hr + '"', 'g'), 'r="$1' + r + '"'));
        });
        T.merges.forEach(function (mg) {
          var p2 = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(mg);
          if (p2 && +p2[2] >= h1 && +p2[4] <= h1 + 1) merges.push(p2[1] + (+p2[2] - h1 + r - 1) + ':' + p2[3] + (+p2[4] - h1 + r - 1));
        });
      }
      var m1 = y + '-' + String(mo + 1).padStart(2, '0') + '-01', mEnd = C.addDays(C.addMonths(m1, 1), -1), firstRow = r + 1, monthMin = 0;
      for (var d = m1; d <= mEnd;) {
        var e = C.addDays(d, 6 - C.dow(d)); if (e > mEnd) e = mEnd;
        r++;
        var cells = [c('A' + r, T.week.A, 'DU ' + dd(d) + ' AU ' + dd(e) + '/' + e.slice(5, 7) + '/' + y)], vals = {}, wk = 0;
        for (var x = d; x <= e; x = C.addDays(x, 1)) {
          var list = mine.filter(function (s) { return s.day === x; }), work = list.filter(function (s) { return s.kind === 'work'; }), i = C.dow(x) * 2;
          if (work.length) {
            work.sort(function (a, b) { return String(a.start_time).localeCompare(String(b.start_time)); });
            var w0 = work[0], wl = work[work.length - 1];
            vals[L[i]] = ptTime(w0.actual_start && w0.actual_end ? w0.actual_start : w0.start_time);
            vals[L[i + 1]] = ptTime(wl.actual_start && wl.actual_end ? wl.actual_end : wl.end_time);
          } else if (list.length) { vals[L[i]] = list[0].kind === 'repos' ? 'OFF' : KLABEL[list[0].kind] || ABBR[list[0].kind] || '?'; vals['_m' + i] = 1; merges.push(L[i] + r + ':' + L[i + 1] + r); }
          list.forEach(function (s) { wk += C.shiftDetail(s).worked; });
        }
        var dIn = C.dow(d) * 2, eIn = C.dow(e) * 2 + 1; // colonnes des jours du mois ; les autres (mois voisin) sont grisées
        for (var k = 0; k < L.length; k++) cells.push(c(L[k] + r, k < dIn || k > eIn ? (T.grey != null ? T.grey : T.week[L[k]]) : vals['_m' + (k - k % 2)] && T.label != null ? T.label : T.week[L[k]], vals[L[k]]));
        monthMin += wk;
        cells.push(c('P' + r, T.hours, wk ? Math.round(wk / 60 * 100) / 100 : ''), c('Q' + r, T.sign, ''));
        rows.push('<row r="' + r + '" ht="16" customHeight="1">' + cells.join('') + '</row>');
        d = C.addDays(e, 1);
      }
      r++;
      var tc = [c('A' + r, T.total.A, 'TOTAL du Mois')];
      for (var k2 = 0; k2 < L.length; k2++) tc.push(c(L[k2] + r, T.total[L[k2]], ''));
      tc.push(c('P' + r, T.hours, { f: 'SUM(P' + firstRow + ':P' + (r - 1) + ')', v: Math.round(monthMin / 60 * 100) / 100 }), c('Q' + r, T.sign, ''));
      rows.push('<row r="' + r + '" ht="16" customHeight="1">' + tc.join('') + '</row>');
      merges.push('B' + r + ':O' + r, 'Q' + firstRow + ':Q' + r);
      if (mo < 11) {
        r++;
        var gc = [c('A' + r, T.gap.A, '')]; for (var k3 = 0; k3 < L.length; k3++) gc.push(c(L[k3] + r, T.gap[L[k3]], ''));
        gc.push(c('P' + r, T.gap.P, ''), c('Q' + r, T.gap.Q, ''));
        rows.push('<row r="' + r + '" ht="7" customHeight="1">' + gc.join('') + '</row>');
      }
    }
    var nm = ptName(p.full_name), head = T.head.replace(new RegExp('<row r="(' + h1 + '|' + (h1 + 1) + ')"[^>]*>[\\s\\S]*?</row>', 'g'), '');
    var hire = p.hire_date ? p.hire_date.split('-').reverse().join('/') : '';
    head = X.setCell(head, 'A3', 'Nom : ' + nm.nom);
    head = X.setCell(head, 'B3', 'Prénom : ' + nm.prenom);
    head = X.setCell(head, 'G3', "Date d'embauche : " + hire);
    head = X.setCell(head, 'L3', 'Emploi : ' + (p.job_title || ''));
    head = X.setCell(head, 'L4', 'Contrat : ' + (CONTRATS[p.contract_type] || ''));
    head = X.setCell(head, 'L5', 'Pause : ' + ptPause());
    head = X.setCell(head, 'A5', 'Année ' + y);
    head = X.setCell(head, 'A1', S.settings.pointage_title || coName().toUpperCase());
    var cols = T.cols.replace(/(<col min="1" max="1" width=")[\d.]+/, function (_, a) { return a + '24'; });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="16"/>' + cols +
      '<sheetData>' + head + rows.join('') + '</sheetData><mergeCells count="' + merges.length + '">' + merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>' +
      '<printOptions horizontalCentered="1"/><pageMargins left="0.2" right="0.2" top="0.25" bottom="0.25" header="0" footer="0"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/></worksheet>';
  }
  async function exportPointage() {
    await refreshConfig(true);
    var svc = S.svc, y = S.ptYear || +today().slice(0, 4), team = teamOf(svc).filter(function (p) { return cpEligible(p); });
    var T = window.HPG_POINTAGE;
    if (!T) { toast('Gabarit de la fiche de pointage manquant (modele-pointage.js).', true); return; }
    try {
      var all = await Store.shifts(y + '-01-01', y + '-12-31', {});
      var sheets = team.map(function (p) { return { name: p.full_name, xml: pointageXml(T, p, y, all.filter(function (s) { return s.employee_id === p.id; })) }; });
      await saveFile(MiniXlsx.buildFromTemplate({ styles: T.styles, theme: T.theme }, sheets), 'Pointage ' + y + ' ' + svcName(svc) + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) { toast('Export impossible : ' + e.message, true); }
  }

  /* ---------- MANAGER / DIRECTION : demandes ---------- */
  async function vValidate() {
    var res = await Promise.all([Store.requests(), Store.profiles()]), all = res[0];
    S.profiles = res[1];
    var mineToDo = all.filter(canDecide);
    var rest = all.filter(function (r) { return mineToDo.indexOf(r) < 0 && r.employee_id !== S.me.id; }).slice(0, 40);
    var otB = {};
    await Promise.all(mineToDo.filter(function (r) { return r.type === 'ot_day'; }).map(async function (r) { try { otB[r.employee_id] = await Store.otBalance(r.employee_id); } catch (e) {} }));
    function info(r) {
      var n = all.filter(function (x) { return x.id !== r.id && x.service_id === r.service_id && (x.status === 'approved' || /^pending/.test(x.status)) && x.start_date <= r.end_date && x.end_date >= r.start_date; });
      var p = S.profiles.find(function (x) { return x.id === r.employee_id; }), bal = '';
      if (p) bal = '<div class="sub">Soldes : ' + esc(counters(p)) + (otB[p.id] != null ? ' · heures supp ' + signedFmt(otB[p.id]) : '') + '</div>';
      return bal + (n.length ? '<div class="sub" style="color:var(--warn)">' + n.length + ' autre(s) absence(s) dans le service sur cette période : ' + n.map(function (x) { return esc(name(x.employee_id)); }).join(', ') + '</div>' : '');
    }
    var svcs = rightServices('requests'), people = S.profiles.filter(function (p) { return (p.id !== S.me.id || isAdmin()) && p.active && ['employee', 'assistant', 'manager', 'admin'].indexOf(p.role) >= 0 && (p.services || []).some(function (s) { return svcs.indexOf(s) >= 0; }); });
    var form = svcs.length || isAdmin() ? '<section class="panel"><h3>Saisir une demande</h3><p class="hint" style="margin-top:0">Les salariés ne font pas de demande dans HPG : vous la saisissez puis vous la validez. Les congés payés partent ensuite à la direction pour la validation finale. Une demande d\'un manager ou d\'un assistant est saisie par l\'administrateur.</p>' +
      '<form class="form" data-submit="request-for" novalidate><div class="two"><label class="f">Salarié<select id="rf-emp">' + people.filter(function (p) { return isAdmin() || p.role === 'employee'; }).map(function (p) { return '<option value="' + p.id + '">' + esc(p.full_name) + ' · ' + esc((p.services || []).map(svcName).join(' + ')) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">Type<select id="rf-type">' + Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + TYPES[k] + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="two"><label class="f">Du<input type="date" id="rf-start" value="' + today() + '"></label><label class="f">Au<input type="date" id="rf-end" value="' + today() + '"></label></div>' +
      '<label class="f">Commentaire<input type="text" id="rf-comment" maxlength="300"></label><div class="hint" id="rf-info"></div>' +
      '<div class="row"><button class="btn brass" type="submit" data-and="validate">Saisir et valider</button><button class="btn" type="submit" data-and="">Saisir seulement (à valider plus tard)</button></div></form></section>' : '';
    return '<div class="page-head"><div><div class="eyebrow">' + (isAdmin() ? 'Tous les services' : esc(svcs.map(svcName).join(' · '))) + '</div><h2>Demandes à valider</h2></div></div>' + form +
      '<section class="list"><h3>À traiter <span class="muted small">(' + mineToDo.length + ')</span></h3>' +
      (mineToDo.length ? mineToDo.map(function (r) { return requestItem(r, true, info(r)); }).join('') : '<div class="panel empty">Rien à valider pour le moment.</div>') + '</section>' +
      '<section class="list"><h3>Historique récent</h3>' + (rest.length ? rest.map(function (r) { return requestItem(r, true); }).join('') : '<div class="panel empty">Aucune demande.</div>') + '</section>';
  }
  function openRefuse(id) {
    dlg.innerHTML = '<form id="rf" novalidate><div class="dlg-h"><h3>Refuser la demande</h3><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div>' +
      '<div class="dlg-b"><label class="f">Motif communiqué au salarié (obligatoire)<textarea id="rf-reason" maxlength="200" placeholder="Ex. : effectif minimum non atteint ce week-end"></textarea></label><div class="err" id="rf-err"></div></div>' +
      '<div class="dlg-f"><span></span><div class="row"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary" type="submit">Refuser</button></div></div></form>';
    var f = dlg.querySelector('#rf');
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var reason = f.querySelector('#rf-reason').value.trim();
      if (!reason) { f.querySelector('#rf-err').textContent = 'Indiquez le motif du refus.'; return; }
      try { await attempt(function () { return Store.decide(id, false, reason); }, 'Demande refusée'); dlg.close(); render(); } catch (err) {}
    });
    dlg.showModal();
  }

  /* ---------- ÉQUIPE ---------- */
  function sinceTxt(iso) { if (!iso) return 'jamais connecté'; var d = new Date(iso); return 'dernière connexion le ' + d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  /* Mot de passe : hiérarchie développeur > administrateur > manager > assistant > salarié.
     On ne change que celui d'un rang inférieur ; manager et assistant seulement pour les personnes de leurs services. */
  var PW_RANK = { pending: 0, employee: 1, assistant: 2, manager: 3, admin: 4, developer: 5 };
  function canSetPw(p) { return !!(p && p.email) && feat('pw_reset') && pwRankOk(p); }
  function pwRankOk(p) {
    if (!p || p.id === S.me.id) return false;
    var me = role();
    if (me === 'developer') return true;
    if (!(PW_RANK[me] > PW_RANK[p.role])) return false;
    if (me === 'admin') return adminRight('passwords');
    if (me !== 'manager' && me !== 'assistant') return false;
    var mine = S.me.services || [];
    return (p.services || []).some(function (x) { return mine.indexOf(x) >= 0; });
  }
  /* Code provisoire : affiché UNE fois à la personne qui ouvre l'accès ; elle le remet en main propre.
     Le salarié reçoit par e-mail le lien et son identifiant (jamais le code), puis choisit son mot de passe à la 1re connexion. */
  function siteUrl() { return location.origin + location.pathname.replace(/[^/]*$/, ''); }
  function showCode(p, r) {
    var name = (p && (p.full_name || p.email)) || '', email = (r && r.email) || (p && p.email) || '';
    var msg = 'Bonjour ' + name + ',\n\nVotre accès au planning de ' + (S.settings.hotel_name || 'l\'hôtel') + ' est ouvert.\nSite : ' + siteUrl() + '\nIdentifiant : ' + email + '\nMot de passe : le code provisoire que je vous remets en main propre.\nÀ la première connexion, vous choisirez votre propre mot de passe.';
    var mail = r.demo ? '<div class="banner info">Démonstration : aucun e-mail n\'est réellement envoyé.</div>'
      : r.mailed ? '<div class="banner info"><div>E-mail envoyé à <b>' + esc(email) + '</b> avec le lien du site et son identifiant (sans le code).</div></div>'
      : r.created === false || (r.mailed === false && !r.mail_error) ? ''
      : '<div class="banner warn mailwarn">' + (r.mail_error === 'not_configured' ? 'L\'envoi d\'e-mails n\'est pas encore configuré : aucun e-mail n\'est parti.' : 'L\'e-mail n\'a pas pu partir (' + esc(r.mail_error || '') + ').') +
        ' Envoyez-lui ce message vous-même (il ne contient pas le code) :<textarea class="code-msg" readonly rows="6">' + esc(msg) + '</textarea><button type="button" class="btn sm" data-copy="msg">Copier le message</button></div>';
    dlg.innerHTML = '<div class="form"><div class="dlg-h"><div><div class="eyebrow">Code provisoire</div><h3>' + esc(name) + '</h3></div><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div><div class="dlg-b">' +
      '<div class="small">Identifiant : <b>' + esc(email) + '</b></div>' +
      '<div class="temp-code"><b class="mono">' + esc(r.temp_password) + '</b><button type="button" class="btn sm" data-copy="code">Copier</button></div>' +
      '<div class="banner warn"><div>Notez-le maintenant : <b>il ne sera plus affiché</b>. Remettez-le à la personne <b>en main propre</b> (pas par e-mail). À sa première connexion, elle devra choisir son propre mot de passe.</div></div>' + mail +
      '</div><div class="dlg-f"><span></span><button class="btn primary" data-close>J\'ai noté le code</button></div></div>';
    dlg.onclick = function (e) {
      var b = e.target.closest('[data-copy]'); if (!b) return;
      var t = b.dataset.copy === 'code' ? r.temp_password : msg;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Copié'); }, function () { toast('Sélectionnez puis copiez à la main', true); });
    };
    if (!dlg.open) dlg.showModal();
  }
  function openPassword(id) {
    var p = S.profiles.find(function (x) { return x.id === id; });
    dlg.onclick = null;
    dlg.innerHTML = '<form id="pw" class="form" novalidate><div class="dlg-h"><div><div class="eyebrow">' + esc(ROLES[p.role] || '') + '</div><h3>Mot de passe de ' + esc(p.full_name || p.email) + '</h3></div><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div><div class="dlg-b">' +
      '<div class="small">Identifiant : <b>' + esc(p.email || '—') + '</b></div>' +
      '<p class="small" style="margin:0">' + (p.has_account ? 'Un <b>nouveau code provisoire</b> va remplacer son mot de passe actuel. Vous le remettrez en main propre ; à sa prochaine connexion, la personne choisira un nouveau mot de passe.' + (!p.last_sign_in_at && !(S.lastSeen || {})[p.id] ? ' Comme elle ne s\'est <b>jamais connectée</b>, elle recevra aussi l\'e-mail avec le lien du site et son identifiant.' : '')
        : 'Son <b>accès va être créé</b> : un code provisoire unique s\'affichera pour que vous le lui remettiez en main propre, et elle recevra un e-mail avec le lien du site et son identifiant.') + '</p>' +
      '<div class="err" id="pw-err" role="alert"></div></div><div class="dlg-f"><span></span><div class="row"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary" type="submit">' + (p.has_account ? 'Générer un nouveau code' : 'Créer l\'accès') + '</button></div></div></form>';
    var f = dlg.querySelector('#pw');
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = f.querySelector('#pw-err'), btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try { var r = await Store.setUserPassword(p.id); S.profiles = await Store.profiles(); render(); showCode(p, r); }
      catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    });
    dlg.showModal();
  }
  async function vTeam() {
    var res = await Promise.all([Store.profiles(), Store.lastSignIns().catch(function () { return {}; })]);
    S.profiles = res[0]; var last = res[1]; S.lastSeen = last;
    var svc = S.svc, canTeam = can('team', svc), admin = isAdmin();
    var pending = S.profiles.filter(function (p) { return p.role === 'pending'; });
    var members = S.profiles.filter(function (p) { return p.role !== 'pending' && ((p.services || []).indexOf(svc) >= 0 || (admin && S.teamAll && p.role === 'admin') || (admin && !(p.services || []).length && p.role === 'admin')); });
    var noHire = members.filter(function (p) { return !p.hire_date; });
    function editable(p) { return admin || (canTeam && (p.role === 'employee' || p.role === 'pending')); }
    function row(p) {
      var acc = p.has_account ? '<span class="pill ok" title="' + esc(sinceTxt(last[p.id])) + '">accès actif</span>' : '<span class="pill neutral">sans accès</span>';
      return '<div class="item"><div><div class="title">' + esc(p.full_name || p.email) + ' ' + contractPill(p) + (p.active ? '' : ' <span class="pill neutral">désactivé</span>') + ' ' + acc + '</div>' +
        '<div class="sub">' + esc(CONTRATS[p.contract_type]) + ' · ' + ROLES[p.role] + ' · ' + esc((p.services || []).map(svcName).join(' + ') || '—') + (p.location ? ' · ' + esc(p.location) : '') + (p.job_title ? ' · ' + esc(p.job_title) : '') + ' · ' + esc(p.email || 'pas d\'e-mail') + '</div>' +
        '<div class="sub">' + (p.hire_date ? 'Entré le ' + p.hire_date.split('-').reverse().join('/') : '<span style="color:var(--bad)">date d\'entrée manquante</span>') + (p.has_account ? ' · ' + sinceTxt(last[p.id]) : '') + '</div>' +
        '<div class="counters"><span><b>' + num(p.cp_balance) + '</b> CP</span><span><b>' + num(p.ferie_balance || 0) + '</b> fériés</span><span><b>' + num(p.seniority_balance || 0) + '</b> ancienn.</span><span><b>' + num(p.recup_days || 0) + '</b> à récup.</span><span' + ((p.rendre_days || 0) > 0 ? ' class="over"' : '') + '><b>' + num(p.rendre_days || 0) + '</b> à rendre</span></div></div>' +
        '<div class="acts">' + (editable(p) ? '<button class="btn sm" data-act="edit-profile" data-id="' + p.id + '">Modifier</button>' : '') + (canSetPw(p) ? '<button class="btn sm" data-act="set-pw" data-id="' + p.id + '" title="Changer le mot de passe (mot de passe oublié)">Mot de passe</button>' : '') + (svcOwedRight(p) ? '<button class="btn sm" data-act="owed" data-id="' + p.id + '">Jours dus</button>' : '') + '</div></div>';
    }
    return '<div class="page-head"><div><div class="eyebrow">' + esc(svcName(svc)) + '</div><h2>Équipe</h2><div class="small muted">' + members.length + ' fiche' + (members.length > 1 ? 's' : '') + '</div></div><div class="row">' + svcSelect() +
      (hasRight('owed') ? '<button class="btn" data-act="credit-ferie">Créditer des jours fériés</button>' : '') + (canTeam ? '<button class="btn brass" data-act="add-staff">Ajouter un salarié</button>' : '') + '</div></div>' +
      (noHire.length ? '<div class="banner warn">' + noHire.length + ' salarié(s) sans date d\'entrée : congés payés et ancienneté non calculés (' + noHire.map(function (p) { return esc(p.full_name); }).join(', ') + ').</div>' : '') +
      (pending.length && (admin || canTeam) ? '<section class="list"><h3>Comptes à activer</h3>' + pending.map(function (p) {
        return '<div class="item"><div><div class="title">' + esc(p.full_name || '(sans nom)') + '</div><div class="sub">' + esc(p.email) + ' · compte créé, pas encore rattaché</div></div>' +
          '<div class="acts"><button class="btn sm brass" data-act="edit-profile" data-id="' + p.id + '">Activer</button></div></div>';
      }).join('') + '</section>' : '') +
      '<section class="list"><h3>Membres</h3>' + (members.length ? members.map(row).join('') : '<div class="panel empty">Aucun membre dans ce service.</div>') + '</section>' +
      '<p class="hint">Les comptes sont créés à l\'avance : « Ajouter un salarié » avec son e-mail et un mot de passe provisoire. Un extra ou un intérimaire peut être ajouté sans accès. Survolez « accès actif » pour la dernière connexion.</p>';
  }
  function svcOwedRight(p) { return (p.services || []).some(function (s) { return can('owed', s); }) || isAdmin(); }
  /* ---------- JOURS DUS : vue d'ensemble ---------- */
  async function vOwedAll() {
    var list = rightServices('owed'); if (list.indexOf(S.svc) < 0) S.svc = list[0];
    var svc = S.svc, team = teamOf(svc), owed = await Store.owedDays({ serviceId: svc });
    owed = owed.filter(function (o) { return o.type !== 'ferie'; });
    return '<div class="page-head"><div><div class="eyebrow">' + esc(svcName(svc)) + '</div><h2>Jours à rendre et à récupérer</h2></div><div class="row">' + svcSelect(null, list) + '</div></div>' +
      '<p class="hint">Jour à rendre : le salarié doit ce jour (posé avec « AR », rendu par un shift coché « Jour rendu »). Jour à récupérer : l\'entreprise doit ce jour au salarié (pris avec « JR » dans le planning). Les jours fériés ont leur propre onglet.</p>' +
      owedSplitTable(team, owed);
  }
  function lastHoliday() { var d = today(); for (var i = 0; i < 370; i++) { if (C.holidayName(d)) return d; d = C.addDays(d, -1); } return today(); }
  function openCreditFerie() {
    var svcs = rightServices('owed'), svc = svcs.indexOf(S.svc) >= 0 ? S.svc : svcs[0], team = teamOf(svc);
    var h = lastHoliday();
    dlg.innerHTML = '<form id="cf" class="form" novalidate><div class="dlg-h"><div><div class="eyebrow">' + esc(svcName(svc)) + '</div><h3>Créditer des jours fériés</h3></div><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div><div class="dlg-b">' +
      '<div class="two"><label class="f">Jour férié concerné (date choisie par l\'entreprise)<input type="date" id="cf-day" value="' + h + '"></label><label class="f">Nombre de jours à créditer<select id="cf-days"><option value="1">1 jour</option><option value="0.5">½ jour</option><option value="2">2 jours</option></select></label></div>' +
      '<div class="hint" id="cf-name">' + esc(C.holidayName(h) || '') + '</div>' +
      '<label class="f">Motif (facultatif)<input type="text" id="cf-reason" maxlength="120" placeholder="Ex. : férié travaillé"></label>' +
      '<div><div class="row" style="justify-content:space-between"><span class="eyebrow">Salariés</span><button type="button" class="linkish" id="cf-all">Tout cocher</button></div><div class="checks">' +
      team.map(function (p) { return '<label class="row"><input type="checkbox" name="cf" value="' + p.id + '"> ' + esc(p.full_name) + ' <span class="muted small">(' + num(p.ferie_balance || 0) + ' j)</span></label>'; }).join('') + '</div></div>' +
      '<div class="hint">Une ligne « jour férié dû » est ajoutée à la liste de chacun ; il la prendra avec « JF » dans le planning ou par une demande « Jour férié ».</div>' +
      '<div class="err" id="cf-err" role="alert"></div></div><div class="dlg-f"><span></span><div class="row"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary" type="submit">Créditer</button></div></div></form>';
    var f = dlg.querySelector('#cf');
    f.querySelector('#cf-all').onclick = function () { f.querySelectorAll('input[name=cf]').forEach(function (x) { x.checked = true; }); };
    f.querySelector('#cf-day').onchange = function () { f.querySelector('#cf-name').textContent = C.holidayName(this.value) || 'Ce jour n\'est pas un férié légal : vérifiez la date.'; };
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var ids = [].slice.call(f.querySelectorAll('input[name=cf]:checked')).map(function (x) { return x.value; });
      if (!ids.length) { f.querySelector('#cf-err').textContent = 'Cochez au moins un salarié.'; return; }
      try {
        var n = await Store.creditFerie(ids, +f.querySelector('#cf-days').value, f.querySelector('#cf-day').value, f.querySelector('#cf-reason').value.trim());
        S.profiles = await Store.profiles(); toast('Jour férié crédité à ' + n + ' salarié' + (n > 1 ? 's' : '')); dlg.close(); render();
      } catch (ex) { f.querySelector('#cf-err').textContent = ex.message; }
    });
    dlg.showModal();
  }
  async function openOwed(empId) {
    var p = S.profiles.find(function (x) { return x.id === empId; });
    var list = await Store.owedDays({ employeeId: empId }), manage = svcOwedRight(p);
    dlg.innerHTML = '<form id="ow" class="form" novalidate><div class="dlg-h"><div><div class="eyebrow">' + esc(p.full_name) + '</div><h3>Jours dus</h3>' +
      '<div class="small muted">' + num(p.ferie_balance || 0) + ' férié(s) dû(s) · ' + num(p.recup_days || 0) + ' jour(s) à récupérer · ' + num(p.rendre_days || 0) + ' jour(s) à rendre</div></div><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div><div class="dlg-b">' +
      owedTable(list, manage) +
      (manage ? '<div class="panel form"><h3>Ajouter un jour</h3>' +
      '<div class="two"><label class="f">Type<select id="ow-type"><option value="ferie">Jour férié dû (l\'entreprise le doit)</option><option value="recup">Jour à récupérer (l\'entreprise le doit)</option><option value="rendre">Jour à rendre (le salarié le doit)</option></select></label>' +
      '<label class="f">Date d\'origine<input type="date" id="ow-date" value="' + today() + '"></label></div>' +
      '<div class="two"><label class="f">Durée<select id="ow-days"><option value="1">1 jour</option><option value="0.5">½ jour</option></select></label>' +
      '<label class="f">Motif<input type="text" id="ow-reason" maxlength="120" placeholder="Ex. : repos travaillé (remplacement)"></label></div>' +
      '<button class="btn brass" type="submit">Ajouter à la liste</button></div>' : '') +
      '<div class="hint">Les jours venus du planning (Jour à rendre posé, shift « Jour supplémentaire à récupérer ») se retirent depuis le planning. Une ligne déjà prise ou rendue ne peut pas être supprimée.</div>' +
      '<div class="err" id="ow-err" role="alert"></div></div></form>';
    var f = dlg.querySelector('#ow');
    f.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-owed-del]'); if (!b) return;
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmer'; return; }
      try { await Store.deleteOwed(b.dataset.owedDel); S.profiles = await Store.profiles(); openOwed(empId); render(); } catch (ex) { f.querySelector('#ow-err').textContent = ex.message; }
    });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      try {
        await Store.addOwed({ employee_id: empId, type: f.querySelector('#ow-type').value, origin_date: f.querySelector('#ow-date').value || null, days: +f.querySelector('#ow-days').value, reason: f.querySelector('#ow-reason').value.trim() });
        S.profiles = await Store.profiles(); toast('Jour ajouté à la liste de ' + p.full_name); openOwed(empId); render();
      } catch (ex) { f.querySelector('#ow-err').textContent = ex.message; }
    });
    if (!dlg.open) dlg.showModal();
  }
  function contractOptions(sel) { return contractTypes().map(function (k) { return '<option value="' + k[0] + '"' + (k[0] === sel ? ' selected' : '') + '>' + esc(k[1]) + '</option>'; }).join(''); }
  function svcOptions(sel) { return S.services.filter(function (s) { return !s.archived; }).map(function (s) { return '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join(''); }
  /* Champs communs (ajout / modification) : services, localisation, poste, repos, contrat */
  function staffFields(p, prefix) {
    var allowed = isAdmin() ? S.services.filter(function (s) { return !s.archived; }).map(function (s) { return s.id; }) : rightServices('team');
    var mine = p.services && p.services.length ? p.services : [S.svc];
    var locs = []; S.services.forEach(function (s) { (s.locations || []).forEach(function (l) { if (locs.indexOf(l) < 0) locs.push(l); }); });
    var JR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    return '<div><span class="eyebrow">Services (un ou plusieurs)</span><div class="checks">' + allowed.map(function (sid) {
        return '<label class="row"><input type="checkbox" name="' + prefix + '-svc" value="' + sid + '"' + (mine.indexOf(sid) >= 0 ? ' checked' : '') + '> ' + esc(svcName(sid)) + '</label>'; }).join('') + '</div></div>' +
      '<div class="two"><label class="f">Localisation dans le service<select id="' + prefix + '-loc"><option value="">—</option>' + locs.map(function (l) { return '<option' + (l === p.location ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">Poste / fonction (case « Code » de la fiche de présence)<input type="text" id="' + prefix + '-job" maxlength="60" value="' + esc(p.job_title || '') + '" placeholder="Ex. : Responsable PDJ"></label></div>' +
      '<div><span class="eyebrow">Repos hebdomadaire habituel (1 ou 2 jours)</span><div class="row">' + JR.map(function (j, i) { return '<label class="row"><input type="checkbox" name="' + prefix + '-rest" value="' + (i + 1) + '"' + ((p.weekly_rest || []).indexOf(i + 1) >= 0 ? ' checked' : '') + '> ' + j + '</label>'; }).join('') + '</div></div>' +
      '<div class="two"><label class="f">Statut<select id="' + prefix + '-type">' + contractOptions(p.contract_type || 'cdi') + '</select></label><label class="f">Contrat (h / semaine)<input type="number" id="' + prefix + '-hours" min="1" max="48" step="0.5" value="' + (p.contract_hours || S.settings.default_contract_hours || 39) + '"></label></div>' +
      '<label class="f">Date d\'entrée dans l\'entreprise (obligatoire)<input type="date" id="' + prefix + '-hire" value="' + esc(p.hire_date || '') + '" required></label>';
  }
  function readStaff(f, prefix) {
    var v = function (i) { var el = f.querySelector('#' + prefix + '-' + i); return el ? el.value.trim() : ''; };
    var svcs = [].slice.call(f.querySelectorAll('input[name=' + prefix + '-svc]:checked')).map(function (x) { return +x.value; });
    var rest = [].slice.call(f.querySelectorAll('input[name=' + prefix + '-rest]:checked')).map(function (x) { return +x.value; });
    return { services: svcs, service_id: svcs[0] || null, location: v('loc') || null, job_title: v('job') || null, weekly_rest: rest, contract_type: v('type'), contract_hours: +v('hours') || 39, hire_date: v('hire') || null };
  }
  function roleOptions(sel, withPending) {
    var list = isAdmin() ? ['employee', 'assistant', 'manager', 'admin'] : ['employee'];
    if (withPending) list = list.concat(['pending']);
    return list.map(function (r) { return '<option value="' + r + '"' + (r === sel ? ' selected' : '') + '>' + ROLES[r] + '</option>'; }).join('');
  }
  function openAddStaff() {
    dlg.innerHTML = '<form id="as" class="form" novalidate><div class="dlg-h"><h3>Ajouter un salarié</h3><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div><div class="dlg-b">' +
      '<div class="two"><label class="f">NOM Prénom<input type="text" id="as-name" maxlength="60" required placeholder="DUPONT Marie"></label><label class="f">Rôle<select id="as-role">' + roleOptions('employee') + '</select></label></div>' +
      staffFields({ services: [S.svc] }, 'as') +
      '<div class="panel form access"><h3>Accès à l\'application</h3>' +
      '<label class="f">E-mail de connexion<input type="email" id="as-email" autocomplete="off" placeholder="prenom.nom@exemple.fr"></label>' +
      '<label class="row"><input type="checkbox" id="as-access" checked> Créer son accès à l\'application</label>' +
      '<div class="hint">Un code provisoire unique s\'affichera à l\'écran : vous le remettez au salarié en main propre. Il reçoit par e-mail le lien du site et son identifiant, puis choisit son mot de passe à la première connexion. Décochez pour un extra ou un intérimaire sans accès (vous pourrez le créer plus tard).</div></div>' +
      '<div class="err" id="as-err" role="alert"></div></div><div class="dlg-f"><span></span><div class="row"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary" type="submit">Ajouter</button></div></div></form>';
    var f = dlg.querySelector('#as');
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = function (i) { var el = f.querySelector('#' + i); return el ? el.value.trim() : null; }, err = f.querySelector('#as-err'), btn = f.querySelector('button[type=submit]');
      var st = readStaff(f, 'as'); err.textContent = '';
      if (!v('as-name')) { err.textContent = 'Indiquez le nom du salarié.'; return; }
      if (!st.services.length && v('as-role') !== 'admin') { err.textContent = 'Cochez au moins un service.'; return; }
      if (!st.hire_date) { err.textContent = 'La date d\'entrée est obligatoire.'; return; }
      var access = f.querySelector('#as-access').checked;
      if (access && !v('as-email')) { err.textContent = 'Indiquez l\'e-mail de connexion (ou décochez « Créer son accès »).'; return; }
      btn.disabled = true;
      try {
        var made = await Store.addStaff(Object.assign(st, { full_name: v('as-name'), email: v('as-email'), access: access, role: v('as-role') }));
        S.profiles = await Store.profiles();
        var nr = 0;
        if ((st.weekly_rest || []).length && v('as-role') !== 'admin') {
          var np = (made && made.id && S.profiles.find(function (x) { return x.id === made.id; })) || S.profiles.find(function (x) { return (v('as-email') && x.email === v('as-email').toLowerCase()) || x.full_name === v('as-name'); });
          if (np && feat('rest_auto')) nr = await placeRest(np.id, st.hire_date > today() ? st.hire_date : today());
        }
        toast((access ? 'Compte créé : ' + v('as-email') : 'Salarié ajouté (sans accès)') + (nr ? ' · ' + nr + ' jours de repos posés dans le planning' : '')); render();
        if (access && made && made.temp_password) showCode({ full_name: v('as-name'), email: v('as-email') }, Object.assign({ created: true }, made)); else dlg.close();
      } catch (ex) { err.textContent = ex.message; }
      finally { btn.disabled = false; }
    });
    dlg.showModal();
  }
  /* repos habituels posés tout seuls dans le planning : du jour (ou de l'entrée) à la fin du 3e mois suivant */
  function restUntil() { var m = C.addMonths(today().slice(0, 8) + '01', 1 + (+(S.settings || {}).rest_auto_months || 3)); return C.addDays(m, -1); }
  async function placeRest(empId, from, to) {
    if (!Store.applyWeeklyRest) return 0;
    try { return await Store.applyWeeklyRest(empId, from || today(), to || restUntil()); } catch (e) { toast('Repos non posés : ' + e.message, true); return 0; }
  }
  function openProfile(id) {
    var p = S.profiles.find(function (x) { return x.id === id; }), admin = isAdmin(), self = p.id === S.me.id;
    dlg.innerHTML = '<form id="pf" class="form" novalidate><div class="dlg-h"><div><div class="eyebrow">' + esc(p.email || 'Sans compte') + '</div><h3>' + esc(p.full_name || 'Nouveau compte') + '</h3></div><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div><div class="dlg-b">' +
      '<div class="two"><label class="f">NOM Prénom<input type="text" id="pf-name" value="' + esc(p.full_name) + '" maxlength="60"></label>' +
      (p.role === 'developer' ? '<label class="f">Rôle<input type="text" value="Développeur" disabled></label>' : '<label class="f">Rôle<select id="pf-role"' + (self && !admin ? ' disabled' : '') + '>' + roleOptions(p.role === 'pending' ? 'employee' : p.role, p.role === 'pending') + '</select></label>') + '</div>' +
      (p.has_account ? '' : '<label class="f">E-mail (pour créer ou relier un compte)<input type="email" id="pf-email" value="' + esc(p.email || '') + '"></label>') +
      (p.role === 'developer' ? '' : staffFields(p, 'pf')) +
      (pwRankOk(p) ? '<div class="panel form access"><h3>Accès à l\'application</h3><div class="small">' + (p.has_account ? 'Identifiant : <b>' + esc(p.email) + '</b>' : 'Pas encore d\'accès' + (p.email ? ' (e-mail : ' + esc(p.email) + ')' : '')) + '</div>' +
      '<div class="row"><button type="button" class="btn sm" data-setpw="1">' + (p.has_account ? 'Nouveau code provisoire' : 'Créer l\'accès') + '</button></div><div class="small" id="pf-pwmsg"></div></div>' : '') +
      (p.role === 'developer' ? '' : '<label class="f">Compte<select id="pf-active"><option value="true"' + (p.active ? ' selected' : '') + '>Actif</option><option value="false"' + (p.active ? '' : ' selected') + '>Désactivé (ne peut plus se connecter, historique conservé)</option></select></label>') +
      (admin && p.role !== 'developer' ? '<div class="two"><label class="f">Solde CP (jours ouvrables)<input type="number" id="pf-cp" step="0.5" value="' + p.cp_balance + '"></label><label class="f">Jours d\'ancienneté<input type="number" id="pf-sen" step="0.5" value="' + (p.seniority_balance || 0) + '"></label></div>' +
        '<label class="f">Correction du compteur d\'heures supp (minutes, + ou −)<input type="number" id="pf-recup" step="1" value="' + (p.recup_adjust_min || 0) + '"></label>' +
        '<div class="hint">Jours fériés, jours à récupérer et jours à rendre se gèrent dans « Jours dus ».</div>'
        : '<div class="hint">Les soldes sont tenus par la direction ; les jours dus se gèrent dans « Jours dus ».</div>') +
      '<div class="err" id="pf-err" role="alert"></div></div><div class="dlg-f"><span></span><div class="row"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div></div></form>';
    var f = dlg.querySelector('#pf');
    if (f.querySelector('[data-setpw]')) f.querySelector('[data-setpw]').addEventListener('click', async function () {
      var out = f.querySelector('#pf-pwmsg');
      if (!p.has_account) {
        var em = ((f.querySelector('#pf-email') || {}).value || '').trim();
        if (!em && !p.email) { out.textContent = 'Indiquez d\'abord son e-mail.'; out.style.color = 'var(--bad)'; return; }
        if (em && em !== (p.email || '')) { try { await Store.updateProfile(p.id, { email: em }); p.email = em; } catch (ex) { out.textContent = ex.message; out.style.color = 'var(--bad)'; return; } }
      } else if (!confirm('Générer un nouveau code provisoire pour ' + (p.full_name || p.email) + ' ? Son mot de passe actuel ne fonctionnera plus.')) return;
      try { var r = await Store.setUserPassword(p.id); S.profiles = await Store.profiles(); render(); showCode(p, r); }
      catch (ex) { out.textContent = ex.message; out.style.color = 'var(--bad)'; }
    });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = function (i) { var el = f.querySelector('#' + i); return el ? el.value : null; }, err = f.querySelector('#pf-err');
      var patch = { full_name: v('pf-name').trim() };
      if (p.role !== 'developer') {
        Object.assign(patch, readStaff(f, 'pf'));
        if (!patch.hire_date) { err.textContent = 'La date d\'entrée est obligatoire.'; return; }
        var r = v('pf-role'); if (r && !(self && !admin)) patch.role = r;
        if (patch.role !== 'admin' && !patch.services.length) { err.textContent = 'Cochez au moins un service.'; return; }
        patch.active = v('pf-active') === 'true';
      }
      if (!p.has_account) patch.email = (v('pf-email') || '').trim();
      if (admin && p.role !== 'developer') { patch.cp_balance = +v('pf-cp'); patch.seniority_balance = +v('pf-sen'); patch.recup_adjust_min = Math.round(+v('pf-recup') || 0); }
      try {
        await Store.updateProfile(p.id, patch);
        var restChanged = patch.weekly_rest && (patch.weekly_rest.slice().sort().join() !== (p.weekly_rest || []).slice().sort().join());
        var nr2 = restChanged && patch.role !== 'admin' && feat('rest_auto') ? await placeRest(p.id, today()) : 0;
        toast('Fiche mise à jour' + (restChanged ? ' · repos habituels mis à jour dans le planning' + (nr2 ? ' (' + nr2 + ' posés)' : '') : ''));
        S.profiles = await Store.profiles(); if (self) S.me = await Store.init(); dlg.close(); render();
      }
      catch (ex) { err.textContent = ex.message; }
    });
    dlg.showModal();
  }

  /* ---------- PARAMÈTRES (administrateur et développeur) ---------- */
  function card(icon, title, sub, body, key) {
    return '<form class="panel form scard" data-submit="settings" novalidate><div class="scard-h"><span class="scard-i">' + icon + '</span><div><h3>' + title + '</h3><div class="small muted">' + sub + '</div></div></div>' + body +
      (key ? '<div class="row" style="justify-content:flex-end"><button type="button" class="btn sm ghost" data-act="st-default" data-card="' + key + '">Valeurs par défaut</button><button class="btn sm primary" type="submit">Enregistrer</button></div>' : '') + '</form>';
  }
  function nf(k, label, v, attrs) { return '<label class="f">' + label + '<input type="number" data-k="' + k + '" value="' + esc(v) + '" ' + (attrs || '') + '></label>'; }
  function tf(k, label, v) { return '<label class="f">' + label + '<input type="text" data-k="' + k + '" value="' + esc(v || '') + '"></label>'; }
  function sw(attr, label, on, hint) { return '<label class="sw-row"><input type="checkbox" ' + attr + (on ? ' checked' : '') + '><span class="sw"></span><span>' + label + (hint ? '<br><span class="hint">' + hint + '</span>' : '') + '</span></label>'; }
  var RIGHT_LABELS = { planning: 'Créer et modifier le planning', publish: 'Publier / dépublier la semaine', copy_week: 'Copier la semaine précédente', requests: 'Saisir et valider les demandes des salariés',
    owed: 'Jours fériés, à récupérer et à rendre', presence: 'Fiches de présence et pointage', overtime: 'Heures supplémentaires', team: 'Créer et modifier les fiches de l\'équipe' };
  var ADMIN_RIGHTS = Object.assign({}, { settings: 'Accéder aux Paramètres et les modifier', journal: 'Consulter le journal des modifications', company: 'Modifier la fiche de l\'entreprise', passwords: 'Changer les mots de passe de l\'équipe' }, null);
  var EMP_RIGHTS = { team_planning: 'Voir le planning de toute l\'équipe (mois publiés)', balances: 'Consulter ses soldes et ses demandes (CP, fériés, ancienneté, heures supp)' };
  var ST_DEFAULTS = {
    work: { default_contract_hours: 39, break_threshold_min: 360, break_min: 30, min_rest_hours: 11 }, req: { publish_weeks_ahead: 2 },
    cp: { cp_monthly_days: 2.5, cp_credit_day: 1, cp_credit_month: 5, cp_cap: 30, cp_contracts: ['cdi', 'cdd', 'alternant'] }, ot: { contingent_hours: 360, ot_day_minutes: 450 },
    sen: { seniority_years: 5, seniority_days: 1, seniority_contracts: ['cdi', 'cdd', 'alternant'] }, pres: { prev_month_start_day: 25 },
    rights: { rights: { manager: { planning: true, publish: true, copy_week: true, requests: true, owed: true, presence: true, overtime: true, team: true }, assistant: { planning: true, publish: false, copy_week: true, requests: false, owed: false, presence: false, overtime: false, team: false }, employee: { team_planning: false, balances: true } } },
    days: { day_types: {} }, notif: { notify: { publish: true, change: true, request: true, decision: true, credit: true } }, hotel: {}, rest: { rest_auto_months: 3 }
  };
  async function vSettings() {
    var res = await Promise.all([Store.settings(), Store.cpAccruals(), Store.profiles(), Store.services(), Store.templates(), Store.seniorityCredits().catch(function () { return []; })]);
    var st = S.settings = res[0], acc = res[1]; S.profiles = res[2]; S.services = res[3]; S.templates = res[4]; applyDayTypes(); C.setRules(st);
    var per = cpPeriod(), rate = +st.cp_monthly_days, cap = +st.cp_cap || 30;
    var lastEnd = C.addDays(per.start, -1), lastStart = C.addMonths(per.start, -12);
    var done = acc.some(function (a) { return a.period_end === lastEnd; });
    function d(x) { return x.split('-').reverse().join('/'); }
    var ctypes = contractTypes();
    function ctChecks(attr, list) { return '<div class="row">' + ctypes.map(function (c) { return '<label class="row"><input type="checkbox" ' + attr + ' value="' + c[0] + '"' + ((list || []).indexOf(c[0]) >= 0 ? ' checked' : '') + '> ' + esc(c[1]) + '</label>'; }).join('') + '</div>'; }
    var staff = S.profiles.filter(function (p) { return p.active && ['employee', 'assistant', 'manager', 'admin'].indexOf(p.role) >= 0; }).sort(function (a, b) { return (a.full_name || '').localeCompare(b.full_name || ''); });
    var cpRows = staff.map(function (p) {
      var elig = cpEligible(p);
      var now = elig && p.hire_date ? C.cpEarned(p.hire_date, per.start, C.addDays(today(), -1), rate, true, cap) : null;
      var full = elig && p.hire_date ? C.cpEarned(p.hire_date, per.start, per.end, rate, false, cap) : null;
      return '<tr><td>' + esc(p.full_name) + ' <span class="muted small">' + esc((p.services || []).map(svcName).join(' + ')) + '</span></td><td>' + esc(CONTRATS[p.contract_type]) + '</td><td>' + (p.hire_date ? d(p.hire_date) : '<span style="color:var(--bad)">à renseigner</span>') + '</td>' +
        '<td class="n">' + (now == null ? (elig ? '–' : 'non concerné') : String(now).replace('.', ',') + ' j') + '</td><td class="n">' + (full == null ? '–' : full + ' j') + '</td><td class="n"><b>' + num(p.cp_balance) + ' j</b></td><td class="n">' + num(p.seniority_balance || 0) + ' j</td></tr>';
    }).join('');
    var missing = staff.filter(function (p) { return !p.hire_date; }).length;
    var monthOpts = MOIS_L.map(function (m, k) { return '<option value="' + (k + 1) + '"' + (+st.cp_credit_month === k + 1 ? ' selected' : '') + '>' + m + '</option>'; }).join('');
    var R = st.rights || ST_DEFAULTS.rights.rights;
    function rightsBoxAdmin() {
      var L = Object.assign({}, RIGHT_LABELS, ADMIN_RIGHTS), n = 0, tot = Object.keys(L).length;
      var h = Object.keys(L).map(function (k) { var on = (R.admin || {})[k] !== false; if (on) n++; return sw('data-right="admin.' + k + '"', L[k], on); }).join('');
      return h + '<div class="small muted">' + n + ' droit(s) accordé(s) sur ' + tot + '. Seul le développeur voit et modifie ce bloc.</div>';
    }
    function rightsBox(ro, labels) { var n = 0, tot = Object.keys(labels).length; var h = Object.keys(labels).map(function (k) { if ((R[ro] || {})[k]) n++; return sw('data-right="' + ro + '.' + k + '"', labels[k], (R[ro] || {})[k]); }).join(''); return h + '<div class="small muted">' + n + ' droit(s) accordé(s) sur ' + tot + '. Le reste est réservé à l\'administrateur.</div>'; }
    var tplSvc = S.tplSvc == null ? String(S.svc || (S.services[0] || {}).id || '') : String(S.tplSvc);
    var tpls = S.templates.filter(function (t) { return tplSvc === '' ? true : tplSvc === 'all' ? !t.service_id : String(t.service_id || '') === tplSvc; });
    var dt = st.day_types || {};
    var sections = [
      card(ICON.gear, 'Fiche de pointage', 'Titre en haut de chaque fiche de pointage Excel. Le nom de l\'établissement se modifie dans le menu « Entreprise ».', tf('pointage_title', 'Titre de la fiche de pointage', st.pointage_title), 'hotel'),
      card(ICON.clock, 'Temps de travail (HCR)', 'Contrat, pause automatique et repos entre deux shifts.',
        '<div class="two">' + nf('default_contract_hours', 'Contrat par défaut (h / semaine)', st.default_contract_hours, 'min="1" max="48" step="0.5"') + nf('min_rest_hours', 'Repos minimum entre deux shifts (h)', st.min_rest_hours, 'min="0" max="24" step="0.5"') + '</div>' +
        '<div class="two">' + nf('break_threshold_h', 'Pause déduite au-delà de (h)', (st.break_threshold_min || 360) / 60, 'min="0" max="16" step="0.5"') + nf('break_min', 'Durée de la pause (min)', st.break_min, 'min="0" max="120" step="5"') + '</div>' +
        '<div class="hint">Au-delà de ' + num((st.break_threshold_min || 360) / 60) + ' h de shift, ' + st.break_min + ' min sont déduites. Repos légal : 11 h ; ne le réduisez que si un accord applicable le permet.</div>', 'work'),
      card(ICON.inbox, 'Demandes et publication', 'Saisie des demandes et publication du planning mois par mois.',
        nf('publish_weeks_ahead', 'Le mois suivant doit être publié (semaines avant son début)', st.publish_weeks_ahead == null ? 2 : st.publish_weeks_ahead, 'min="0" max="8"') +
        '<div class="hint">Les salariés ne font pas de demande : le manager (ou l\'assistant qui en a le droit) saisit la demande puis la valide. Congés payés : validation finale par l\'administrateur. Une demande d\'un manager ou d\'un assistant est saisie et validée par l\'administrateur.</div>', 'req'),
      card(ICON.cal, 'Congés payés', 'Acquisition selon la date d\'entrée, crédit annuel, plafond.',
        '<div class="two">' + nf('cp_monthly_days', 'CP acquis par mois', st.cp_monthly_days, 'min="0" max="5" step="0.01"') + nf('cp_cap', 'Plafond par période (jours)', st.cp_cap || 30, 'min="0" max="60"') + '</div>' +
        '<div class="two"><label class="f">Crédit annuel : jour<input type="number" data-k="cp_credit_day" min="1" max="28" value="' + (st.cp_credit_day || 1) + '"></label><label class="f">mois<select data-k="cp_credit_month">' + monthOpts + '</select></label></div>' +
        '<div><span class="eyebrow">Statuts concernés</span>' + ctChecks('data-arr="cp_contracts"', st.cp_contracts) + '</div>', 'cp'),
      card(ICON.clock, 'Heures supplémentaires', 'Contingent annuel et durée d\'une récupération.',
        '<div class="two">' + nf('contingent_hours', 'Contingent annuel (h)', st.contingent_hours, 'min="0" max="1000"') + '<label class="f">Durée retirée par une « Récup heures supp »' + durSel('st-otday', st.ot_day_minutes == null ? 450 : +st.ot_day_minutes) + '</label></div>', 'ot'),
      card(ICON.users, 'Jours d\'ancienneté', 'Crédités automatiquement à chaque palier atteint (date anniversaire).',
        '<div class="two">' + nf('seniority_years', 'Années par tranche', st.seniority_years || 5, 'min="1" max="40"') + nf('seniority_days', 'Jours par tranche', st.seniority_days || 1, 'min="0" max="10" step="0.5"') + '</div>' +
        '<div><span class="eyebrow">Statuts concernés</span>' + ctChecks('data-arr="seniority_contracts"', st.seniority_contracts) + '</div>' +
        '<div class="row"><button type="button" class="btn sm" data-act="sen-recalc">Recalculer les jours d\'ancienneté</button><span class="small muted">+' + num(st.seniority_days || 1) + ' j tous les ' + (st.seniority_years || 5) + ' ans · ' + res[5].length + ' palier(s) déjà crédité(s)</span></div>', 'sen'),
      card(ICON.users, 'Droits du rôle Manager', 'Dans les services qui lui sont attribués. Il voit toujours le planning et possède son propre planning.', rightsBox('manager', RIGHT_LABELS), 'rights'),
      card(ICON.users, 'Droits du rôle Assistant', 'Dans les services qui lui sont attribués. Il voit toujours le planning et possède son propre planning.', rightsBox('assistant', RIGHT_LABELS), 'rights'),
      card(ICON.user, 'Droits du rôle Salarié', 'Depuis son propre compte. Il voit toujours son planning personnel (mois publiés). Il ne saisit jamais de demande.', rightsBox('employee', EMP_RIGHTS), 'rights'),
      card(ICON.sheet, 'Fiche de présence', 'En-tête et grille « mois précédent » du modèle Excel.',
        tf('company_name', 'Société (en-tête)', st.company_name) + tf('presence_hotel_label', 'Hôtel (en-tête)', st.presence_hotel_label) +
        nf('prev_month_start_day', 'Grille « Mois précédent » à partir du jour', st.prev_month_start_day || 25, 'min="15" max="31"') + '<div class="hint">7 lignes au maximum : les 7 derniers jours du mois précédent si le jour choisi est plus tôt.</div>', 'pres'),
      card(ICON.bell, 'Notifications', 'Dans l\'application, par e-mail et sur téléphone.',
        [['publish', 'Semaine publiée'], ['change', 'Planning modifié après publication'], ['request', 'Nouvelle demande (à l\'encadrement)'], ['decision', 'Demande validée ou refusée'], ['credit', 'CP, jours fériés et ancienneté crédités']].map(function (x) { return sw('data-notify="' + x[0] + '"', x[1], (st.notify || {})[x[0]] !== false); }).join(''), 'notif'),
      card(ICON.cal, 'Types de journées', 'Libellé, code et couleur affichés dans le planning et la palette.',
        '<div class="table-wrap" style="border:0"><table><thead><tr><th>Type</th><th>Libellé</th><th>Code</th><th>Fond</th><th>Texte</th></tr></thead><tbody>' + DAYKINDS0.map(function (k) {
          var c = dt[k[0]] || {};
          return '<tr><td><span class="chip k-' + k[0] + '" style="display:inline-block;width:auto;padding:2px 8px"' + dayStyle(k[0]) + '>' + esc(ABBR[k[0]]) + '</span></td><td><input type="text" data-dt="' + k[0] + '.label" value="' + esc(c.label || '') + '" placeholder="' + esc(k[1]) + '"></td><td><input type="text" data-dt="' + k[0] + '.code" maxlength="4" style="width:64px" value="' + esc(c.code || '') + '" placeholder="' + k[2] + '"></td>' +
            '<td><input type="color" data-dt="' + k[0] + '.bg" value="' + esc(c.bg || PDFC[k[0]][0]) + '"></td><td><input type="color" data-dt="' + k[0] + '.fg" value="' + esc(c.fg || PDFC[k[0]][1]) + '"></td></tr>';
        }).join('') + '</tbody></table></div><div class="hint">Laissez vide pour garder le libellé d\'origine. Les effets sur les compteurs ne changent pas.</div>', 'days'),
      card(ICON.users, 'Statuts de contrat', 'Liste proposée dans les fiches salariés.',
        '<div class="list">' + ctypes.map(function (c, i) { return '<div class="row"><input type="text" data-ct="' + i + '" value="' + esc(c[1]) + '" style="flex:1"><span class="muted small mono">' + esc(c[0]) + '</span></div>'; }).join('') +
        '<div class="row"><input type="text" id="ct-new" placeholder="Nouveau statut (ex. Saisonnier)" style="flex:1"></div></div>', 'ct'),
      card(ICON.user, 'Sécurité', 'Connexion par e-mail et mot de passe.',
        sw('data-k="require_email_code"', 'Exiger un code reçu par e-mail à chaque connexion', st.require_email_code, 'Désactivé par défaut. Si vous l\'activez, configurez d\'abord le modèle d\'e-mail dans Supabase (guide).') +
        (isDev() ? tf('developer_email', 'Compte développeur (invisible dans les effectifs)', st.developer_email) : ''), 'sec')
    ];
    var svcCard = '<section class="panel form scard"><div class="scard-h"><span class="scard-i">' + ICON.users + '</span><div><h3>Services</h3><div class="small muted">Chaque service a son planning. Localisations = sous-groupes du planning (séparées par des virgules).</div></div></div>' +
      '<div class="table-wrap" style="border:0"><table><thead><tr><th>Nom</th><th>Localisations</th><th>Ordre</th><th>Archivé</th><th></th></tr></thead><tbody>' +
      S.services.concat([{ id: '', name: '', locations: [], sort: S.services.length + 1 }]).map(function (sv) {
        var k = sv.id || 'new';
        return '<tr><td><input type="text" id="sv-name-' + k + '" value="' + esc(sv.name) + '" placeholder="' + (sv.id ? '' : 'Nouveau service') + '"></td><td><input type="text" id="sv-loc-' + k + '" value="' + esc((sv.locations || []).join(', ')) + '" placeholder="Ex. : RECEP JOUR, RECEP NUIT"></td>' +
          '<td><input type="number" id="sv-sort-' + k + '" value="' + (sv.sort || 0) + '" style="width:64px"></td><td>' + (sv.id ? '<input type="checkbox" id="sv-arch-' + k + '"' + (sv.archived ? ' checked' : '') + '>' : '') + '</td>' +
          '<td><div class="row" style="flex-wrap:nowrap"><button type="button" class="btn sm" data-act="svc-save" data-id="' + sv.id + '">' + (sv.id ? 'Enregistrer' : 'Ajouter') + '</button>' + (sv.id ? '<button type="button" class="btn sm" data-act="svc-staffing" data-id="' + sv.id + '">Effectif requis' + (sv.staffing && (sv.staffing.inputs || []).length ? ' ✓' : '') + '</button><button type="button" class="btn sm ghost danger" data-act="svc-del" data-id="' + sv.id + '">Supprimer</button>' : '') + '</div></td></tr>';
      }).join('') + '</tbody></table></div><div class="hint">Un service encore utilisé (salariés, shifts, mois publiés) ne peut pas être supprimé : archivez-le.</div></section>';
    var tplCard = '<section class="panel form scard" id="shifts-svc"><div class="scard-h"><span class="scard-i">' + ICON.clock + '</span><div><h3>Shifts par service</h3><div class="small muted">Chaque service a ses propres shifts (nom, horaires, couleur). Ce sont les seuls proposés dans la palette du planning de ce service. Changer un horaire le met à jour partout (plannings, fiches, pointage, PDF et Excel, pour tous les utilisateurs) à partir d\'aujourd\'hui ; les jours passés gardent l\'horaire réellement travaillé.</div></div></div>' +
      '<div class="seg svc-tabs" role="tablist">' + S.services.filter(function (sv) { return !sv.archived; }).map(function (sv) {
        var n = S.templates.filter(function (t) { return t.service_id === sv.id; }).length;
        return '<button type="button" role="tab" data-act="tpl-tab" data-v="' + sv.id + '" aria-pressed="' + (tplSvc === String(sv.id)) + '">' + esc(sv.name) + ' <span class="muted">(' + n + ')</span></button>';
      }).join('') + '<button type="button" role="tab" data-act="tpl-tab" data-v="all" aria-pressed="' + (tplSvc === 'all') + '">Tous les services</button></div>' +
      '<div class="table-wrap" style="border:0"><table><thead><tr><th>Nom</th><th>Service</th><th>Début</th><th>Fin</th><th>Couleur</th><th title="Texte écrit dans la case du planning (vide = automatique)">Affiché</th><th title="Couleurs propres à ce shift (laisser « auto » pour la couleur de la liste)">Fond / texte</th><th title="Nombre de chambres faites avec ce shift (Housekeeping) : affiché dans la case du planning et retiré du total à faire">Chambres</th><th>Ordre</th><th>Actif</th><th></th></tr></thead><tbody>' +
      (tpls.length ? tpls.map(tplRow).join('') : '<tr><td colspan="11" class="muted small">Aucun shift pour ce service : ajoutez le premier ci-dessous.</td></tr>') +
      tplRow({ id: '', name: '', start_time: '', end_time: '', color: 'am', sort: tpls.length + 1, active: true, service_id: tplSvc && tplSvc !== 'all' ? +tplSvc : null }) + '</tbody></table></div>' +
      '<div class="hint">Dernière ligne = nouveau shift pour ' + (tplSvc === 'all' ? 'tous les services' : esc(svcName(+tplSvc))) + '. « Tous les services » = shift proposé partout. Décocher « Actif » retire un shift de la palette sans toucher aux plannings déjà faits.</div></section>';
    var cpCard = '<section class="panel"><h3>Congés payés par salarié</h3><p class="small" style="margin-top:0">Le ' + (st.cp_credit_day || 1) + ' ' + MOIS_L[(st.cp_credit_month || 5) - 1] + ' de chaque année, chaque salarié des statuts concernés reçoit ' + num(rate) + ' jours par mois de présence sur la période écoulée, calculés depuis sa date d\'entrée (prorata, arrondi au supérieur, plafond ' + cap + ' j).</p>' +
      (done ? '<div class="banner info">Période du ' + d(lastStart) + ' au ' + d(lastEnd) + ' : déjà créditée.</div>'
        : '<button class="btn brass" data-act="accrue" data-m="' + today() + '">Calculer et créditer les CP de la période du ' + d(lastStart) + ' au ' + d(lastEnd) + '</button>') +
      (missing ? '<div class="banner warn">' + missing + ' salarié(s) sans date d\'entrée : ils ne seront pas crédités. Renseignez-la dans Équipe.</div>' : '') +
      '<div class="table-wrap" style="border:0"><table><thead><tr><th>Salarié</th><th>Contrat</th><th>Entrée</th><th class="n">Acquis à ce jour</th><th class="n">Prévus au ' + d(per.next) + '</th><th class="n">Solde CP</th><th class="n">Ancienneté</th></tr></thead><tbody>' +
      (cpRows || '<tr><td colspan="7" class="empty">Aucun salarié.</td></tr>') + '</tbody></table></div>' +
      '<div class="list">' + (acc.length ? acc.map(function (a) { return '<div class="sub">' + d(a.period_start) + ' → ' + d(a.period_end) + ' : ' + String(a.total_days).replace('.', ',') + ' j crédités à ' + a.employees + ' salariés</div>'; }).join('') : '<div class="sub muted">Aucun crédit enregistré.</div>') + '</div></section>';
    /* catégories à gauche, comme le menu : un clic affiche les réglages de la catégorie */
    var co = (S.companies || []).find(function (x) { return x.id === S.me.company_id; }) || {};
    var coSec = '<section class="panel form scard"><div class="scard-h"><span class="scard-i">' + ICON.building + '</span><div><h3>' + esc(co.name || 'Entreprise') + '</h3><div class="small muted">Fiche de l\'établissement (raison sociale, SIRET, adresse, contacts…).</div></div></div>' + coCard(co, false) +
      '<div class="row"><button type="button" class="btn sm brass" data-act="co-edit" data-id="' + co.id + '">Modifier la fiche</button>' + (isDev() ? '<button type="button" class="btn sm" data-act="go" data-v="entreprises">Toutes les entreprises</button>' : '') + '</div></section>';
    var restSec = card(ICON.cal, 'Repos habituels', 'Posés tout seuls dans le planning à la création d\'un salarié ou au changement de ses jours de repos.',
      nf('rest_auto_months', 'Poser les repos sur (mois à venir)', st.rest_auto_months || 3, 'min="1" max="12"') + '<div class="hint">Les repos sont posés sur les cases vides uniquement. Pour un mois plus lointain : bouton « Poser les repos habituels » dans le planning.</div>', 'rest');
    var CATS = [
      ['etab', 'Établissement', ICON.building, coSec + sections[0] + sections[9]],
      ['temps', 'Temps de travail', ICON.clock, sections[1] + restSec],
      ['services', 'Services et effectifs', ICON.users, svcCard],
      ['shifts', 'Shifts par service', ICON.clock, tplCard],
      ['journees', 'Journées et statuts', ICON.cal, sections[11] + sections[12]],
      ['demandes', 'Demandes et publication', ICON.inbox, sections[2]],
      ['conges', 'Congés payés', ICON.cal, sections[3] + cpCard],
      ['hs', 'Heures supplémentaires', ICON.clock, sections[4]],
      ['anc', 'Ancienneté', ICON.users, sections[5]],
      ['droits', 'Droits des rôles', ICON.users, (isDev() ? card(ICON.user, 'Droits du rôle Administrateur', 'Réglables par le développeur uniquement. Par défaut, l\'administrateur a tous les droits sur tous les services de son établissement.', rightsBoxAdmin(), 'rights') : '') + sections[6] + sections[7] + sections[8]],
      ['notifs', 'Notifications', ICON.bell, sections[10]],
      ['securite', 'Sécurité', ICON.user, sections[13]]
    ];
    var cat = CATS.some(function (c) { return c[0] === S.setCat; }) ? S.setCat : 'etab';
    var curCat = CATS.find(function (c) { return c[0] === cat; });
    return '<div class="page-head"><div><div class="eyebrow">Réservé à l\'administrateur</div><h2>Paramètres</h2><div class="small muted">Règles de l\'établissement, compteurs et droits des rôles' + (st.updated_at ? ' · modifiés le ' + stamp(new Date(st.updated_at)) : '') + '</div></div></div>' +
            '<div class="set-layout"><nav class="set-nav" aria-label="Catégories de réglages">' + CATS.map(function (c) { return '<button type="button" data-act="set-cat" data-v="' + c[0] + '"' + (c[0] === cat ? ' aria-current="page"' : '') + '>' + c[2] + '<span>' + esc(c[1]) + '</span></button>'; }).join('') + '</nav>' +
      '<div class="set-body"><h3 class="set-title">' + esc(curCat[1]) + '</h3><div class="scards' + (['services', 'shifts', 'conges'].indexOf(cat) >= 0 ? ' one' : '') + '">' + curCat[3] + '</div></div></div>';
  }
  function tplRow(t) {
    var colors = Object.keys(COLORS).map(function (k) { return '<option value="' + k + '"' + (t.color === k ? ' selected' : '') + '>' + COLORS[k] + '</option>'; }).join('');
    var key = t.id || 'new';
    return '<tr data-tpl-row="' + key + '"><td class="nowrap"><span class="swatch k-' + (t.color || 'am') + '"' + (t.bg ? ' style="background:' + esc(t.bg) + '"' : '') + '></span><input type="text" id="tp-name-' + key + '" value="' + esc(t.name) + '" placeholder="' + (t.id ? '' : 'Nouveau modèle') + '" maxlength="30"></td>' +
      '<td><select id="tp-svc-' + key + '"><option value="">Tous les services</option>' + S.services.map(function (sv) { return '<option value="' + sv.id + '"' + (t.service_id === sv.id ? ' selected' : '') + '>' + esc(sv.name) + '</option>'; }).join('') + '</select></td>' +
      '<td><input type="time" id="tp-start-' + key + '" value="' + esc((t.start_time || '').slice(0, 5)) + '"></td><td><input type="time" id="tp-end-' + key + '" value="' + esc((t.end_time || '').slice(0, 5)) + '"></td>' +
      '<td><select id="tp-color-' + key + '">' + colors + '</select></td>' +
      '<td><input type="text" id="tp-label-' + key + '" value="' + esc(t.label || '') + '" maxlength="6" style="width:64px" placeholder="auto" aria-label="Texte affiché"></td>' +
      '<td class="nowrap"><label class="small"><input type="checkbox" id="tp-own-' + key + '"' + (t.bg ? ' checked' : '') + '> perso</label> <input type="color" id="tp-bg-' + key + '" value="' + esc(t.bg || '#87CEEB') + '" aria-label="Couleur de fond"> <input type="color" id="tp-fg-' + key + '" value="' + esc(t.fg || '#000000') + '" aria-label="Couleur du texte"></td>' +
      '<td><input type="number" min="0" max="99" id="tp-rooms-' + key + '" value="' + (t.rooms == null ? '' : t.rooms) + '" style="width:64px" placeholder="—" aria-label="Chambres"></td><td><input type="number" id="tp-sort-' + key + '" value="' + (t.sort || 0) + '" style="width:60px"></td>' +
      '<td><input type="checkbox" id="tp-active-' + key + '"' + (t.active !== false ? ' checked' : '') + '></td>' +
      '<td><div class="row" style="flex-wrap:nowrap"><button type="button" class="btn sm" data-act="tpl-save" data-id="' + t.id + '">' + (t.id ? 'Enregistrer' : 'Ajouter') + '</button>' +
      (t.id ? '<button type="button" class="btn sm ghost danger" data-act="tpl-del" data-id="' + t.id + '">Supprimer</button>' : '') + '</div></td></tr>';
  }
  /* Barème d'effectif requis d'un service (lignes à saisir au-dessus du planning + paliers) */
  function openStaffing(id) {
    var sv = S.services.find(function (x) { return x.id === id; }), c = sv.staffing || { inputs: [], combine: 'max', tiers: [], base: null };
    var tot = c.total || { label: 'Total à faire', keys: [], prev: [] };
    function roleOf(k) { return (tot.prev || []).indexOf(k) >= 0 ? 'prev' : (tot.keys || []).indexOf(k) >= 0 ? 'day' : 'none'; }
    dlg.innerHTML = '<form id="sf" class="form" novalidate><div class="dlg-h"><div><div class="eyebrow">' + esc(sv.name) + '</div><h3>Effectif requis et totaux</h3></div><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div><div class="dlg-b">' +
      '<label class="f">Lignes à saisir au-dessus du planning (une par ligne ; vide = pas de lignes pour ce service)<textarea id="sf-inputs" rows="4">' + esc((c.inputs || []).map(function (i) { return i.label; }).join('\n')) + '</textarea></label>' +
      '<label class="f">Le barème s\'applique à<select id="sf-combine"><option value="sum"' + (c.combine === 'sum' ? ' selected' : '') + '>la somme des lignes (ligne « Total » affichée)</option><option value="max"' + (c.combine === 'max' || !c.combine ? ' selected' : '') + '>la plus grande des valeurs saisies ce jour-là</option><option value="formula"' + (c.combine === 'formula' ? ' selected' : '') + '>un total calculé : lignes du jour + lignes de la veille</option></select></label>' +
      '<div id="sf-formula" class="sf-formula"' + (c.combine === 'formula' ? '' : ' hidden') + '><label class="f">Nom de la ligne calculée<input type="text" id="sf-totlabel" value="' + esc(tot.label || 'Total à faire') + '"></label>' +
        ((c.inputs || []).length ? '<div class="small muted">Ce que chaque ligne apporte au total :</div>' + c.inputs.map(function (inp, k) {
          var r = roleOf(inp.key);
          return '<label class="f sf-role">' + esc(inp.label) + '<select data-role-idx="' + k + '"><option value="day"' + (r === 'day' ? ' selected' : '') + '>compte le jour même</option><option value="prev"' + (r === 'prev' ? ' selected' : '') + '>compte le lendemain (J+1)</option><option value="none"' + (r === 'none' ? ' selected' : '') + '>ne compte pas</option></select></label>';
        }).join('') : '<div class="small muted">Enregistrez d\'abord les lignes, puis rouvrez cette fenêtre pour choisir ce que chacune apporte au total.</div>') + '</div>' +
      '<label class="f">Paliers « si plus de … : … employés » (un par ligne, ex. 320 : 8 ; vide = pas de contrôle de l\'effectif)<textarea id="sf-tiers" rows="5">' + esc((c.tiers || []).slice().sort(function (a, b) { return b.over - a.over; }).map(function (t) { return t.over + ' : ' + t.n; }).join('\n')) + '</textarea></label>' +
      '<label class="f">Sinon (en dessous du dernier palier) : employés<input type="number" id="sf-base" min="0" value="' + (c.base == null ? '' : c.base) + '"></label>' +
      '<label class="f">Minimum de présents chaque jour (ex. Conciergerie : 4 ; vide = aucun)<input type="number" id="sf-min" min="0" max="50" value="' + (c.min_staff == null ? '' : c.min_staff) + '"></label>' +
      '<label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="sf-deliv"' + (c.delivery ? ' checked' : '') + '> Ligne « Jour de livraison » au-dessus du planning : une livraison cochée le jour J ajoute 1 personne requise à J+2 (« Livr. » imprimé)</label>' +
      '<label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="sf-rooms"' + (c.rooms_left ? ' checked' : '') + '> Ligne « Chambres restant à faire » en bas du planning : total calculé − chambres des shifts posés ce jour-là (nombre de chambres de chaque shift : Paramètres → Shifts par service, colonne « Chambres »)</label>' +
      '<fieldset class="sf-formula"><label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="sf-extra"' + (c.extra ? ' checked' : '') + '> Ligne « Demande extra StaffHôtel » : chaque extra saisi compte comme une personne présente (simulation du manque de personnel)</label>' +
        '<div class="two"><label class="f">Chambres faites par un extra (Housekeeping, sinon 0)<input type="number" id="sf-xrooms" min="0" max="40" value="' + ((c.extra || {}).rooms || 0) + '"></label><label class="f">Compté dans la localisation (facultatif)<input type="text" id="sf-xloc" value="' + esc((c.extra || {}).location || '') + '" placeholder="ex. FEMMES DE CHAMBRE"></label></div></fieldset>' +
      '<label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="sf-byloc"' + (c.by_location ? ' checked' : '') + '> Totaux séparés par localisation : sous chaque localisation, le nombre de présents de cette localisation (écran et PDF)</label>' +
      '<div class="err" id="sf-err"></div></div><div class="dlg-f"><span></span><div class="row"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div></div></form>';
    var f = dlg.querySelector('#sf');
    f.querySelector('#sf-combine').addEventListener('change', function () { f.querySelector('#sf-formula').hidden = this.value !== 'formula'; });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var labels = f.querySelector('#sf-inputs').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean), err = f.querySelector('#sf-err');
      var tiers = [], bad = false;
      f.querySelector('#sf-tiers').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (l) {
        var m = l.match(/^(\d+)\s*[:=;,\-]\s*(\d+)/); if (!m) bad = true; else tiers.push({ over: +m[1], n: +m[2] });
      });
      if (bad) { err.textContent = 'Écrivez chaque palier sous la forme « 320 : 8 ».'; return; }
      var bv = f.querySelector('#sf-base').value;
      var inputs = labels.map(function (l, i) { var old = (c.inputs || [])[i]; return { key: old ? old.key : 'v' + (i + 1) + '_' + Date.now().toString(36), label: l }; });
      var staffing = { inputs: inputs, combine: f.querySelector('#sf-combine').value, tiers: tiers.sort(function (a, b) { return b.over - a.over; }),
        base: bv === '' ? (tiers.length ? 0 : null) : +bv, delivery: f.querySelector('#sf-deliv').checked, by_location: f.querySelector('#sf-byloc').checked, rooms_left: f.querySelector('#sf-rooms').checked,
        min_staff: f.querySelector('#sf-min').value === '' ? null : Math.max(0, +f.querySelector('#sf-min').value),
        extra: f.querySelector('#sf-extra').checked ? { label: 'Demande extra StaffHôtel', rooms: Math.max(0, +f.querySelector('#sf-xrooms').value || 0), location: f.querySelector('#sf-xloc').value.trim() || null } : null };
      if (staffing.combine === 'formula') {
        var t2 = { label: f.querySelector('#sf-totlabel').value.trim() || 'Total', keys: [], prev: [] };
        inputs.forEach(function (inp, k) { var sel = f.querySelector('[data-role-idx="' + k + '"]'), r = sel ? sel.value : 'day'; if (r === 'day') t2.keys.push(inp.key); if (r === 'prev') t2.prev.push(inp.key); });
        staffing.total = t2;
      }
      if (!inputs.length && !staffing.by_location && staffing.min_staff == null && !staffing.extra) staffing = null;
      try { await Store.saveService({ id: sv.id, name: sv.name, locations: sv.locations, sort: sv.sort, archived: sv.archived, staffing: staffing }); S.services = await Store.services(); toast('Réglages enregistrés'); dlg.close(); render(); }
      catch (ex) { err.textContent = ex.message; }
    });
    dlg.showModal();
  }
  /* ---------- JOURNAL DES MODIFICATIONS ---------- */
  /* ---------- ENTREPRISES (développeur : toutes ; administrateur : la sienne) ---------- */
  var CO_FIELDS = [['name', 'Nom de l\'établissement *'], ['legal_name', 'Raison sociale'], ['siret', 'SIRET'], ['ape_code', 'Code APE / NAF'], ['vat_number', 'N° TVA intracommunautaire'],
    ['address', 'Adresse'], ['postal_code', 'Code postal'], ['city', 'Ville'], ['country', 'Pays'], ['phone', 'Téléphone'], ['email', 'E-mail'], ['website', 'Site internet'],
    ['director', 'Directeur / directrice'], ['contact_name', 'Contact RH / paie'], ['contact_email', 'E-mail RH / paie'], ['collective_agreement', 'Convention collective'],
    ['category', 'Type d\'établissement (ex. hôtel 4*)'], ['rooms', 'Nombre de chambres']];
  async function vCompanies() {
    S.companies = await Store.companies();
    var list = S.companies, cur = S.me.company_id;
    function addr(c) { return [c.address, [c.postal_code, c.city].filter(Boolean).join(' '), c.country && c.country !== 'France' ? c.country : ''].filter(Boolean).join(', '); }
    if (!isDev()) {
      var c = list.find(function (x) { return x.id === cur; }) || {};
      return '<div class="page-head"><div><div class="eyebrow">Administration</div><h2>Mon entreprise</h2></div><button class="btn brass" data-act="co-edit" data-id="' + c.id + '">Modifier la fiche</button></div>' + coCard(c, true);
    }
    return '<div class="page-head"><div><div class="eyebrow">Développeur</div><h2>Entreprises</h2></div><button class="btn brass" data-act="co-new">+ Nouvelle entreprise</button></div>' +
      '<p class="hint" style="margin:0">Chaque entreprise a ses propres services, salariés, shifts, barèmes, paramètres, plannings, demandes, fiches de présence et de pointage : rien n\'est partagé. Choisissez l\'entreprise ouverte en haut de l\'écran (ou « Ouvrir » ci-dessous) : tout HPG passe sur elle. Son administrateur ne voit que la sienne, avec tous ses services.</p>' +
      '<div class="co-list">' + list.map(function (c) {
        return '<section class="panel co-item' + (c.id === cur ? ' current' : '') + '"><div class="co-h"><div><h3>' + esc(c.name) + (c.active === false ? ' <span class="pill warn">inactive</span>' : '') + (c.id === cur ? ' <span class="pill ok">ouverte</span>' : '') + '</h3>' +
          '<div class="small muted">' + esc([c.legal_name, addr(c)].filter(Boolean).join(' · ') || 'Fiche à compléter') + '</div></div><div class="row">' +
          (c.id === cur ? '' : '<button class="btn sm brass" data-act="co-open" data-id="' + c.id + '">Ouvrir</button>') +
          '<button class="btn sm" data-act="co-edit" data-id="' + c.id + '">Modifier</button></div></div>' + coCard(c, false) + '</section>';
      }).join('') + '</div>';
  }
  function coCard(c, big) {
    var rows = CO_FIELDS.slice(1).filter(function (f) { return c[f[0]] != null && c[f[0]] !== ''; }).map(function (f) { return '<div><dt>' + esc(f[1].replace(' *', '')) + '</dt><dd>' + esc(c[f[0]]) + '</dd></div>'; });
    if (c.notes) rows.push('<div class="wide"><dt>Notes</dt><dd>' + esc(c.notes) + '</dd></div>');
    return rows.length ? '<dl class="co-dl' + (big ? ' panel' : '') + '">' + rows.join('') + '</dl>' : (big ? '<div class="panel empty">Fiche à compléter.</div>' : '');
  }
  function featBox(fs) {
    return '<fieldset class="co-start co-feat"><legend>Options de l\'entreprise <span class="muted small">(développeur seulement · décochez ce que l\'établissement ne doit pas avoir)</span></legend>' +
      FEATURES.map(function (g) { return '<div class="feat-g"><div class="eyebrow">' + esc(g[0]) + '</div>' + g[1].map(function (o) { return '<label class="feat"><input type="checkbox" data-feat="' + o[0] + '"' + (fs[o[0]] !== false ? ' checked' : '') + '> ' + esc(o[1]) + '</label>'; }).join('') + '</div>'; }).join('') + '</fieldset>';
  }
  function openCompany(c) {
    var isNew = !c || !c.id; c = c || { country: 'France' };
    var others = (S.companies || []);
    dlg.innerHTML = '<form id="co" class="form" novalidate><div class="dlg-h"><div><div class="eyebrow">' + (isNew ? 'Nouvelle entreprise' : esc(c.name)) + '</div><h3>' + (isNew ? 'Créer une entreprise' : 'Fiche entreprise') + '</h3></div><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div><div class="dlg-b">' +
      '<div class="co-grid">' + CO_FIELDS.map(function (f) { return '<label class="f">' + esc(f[1]) + '<input ' + (f[0] === 'rooms' ? 'type="number" min="0"' : f[0].indexOf('email') >= 0 ? 'type="email"' : 'type="text"') + ' name="' + f[0] + '" value="' + esc(c[f[0]] == null ? '' : c[f[0]]) + '"></label>'; }).join('') + '</div>' +
      '<label class="f">Notes<textarea name="notes" rows="2">' + esc(c.notes || '') + '</textarea></label>' +
      (isNew ? '<fieldset class="co-start"><legend>Point de départ</legend>' +
        '<label class="co-opt"><input type="radio" name="start" value="copy" checked><span>Recopier les réglages d\'une entreprise : services, shifts par service, barèmes d\'effectif, paramètres (temps de travail, CP, ancienneté, droits, types de journées…). Aucun salarié ni planning n\'est recopié.' +
        '<select name="copy_from" style="margin-top:6px;display:block">' + others.map(function (o) { return '<option value="' + o.id + '">' + esc(o.name) + '</option>'; }).join('') + '</select></span></label>' +
        '<label class="co-opt"><input type="radio" name="start" value="blank"><span>Partir de zéro : paramètres par défaut et les services ci-dessous (un par ligne)<textarea name="services" rows="4" style="margin-top:6px;display:block;width:100%">Réception\nÉtages\nPetit-déjeuner\nTechnique</textarea></span></label></fieldset>'
        : (isDev() ? sw('name="active"', 'Entreprise active', c.active !== false, 'Inactive : conservée mais plus de crédit automatique des congés.') : '')) +
      (isDev() ? featBox(c.features || {}) : '') +
      '<div class="err" id="co-err"></div></div><div class="dlg-f"><span></span><div class="row"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary" type="submit">' + (isNew ? 'Créer et ouvrir' : 'Enregistrer') + '</button></div></div></form>';
    dlg.classList.add('wide-dlg'); dlg.showModal();
    var f = dlg.querySelector('#co');
    if (isNew && f.elements.copy_from) {   /* options recopiées de l'entreprise choisie (modifiables avant de créer) */
      var syncFeat = function () { var src = others.find(function (o) { return o.id === +f.elements.copy_from.value; }); var fs = (f.elements.start.value === 'copy' && src && src.features) || {}; f.querySelectorAll('input[data-feat]').forEach(function (x) { x.checked = fs[x.dataset.feat] !== false; }); };
      f.elements.copy_from.addEventListener('change', syncFeat); f.querySelectorAll('input[name=start]').forEach(function (x) { x.addEventListener('change', syncFeat); }); syncFeat();
    }
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var p = {}; CO_FIELDS.forEach(function (x) { p[x[0]] = f.elements[x[0]].value; }); p.notes = f.elements.notes.value;
      if (!p.name.trim()) { f.querySelector('#co-err').textContent = 'Indiquez le nom de l\'établissement.'; return; }
      if (!isNew) { p.id = c.id; if (f.elements.active) p.active = f.elements.active.checked; }
      else if (f.elements.start.value === 'copy') p.copy_from = +f.elements.copy_from.value;
      if (isDev()) { p.features = {}; f.querySelectorAll('input[data-feat]').forEach(function (x) { if (!x.checked) p.features[x.dataset.feat] = false; }); }
      else p.services = f.elements.services.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      try {
        var saved = await Store.saveCompany(p);
        dlg.close();
        if (isNew) { toast('Entreprise créée : elle est ouverte. Réglez ses Paramètres puis créez son administrateur dans Équipe.'); await switchCompany(saved.id, 'parametres'); }
        else { toast('Fiche enregistrée'); S.companies = await Store.companies(); S.settings = await Store.settings(); render(); }
      } catch (ex) { f.querySelector('#co-err').textContent = ex.message; }
    });
  }
  async function switchCompany(id, view) {
    try {
      S.me = await Store.switchCompany(id);
      S.svc = null; S.tplSvc = null; S.prEmp = null; S.armed = null; S.armedKey = null; S.cache = {}; S.cfgSig = null; S.menuOpen = false;
      var base = await Promise.all([Store.services(), Store.templates(), Store.profiles(), Store.settings(), Store.companies()]);
      S.services = base[0]; S.templates = base[1]; S.profiles = base[2]; S.settings = base[3] || {}; S.companies = base[4];
      applyDayTypes(); C.setRules(S.settings);
      var svcs = myServices(); S.svc = svcs[0];
      S.view = view || 'planning'; render(); window.scrollTo(0, 0);
    } catch (e) { toast(e.message, true); render(); }
  }

  async function vJournal() {
    var list = await Store.auditEntries(300);
    var TN = { shifts: 'Planning', requests: 'Demande', profiles: 'Fiche salarié', overtime_entries: 'Heures supp', owed_days: 'Jours dus', settings: 'Paramètres', services: 'Service', shift_templates: 'Modèle de shift' };
    var AN = { INSERT: 'ajout', UPDATE: 'modification', DELETE: 'suppression', UPSERT: 'saisie' };
    function what(e) {
      var r = e.new_data || e.old_data || {};
      if (e.table_name === 'shifts') return (r.employee_id ? name(r.employee_id) + ' · ' : '') + (r.day ? r.day.split('-').reverse().join('/') + ' · ' : '') + (r.kind === 'work' ? (r.label || '') + ' ' + hhmm(r.start_time) + '–' + hhmm(r.end_time) : KLABEL[r.kind] || r.kind || '');
      if (e.table_name === 'requests') return (r.employee_id ? name(r.employee_id) + ' · ' : '') + (TYPES[r.type] || '') + ' · ' + (STATUS[r.status] || [''])[0];
      if (e.table_name === 'profiles') return r.full_name || '';
      if (e.table_name === 'overtime_entries') return (r.employee_id ? name(r.employee_id) + ' · ' : '') + (r.minutes ? '+' + fmt(r.minutes) : '');
      if (e.table_name === 'owed_days') return (r.employee_id ? name(r.employee_id) + ' · ' : '') + ({ ferie: 'jour férié', recup: 'jour à récupérer', rendre: 'jour à rendre' }[r.type] || '');
      if (e.table_name === 'settings' && e.old_data && e.new_data) return Object.keys(e.new_data).filter(function (k) { return k !== 'updated_at' && k !== 'updated_by' && JSON.stringify(e.new_data[k]) !== JSON.stringify(e.old_data[k]); }).join(', ');
      return r.name || '';
    }
    return '<div class="page-head"><div><div class="eyebrow">Réservé à l\'administrateur</div><h2>Journal des modifications</h2></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Quand</th><th>Qui</th><th>Quoi</th><th>Action</th><th>Détail</th></tr></thead><tbody>' +
      (list.length ? list.map(function (e) { return '<tr><td class="small">' + stamp(new Date(e.at)) + '</td><td>' + esc(e.actor_name || 'Système') + '</td><td>' + esc(TN[e.table_name] || e.table_name) + '</td><td>' + esc(AN[e.action] || e.action) + '</td><td class="small">' + esc(what(e)) + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="empty">Aucune modification enregistrée.</td></tr>') +
      '</tbody></table></div>';
  }

  /* ---------- Impression du planning mensuel : tout le mois sur UNE seule page A4 paysage ---------- */
  function openExport() {
    var m = curMonth(), list = myServices();
    dlg.innerHTML = '<form id="ex" class="form" novalidate><div class="dlg-h"><h3>Imprimer le planning du mois</h3><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div><div class="dlg-b">' +
      '<div class="two"><label class="f">Mois<input type="month" id="ex-month" value="' + m + '" required></label>' + (list.length > 1 ? '<label class="f">Service<select id="ex-svc">' + list.map(function (sid) { return '<option value="' + sid + '"' + (sid === S.svc ? ' selected' : '') + '>' + esc(svcName(sid)) + '</option>'; }).join('') + '</select></label>' : '') + '</div>' +
      '<div class="hint">Tout le mois tient sur une seule page A4 paysage : un salarié par ligne, un jour par colonne (codes et couleurs du planning), nombre de personnes par shift et par jour, légende, date et heure d\'impression, date de dernière modification. Mention « brouillon » si le mois n\'est pas publié.</div>' +
      '<div class="err" id="ex-err" role="alert"></div></div><div class="dlg-f"><span></span><div class="row"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary" type="submit">' + ICON.pdf + ' Télécharger le PDF</button></div></div></form>';
    var f = dlg.querySelector('#ex');
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var month = f.querySelector('#ex-month').value, svc = f.querySelector('#ex-svc') ? +f.querySelector('#ex-svc').value : S.svc;
      if (!/^\d{4}-\d{2}$/.test(month)) { f.querySelector('#ex-err').textContent = 'Choisissez un mois.'; return; }
      var btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try { await exportPdf(month, svc); dlg.close(); }
      catch (ex) { f.querySelector('#ex-err').textContent = ex.message; }
      finally { btn.disabled = false; }
    });
    dlg.showModal();
  }
  /* code d'une case, comme en vue mois : M ouverture, M matin, S soir, N nuit, heure de début pour les middles, code des journées */
  function cellCode(sh) {
    var k = colorKey(sh), letter = sh.kind === 'work' && MLETTER[k];
    var rmc = shiftRooms(sh), tpc = tplOf(sh), bgc = tpc && tpc.bg ? tpc.bg : null, fgc = tpc && tpc.bg ? (tpc.fg || '#000000') : null;
    if (rmc != null) return { code: String(rmc), bg: bgc || (PDFC[k] || PDFC.am)[0], fg: fgc || (PDFC[k] || PDFC.am)[1] };
    if (tpc && (tpc.label || tpc.bg)) return { code: tpc.label || (letter || startCode(sh.start_time, k)), bg: bgc || (PDFC[k] || PDFC.am)[0], fg: fgc || (PDFC[k] || PDFC.am)[1] };
    if (sh.kind !== 'work') return { code: ABBR[sh.kind] || '?', bg: (((S.settings.day_types || {})[sh.kind] || {}).bg) || (PDFC[sh.kind] || PDFC.repos)[0], fg: (((S.settings.day_types || {})[sh.kind] || {}).fg) || (PDFC[sh.kind] || PDFC.repos)[1] };
    if (letter) return { code: letter, bg: { open: '#FF9F0A', am: '#8EE5A6', pm: '#FF3EB5', night: '#1E3A8A' }[k], fg: { open: '#D00000', am: '#000000', pm: '#000000', night: '#FFFFFF' }[k] };
    return { code: startCode(sh.start_time, k), bg: (PDFC[k] || PDFC.am)[0], fg: (PDFC[k] || PDFC.am)[1] };
  }
  async function exportPdf(month, svc) {
    await refreshConfig(true);
    var days = monthDays(month), first = days[0], last = days[days.length - 1];
    var cfg = staffingCfg(svc);
    var res = await Promise.all([Store.shifts(first, last, { serviceId: svc }), Store.publishedMonths(svc), Store.staffingValues(svc, C.addDays(first, -2), last)]);
    var shifts = res[0], published = res[1].some(function (p) { return p.month === first; });
    var sv = {}; res[2].forEach(function (v) { (sv[v.day] = sv[v.day] || {})[v.key] = v.value; });
    function reqFull(d) { return cfg ? requiredDay(cfg, d, function (x) { return sv[x]; }) : null; }
    function reqOf(d) { var r = reqFull(d); return r ? r.n : null; }
    var team = teamOf(svc), ids = team.map(function (p) { return p.id; });
    shifts.forEach(function (s) { if (ids.indexOf(s.employee_id) < 0) { var p = S.profiles.find(function (x) { return x.id === s.employee_id; }); if (p) { team.push(p); ids.push(p.id); } } });
    var lastMod = shifts.filter(function (s) { return s.updated_at; }).reduce(function (a, s) { return !a || s.updated_at > a.updated_at ? s : a; }, null);
    var printed = new Date(), monthLabel = MOIS_L[+month.slice(5, 7) - 1] + ' ' + month.slice(0, 4), svcLabel = svcName(svc);
    var printedTxt = 'Imprimé le ' + stamp(printed) + ' par ' + (isDev() ? 'Développeur' : (S.me.full_name || S.me.email));
    var modTxt = lastMod ? 'Dernière modification : ' + stamp(new Date(lastMod.updated_at)) + (lastMod.updated_by && name(lastMod.updated_by) !== '—' ? ' par ' + name(lastMod.updated_by) : '') : 'Aucune modification enregistrée ce mois-ci';
    // groupes « nombre de personnes par shift »
    var groups = {};
    shifts.forEach(function (s) { if (s.kind !== 'work' || ids.indexOf(s.employee_id) < 0) return; var g = shiftGroup(s); groups[g.key] = groups[g.key] || Object.assign(g, { days: {} }); groups[g.key].days[s.day] = (groups[g.key].days[s.day] || 0) + 1; });
    var glist = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return a.order - b.order || a.label.localeCompare(b.label); });
    // mise en page : tout tient sur une page A4 paysage, les tailles s'adaptent au nombre de lignes
    var doc = new window.MiniPdf(), PW = doc.w, PH = doc.h, M = 20, top = 52, legendH = 30, footH = 16;
    var nameW = 104, totW = 34, dayW = (PW - 2 * M - nameW - totW) / days.length;
    var grpRows = 0, g0 = null; team.forEach(function (p) { var g = groupOf(p, svc); if (g !== g0) { g0 = g; if (g) grpRows++; } });
    var locSplit = byLocation(svc) && team.some(function (q) { return groupOf(q, svc); }), locRows = 0, locMembers = {};
    if (locSplit) {
      team.forEach(function (q) { var g = groupOf(q, svc); (locMembers[g] = locMembers[g] || []).push(q.id); });
      locRows = Object.keys(locMembers).length;
    }
    var roomsLine = !!(cfg && cfg.rooms_left), xRow = !!(cfg && cfg.extra && days.some(function (d) { return extraN(cfg, d, function (x) { return sv[x]; }); }));
    var nRows = team.length + grpRows * 0.6 + 1 + 1.2 + locRows * 0.85 + (roomsLine ? 1 : 0) + (xRow ? 1 : 0);
    var rowH = Math.min(18, (PH - top - legendH - footH - 22) / nRows), fs = Math.max(4.2, Math.min(7.5, rowH * 0.48)), cfs = Math.max(4, Math.min(7, Math.min(rowH * 0.5, dayW * 0.36)));
    doc.addPage();
    doc.rect(0, 0, PW, 5, '#1B2433');
    doc.text('Planning ' + svcLabel + ' — ' + monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1), M, 26, { size: 14, bold: true, color: '#1B2433' });
    doc.text((S.settings.hotel_name || 'HPG') + ' · HPG Hotelplanning' + (published ? '' : '   ·   BROUILLON : mois non publié'), M, 40, { size: 8, bold: !published, color: published ? '#7A8291' : '#8A5A00' });
    doc.text(printedTxt, PW - M, 24, { size: 8, bold: true, align: 'right', color: '#1B2433' });
    doc.text(modTxt, PW - M, 35, { size: 7, align: 'right', color: '#4A5363' });
    var y = top, hh = Math.max(16, rowH);
    // en-tête des jours
    doc.rect(M, y, PW - 2 * M, hh, '#EBEBE4');
    doc.text('Salarié', M + 4, y + hh * 0.65, { size: fs, bold: true, color: '#4A5363' });
    days.forEach(function (d, i) {
      var x = M + nameW + i * dayW, dw = C.dow(d), hol = C.holidayName(d);
      if (cfg && cfg.delivery && (sv[d] || {})._livr) doc.text('Livr.', x + dayW / 2, y - 2.5, { size: Math.min(6.5, dayW * 0.3), bold: true, align: 'center', color: '#9B2C22' });
      if (dw === 0 || dw === 6) doc.rect(x, y, dayW, hh, '#DADBD3');
      doc.text(JOURS[dw].slice(0, 1).toUpperCase(), x + dayW / 2, y + hh * 0.42, { size: Math.min(6, fs), align: 'center', color: '#7A8291' });
      doc.text(String(+d.slice(8, 10)), x + dayW / 2, y + hh * 0.85, { size: Math.min(7, fs + 0.5), bold: true, align: 'center', color: hol ? '#9B2C22' : '#1B2433' });
    });
    doc.text('Jours', PW - M - 3, y + hh * 0.65, { size: fs, bold: true, align: 'right', color: '#4A5363' });
    y += hh;
    // les lignes de calcul (chambres, PDJ, total, effectif requis) restent à l'écran : elles ne s'impriment pas
    var grp = null;
    team.forEach(function (p, idx) {
      var g = groupOf(p, svc);
      if (g !== grp) { grp = g; if (g) { var gh = rowH * 0.6; doc.rect(M, y, PW - 2 * M, gh, '#F3F3EE'); doc.text(g, M + 4, y + gh * 0.78, { size: Math.max(4, fs - 1.5), bold: true, color: '#7A8291' }); y += gh; } }
      if (idx % 2) doc.rect(M, y, PW - 2 * M, rowH, '#FAFAF7');
      doc.text(p.full_name, M + 4, y + rowH * 0.66, { size: fs, bold: true, color: '#1B2433', maxWidth: nameW - 8 });
      var mine = shifts.filter(function (s) { return s.employee_id === p.id; }), worked = 0;
      days.forEach(function (d, i) {
        var list = mine.filter(function (s) { return s.day === d; }), x = M + nameW + i * dayW;
        list.slice(0, 2).forEach(function (s, k) {
          worked += C.shiftDetail(s).worked;
          var c = cellCode(s), h = list.length > 1 ? (rowH - 2) / 2 : rowH - 2, cy = y + 1 + k * h;
          if (s.kind === 'repos') doc.rect(x + 0.6, cy, dayW - 1.2, h, null, '#C9CABF', 0.4); else doc.rect(x + 0.6, cy, dayW - 1.2, h, c.bg);
          doc.text(c.code, x + dayW / 2, cy + h * 0.68, { size: list.length > 1 ? cfs * 0.8 : cfs, bold: true, align: 'center', color: s.kind === 'repos' ? '#7A8291' : c.fg, maxWidth: dayW - 1 });
          if (s.extra_pay) doc.rect(x + dayW - 3.2, cy + 0.6, 2.4, 2.4, '#FFD43B');
        });
      });
      doc.text(daysTxt(workedDays(mine, days)), PW - M - 3, y + rowH * 0.66, { size: fs, align: 'right', color: '#1B2433' });
      doc.line(M, y + rowH, PW - M, y + rowH, '#B9BBB0', 0.45);
      y += rowH;
      // totaux de la localisation, sous son dernier salarié
      var nx = team[idx + 1];
      if (locSplit && (!nx || groupOf(nx, svc) !== g)) {
        var ls = locStats(shifts, locMembers[g] || [], days), lh = rowH * 0.85, lfs = Math.max(4, fs - 0.8);
        [{ pres: true }].forEach(function (lg) {
          doc.rect(M, y, PW - 2 * M, lh, lg.pres ? '#E4E5DD' : '#F1F1EB');
          var col = lg.pres ? null : (PDFC[lg.color] || PDFC.am);
          if (col) doc.rect(M + 4, y + lh * 0.25, lh * 0.5, lh * 0.5, col[0]);
          doc.text(lg.pres ? 'Présents ' + (g || 'sans localisation') : lg.label, M + (col ? 6 + lh * 0.6 : 4), y + lh * 0.68, { size: lfs, bold: !!lg.pres, color: '#1B2433', maxWidth: nameW - 12 });
          var xLoc = lg.pres && cfg && cfg.extra && cfg.extra.location && String(cfg.extra.location).toUpperCase() === String(g || '').toUpperCase();
          days.forEach(function (d, i) { var n = lg.pres ? ls.pres[i] + (xLoc ? extraN(cfg, d, function (x) { return sv[x]; }) : 0) : (lg.days[d] || 0); if (n || lg.pres) doc.text(String(n), M + nameW + i * dayW + dayW / 2, y + lh * 0.68, { size: lfs, bold: !!lg.pres, align: 'center', color: '#1B2433' }); });
          y += lh;
        });
        doc.line(M, y, PW - M, y, '#9AA0A6', 0.4);
      }
    });
    // nombre de personnes par shift et présents
    doc.line(M, y, PW - M, y, '#9AA0A6', 0.6);
    // extras StaffHôtel demandés (imprimés s'il y en a ce mois-ci)
    if (xRow) {
      doc.rect(M, y, PW - 2 * M, rowH, '#FFF4D6');
      doc.text(cfg.extra.label || 'Demande extra StaffHôtel', M + 4, y + rowH * 0.66, { size: fs, bold: true, color: '#1B2433', maxWidth: nameW - 6 });
      days.forEach(function (d, i) { var e = extraN(cfg, d, function (x) { return sv[x]; }); if (e) doc.text(String(e), M + nameW + i * dayW + dayW / 2, y + rowH * 0.66, { size: fs, bold: true, align: 'center', color: '#8A5A00' }); });
      y += rowH;
    }
    [{ label: 'Présents', total: true }].forEach(function (g) {
      if (g.total) doc.rect(M, y, PW - 2 * M, rowH, '#EBEBE4');
      var col = g.total ? null : (PDFC[g.color] || PDFC.am);
      if (col) doc.rect(M + 4, y + rowH * 0.25, rowH * 0.5, rowH * 0.5, col[0]);
      doc.text(g.total ? 'Présents / jour' : g.label, M + (col ? 6 + rowH * 0.6 : 4), y + rowH * 0.66, { size: fs, bold: !!g.total, color: '#1B2433', maxWidth: nameW - 12 });
      days.forEach(function (d, i) {
        var n;
        var col2 = '#1B2433';
        if (g.total) {
          var ppl = {}; shifts.forEach(function (s) { if (s.kind === 'work' && s.day === d && ids.indexOf(s.employee_id) >= 0) ppl[s.employee_id] = 1; }); n = Object.keys(ppl).length + extraN(cfg, d, function (x) { return sv[x]; });
          var rq = reqOf(d);
          if (rq != null && n < rq) { doc.rect(M + nameW + i * dayW, y, dayW, rowH, '#FFFF00'); col2 = '#E00000'; }
          else if (rq != null && n > rq) doc.rect(M + nameW + i * dayW, y, dayW, rowH, '#FF9F0A');
        }
        else n = g.days[d] || 0;
        if (n || g.total) doc.text(String(n), M + nameW + i * dayW + dayW / 2, y + rowH * 0.66, { size: fs, bold: !!g.total, align: 'center', color: col2 });
      });
      y += rowH;
    });
    // chambres restant à faire (Housekeeping) : total à faire − chambres des shifts posés
    if (roomsLine) {
      doc.rect(M, y, PW - 2 * M, rowH, '#EBEBE4');
      doc.text('Chambres restant à faire', M + 4, y + rowH * 0.66, { size: fs, bold: true, color: '#1B2433', maxWidth: nameW - 6 });
      days.forEach(function (d, i) {
        var done = 0; shifts.forEach(function (s) { if (s.day === d && ids.indexOf(s.employee_id) >= 0) done += shiftRooms(s) || 0; });
        var rem = roomsLeft(cfg, d, function (x) { return sv[x]; }, done + extraN(cfg, d, function (x) { return sv[x]; }) * (+(cfg.extra || {}).rooms || 0)), col3 = '#1B2433';
        if (rem == null) return;
        if (rem > 0) { doc.rect(M + nameW + i * dayW, y, dayW, rowH, '#FFFF00'); col3 = '#E00000'; }
        else if (rem < 0) doc.rect(M + nameW + i * dayW, y, dayW, rowH, '#FF9F0A');
        doc.text(String(rem), M + nameW + i * dayW + dayW / 2, y + rowH * 0.66, { size: fs, bold: true, align: 'center', color: col3 });
      });
      y += rowH;
    }
    // grille verticale légère
    for (var i = 0; i <= days.length; i++) doc.line(M + nameW + i * dayW, top, M + nameW + i * dayW, y, '#B9BBB0', 0.45);
    doc.rect(M, top, PW - 2 * M, y - top, null, '#9AA0A6', 0.6);
    // légende
    var ly = PH - footH - legendH + 6, lx = M;
    var items = svcTemplates(svc).slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }).map(function (t) { var cc = cellCode(tplSample(t)); return [cc.code, cc.bg, cc.fg, t.name + ' ' + hhmm(t.start_time) + '–' + hhmm(t.end_time)]; })
      .concat(DAYKINDS.map(function (k) { var c = cellCode({ kind: k[0] }); return [k[2], c.bg, c.fg, k[1]]; }));
    items.forEach(function (it) {
      var w = doc.width(it[3], 6) + 26;
      if (lx + w > PW - M) { lx = M; ly += 11; }
      doc.rect(lx, ly - 7, 18, 9, it[1]); doc.text(it[0], lx + 9, ly, { size: 5.5, bold: true, align: 'center', color: it[2] });
      doc.text(it[3], lx + 21, ly, { size: 6, color: '#4A5363' }); lx += w;
    });
    doc.text('HPG · ' + svcLabel + ' · ' + monthLabel + ' · repos min. ' + minRest() + ' h · carré jaune = extra à payer' + (cfg && cfg.delivery ? ' · Livr. = livraison (+1 personne à J+2)' : '') + (roomsLine ? ' · Chambres restantes : jaune = sans personne, orange = capacité en trop' : cfg && hasRule(cfg) ? ' · Présents : jaune = manque, orange = en trop' : ''), M, PH - 7, { size: 6.5, color: '#7A8291' });
    doc.text(printedTxt, PW - M, PH - 7, { size: 6.5, align: 'right', color: '#7A8291' });
    var file = 'HPG-planning-' + svcLabel.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-') + '-' + month + '.pdf';
    await saveFile(doc.output(), file);
  }
  async function saveFile(bytes, filename, mime) {
    var blob = new Blob([bytes], { type: mime || 'application/pdf' });
    if (window.claude && typeof window.claude.use === 'function') {
      var dl = null; try { dl = await window.claude.use('downloads'); } catch (e) {}
      if (dl) {
        try { await dl.save({ filename: filename, data: blob }); toast('Fichier enregistré : ' + filename); }
        catch (e) { if (e && e.code !== 'declined') toast('Téléchargement impossible ici : ' + (e.message || e.code), true); }
        return;
      }
    }
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    toast('Fichier téléchargé : ' + filename);
  }

  /* ---------- Compte ---------- */
  function openAccount() {
    var live = Store.mode === 'live', pushOk = live && feat('push') && cfg.VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window;
    dlg.innerHTML = '<div><div class="dlg-h"><div><div class="eyebrow">' + ROLES[S.me.role] + ' · ' + esc(svcName(S.me.service_id)) + '</div><h3>' + esc(S.me.full_name || S.me.email) + '</h3><div class="small muted">' + esc(S.me.email || '') + '</div></div><button type="button" class="btn sm ghost" data-close aria-label="Fermer">✕</button></div>' +
      '<div class="dlg-b"><div class="list">' +
      '<form class="item" id="pw-form" novalidate><div class="form"><div class="title">Changer de mot de passe</div>' +
      '<input type="password" id="pw-new" autocomplete="new-password" minlength="8" placeholder="Nouveau mot de passe (8 caractères minimum)">' +
      '<input type="password" id="pw-new2" autocomplete="new-password" minlength="8" placeholder="Confirmer le nouveau mot de passe">' +
      '<div class="err" id="pw-err" role="alert"></div></div><div class="acts"><button class="btn sm primary" type="submit">Changer</button></div></form>' +
      '<div class="item"><div><div class="title">Notifications sur ce téléphone</div><div class="sub">' + (pushOk ? 'Recevez une alerte quand votre planning change ou qu\'une demande est traitée.' : live ? 'Indisponible sur ce navigateur. Sur iPhone, ajoutez d\'abord HPG à l\'écran d\'accueil (Partager → Sur l\'écran d\'accueil), puis ouvrez-la depuis l\'icône.' : 'Disponible une fois l\'application en ligne.') + '</div></div>' +
      '<div class="acts"><button class="btn sm" data-a="push"' + (pushOk ? '' : ' disabled') + '>Activer</button></div></div>' +
      '</div></div><div class="dlg-f"><button class="btn danger" data-a="logout">Se déconnecter</button><button class="btn" data-close>Fermer</button></div></div>';
    dlg.onclick = async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.a === 'logout') { dlg.close(); logout(); }
      if (b.dataset.a === 'push') { try { await enablePush(); } catch (err) { toast(err.message, true); } }
    };
    var pf = dlg.querySelector('#pw-form');
    pf.onsubmit = async function (e) {
      e.preventDefault();
      var a = pf.querySelector('#pw-new').value, b2 = pf.querySelector('#pw-new2').value, err = pf.querySelector('#pw-err');
      err.textContent = '';
      if (a.length < 8) { err.textContent = 'Le mot de passe doit contenir au moins 8 caractères.'; return; }
      if (a !== b2) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
      try { await Store.updatePassword(a); if (Store.pwChanged) await Store.pwChanged(); toast('Mot de passe changé'); pf.reset(); } catch (ex) { err.textContent = ex.message; }
    };
    dlg.showModal();
  }
  async function logout() {
    try { await Store.signOut(); } catch (e) {}
    S.me = null; S.notifs = []; S.notifOpen = false; S.authMode = 'login'; S.pending = null; S.view = null; S.svc = null;
    authView({ ok: 'Vous êtes déconnecté.' });
  }
  function b64ToBytes(b) { var p = '='.repeat((4 - b.length % 4) % 4), s = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, function (c) { return c.charCodeAt(0); }); }
  async function enablePush() {
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications refusées. Autorisez-les dans les réglages du navigateur pour HPG.');
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.VAPID_PUBLIC_KEY) });
    await Store.savePush(sub);
    toast('Notifications activées sur cet appareil');
  }

  /* ---------- Écrans de connexion : mot de passe, puis code reçu par e-mail ---------- */
  function authView(msg) {
    var m = S.authMode, demo = Store.mode === 'demo';
    if (m === 'code') return codeView(msg);
    var title = { login: 'Connexion', signup: 'Créer mon compte', forgot: 'Mot de passe oublié', recovery: 'Nouveau mot de passe', firstpw: 'Choisissez votre mot de passe' }[m];
    var fields = '';
    if (m === 'signup') fields += '<label class="f">Prénom et nom<input type="text" id="au-name" autocomplete="name" required maxlength="60"></label>';
    if (m === 'firstpw') fields += '<p class="small" style="margin:0">Bienvenue ' + esc((S.me && S.me.full_name) || '') + '. Vous vous êtes connecté avec un code provisoire : choisissez maintenant votre propre mot de passe (8 caractères minimum).</p>' +
      '<label class="f">Nouveau mot de passe<input type="password" id="au-pw" autocomplete="new-password" required></label><label class="f">Confirmer<input type="password" id="au-pw2" autocomplete="new-password" required></label>';
    if (m !== 'recovery' && m !== 'firstpw') fields += '<label class="f">E-mail<input type="email" id="au-email" autocomplete="username" required value="' + esc(S.lastEmail || '') + '"></label>';
    if (m === 'login' || m === 'signup' || m === 'recovery') fields += '<label class="f">Mot de passe<input type="password" id="au-pw" autocomplete="' + (m === 'login' ? 'current-password' : 'new-password') + '" required></label>';
    var sw = m === 'firstpw' ? '<button type="button" class="linkish" data-logout="1">Se déconnecter</button>' : demo ? '' : m === 'login' ? '<button type="button" class="linkish" data-mode="forgot">Mot de passe oublié</button>'
      : '<button type="button" class="linkish" data-mode="login">Retour à la connexion</button>';
    app.innerHTML = '<div class="auth"><form class="card form" id="auth" novalidate><div><h1>HPG</h1><p class="muted" style="margin:4px 0 0">Hotelplanning · planning et heures de l\'équipe</p></div><h3>' + title + '</h3>' + fields +
      '<div class="err" id="au-err" role="alert">' + esc(msg && msg.err || '') + '</div>' + (msg && msg.ok ? '<div class="banner info">' + esc(msg.ok) + '</div>' : '') +
      '<button class="btn primary" type="submit">' + { login: 'Continuer', signup: 'Créer mon compte', forgot: 'Recevoir le lien', recovery: 'Enregistrer', firstpw: 'Enregistrer et continuer' }[m] + '</button>' +
      (sw ? '<div class="auth-sw">' + sw + '</div>' : '') + '<p class="hint" id="au-hint" style="margin:0">Votre identifiant et votre mot de passe vous sont remis par votre responsable.</p></form></div>';
    var f = document.getElementById('auth');
    f.addEventListener('click', function (e) {
      if (e.target.closest('[data-logout]')) { S.authMode = 'login'; logout(); return; }
      var b = e.target.closest('[data-mode]'); if (b) { S.authMode = b.dataset.mode; authView(); return; }
      var d = e.target.closest('[data-fill]'); if (d) { var v = d.dataset.fill.split('|'); f.querySelector('#au-email').value = v[0]; f.querySelector('#au-pw').value = v[1]; }
    });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = function (i) { var el = f.querySelector('#' + i); return el ? el.value.trim() : ''; }, err = f.querySelector('#au-err'), btn = f.querySelector('button[type=submit]');
      err.textContent = ''; btn.disabled = true;
      try {
        if (m === 'login') {
          if (!v('au-email') || !f.querySelector('#au-pw').value) throw new Error('Indiquez votre e-mail et votre mot de passe.');
          S.lastEmail = v('au-email');
          var r = await Store.signIn(v('au-email'), f.querySelector('#au-pw').value);
          if (r && r.needCode) { S.pending = { email: v('au-email'), demoCode: r.demoCode, sentAt: Date.now() }; S.authMode = 'code'; return codeView(); }
          boot();
        } else if (m === 'signup') {
          if (!v('au-name')) throw new Error('Indiquez votre nom.');
          if (f.querySelector('#au-pw').value.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
          var direct = await Store.signUp(v('au-email'), f.querySelector('#au-pw').value, v('au-name'));
          if (direct) boot(); else { S.authMode = 'login'; authView({ ok: 'Compte créé. Ouvrez le lien reçu par e-mail pour confirmer votre adresse, puis connectez-vous.' }); }
        } else if (m === 'forgot') { await Store.resetPassword(v('au-email')); authView({ ok: 'Si un compte existe pour cette adresse, un lien de réinitialisation vient d\'être envoyé.' }); }
        else if (m === 'firstpw') {
          var p1 = f.querySelector('#au-pw').value, p2 = f.querySelector('#au-pw2').value;
          if (p1.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
          if (p1 !== p2) throw new Error('Les deux mots de passe ne sont pas identiques.');
          if (/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(p1)) throw new Error('Choisissez un mot de passe personnel, différent du code provisoire.');
          await Store.updatePassword(p1); await Store.pwChanged(); S.me.must_change_pw = false; S.authMode = 'login'; toast('Mot de passe enregistré'); boot();
        }
        else if (m === 'recovery') {
          var pw = f.querySelector('#au-pw').value; if (pw.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
          await Store.updatePassword(pw); history.replaceState(null, '', location.pathname); S.authMode = 'login'; boot();
        }
      } catch (ex) { err.textContent = ex.message; }
      finally { btn.disabled = false; }
    });
  }
  function codeView(msg) {
    var p = S.pending || {}, demo = Store.mode === 'demo';
    app.innerHTML = '<div class="auth"><form class="card form" id="code" novalidate><div><h1>HPG</h1><p class="muted" style="margin:4px 0 0">Double authentification</p></div>' +
      '<h3>Saisissez le code reçu par e-mail</h3><p class="small" style="margin:0">Un code à 6 chiffres vient d\'être envoyé à <b>' + esc(p.email || '') + '</b>. Il est valable quelques minutes.</p>' +
      (demo && p.demoCode ? '<div class="banner info demo-code"><div>Démonstration : aucun e-mail n\'est envoyé. Votre code :</div><b class="mono">' + esc(p.demoCode) + '</b><button type="button" class="btn sm" data-a="fill">Utiliser ce code</button></div>' : '') +
      '<label class="f">Code<input type="text" id="cd-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" pattern="[0-9]*" class="code-input" autofocus></label>' +
      '<div class="err" id="cd-err" role="alert">' + esc(msg && msg.err || '') + '</div>' + (msg && msg.ok ? '<div class="banner info">' + esc(msg.ok) + '</div>' : '') +
      '<button class="btn primary" type="submit">Valider</button>' +
      '<div class="sw"><button type="button" class="linkish" data-a="resend">Renvoyer le code</button><button type="button" class="linkish" data-a="back">Utiliser un autre compte</button></div>' +
      '<p class="hint" style="margin:0">Pas reçu ? Vérifiez vos courriers indésirables.</p></form></div>';
    var f = document.getElementById('code'), input = f.querySelector('#cd-code');
    input.focus();
    input.addEventListener('input', function () { input.value = input.value.replace(/\D/g, ''); if (input.value.length === 6) { if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true })); } });
    f.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'back') { S.pending = null; S.authMode = 'login'; authView(); return; }
      if (b.dataset.a === 'fill') { input.value = p.demoCode; f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); return; }
      if (b.dataset.a === 'resend') {
        if (Date.now() - (p.sentAt || 0) < 60000) { f.querySelector('#cd-err').textContent = 'Patientez ' + Math.ceil((60000 - (Date.now() - p.sentAt)) / 1000) + ' s avant de redemander un code.'; return; }
        try { var r = await Store.resendCode(p.email); p.sentAt = Date.now(); if (r && r.demoCode) p.demoCode = r.demoCode; codeView({ ok: 'Nouveau code envoyé.' }); }
        catch (ex) { f.querySelector('#cd-err').textContent = ex.message; }
      }
    });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var code = input.value.trim(), err = f.querySelector('#cd-err');
      if (!/^\d{6,10}$/.test(code)) { err.textContent = 'Saisissez les 6 chiffres du code.'; return; }
      try { await Store.verifyCode(p.email, code); S.pending = null; S.authMode = 'login'; boot(); }
      catch (ex) { err.textContent = ex.message; input.select(); }
    });
  }
  function pendingView() {
    return '<div class="panel" style="max-width:520px"><h2>Compte en attente</h2><p>Votre compte est créé. Votre responsable de service doit maintenant l\'activer et vous rattacher à votre service. Vous recevrez une notification dès que c\'est fait.</p>' +
      '<button class="btn" data-act="reload">Vérifier à nouveau</button></div>';
  }

  /* ---------- Événements ---------- */
  var A = {
    go: function (b) { if (b.dataset.v === 'parametres' && b.closest('.palette')) S.tplSvc = null; S.view = b.dataset.v; S.notifOpen = false; S.menuOpen = false; render(); window.scrollTo(0, 0); },
    'co-new': function () { openCompany(null); },
    'preview-exit': function () { exitPreview(); },
    'set-pw': function (b) { openPassword(b.dataset.id); },
    'set-cat': function (b) { S.setCat = b.dataset.v; render(); var t = document.querySelector('.set-body'); if (t && window.innerWidth < 760) t.scrollIntoView({ block: 'start' }); },
    'co-edit': function (b) { openCompany((S.companies || []).find(function (c) { return String(c.id) === b.dataset.id; })); },
    'co-open': function (b) { switchCompany(+b.dataset.id, 'entreprises'); },
    menu: function () { S.menuOpen = !S.menuOpen; S.notifOpen = false; render(); if (S.menuOpen) setTimeout(function () { var c = document.querySelector('.side-menu [aria-current="page"]') || document.querySelector('.side-menu button'); if (c) c.focus(); }, 0); },
    'menu-close': function () { S.menuOpen = false; render(); },
    week: function (b) { S.week = C.addDays(S.week, +b.dataset.d); render(); },
    'week-today': function () { S.week = C.weekStart(today()); render(); },
    pview: function (b) {
      if (b.dataset.v === 'month') S.month = S.week.slice(0, 7);
      else if (S.month) { var t = today(); S.week = t.slice(0, 7) === S.month ? C.weekStart(t) : C.weekStart(S.month + '-01'); }
      S.planView = b.dataset.v; render();
    },
    month: function (b) { S.month = C.addMonths(curMonth() + '-01', +b.dataset.d).slice(0, 7); render(); },
    'month-today': function () { S.month = today().slice(0, 7); render(); },
    'goto-week': function (b) { S.week = b.dataset.w; S.planView = 'week'; render(); },
    notif: async function () {
      S.notifOpen = !S.notifOpen; await refreshNotifs(); render();
      if (S.notifOpen && S.notifs.some(function (n) { return !n.read_at; })) setTimeout(async function () { await Store.markAllRead(); await refreshNotifs(); }, 1500);
    },
    account: openAccount,
    logout: function () { logout(); },
    reload: function () { boot(); },
    'demo-reset': function () { Store.resetDemo(); S.me = null; S.view = 'planning'; S.svc = null; S.week = null; S.authMode = 'login'; authView({ ok: 'Démo remise à zéro.' }); },
    cell: function (b, e) {
      if (e.target.closest && e.target.closest('[data-act="edit"]') && !S.armed) return;
      if (S.armed) {
        var sh = Object.assign({}, S.armed, { employee_id: b.dataset.emp, day: b.dataset.day, service_id: S.svc });
        placeShift(sh, { add: e.shiftKey }); return;
      }
      var tpl = svcTemplates(S.svc)[1] || svcTemplates(S.svc)[0];
      openEditor({ employee_id: b.dataset.emp, service_id: S.svc, day: b.dataset.day, kind: 'work', template_id: tpl ? tpl.id : null, start_time: tpl ? tpl.start_time.slice(0, 5) : '', end_time: tpl ? tpl.end_time.slice(0, 5) : '', label: tpl ? tpl.name : null, color: tpl ? tpl.color : null, break_min: null });
    },
    arm: function (b) {
      var sh = dragShift('tpl', b), same = S.armed && S.armedKey === b.dataset.tpl;
      S.armed = same ? null : sh; S.armedKey = same ? null : b.dataset.tpl;
      document.querySelectorAll('.pal.armed').forEach(function (x) { x.classList.remove('armed'); });
      if (S.armed) { b.classList.add('armed'); toast('« ' + (sh.label || '') + ' » sélectionné : touchez une case pour le poser (touchez à nouveau le modèle pour annuler).'); }
    },
    edit: function (b, e) { if (S.armed) { var c = b.closest('td.cell'); if (c) return A.cell(c, e); } e.stopPropagation(); var sh = (S.cache.weekShifts || []).find(function (s) { return s.id === b.dataset.id; }); if (sh) openEditor(sh); },
    publish: async function () { try { await attempt(function () { return Store.publishMonth(S.svc, curMonth() + '-01'); }, 'Mois publié, l\'équipe est prévenue'); render(); } catch (e) {} },
    unpublish: async function () { try { await attempt(function () { return Store.unpublishMonth(S.svc, curMonth() + '-01'); }, 'Publication du mois retirée'); render(); } catch (e) {} },
    'goto-month': function (b) { S.month = b.dataset.m; render(); },
    export: openExport,
    'rest-month': async function () {
      var svc = S.svc, m = curMonth() + '-01', first = m > today() ? m : today(), last = C.addDays(C.addMonths(m, 1), -1), n = 0;
      if (first > last) { toast('Ce mois est déjà passé.', true); return; }
      var team = teamOf(svc).filter(function (p) { return (p.weekly_rest || []).length && p.role !== 'admin'; });
      for (var i = 0; i < team.length; i++) n += await placeRest(team[i].id, first, last);
      toast(n ? n + ' jours de repos posés' : 'Les repos habituels sont déjà posés'); render();
    },
    'copy-month': async function (b) {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmer la recopie'; return; }
      var days = monthDays(curMonth()), first = days[0], last = days[days.length - 1], team = teamOf(S.svc).map(function (p) { return p.id; });
      var src = await Store.shifts(C.addDays(first, -35), C.addDays(first, -1), { serviceId: S.svc });
      var cur = await Store.shifts(first, last, { serviceId: S.svc });
      var ok = 0, ko = 0;
      for (var i = 0; i < days.length; i++) {
        var d = days[i], from = C.addDays(d, -28) < first ? C.addDays(d, -28) : C.addDays(d, -35);
        var list = src.filter(function (s) { return s.day === from && !s.request_id && (s.kind === 'work' || s.kind === 'repos') && team.indexOf(s.employee_id) >= 0; });
        for (var k = 0; k < list.length; k++) {
          var s0 = list[k];
          if (cur.some(function (c) { return c.employee_id === s0.employee_id && c.day === d; })) continue;
          try { await Store.saveShift({ employee_id: s0.employee_id, service_id: s0.service_id, day: d, kind: s0.kind, template_id: s0.template_id || null, start_time: s0.start_time, end_time: s0.end_time, break_min: s0.break_min, label: s0.label, color: s0.color || null, note: null }); ok++; }
          catch (e) { ko++; }
        }
      }
      toast(ok + ' shifts recopiés sur les jours vides' + (ko ? ', ' + ko + ' ignorés (repos minimum non respecté)' : ''), !!ko); render();
    },
    approve: async function (b) { try { await attempt(function () { return Store.decide(b.dataset.id, true); }, 'Demande validée'); render(); } catch (e) {} },
    refuse: function (b) { openRefuse(b.dataset.id); },
    cancel: async function (b) {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmer l\'annulation'; return; }
      try { await attempt(function () { return Store.cancel(b.dataset.id); }, 'Demande annulée'); render(); } catch (e) {}
    },
    'ot-open': function (b) { var o = S.otOpen || {}; S.otOpen = (o.emp === b.dataset.emp && o.m === +b.dataset.m) ? null : { emp: b.dataset.emp, m: +b.dataset.m }; render(); },
    'ot-year': function (b) { S.otYear = (S.otYear || +S.week.slice(0, 4)) + +b.dataset.d; S.otOpen = null; render(); },
    'ot-del': async function (b) {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmer'; return; }
      try { await attempt(function () { return Store.deleteOvertime(b.dataset.id); }, 'Heures supprimées'); render(); } catch (e) {}
    },
    'edit-profile': function (b) { openProfile(b.dataset.id); },
    'add-staff': openAddStaff,
    owed: function (b) { openOwed(b.dataset.id); },
    'pr-export': function (b) { exportPresence(b.dataset.scope, b.dataset.fmt); },
    'pt-year': function (b) { S.ptYear = (S.ptYear || +today().slice(0, 4)) + +b.dataset.d; render(); },
    'pt-export': function () { exportPointage(); },
    'credit-ferie': openCreditFerie,
    accrue: async function (b) {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmer : créditer les congés de cette période'; return; }
      try { var n = await attempt(function () { return Store.accrueCp(b.dataset.m); }); toast('Congés crédités à ' + n + ' salariés'); S.profiles = await Store.profiles(); render(); } catch (e) {}
    },
    'tpl-save': async function (b) {
      var key = b.dataset.id || 'new', v = function (k) { return document.getElementById('tp-' + k + '-' + key); };
      var t = { id: b.dataset.id ? +b.dataset.id || b.dataset.id : undefined, name: v('name').value.trim(), start_time: v('start').value, end_time: v('end').value, color: v('color').value,
        service_id: v('svc').value ? +v('svc').value : null, sort: +v('sort').value || 0, active: v('active').checked, rooms: v('rooms').value === '' ? null : Math.max(0, Math.round(+v('rooms').value)),
        label: v('label').value.trim() || null, bg: v('own').checked ? v('bg').value : null, fg: v('own').checked ? v('fg').value : null };
      if (!t.name || !t.start_time || !t.end_time) { toast('Indiquez un nom, une heure de début et une heure de fin.', true); return; }
      try { await attempt(function () { return Store.saveTemplate(t); }, b.dataset.id ? 'Shift mis à jour : le nouvel horaire s\'applique à tous les plannings à partir d\'aujourd\'hui' : 'Shift ajouté'); S.templates = await Store.templates(); S.cfgSig = null; render(); } catch (e) {}
    },
    'tpl-del': async function (b) {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmer'; return; }
      try { await attempt(function () { return Store.deleteTemplate(+b.dataset.id || b.dataset.id); }, 'Modèle supprimé'); S.templates = await Store.templates(); render(); } catch (e) {}
    },
    'svc-save': async function (b) {
      var key = b.dataset.id || 'new', g = function (k) { return document.getElementById('sv-' + k + '-' + key); };
      var sv = { id: b.dataset.id ? +b.dataset.id : undefined, name: g('name').value.trim(), locations: g('loc').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean), sort: +g('sort').value || 0, archived: g('arch') ? g('arch').checked : false };
      if (!sv.name) { toast('Indiquez le nom du service.', true); return; }
      try { await attempt(function () { return Store.saveService(sv); }, sv.id ? 'Service mis à jour' : 'Service ajouté'); S.services = await Store.services(); render(); } catch (e) {}
    },
    'svc-staffing': function (b) { openStaffing(+b.dataset.id); },
    'tpl-tab': function (b) { S.tplSvc = b.dataset.v; render(); },
    'svc-del': async function (b) {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmer'; return; }
      try { await attempt(function () { return Store.deleteService(+b.dataset.id); }, 'Service supprimé'); S.services = await Store.services(); render(); } catch (e) {}
    },
    'sen-recalc': async function () {
      try { var n = await attempt(function () { return Store.accrueSeniority(today()); }); toast(n ? n + ' palier(s) d\'ancienneté crédité(s)' : 'Aucun nouveau palier à créditer'); S.profiles = await Store.profiles(); render(); } catch (e) {}
    },
    'st-default': async function (b) {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmer les valeurs par défaut'; return; }
      var patch = ST_DEFAULTS[b.dataset.card]; if (!patch) return;
      if (b.dataset.card === 'hotel') patch = { pointage_title: coName().toUpperCase() };
      try { S.settings = await attempt(function () { return Store.saveSettings(JSON.parse(JSON.stringify(patch))); }, 'Valeurs par défaut rétablies'); applyDayTypes(); C.setRules(S.settings); render(); } catch (e) {}
    }
  };
  function delegate(e) {
    var b = e.target.closest('[data-act]');
    if (!b) { if (e.currentTarget === app && S.notifOpen && !e.target.closest('.notif-wrap')) { S.notifOpen = false; render(); } return; }
    var fn = A[b.dataset.act]; if (fn) fn(b, e);
  }
  app.addEventListener('click', delegate);
  dlg.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) { dlg.close(); return; }
    if (e.target === dlg) { dlg.close(); return; }
    if (e.target.closest('[data-act]')) delegate(e);
  });
  dlg.addEventListener('close', function () { dlg.onclick = null; delete dlg.dataset.emp; dlg.classList.remove('wide-dlg'); });
  /* Collage depuis Excel dans les lignes « chambres à faire » / « PDJ prévisionnels » :
     une ligne copiée remplit les jours suivants ; plusieurs lignes remplissent aussi les lignes du dessous */
  function parseNum(t) {
    t = String(t).replace(/[\u00a0\u202f\s]/g, '').replace(',', '.');
    if (t === '' || t === '-') return null;
    var n = Math.round(+t); return isNaN(n) || n < 0 ? undefined : n;
  }
  app.addEventListener('paste', async function (e) {
    var el = e.target; if (!el.matches || !el.matches('input[data-change="staff"]')) return;
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text || !/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;   // une seule valeur : collage normal
    e.preventDefault();
    var rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(function (r) { return r.split('\t'); });
    var keys = [].slice.call(document.querySelectorAll('tr.staffrow input[data-change="staff"]')).reduce(function (a, i) { if (a.indexOf(i.dataset.key) < 0) a.push(i.dataset.key); return a; }, []);
    var days = [].slice.call(document.querySelectorAll('input[data-change="staff"][data-key="' + el.dataset.key + '"]')).map(function (i) { return i.dataset.day; });
    var k0 = keys.indexOf(el.dataset.key), d0 = days.indexOf(el.dataset.day), list = [], bad = 0, cut = 0;
    rows.forEach(function (r, ri) {
      var key = keys[k0 + ri]; if (!key) { cut++; return; }
      r.forEach(function (cell, ci) {
        var day = days[d0 + ci]; if (!day) { cut++; return; }
        var v = parseNum(cell); if (v === undefined) { bad++; return; }
        list.push({ day: day, key: key, value: v });
      });
    });
    if (!list.length) { toast('Rien à coller : les cellules copiées ne contiennent pas de nombres.', true); return; }
    try {
      await Store.saveStaffingValues(S.svc, list);
      S.cache.staffVals = S.cache.staffVals || {};
      list.forEach(function (x) {
        var o = S.cache.staffVals[x.day] = S.cache.staffVals[x.day] || {};
        if (x.value == null) delete o[x.key]; else o[x.key] = x.value;
        var inp = document.querySelector('input[data-change="staff"][data-key="' + x.key + '"][data-day="' + x.day + '"]'); if (inp) inp.value = x.value == null ? '' : x.value;
      });
      list.map(function (x) { return x.day; }).concat(list.map(function (x) { return C.addDays(x.day, 1); })).filter(function (d, i, a) { return a.indexOf(d) === i; }).forEach(refreshStaffDay);
      toast(list.length + ' valeur' + (list.length > 1 ? 's' : '') + ' collée' + (list.length > 1 ? 's' : '') + (cut ? ' · ' + cut + ' cellule(s) hors du mois ignorée(s)' : '') + (bad ? ' · ' + bad + ' cellule(s) non numérique(s) ignorée(s)' : ''), !!bad);
    } catch (err) { toast(err.message, true); }
  });
  app.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.menuOpen) { S.menuOpen = false; render(); var mb = document.querySelector('.menu-btn'); if (mb) mb.focus(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('td.cell')) { e.preventDefault(); A.cell(e.target, e); }
  });
  app.addEventListener('change', function (e) {
    var a = e.target.dataset.change;
    if (a === 'co-switch') { switchCompany(+e.target.value, S.view); return; }
    if (a === 'view-as') { if (e.target.value) enterPreview(e.target.value); else exitPreview(); return; }
    if (a === 'svc') { S.svc = +e.target.value; S.prEmp = null; S.armed = null; S.armedKey = null; render(); }
    if (a === 'tpl-svc') { S.tplSvc = e.target.value; render(); }
    if (a === 'livr') {
      var cb = e.target, dl = cb.dataset.day;
      Store.saveStaffingValue(S.svc, dl, '_livr', cb.checked ? 1 : null).then(function () {
        S.cache.staffVals = S.cache.staffVals || {}; var o2 = S.cache.staffVals[dl] = S.cache.staffVals[dl] || {};
        if (cb.checked) o2._livr = 1; else delete o2._livr;
        refreshStaffDay(C.addDays(dl, 2));
      }).catch(function (err) { cb.checked = !cb.checked; toast(err.message, true); });
    }
    if (a === 'staff') {
      var el = e.target, day = el.dataset.day, key = el.dataset.key, val = el.value === '' ? null : Math.max(0, Math.round(+el.value));
      Store.saveStaffingValue(S.svc, day, key, val).then(function () {
        S.cache.staffVals = S.cache.staffVals || {}; var o = S.cache.staffVals[day] = S.cache.staffVals[day] || {};
        if (val == null) delete o[key]; else o[key] = val;
        refreshStaffDay(day); refreshStaffDay(C.addDays(day, 1));
      }).catch(function (err) { toast(err.message, true); });
    }
    if (a === 'pr') { S.prEmp = document.getElementById('pr-emp').value; S.prFrom = document.getElementById('pr-from').value; S.prTo = document.getElementById('pr-to').value; if (S.prTo < S.prFrom) S.prTo = S.prFrom; render(); }
    if (a === 'rq-preview') {
      var s = document.getElementById('rq-start'), en = document.getElementById('rq-end');
      if (e.target === s && en.value < s.value) en.value = s.value;
      en.min = s.value;
      document.getElementById('rq-preview').textContent = previewText(document.getElementById('rq-type').value, s.value, en.value);
    }
  });
  app.addEventListener('submit', async function (e) {
    var kind = e.target.dataset.submit, f = e.target;
    if (!kind) return;
    e.preventDefault();
    if (kind === 'request-for') {
      var andValidate = e.submitter && e.submitter.dataset.and === 'validate';
      var r2 = { employee_id: f.querySelector('#rf-emp').value, type: f.querySelector('#rf-type').value, start_date: f.querySelector('#rf-start').value, end_date: f.querySelector('#rf-end').value, comment: f.querySelector('#rf-comment').value.trim() };
      if (!r2.start_date || !r2.end_date || r2.end_date < r2.start_date) { toast('Choisissez une période valide.', true); return; }
      try {
        var row = await attempt(function () { return Store.createRequest(r2); });
        if (andValidate) {
          var done = await attempt(function () { return Store.decide(row.id, true); });
          toast(done.status === 'pending_admin' ? 'Demande saisie et validée : en attente de la validation finale de la direction' : 'Demande saisie et validée : posée dans le planning');
        } else toast('Demande saisie pour ' + name(r2.employee_id) + ' (à valider)');
        S.profiles = await Store.profiles(); render();
      } catch (err) {}
    }
    if (kind === 'settings') {
      var p = {}, bad = false;
      f.querySelectorAll('[data-k]').forEach(function (el) {
        var k = el.dataset.k;
        if (el.type === 'checkbox') p[k] = el.checked;
        else if (el.type === 'number' || el.tagName === 'SELECT' && k === 'cp_credit_month') { var x = +el.value; if (el.value === '' || isNaN(x) || x < 0) bad = true; p[k] = x; }
        else p[k] = el.value.trim();
      });
      if ('break_threshold_h' in p) { p.break_threshold_min = Math.round(p.break_threshold_h * 60); delete p.break_threshold_h; }
      if (f.querySelector('#st-otday-h')) p.ot_day_minutes = readDur(f, 'st-otday');
      var arrs = {}; f.querySelectorAll('[data-arr]').forEach(function (el) { arrs[el.dataset.arr] = arrs[el.dataset.arr] || []; if (el.checked) arrs[el.dataset.arr].push(el.value); });
      Object.assign(p, arrs);
      if (f.querySelector('[data-right]')) {
        var R = JSON.parse(JSON.stringify(S.settings.rights || {}));
        f.querySelectorAll('[data-right]').forEach(function (el) { var k = el.dataset.right.split('.'); R[k[0]] = R[k[0]] || {}; R[k[0]][k[1]] = el.checked; });
        p.rights = R;
      }
      if (f.querySelector('[data-notify]')) { var N = Object.assign({}, S.settings.notify || {}); f.querySelectorAll('[data-notify]').forEach(function (el) { N[el.dataset.notify] = el.checked; }); p.notify = N; }
      if (f.querySelector('[data-dt]')) {
        var D = {};
        f.querySelectorAll('[data-dt]').forEach(function (el) {
          var k = el.dataset.dt.split('.'), def = DAYKINDS0.find(function (x) { return x[0] === k[0]; }), v = el.value.trim();
          if (k[1] === 'bg' && v.toLowerCase() === PDFC[k[0]][0].toLowerCase()) return;
          if (k[1] === 'fg' && v.toLowerCase() === PDFC[k[0]][1].toLowerCase()) return;
          if (!v || (k[1] === 'label' && v === def[1]) || (k[1] === 'code' && v === def[2])) return;
          D[k[0]] = D[k[0]] || {}; D[k[0]][k[1]] = v;
        });
        Object.keys(D).forEach(function (k) { if (D[k].fg && !D[k].bg) D[k].bg = PDFC[k][0]; if (D[k].bg && !D[k].fg) D[k].fg = PDFC[k][1]; });
        p.day_types = D;
      }
      if (f.querySelector('[data-ct]')) {
        var list = contractTypes().map(function (c, i) { var el = f.querySelector('[data-ct="' + i + '"]'); return [c[0], (el && el.value.trim()) || c[1]]; });
        var nw = f.querySelector('#ct-new').value.trim();
        if (nw) list.push([nw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'statut' + list.length, nw]);
        p.contract_types = list;
      }
      if (bad) { toast('Vérifiez les valeurs saisies.', true); return; }
      try { S.settings = await attempt(function () { return Store.saveSettings(p); }, 'Paramètres enregistrés'); applyDayTypes(); C.setRules(S.settings); render(); } catch (err) {}
    }
  });

  /* ---------- Démarrage ---------- */
  async function boot() {
    if (!Store) { app.innerHTML = '<div class="auth"><div class="card"><h1>HPG</h1><p>Connexion au serveur impossible. Vérifiez votre connexion internet puis rechargez la page.</p></div></div>'; return; }
    try {
      S.me = await Store.init();
      if (location.hash.indexOf('type=recovery') >= 0 && S.me) { S.authMode = 'recovery'; return authView(); }
      if (!S.me) return authView();
      if (S.me.must_change_pw) { S.authMode = 'firstpw'; return authView(); }
      var base = await Promise.all([Store.services(), Store.templates(), Store.profiles(), Store.settings(), Store.companies ? Store.companies().catch(function () { return []; }) : []]);
      S.services = base[0]; S.templates = base[1]; S.profiles = base[2]; S.settings = base[3] || {}; S.companies = base[4];
      applyDayTypes(); C.setRules(S.settings);
      if (!S.week) S.week = C.weekStart(today());
      var svcs = myServices();
      if (svcs.indexOf(S.svc) < 0) S.svc = S.me.service_id && svcs.indexOf(S.me.service_id) >= 0 ? S.me.service_id : svcs[0];
      await refreshNotifs();
      render();
    } catch (e) { app.innerHTML = '<div class="auth"><div class="card"><h1>HPG</h1><p class="err">' + esc(e.message) + '</p><button class="btn" onclick="location.reload()">Réessayer</button></div></div>'; }
  }
  /* Explications : plus de lignes de texte, un « i » encerclé qui affiche l'aide au survol (ou au toucher / au clavier) */
  var tipEl = document.createElement('div'); tipEl.id = 'tip'; tipEl.setAttribute('role', 'tooltip'); tipEl.hidden = true; document.body.appendChild(tipEl);
  function infoize(root) {
    if (!root || !root.querySelectorAll) return;
    var list = [].slice.call(root.querySelectorAll('.hint:not([id]), .scard-h .small.muted'));
    if (root.matches && root.matches('.hint:not([id])')) list.push(root);
    list.forEach(function (el) {
      if (!el.parentNode || el.querySelector('button, a, input, select, textarea')) return;
      var txt = el.textContent.replace(/\s+/g, ' ').trim(); if (!txt) return;
      var i = document.createElement('span');
      i.className = 'i-tip' + (el.tagName === 'P' || el.tagName === 'DIV' ? ' info-block' : '');
      i.tabIndex = 0; i.setAttribute('role', 'button'); i.setAttribute('aria-label', 'Aide : ' + txt); i.dataset.tip = txt; i.textContent = 'i';
      var h = el.previousElementSibling;
      if (h && /^H[1-4]$/.test(h.tagName)) { i.classList.remove('info-block'); h.appendChild(i); el.parentNode.removeChild(el); }   // à côté du titre
      else el.parentNode.replaceChild(i, el);
    });
  }
  function showTip(i) {
    tipEl.textContent = i.dataset.tip; tipEl.hidden = false;
    var r = i.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 24); tipEl.style.maxWidth = w + 'px';
    var tw = tipEl.offsetWidth, th = tipEl.offsetHeight, x = Math.max(12, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 12));
    var y = r.bottom + 8; if (y + th > window.innerHeight - 8) y = Math.max(8, r.top - th - 8);
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  function hideTip() { tipEl.hidden = true; }
  document.addEventListener('mouseover', function (e) { var i = e.target.closest && e.target.closest('.i-tip'); if (i) showTip(i); });
  document.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('.i-tip')) hideTip(); });
  document.addEventListener('focusin', function (e) { if (e.target.classList && e.target.classList.contains('i-tip')) showTip(e.target); });
  document.addEventListener('focusout', function (e) { if (e.target.classList && e.target.classList.contains('i-tip')) hideTip(); });
  document.addEventListener('click', function (e) { var i = e.target.closest && e.target.closest('.i-tip'); if (i) { e.preventDefault(); if (tipEl.hidden) showTip(i); else hideTip(); } else hideTip(); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
  window.addEventListener('scroll', hideTip, true);
  new MutationObserver(function (muts) { muts.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) infoize(n); }); }); }).observe(document.body, { childList: true, subtree: true });
  infoize(document.body);

  /* Paramètres, shifts et services relus régulièrement : une modification faite par l'administrateur
     s'applique chez tous les utilisateurs sans recharger la page (planning, légendes, PDF, Excel). */
  async function refreshConfig(silent) {
    if (!S.me || S.me.role === 'pending' || drag) return;
    try {
      var r = await Promise.all([Store.settings(), Store.templates(), Store.services(), Store.companies ? Store.companies().catch(function () { return S.companies || []; }) : []]);
      var sig = JSON.stringify(r);
      if (S.cfgSig && sig !== S.cfgSig) {
        S.settings = r[0] || {}; S.templates = r[1]; S.services = r[2]; S.companies = r[3]; applyDayTypes(); C.setRules(S.settings);
        if (!silent && !dlg.open && !(document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) render();
      }
      S.cfgSig = sig;
    } catch (e) {}
  }
  /* Mise à jour automatique : quand une nouvelle version est déployée à la même adresse, chaque utilisateur la reçoit
     (vérification toutes les 30 s et au retour sur l'onglet) ; rechargement immédiat si rien n'est en cours de saisie, sinon bandeau « Actualiser ». */
  var APP_VERSION = '50';
  async function checkVersion() {
    if (!/^https?:$/.test(location.protocol) || /claude\.ai|claudeusercontent/.test(location.hostname)) return;
    try {
      var r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return;
      var v = String((await r.json()).v || ''); if (!v || v === APP_VERSION) return;
      var busy = !S.me ? [].some.call(document.querySelectorAll('#auth input'), function (x) { return x.value && x.id !== 'au-email'; })
        : dlg.open || drag || (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)), tried = '';
      try { tried = sessionStorage.getItem('hpg-reload') || ''; } catch (e) {}
      if (!busy && tried !== v) {
        try { sessionStorage.setItem('hpg-reload', v); } catch (e) {}
        try { var reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) {}
        setTimeout(function () { location.reload(); }, 800); return;
      }
      if (!document.getElementById('upd-bar')) { var b = document.createElement('button'); b.id = 'upd-bar'; b.type = 'button'; b.textContent = 'Nouvelle version de HPG disponible · Actualiser'; b.onclick = async function () { try { var reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) {} location.reload(); }; document.body.appendChild(b); }
    } catch (e) {}
  }
  setInterval(function () { if (!document.hidden) checkVersion(); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkVersion(); });
  checkVersion();
  setInterval(function () { if (!document.hidden) refreshConfig(); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshConfig(); });
  if (Store) Store.onAuthChange(function () { if (Store.mode === 'live' && !S.me) boot(); });
  setInterval(async function () { if (S.me && !document.hidden && S.me.role !== 'pending' && !drag) { var before = S.notifs.filter(function (n) { return !n.read_at; }).length; await refreshNotifs(); if (S.notifs.filter(function (n) { return !n.read_at; }).length !== before && !dlg.open) render(); } }, 60000);
  if ('serviceWorker' in navigator && Store && Store.mode === 'live') { navigator.serviceWorker.register('sw.js').catch(function () {}); }
  boot();
})();
