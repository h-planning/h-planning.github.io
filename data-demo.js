/* HPG — mode démonstration : données fictives stockées dans ce navigateur.
   Reproduit les règles de la base réelle (droits par rôle, multi-services, repos minimum, compteurs reliés
   au planning, circuit de validation) pour présenter l'application sans serveur.
   Chaque opération est atomique : si une règle refuse, rien n'est modifié. */
(function () {
  'use strict';
  if (window.Store || (window.RELEVE_CONFIG || {}).SUPABASE_URL) return; // Supabase configuré : pas de démo
  var C = window.Calc, KEY = 'hpg-demo-v27', db, me;

  function uid() { return 'id' + Math.random().toString(36).slice(2, 10); }
  function hm5(t) { return String(t || '').slice(0, 5); }
  function today() { var d = new Date(); return C.iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))); }
  function nowIso() { return new Date().toISOString(); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
  function fail(m) { throw new Error(m); }
  var LABELS = { work: 'Travail', repos: 'Repos', formation: 'Formation', cp: 'Congés payés', ferie: 'Jour férié', recup: 'Jour récupéré', rendre: 'Jour à rendre',
    anciennete: "Jour d'ancienneté", ot_day: 'Récup heures supp', maladie: 'Arrêt maladie', at: 'Accident du travail', css: 'Congé sans solde', absence: 'Absence' };
  function label(t) { return LABELS[t] || t; }
  function isOuvr(d) { return C.dow(d) !== 0 && !C.holidayName(d); }
  function dm(s) { return s.slice(8, 10) + '/' + s.slice(5, 7); }
  function dmy(s) { return s.split('-').reverse().join('/'); }
  function hm(t) { return String(t).slice(0, 5).replace(':', 'h'); }
  function n1(x) { return +(+x).toFixed(1); }
  function profile(id) { return db.profiles.find(function (p) { return p.id === id; }); }
  function role() { return me && me.active ? me.role : null; }
  function isAdm() { return role() === 'admin' || role() === 'developer'; }
  /* entreprises : chacun ne voit que la sienne (le développeur : celle qu'il a ouverte) */
  function myCo() { return me ? me.company_id : null; }
  function svcCo(svc) { var x = db.services.find(function (v) { return v.id === svc; }); return x ? x.company_id : null; }
  function inCo(svc) { return myCo() != null && svcCo(svc) === myCo(); }
  function ST(cid) { return db.settingsBy[cid || myCo() || 1]; }
  function svcsOf(p) { return (p && p.services) || []; }
  function inMine(svc) { return svcsOf(me).indexOf(svc) >= 0; }
  function tempCode() {   // code provisoire XXXX-XXXX (sans 0/O, 1/I/L)
    var A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', c = '';
    for (var i = 0; i < 8; i++) c += A[Math.floor(Math.random() * A.length)];
    return c.slice(0, 4) + '-' + c.slice(4);
  }
  function adminRight(r) { return role() === 'developer' || (role() === 'admin' && ((ST().rights || {}).admin || {})[r] !== false); }
  function can(r, svc) {
    if (!inCo(svc)) return false;
    if (role() === 'developer') return true;
    if (role() === 'admin') return adminRight(r);
    var ro = role(); if ((ro === 'manager' || ro === 'assistant') && inMine(svc)) return !!((ST().rights[ro] || {})[r]);
    return false;
  }
  function staffOf(svc) { return inCo(svc) && (isAdm() || ((role() === 'manager' || role() === 'assistant') && inMine(svc))); }
  function empRight(r) { return !!((ST().rights.employee || {})[r]); }
  function worksIn(empId, svc) { return svcsOf(profile(empId)).indexOf(svc) >= 0; }
  function anySvc(empId, test) { return svcsOf(profile(empId)).some(test); }
  function canSee(p) {
    if (!p) return false;
    if (p.id === me.id) return true;
    if (p.role === 'developer') return false;
    if (p.company_id !== myCo() && !(p.company_id == null && role() === 'developer')) return false;
    if (isAdm()) return true;
    if (role() === 'manager' || role() === 'assistant') return p.role === 'pending' || svcsOf(p).some(staffOf);
    if (role() === 'employee' && empRight('team_planning')) return svcsOf(p).some(inMine);
    return false;
  }
  function monthOf(day) { return day.slice(0, 7) + '-01'; }
  function isPublished(svc, day) { var m = monthOf(day); return db.published.some(function (p) { return p.service_id === svc && p.month === m; }); }
  function notifyOn(k) { return (ST().notify || {})[k] !== false; }
  function notify(userId, title, body) {
    var p = profile(userId); if (!p || !p.has_account || !p.active) return;
    db.notifications.unshift({ id: uid(), user_id: userId, title: title, body: body, read_at: null, created_at: nowIso() });
  }
  function audit(table, row, action, old) { db.audit.push({ id: db.audit.length + 1, company_id: myCo(), table_name: table, row_id: row && row.id, action: action, old_data: old ? clone(old) : null, new_data: row ? clone(row) : null, actor: me ? me.id : null, at: nowIso() }); if (db.audit.length > 800) db.audit.splice(0, db.audit.length - 800); }
  function restError(sh) {
    var others = db.shifts.filter(function (s) { return s.employee_id === sh.employee_id && s.id !== sh.id; });
    var r = C.restCheck(sh, others, ST(svcCo(sh.service_id)).min_rest_hours);
    if (!r) return null;
    var o = r.other;
    if (r.type === 'overlap') return 'Ce shift chevauche l\'horaire du ' + dm(o.day) + ' (' + hm(o.start_time) + ' – ' + hm(o.end_time) + ').';
    return 'Repos de ' + ST(svcCo(sh.service_id)).min_rest_hours + ' h non respecté : seulement ' + C.fmt(r.gap) + ' entre ce shift et celui du ' + dm(o.day) + ' (' + hm(o.start_time) + ' – ' + hm(o.end_time) + ').';
  }

  /* ---------------- Données de départ ---------------- */
  var DEFAULT_RIGHTS = {
    manager: { planning: true, publish: true, copy_week: true, requests: true, owed: true, presence: true, overtime: true, team: true },
    assistant: { planning: true, publish: false, copy_week: true, requests: false, owed: false, presence: false, overtime: false, team: false },
    employee: { team_planning: false, balances: true }
  };
  function seed() {
    var T = [
      { id: 1, service_id: 1, name: 'Matin ouverture', start_time: '06:45', end_time: '15:03', color: 'open', sort: 1, active: true },
      { id: 2, service_id: 1, name: 'Matin', start_time: '07:30', end_time: '15:48', color: 'am', sort: 2, active: true },
      { id: 3, service_id: 1, name: 'Middle', start_time: '09:18', end_time: '17:18', color: 'mid', sort: 3, active: true },
      { id: 4, service_id: 1, name: 'Middle 12h', start_time: '12:00', end_time: '20:18', color: 'mid', sort: 4, active: true },
      { id: 5, service_id: 1, name: 'Middle 13h', start_time: '13:00', end_time: '21:18', color: 'mid', sort: 5, active: true },
      { id: 6, service_id: 1, name: 'Réservation', start_time: '09:00', end_time: '17:18', color: 'sky', sort: 6, active: true },
      { id: 7, service_id: 1, name: 'Soir', start_time: '14:45', end_time: '23:03', color: 'pm', sort: 7, active: true },
      { id: 8, service_id: 1, name: 'Nuit', start_time: '23:00', end_time: '07:00', color: 'night', sort: 8, active: true },
      { id: 9, service_id: 5, name: 'Journée 12 chambres', start_time: '08:30', end_time: '16:45', color: 'am', sort: 1, active: true, rooms: 12 },
      { id: 10, service_id: 5, name: 'Soir 8 chambres', start_time: '12:00', end_time: '20:18', color: 'pm', sort: 2, active: true, rooms: 8 },
      { id: 11, service_id: 5, name: 'Exceptionnel 5 chambres', start_time: '08:30', end_time: '16:45', color: 'sky', sort: 3, active: true, rooms: 5 },
      { id: 12, service_id: 6, name: '6h30', start_time: '06:30', end_time: '14:48', color: 'sky', sort: 1, active: true, label: '6h30', bg: '#87CEEB', fg: '#000000' },
      { id: 13, service_id: 6, name: '7h30', start_time: '07:30', end_time: '15:48', color: 'sky', sort: 2, active: true, label: '7h30', bg: '#4A90E2', fg: '#3A3A3A' },
      { id: 14, service_id: 6, name: '8h00', start_time: '08:00', end_time: '16:18', color: 'night', sort: 3, active: true, label: '8h00', bg: '#1F3864', fg: '#FFFFFF' },
      { id: 15, service_id: 2, name: 'Service', start_time: '06:30', end_time: '14:48', color: 'am', sort: 1, active: true, label: '6h30', bg: '#C6EFCE', fg: '#3A3A3A' },
      { id: 16, service_id: 2, name: 'Buffet', start_time: '06:00', end_time: '14:18', color: 'am', sort: 2, active: true, label: '6h', bg: '#4CAF50', fg: '#000000' },
      { id: 17, service_id: 2, name: 'Cuisine', start_time: '06:30', end_time: '14:48', color: 'am', sort: 3, active: true, label: '6h30', bg: '#1E6B30', fg: '#FFFFFF' },
      { id: 18, service_id: 2, name: 'Plonge', start_time: '07:30', end_time: '15:48', color: 'am', sort: 4, active: true, label: '7h30', bg: '#39FF14', fg: '#000000' },
      { id: 19, service_id: 2, name: 'Room service soir', start_time: '14:45', end_time: '23:03', color: 'pm', sort: 5, active: true, label: 'S', bg: '#FF9F0A', fg: '#000000' },
      { id: 20, service_id: 4, name: 'Livraison', start_time: '06:00', end_time: '14:18', color: 'open', sort: 1, active: true, label: 'LIV', bg: '#A0703C', fg: '#000000' },
      { id: 21, service_id: 4, name: 'Grande calandre', start_time: '07:45', end_time: '16:03', color: 'am', sort: 2, active: true, label: 'GC', bg: '#FFF2A8', fg: '#000000' },
      { id: 22, service_id: 4, name: 'Pliage', start_time: '07:45', end_time: '16:03', color: 'am', sort: 3, active: true, label: 'PL', bg: '#FFC9B0', fg: '#000000' },
      { id: 23, service_id: 4, name: 'Service du soir', start_time: '14:00', end_time: '22:18', color: 'pm', sort: 4, active: true, label: 'S', bg: '#FFFFFF', fg: '#000000' },
      { id: 24, service_id: 7, name: 'Matin 6h45', start_time: '06:45', end_time: '15:03', color: 'open', sort: 1, active: true, label: 'M', bg: '#FFFFFF', fg: '#E00000' },
      { id: 25, service_id: 7, name: 'Matin 7h30', start_time: '07:30', end_time: '15:48', color: 'am', sort: 2, active: true, label: 'M', bg: '#FFFFFF', fg: '#000000' },
      { id: 26, service_id: 7, name: 'Soir', start_time: '14:45', end_time: '23:03', color: 'pm', sort: 3, active: true, label: 'S', bg: '#FFFFFF', fg: '#000000' },
      { id: 27, service_id: 7, name: '9h', start_time: '09:00', end_time: '17:18', color: 'mid', sort: 4, active: true, label: '9', bg: '#FFFFFF', fg: '#E00000' },
      { id: 28, service_id: 7, name: '10h', start_time: '10:00', end_time: '18:18', color: 'mid', sort: 5, active: true, label: '10', bg: '#FFFFFF', fg: '#E00000' },
      { id: 29, service_id: 7, name: '12h', start_time: '12:00', end_time: '20:18', color: 'mid', sort: 6, active: true, label: '12', bg: '#FFFFFF', fg: '#E00000' },
      { id: 30, service_id: 7, name: '13h', start_time: '13:00', end_time: '21:18', color: 'mid', sort: 7, active: true, label: '13', bg: '#FFFFFF', fg: '#E00000' }
    ];
    // id, nom, rôle, services, localisation, poste, contrat, date d'entrée, compte, solde CP, repos habituels
    var people = [
      ['dev', 'Paul R.', 'developer', [], null, null, 'cdi', null, true, 0, []],
      ['adm', 'DUBOIS Claire', 'admin', [], null, 'Directrice', 'cdi', '2009-03-02', true, 25, []],
      ['m1', 'MARTIN Hugo', 'manager', [1], 'BACKOFFICE', 'Chef de réception', 'cdi', '2014-06-01', true, 21, [6, 7]],
      ['a1', 'MOREL Lina', 'assistant', [1], 'BACKOFFICE', '1re de réception', 'cdi', '2019-01-07', true, 16, [7, 1]],
      ['e1', 'MOREAU Léa', 'employee', [1], 'RECEP JOUR', 'Réceptionniste', 'cdi', '2021-04-12', true, 18, [3, 4]],
      ['e2', 'HADDAD Yanis', 'employee', [1], 'RECEP JOUR', 'Réceptionniste', 'cdi', '2023-10-02', true, 12.5, [5, 6]],
      ['e3', 'GARNIER Inès', 'employee', [1], 'RECEP JOUR', 'Réceptionniste', 'cdd', '2025-09-15', true, 9, [1, 2]],
      ['e11', 'ROUX Emma', 'employee', [1], 'RECEP JOUR', 'Stagiaire réception', 'stagiaire', '2026-09-01', true, 0, [6, 7]],
      ['n1', 'LEFÈVRE Tom', 'employee', [1], 'RECEP NUIT', 'Réceptionniste de nuit', 'cdi', '2016-05-23', true, 14, [6, 7]],
      ['n2', 'BENALI Omar', 'employee', [1], 'RECEP NUIT', 'Réceptionniste de nuit', 'cdi', '2020-02-03', true, 11, [2, 3]],
      ['x1', 'RICCI Paolo', 'employee', [1], 'EXTRA', 'Réceptionniste', 'extra', '2025-01-01', false, 0, []],
      ['m2', 'BENALI Sofia', 'manager', [2, 4], null, 'Responsable PDJ et lingerie', 'cdi', '2019-09-16', true, 14, [6, 7]],
      ['e5', 'DIALLO Amina', 'employee', [2], null, 'Employée PDJ', 'cdi', '2024-01-08', true, 15, [1, 2]],
      ['e6', 'PETIT Lucas', 'employee', [2, 1], null, 'Employé PDJ', 'cdi', '2019-11-04', true, 20, [3, 4]],
      ['m3', 'LEROY Marc', 'manager', [3], null, 'Chef technique', 'cdi', '2016-01-04', true, 9, [6, 7]],
      ['e7', 'SAÏDI Karim', 'employee', [3], null, 'Technicien', 'cdi', '2021-07-01', true, 11, [6, 7]],
      ['e8', 'BLANC Julie', 'employee', [3], null, 'Technicienne', 'cdi', '2026-02-02', true, 6, [7, 1]],
      ['e9', 'PEREIRA Rosa', 'employee', [4], null, 'Lingère', 'cdi', '2011-05-15', true, 24, [6, 7]],
      ['e10', 'NGUYEN Marie', 'employee', [4], null, 'Lingère', 'alternant', '2025-12-01', true, 7, [6, 7]],
      ['e14', 'DUBOIS Nina', 'employee', [4], null, 'Lingère', 'cdi', '2020-10-05', true, 12, [3, 7]],
      ['e15', 'MARCHAND Elsa', 'employee', [4], null, 'Lingère', 'cdi', '2023-03-13', true, 10, [1, 7]],
      ['e16', 'FAURE Théo', 'employee', [2], null, 'Employé PDJ', 'cdi', '2022-06-20', true, 11, [5, 6]],
      ['x2', 'LEMAIRE Sarah', 'employee', [4], null, 'Lingère', 'interim', '2026-06-01', false, 0, []],
      ['m5', 'COSTA Nadia', 'manager', [5], 'GOUVERNANTES', 'Gouvernante générale', 'cdi', '2018-03-12', true, 17, [6, 7]],
      ['e12', 'SY Fatou', 'employee', [5], 'FEMMES DE CHAMBRE', 'Femme de chambre', 'cdi', '2022-08-29', true, 13, [1, 2]],
      ['e17', 'TRAORÉ Awa', 'employee', [5], 'FEMMES DE CHAMBRE', 'Femme de chambre', 'cdi', '2021-05-03', true, 15, [3, 4]],
      ['e19', 'KONÉ Mariam', 'employee', [5], 'FEMMES DE CHAMBRE', 'Femme de chambre', 'cdd', '2026-04-01', true, 6, [6, 7]],
      ['e13', 'ROCHE Jean', 'employee', [5], 'ÉQUIPIERS', 'Valet de chambre', 'cdd', '2026-03-02', true, 5, [3, 4]],
      ['e22', 'LAMBERT Hugo', 'employee', [7], null, 'Chef concierge', 'cdi', '2012-04-02', true, 22, [6, 7]],
      ['e23', 'SAADI Karim', 'employee', [7], null, 'Concierge', 'cdi', '2017-09-18', true, 16, [1, 2]],
      ['e24', 'VERDIER Anne', 'employee', [7], null, 'Concierge', 'cdi', '2021-01-11', true, 12, [3, 4]],
      ['e25', 'COLIN Marc', 'employee', [7], null, 'Concierge', 'cdd', '2026-02-02', true, 6, [5, 6]],
      ['e26', 'MENDES Julia', 'employee', [7], null, 'Concierge de nuit', 'cdi', '2019-06-03', true, 18, [2, 3]],
      ['e20', 'BLANC Tom', 'employee', [6], null, 'Équipier', 'cdi', '2019-02-11', true, 18, [6, 7]],
      ['e21', 'DIALLO Issa', 'employee', [6], null, 'Équipier', 'cdd', '2026-06-01', true, 4, [1, 2]],
      ['e18', 'MARTINS Paulo', 'employee', [5], 'ÉQUIPIERS', 'Équipier', 'cdi', '2018-09-10', true, 19, [1, 7]],
      ['p1', 'Samuel Roche', 'pending', [], null, null, 'cdi', null, true, 0, []]
    ];
    function mail(n) { return n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').trim().split(' ').reverse().join('.') + '@exemple.fr'; }
    var d = {
      companies: [{ id: 1, name: 'Hôtel Rochester Champs-Élysées', legal_name: 'S. A. ELYSEES GESTION', city: 'Paris', country: 'France', active: true, created_at: nowIso() }],
      services: [{ id: 1, name: 'Réception', locations: ['BACKOFFICE', 'RECEP JOUR', 'RECEP NUIT', 'EXTRA'], sort: 1, archived: false },
        { id: 2, name: 'Cafétéria', locations: [], sort: 2, archived: false, staffing: { inputs: [{ key: 'pdj', label: 'PDJ prévisionnels' }], combine: 'max',
          tiers: [{ over: 90, n: 7 }, { over: 70, n: 6 }, { over: 50, n: 5 }, { over: 30, n: 4 }], base: 3, extra: { label: 'Demande extra StaffHôtel', rooms: 0, location: null } } },
        { id: 3, name: 'Technique', locations: [], sort: 3, archived: false },
        { id: 4, name: 'Lingerie', locations: [], sort: 4, archived: false, staffing: { inputs: [{ key: 'rochester', label: 'Hôtel Rochester' }, { key: 'demeure', label: 'La Demeure' }, { key: 'splendide', label: 'Le Splendide' }, { key: 'chateau', label: 'Le Château' }],
          combine: 'sum', tiers: [{ over: 320, n: 8 }, { over: 280, n: 7 }, { over: 210, n: 6 }, { over: 150, n: 5 }], base: 4, delivery: true, extra: { label: 'Demande extra StaffHôtel', rooms: 0, location: null } } }, { id: 5, name: 'Housekeeping', locations: ['GOUVERNANTES', 'FEMMES DE CHAMBRE', 'ÉQUIPIERS'], sort: 5, archived: false,
          staffing: { inputs: [{ key: 'vendues', label: 'Chambres vendues à faire' }, { key: 'recouche', label: 'Chambres en recouche' }, { key: 'depart', label: 'Chambres en départ' }, { key: 'bloquee', label: 'Chambres bloquées' }],
            combine: 'formula', total: { label: 'Total à faire', keys: ['recouche', 'depart'], prev: ['bloquee'] }, tiers: [], base: null, by_location: true, rooms_left: true, extra: { label: 'Demande extra StaffHôtel', rooms: 12, location: 'FEMMES DE CHAMBRE' } } },
        { id: 6, name: 'Équipier', locations: [], sort: 6, archived: false, staffing: { inputs: [], combine: 'max', tiers: [], base: null, extra: { label: 'Demande extra StaffHôtel', rooms: 0, location: null } } },
        { id: 7, name: 'Conciergerie', locations: [], sort: 7, archived: false, staffing: { inputs: [], combine: 'max', tiers: [], base: null, min_staff: 4 } }],
      templates: T,
      settingsBy: { 1: {
        id: 1, hotel_name: 'Hôtel Rochester Champs-Élysées', company_name: 'S. A.  ELYSEES GESTION', presence_hotel_label: 'HOTEL ROCHESTER C,ELYSEES',
        default_contract_hours: 39, break_threshold_min: 360, break_min: 30, min_rest_hours: 11, request_delay_days: 7, publish_weeks_ahead: 2,
        cp_monthly_days: 2.5, cp_credit_month: 5, cp_credit_day: 1, cp_cap: 30, cp_contracts: ['cdi', 'cdd', 'alternant'],
        seniority_years: 5, seniority_days: 1, seniority_contracts: ['cdi', 'cdd', 'alternant'],
        contingent_hours: 360, ot_day_minutes: 450, prev_month_start_day: 25,
        contract_types: [['cdi', 'CDI'], ['cdd', 'CDD'], ['alternant', 'Alternant'], ['stagiaire', 'Stagiaire'], ['extra', 'Extra'], ['interim', 'Intérimaire']],
        day_types: {}, rights: clone(DEFAULT_RIGHTS), notify: { publish: true, change: true, request: true, decision: true, credit: true },
        pointage_title: 'HOTEL ROCHESTER CHAMPS ELYSEES', rest_auto_months: 3,
        developer_email: 'paulr.rochester@gmail.com', require_email_code: false, updated_at: nowIso()
      } },
      profiles: people.map(function (p) {
        return { id: p[0], company_id: 1, full_name: p[1], email: p[8] || p[0] === 'x1' ? mail(p[1]) : null, role: p[2], services: p[3], service_id: p[3][0] || null, location: p[4], job_title: p[5],
          contract_type: p[6], contract_hours: 39, hire_date: p[7], has_account: p[8], cp_balance: p[9], ferie_balance: 0, recup_days: 0, rendre_days: 0,
          seniority_balance: 0, recup_adjust_min: 0, active: true, weekly_rest: p[10], last_sign_in_at: p[8] ? new Date(Date.now() - 86400000 * (1 + p[1].length % 9)).toISOString() : null };
      }),
      shifts: [], published: [], requests: [], notifications: [], audit: [], overtime: [], accruals: [], owed: [], seniority: [], staffing: []
    };
    d.profiles.find(function (p) { return p.id === 'dev'; }).email = 'paulr.rochester@gmail.com';
    d.services.forEach(function (x) { x.company_id = 1; }); T.forEach(function (x) { x.company_id = 1; });
    var thisWeek = C.weekStart(today()), stamp = new Date(Date.now() - 86400000 * 3).toISOString();
    function tpl(id) { return T.find(function (t) { return t.id === id; }); }
    function put(eid, svc, day, t, extra) {
      var sh = Object.assign({ id: uid(), employee_id: eid, service_id: svc, day: day, kind: 'work', template_id: t.id, start_time: t.start_time, end_time: t.end_time, label: t.name, color: t.color, break_min: null, updated_at: stamp, updated_by: 'm1' }, extra || {});
      var mine = d.shifts.filter(function (s) { return s.employee_id === eid; });
      if (C.restCheck(sh, mine, 11)) {
        var alt = [7, 4, 5, 3].map(tpl).find(function (x) { return !C.restCheck(Object.assign({}, sh, { start_time: x.start_time, end_time: x.end_time }), mine, 11); });
        if (!alt) return null;
        Object.assign(sh, { template_id: alt.id, start_time: alt.start_time, end_time: alt.end_time, label: alt.name, color: alt.color });
      }
      d.shifts.push(sh); return sh;
    }
    var rota = { m1: [3, 3, 6, 3, 3], a1: [2, 7, 7, 2, 3], e1: [2, 2, 1, 1, 7], e2: [7, 7, 4, 4, 2], e3: [1, 6, 7, 7, 4], m2: [15, 15, 16, 16, 15], e5: [16, 17, 15, 18, 16], e6: [2, 1, 1, 2, 2],
      m3: [3, 3, 3, 3, 3], e7: [2, 2, 2, 7, 7], e8: [7, 7, 2, 2, 2], e9: [21, 20, 21, 20, 21], e10: [22, 21, 22, 21, 22], e14: [23, 23, 23, 23, 23], e15: [20, 20, 21, 21, 20], e16: [19, 19, 19, 19, 19], m5: [2, 2, 2, 2, 2], e12: [9, 9, 9, 10, 9], e13: [10, 10, 9, 9, 10], e17: [9, 10, 9, 9, 11], e18: [9, 9, 10, 10, 9], e19: [9, 9, 11, 9, 10], e20: [12, 13, 14, 12, 13], e21: [14, 12, 13, 14, 12], e22: [24, 24, 25, 25, 24], e23: [26, 26, 26, 26, 26], e24: [27, 28, 27, 28, 27], e25: [29, 30, 29, 30, 29], e26: [25, 27, 28, 25, 25] };
    for (var wk = -8; wk <= 2; wk++) {
      var ws = C.addDays(thisWeek, wk * 7);
      Object.keys(rota).forEach(function (eid) {
        var p = d.profiles.find(function (x) { return x.id === eid; }), dayN = 0;
        for (var i = 0; i < 7; i++) {
          var day = C.addDays(ws, i);
          if (p.weekly_rest.indexOf(i + 1) >= 0) { d.shifts.push({ id: uid(), employee_id: eid, service_id: p.service_id, day: day, kind: 'repos', label: 'Repos', updated_at: stamp }); continue; }
          put(eid, p.service_id, day, tpl(rota[eid][(dayN + wk + 40) % 5])); dayN++;
        }
      });
      ['n1', 'n2'].forEach(function (eid) {
        var p = d.profiles.find(function (x) { return x.id === eid; });
        for (var i = 0; i < 7; i++) {
          var day = C.addDays(ws, i);
          if (p.weekly_rest.indexOf(i + 1) >= 0) d.shifts.push({ id: uid(), employee_id: eid, service_id: 1, day: day, kind: 'repos', label: 'Repos', updated_at: stamp });
          else put(eid, 1, day, tpl(8));
        }
      });
      if (wk >= -2) for (var k = 0; k < 5; k++) put('e11', 1, C.addDays(ws, k), tpl(3));
      if (wk >= -1) { put('x1', 1, C.addDays(ws, 5), tpl(2)); put('x1', 1, C.addDays(ws, 6), tpl(2), { extra_pay: true }); put('x2', 4, C.addDays(ws, 4), tpl(21)); }

    }
    // valeurs du jour (lingerie : chambres à faire ; cafétéria : PDJ prévisionnels) pour le mois en cours et le suivant
    for (var dd = C.addDays(thisWeek, -14); dd <= C.addDays(thisWeek, 34); dd = C.addDays(dd, 1)) {
      var k0 = +dd.slice(8, 10), wd = C.dow(dd);
      if (wd !== 0 && wd !== 6) {
        d.staffing.push({ service_id: 4, day: dd, key: 'rochester', value: 40 + (k0 * 17) % 60 });
        d.staffing.push({ service_id: 4, day: dd, key: 'demeure', value: 20 + (k0 * 11) % 35 });
        d.staffing.push({ service_id: 4, day: dd, key: 'splendide', value: 30 + (k0 * 13) % 50 });
        d.staffing.push({ service_id: 4, day: dd, key: 'chateau', value: 25 + (k0 * 7) % 45 });
      }
      d.staffing.push({ service_id: 2, day: dd, key: 'pdj', value: 12 + (k0 * 13) % 58 });
      var rec = 30 + (k0 * 7) % 25, dep = 15 + (k0 * 11) % 20;
      d.staffing.push({ service_id: 5, day: dd, key: 'vendues', value: rec + dep }, { service_id: 5, day: dd, key: 'recouche', value: rec }, { service_id: 5, day: dd, key: 'depart', value: dep });
      if (k0 % 4 === 0) d.staffing.push({ service_id: 5, day: dd, key: 'bloquee', value: 2 + k0 % 3 });
    }
    // mois publiés : le mois précédent et le mois en cours
    [C.addMonths(today().slice(0, 7) + '-01', -1), today().slice(0, 7) + '-01'].forEach(function (m) { [1, 2, 3, 4, 5].forEach(function (s) { d.published.push({ service_id: s, month: m }); }); });
    // Lucas (Cafétéria + Réception) fait un Soir en Réception un samedi
    put('e6', 1, C.addDays(thisWeek, 5), tpl(7), { note: 'Renfort réception' });
    // heures supp inscrites
    [['e1', -12, 90, 'Arrivée tardive d\'un groupe'], ['e3', -5, 45, 'Clôture de caisse'], ['e2', 1, 60, 'Remplacement absence'], ['n1', -20, 120, 'Panne informatique'], ['n1', -6, 60, 'Audit de nuit']].forEach(function (o) {
      var sh = d.shifts.filter(function (s) { return s.employee_id === o[0] && s.kind === 'work' && s.day >= C.addDays(thisWeek, o[1]); })[0];
      if (sh) d.overtime.push({ id: uid(), shift_id: sh.id, employee_id: o[0], service_id: sh.service_id, day: sh.day, minutes: o[2], reason: o[3], created_by: 'm1', created_at: stamp });
    });
    var y0 = thisWeek.slice(0, 4);
    [['e1', 'ferie', y0 + '-05-01', 'Fête du travail travaillée'], ['e1', 'ferie', y0 + '-11-01', 'Toussaint travaillée'], ['e2', 'ferie', y0 + '-07-14', 'Fête nationale travaillée'],
     ['e2', 'ferie', y0 + '-08-15', 'Assomption travaillée'], ['n1', 'ferie', y0 + '-11-01', 'Toussaint travaillée'], ['e3', 'recup', C.addDays(thisWeek, -20), 'Repos travaillé (remplacement)'],
     ['e6', 'ferie', y0 + '-05-08', 'Victoire 1945 travaillée'], ['e9', 'ferie', y0 + '-08-15', 'Assomption travaillée']].forEach(function (o) {
      var p = d.profiles.find(function (x) { return x.id === o[0]; });
      d.owed.push({ id: uid(), employee_id: o[0], service_id: p.service_id, type: o[1], origin_date: o[2], days: 1, reason: o[3], source_shift_id: null, rendered_shift_id: null, created_by: 'm1', created_at: stamp });
    });
    db = d; me = null; // les journées suivantes passent par les mêmes règles que l'application
    function mark(eid, day, kind, extra) {
      d.shifts.filter(function (s) { return s.employee_id === eid && s.day === day; }).forEach(function (s) { removeShift(s); });
      var p = d.profiles.find(function (x) { return x.id === eid; });
      var row = Object.assign({ id: uid(), employee_id: eid, service_id: p.service_id, day: day, kind: kind, label: label(kind), updated_at: stamp }, extra || {});
      beforeShift(row, null); d.shifts.push(row); afterShift(null, row); return row;
    }
    var owedLea = d.owed.find(function (o) { return o.employee_id === 'e1' && o.origin_date === y0 + '-05-01'; });
    mark('e1', C.addDays(thisWeek, -4), 'ferie', { owed_id: owedLea.id, note: 'Rendu pour le 1er mai' });
    mark('n1', C.addDays(thisWeek, 1), 'maladie', { note: 'Arrêt transmis aux RH' });
    mark('e3', C.addDays(thisWeek, 10), 'formation', { note: 'Formation Mews' });
    mark('e2', C.addDays(thisWeek, -10), 'ot_day');
    mark('e9', C.addDays(thisWeek, 2), 'cp'); mark('e9', C.addDays(thisWeek, 3), 'cp');
    // Yanis : un jour à rendre la semaine dernière, pas encore rendu
    mark('e2', C.addDays(thisWeek, -6), 'rendre', { note: 'Échange avec Léa' });
    // Léa : un shift supplémentaire (jour à récupérer) le mois dernier
    var lsup = d.shifts.find(function (s) { return s.employee_id === 'e1' && s.kind === 'repos' && s.day < C.addDays(thisWeek, -14); });
    if (lsup) { removeShift(lsup); var ls = Object.assign({ id: uid(), employee_id: 'e1', service_id: 1, day: lsup.day, kind: 'work', template_id: 4, start_time: '12:00', end_time: '20:18', label: 'Middle 12h', color: 'mid', jour_sup: true, updated_at: stamp });
      if (!C.restCheck(ls, d.shifts.filter(function (s) { return s.employee_id === 'e1'; }), 11)) { beforeShift(ls, null); d.shifts.push(ls); afterShift(null, ls); } }
    var r1s = C.addDays(thisWeek, 21), r2s = C.addDays(thisWeek, 15);
    d.requests.push({ id: uid(), employee_id: 'e1', service_id: 1, type: 'cp', start_date: r1s, end_date: C.addDays(r1s, 4), days: C.countOuvrables(r1s, C.addDays(r1s, 4)), comment: 'Vacances en famille', status: 'pending_manager', created_by: 'e1', created_at: nowIso() });
    d.requests.push({ id: uid(), employee_id: 'e3', service_id: 1, type: 'cp', start_date: r2s, end_date: C.addDays(r2s, 1), days: 2, comment: '', status: 'pending_admin', manager_id: 'm1', manager_at: nowIso(), created_by: 'e3', created_at: nowIso() });
    d.requests.push({ id: uid(), employee_id: 'e2', service_id: 1, type: 'ferie', start_date: C.addDays(thisWeek, 16), end_date: C.addDays(thisWeek, 16), days: 1, comment: 'Férié du 14 juillet travaillé', status: 'pending_manager', created_by: 'e2', created_at: nowIso() });
    d.notifications.push({ id: uid(), user_id: 'e1', title: 'Planning publié', body: 'Le planning de la semaine du ' + dm(C.addDays(thisWeek, 7)) + ' est disponible.', read_at: null, created_at: nowIso() });
    d.notifications.push({ id: uid(), user_id: 'm1', title: 'Nouvelle demande', body: 'MOREAU Léa : Congés payés du ' + dm(r1s) + ' au ' + dm(C.addDays(r1s, 4)) + '.', read_at: null, created_at: nowIso() });
    d.notifications.push({ id: uid(), user_id: 'adm', title: 'Congés à valider', body: 'GARNIER Inès — validé par le manager.', read_at: null, created_at: nowIso() });
    var last = C.cpLastCredit(today(), 5, 1);
    d.accruals.push({ company_id: 1, period_start: C.addMonths(last, -12), period_end: C.addDays(last, -1), employees: 17, total_days: 431, done_at: last + 'T03:00:00Z' });
    accrueSeniorityIn(d, today());
    d.passwords = { dev: '12042002' };   // démo : les autres comptes ont le mot de passe « demo1234 »
    d.currentUser = null;
    d.profiles.forEach(function (p) { refreshOwed(p.id); });
    db = null;
    return d;
  }

  function accrueSeniorityIn(d, day, cid) {
    var n = 0;
    d.profiles.forEach(function (p) {
      var st = d.settingsBy[p.company_id]; if (!st || (cid && p.company_id !== cid)) return;
      if (!p.active || !p.hire_date || st.seniority_contracts.indexOf(p.contract_type) < 0 || ['employee', 'assistant', 'manager', 'admin'].indexOf(p.role) < 0) return;
      var years = C.yearsBetween(p.hire_date, day), tiers = Math.floor(years / st.seniority_years);
      for (var k = 1; k <= tiers; k++) {
        if (d.seniority.some(function (s) { return s.employee_id === p.id && s.tier === k; })) continue;
        d.seniority.push({ employee_id: p.id, tier: k, years: k * st.seniority_years, days: +st.seniority_days, credited_on: day });
        p.seniority_balance = n1(p.seniority_balance + +st.seniority_days); n++;
        if ((st.notify || {}).credit !== false && p.has_account) d.notifications.unshift({ id: uid(), user_id: p.id, title: "Jour d'ancienneté crédité", body: '+' + st.seniority_days + ' j pour ' + k * st.seniority_years + " ans d'ancienneté.", read_at: null, created_at: nowIso() });
      }
    });
    return n;
  }

  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return seed();
  }

  /* ---------------- Compteurs reliés au planning (mêmes règles que la base) ---------------- */
  function refreshOwed(empId) {
    var p = profile(empId); if (!p) return;
    var open = db.owed.filter(function (o) { return o.employee_id === empId && !o.rendered_shift_id; });
    function sum(t) { return open.filter(function (o) { return o.type === t; }).reduce(function (a, o) { return a + o.days; }, 0); }
    p.ferie_balance = sum('ferie'); p.recup_days = sum('recup'); p.rendre_days = sum('rendre');
  }
  function consumedSource(shiftId, exceptId) {
    return db.owed.find(function (o) { return o.source_shift_id === shiftId && o.rendered_shift_id && o.rendered_shift_id !== exceptId; });
  }
  function consumedMsg(o) {
    return (o.type === 'rendre' ? 'Le jour à rendre' : 'Le jour à récupérer') + ' du ' + dm(o.origin_date) + ' a déjà été ' + (o.type === 'rendre' ? 'rendu' : 'récupéré') + ' le ' + dmy(o.rendered_on) + " : retirez d'abord ce jour-là.";
  }
  function beforeShift(row, old) {
    if (row.kind !== 'work') { row.extra_pay = false; row.jour_rendu = false; row.jour_sup = false; row.start_time = row.end_time = row.break_min = row.template_id = null; }
    if (!(row.kind === 'ferie' || row.kind === 'recup' || (row.kind === 'work' && row.jour_rendu))) row.owed_id = null;
    if (row.jour_rendu && row.jour_sup) fail('Cochez « Jour rendu » ou « Jour supplémentaire à récupérer », pas les deux.');
    if (old && ((old.kind === 'rendre' && row.kind !== 'rendre') || (old.jour_sup && !row.jour_sup) || old.employee_id !== row.employee_id)) {
      var c = db.owed.find(function (o) { return o.source_shift_id === old.id && o.rendered_shift_id; }); if (c) fail(consumedMsg(c));
    }
    var o;
    if (row.kind === 'ferie' || row.kind === 'recup') {
      if (row.owed_id) {
        o = db.owed.find(function (x) { return x.id === row.owed_id; });
        if (!o || o.employee_id !== row.employee_id || o.type !== row.kind) fail('Ce jour ne correspond pas à ce salarié.');
        if (o.rendered_shift_id && o.rendered_shift_id !== row.id) fail('Ce jour a déjà été pris le ' + dmy(o.rendered_on) + '.');
      } else {
        o = db.owed.filter(function (x) { return x.employee_id === row.employee_id && x.type === row.kind && (!x.rendered_shift_id || x.rendered_shift_id === row.id); })
          .sort(function (a, b) { return (a.origin_date || '9').localeCompare(b.origin_date || '9'); })[0];
        if (!o) fail((profile(row.employee_id) || {}).full_name + " n'a aucun " + (row.kind === 'ferie' ? 'jour férié dû' : 'jour à récupérer') + '.');
        row.owed_id = o.id;
      }
    }
    if (row.kind === 'work' && row.jour_rendu) {
      if (!row.owed_id) fail('Choisissez dans la liste le jour à rendre qui est rendu.');
      o = db.owed.find(function (x) { return x.id === row.owed_id; });
      if (!o || o.employee_id !== row.employee_id || o.type !== 'rendre') fail('Ce jour à rendre ne correspond pas à ce salarié.');
      if (o.rendered_shift_id && o.rendered_shift_id !== row.id) fail('Ce jour a déjà été rendu le ' + dmy(o.rendered_on) + '.');
    }
    if (row.kind === 'work' && row.jour_sup && !(old && old.jour_sup)) {
      var owe = db.owed.filter(function (x) { return x.employee_id === row.employee_id && x.type === 'rendre' && !x.rendered_shift_id; }).reduce(function (a, x) { return a + x.days; }, 0);
      if (owe > 0) fail('Ce salarié a encore ' + owe + ' jour(s) à rendre : cochez « Jour rendu » au lieu de « Jour supplémentaire à récupérer ».');
    }
    var same = old && old.employee_id === row.employee_id && old.kind === row.kind && old.day === row.day, p = profile(row.employee_id), bal;
    if (row.kind === 'cp' && !row.request_id && isOuvr(row.day) && !same) {
      bal = p.cp_balance + (old && old.kind === 'cp' && old.employee_id === row.employee_id && isOuvr(old.day) ? 1 : 0);
      if (bal < 1) fail('Solde de congés payés insuffisant (' + bal + ' j).');
    }
    if (row.kind === 'anciennete' && !row.request_id && !same) {
      bal = p.seniority_balance + (old && old.kind === 'anciennete' && old.employee_id === row.employee_id ? 1 : 0);
      if (bal < 1) fail("Solde de jours d'ancienneté insuffisant (" + bal + ' j).');
    }
  }
  function afterShift(old, row) {
    if (old) {
      if (old.kind === 'cp' && isOuvr(old.day)) { var a = profile(old.employee_id); a.cp_balance = n1(a.cp_balance + 1); }
      if (old.kind === 'anciennete') { var a2 = profile(old.employee_id); a2.seniority_balance = n1(a2.seniority_balance + 1); }
      if (old.owed_id && (!row || row.owed_id !== old.owed_id)) db.owed.forEach(function (o) { if (o.id === old.owed_id && o.rendered_shift_id === old.id) { o.rendered_shift_id = null; o.rendered_on = null; o.rendered_note = null; } });
      if (!row || (old.kind === 'rendre' && row.kind !== 'rendre') || (old.jour_sup && !row.jour_sup) || row.employee_id !== old.employee_id)
        db.owed = db.owed.filter(function (o) { return o.source_shift_id !== old.id; });
    }
    if (row) {
      if (row.kind === 'cp' && isOuvr(row.day)) { var b = profile(row.employee_id); b.cp_balance = n1(b.cp_balance - 1); }
      if (row.kind === 'anciennete') { var b2 = profile(row.employee_id); b2.seniority_balance = n1(b2.seniority_balance - 1); }
      if (row.owed_id) db.owed.forEach(function (o) { if (o.id === row.owed_id) { o.rendered_shift_id = row.id; o.rendered_on = row.day; o.rendered_note = row.note || null; } });
      var src = db.owed.find(function (o) { return o.source_shift_id === row.id; }), p = profile(row.employee_id);
      if (row.kind === 'rendre') {
        if (src) { src.origin_date = row.day; src.reason = row.note || src.reason; }
        else db.owed.push({ id: uid(), employee_id: row.employee_id, service_id: p.service_id, type: 'rendre', origin_date: row.day, days: 1, reason: row.note || null, source_shift_id: row.id, rendered_shift_id: null, created_by: me ? me.id : null, created_at: nowIso() });
      }
      if (row.kind === 'work' && row.jour_sup) {
        if (src) src.origin_date = row.day;
        else db.owed.push({ id: uid(), employee_id: row.employee_id, service_id: p.service_id, type: 'recup', origin_date: row.day, days: 1, reason: 'Jour supplémentaire travaillé', source_shift_id: row.id, rendered_shift_id: null, created_by: me ? me.id : null, created_at: nowIso() });
      }
    }
    if (old) refreshOwed(old.employee_id); if (row) refreshOwed(row.employee_id);
  }
  function removeShift(s) {
    var c = consumedSource(s.id, s.id); if (c) fail(consumedMsg(c));
    db.shifts = db.shifts.filter(function (x) { return x.id !== s.id; });
    db.overtime = db.overtime.filter(function (o) { return o.shift_id !== s.id; });
    afterShift(s, null);
  }
  function applyRequest(r) {
    db.shifts.filter(function (s) { return s.employee_id === r.employee_id && s.day >= r.start_date && s.day <= r.end_date; }).forEach(removeShift);
    for (var d = r.start_date; d <= r.end_date; d = C.addDays(d, 1)) {
      var row = { id: uid(), employee_id: r.employee_id, service_id: r.service_id, day: d, kind: r.type, request_id: r.id, label: label(r.type), updated_at: nowIso() };
      beforeShift(row, null); db.shifts.push(row); afterShift(null, row);
    }
  }
  function writeShift(sh) {
    if (!can('planning', sh.service_id)) fail("Vous n'avez pas le droit de modifier le planning de ce service.");
    if (!worksIn(sh.employee_id, sh.service_id)) fail("Ce salarié n'appartient pas à ce service.");
    if (sh.kind === 'work' && (!sh.start_time || !sh.end_time)) fail('Choisissez un modèle de shift.');
    var old = sh.id && db.shifts.find(function (s) { return s.id === sh.id; });
    var candidate = Object.assign({ id: uid(), extra_pay: false, jour_rendu: false, jour_sup: false }, old || {}, sh);
    if (candidate.kind === 'work') { var err = restError(candidate); if (err) fail(err); }
    var before = old ? clone(old) : null;
    beforeShift(candidate, before);
    candidate.updated_at = nowIso(); candidate.updated_by = me.id;
    var row;
    if (old) { row = old; Object.keys(row).forEach(function (k) { delete row[k]; }); Object.assign(row, candidate); } else { row = candidate; db.shifts.push(row); }
    afterShift(before, row);
    audit('shifts', row, old ? 'UPDATE' : 'INSERT', before);
    db.overtime.forEach(function (o) { if (o.shift_id === row.id) { o.day = row.day; o.employee_id = row.employee_id; o.service_id = row.service_id; } });
    if (row.kind !== 'work') db.overtime = db.overtime.filter(function (o) { return o.shift_id !== row.id; });
    if (notifyOn('change') && isPublished(row.service_id, row.day) && row.employee_id !== me.id)
      notify(row.employee_id, 'Planning modifié', 'Votre planning du ' + dmy(row.day) + ' a été ' + (old ? 'modifié' : 'ajouté') + '.');
    cpRest(before, row);
    return row;
  }
  /* CP en jours ouvrables : CP le jour J et J+1 = 1er jour de repos habituel (samedi pour samedi-dimanche) → J+1 décompté en CP */
  var cpGuard = false;
  function isoDow(d) { var w = C.dow(d); return w === 0 ? 7 : w; }
  function cpRestDay(p) {
    var r = ((p && p.weekly_rest) || []).map(Number);
    if (!r.length) return 6;
    if (r.length < 2) return null;
    var c = r.filter(function (x) { return x !== 7 && r.indexOf(x === 1 ? 7 : x - 1) < 0; }).sort();
    if (c.length) return c[0];
    c = r.filter(function (x) { return x !== 7; }).sort(); return c.length ? c[0] : null;
  }
  function cpRest(before, row) {
    if (cpGuard) return;
    cpGuard = true;
    try {
      if (before && before.kind === 'cp' && (!row || row.kind !== 'cp' || row.day !== before.day)) {
        var d0 = C.addDays(before.day, 1), auto = db.shifts.find(function (s) { return s.employee_id === before.employee_id && s.day === d0 && s.kind === 'cp' && s.note === 'CP décompté (repos)'; });
        if (auto) { removeShift(auto); writeShift({ employee_id: before.employee_id, service_id: before.service_id, day: d0, kind: 'repos', note: 'Repos hebdomadaire' }); }
      }
      if (row && row.kind === 'cp' && !row.request_id) {
        var d = C.addDays(row.day, 1), rd = cpRestDay(profile(row.employee_id));
        if (rd && isoDow(d) === rd && C.countOuvrables(d, d) === 1 && !db.shifts.some(function (s) { return s.employee_id === row.employee_id && s.day === d && s.kind !== 'repos'; })) {
          db.shifts.filter(function (s) { return s.employee_id === row.employee_id && s.day === d && s.kind === 'repos'; }).forEach(removeShift);
          writeShift({ employee_id: row.employee_id, service_id: row.service_id, day: d, kind: 'cp', note: 'CP décompté (repos)' });
        }
      }
    } finally { cpGuard = false; }
  }
  function dropShift(id) {
    var row = db.shifts.find(function (s) { return s.id === id; });
    if (!row || !can('planning', row.service_id)) fail("Vous n'avez pas le droit de modifier le planning de ce service.");
    removeShift(row); audit('shifts', null, 'DELETE', row); cpRest(row, null);
    if (notifyOn('change') && isPublished(row.service_id, row.day) && row.employee_id !== me.id) notify(row.employee_id, 'Planning modifié', 'Votre planning du ' + dmy(row.day) + ' a été supprimé.');
  }
  function otBalance(empId) {
    var ins = db.overtime.filter(function (o) { return o.employee_id === empId; }).reduce(function (a, o) { return a + o.minutes; }, 0);
    var used = db.shifts.filter(function (s) { return s.employee_id === empId && s.kind === 'ot_day'; }).length * ST((profile(empId) || {}).company_id).ot_day_minutes;
    return ins + ((profile(empId) || {}).recup_adjust_min || 0) - used;
  }

  db = load(); me = profile(db.currentUser);
  function ok(v) { save(); return Promise.resolve(clone(v)); }
  /* opération atomique : en cas de refus, la base de démo est remise dans son état précédent */
  function run(fn) {
    var snap = JSON.stringify(db), meId = me && me.id;
    try { return ok(fn()); }
    catch (e) { db = JSON.parse(snap); me = profile(meId); return Promise.reject(e); }
  }
  function mustAdmin() { if (!isAdm()) fail("Réservé à l'administrateur."); }

  window.Store = {
    mode: 'demo',
    me: function () { return me && clone(me); },
    init: function () { me = profile(db.currentUser); return Promise.resolve(me && me.active ? clone(me) : null); },
    onAuthChange: function () {},
    resetDemo: function () { try { localStorage.removeItem(KEY); } catch (e) {} db = seed(); me = null; save(); },
    signIn: function (email, pw) {
      return run(function () {
        var p = db.profiles.find(function (x) { return x.has_account && x.email && x.email.toLowerCase() === String(email).trim().toLowerCase(); });
        if (!p || String(pw) !== ((db.passwords || {})[p.id] || 'demo1234')) fail('E-mail ou mot de passe incorrect.');
        if (!p.active) fail('Ce compte est désactivé.');
        p.last_sign_in_at = nowIso();
        if (ST(p.company_id).require_email_code === false) { db.currentUser = p.id; me = p; return { needCode: false }; }
        db.pendingLogin = { id: p.id, email: p.email.toLowerCase(), code: String(Math.floor(100000 + Math.random() * 900000)), at: Date.now() };
        return { needCode: true, demoCode: db.pendingLogin.code };
      });
    },
    verifyCode: function (email, code) {
      return run(function () {
        var pl = db.pendingLogin;
        if (!pl || pl.email !== String(email).toLowerCase() || Date.now() - pl.at > 10 * 60000) fail('Code expiré. Demandez un nouveau code.');
        if (String(code).trim() !== pl.code) fail('Code incorrect.');
        db.pendingLogin = null; db.currentUser = pl.id; me = profile(pl.id); return me;
      });
    },
    resendCode: function () { return run(function () { var pl = db.pendingLogin; if (!pl) fail('Reconnectez-vous avec votre mot de passe.'); pl.code = String(Math.floor(100000 + Math.random() * 900000)); pl.at = Date.now(); return { demoCode: pl.code }; }); },
    signOut: function () { db.currentUser = null; me = null; save(); return Promise.resolve(); },
    resetPassword: function () { return Promise.resolve(); },
    updatePassword: function (pw) { return run(function () { if (String(pw).length < 8) fail('Le mot de passe doit contenir au moins 8 caractères.'); if (me.must_change_pw && pw === (db.passwords || {})[me.id]) fail('Choisissez un mot de passe différent du code provisoire.'); (db.passwords = db.passwords || {})[me.id] = pw; }); },
    pwChanged: function () { return run(function () { me.must_change_pw = false; }); },
    setUserPassword: function (id, pw) {
      return run(function () {
        var t = profile(id); if (!t || !canSee(t)) fail('Salarié introuvable.');
        var RANK = { pending: 0, employee: 1, assistant: 2, manager: 3, admin: 4, developer: 5 };
        if (t.id !== me.id && role() !== 'developer') {
          if (!(RANK[role()] > RANK[t.role])) fail("Vous ne pouvez pas changer le mot de passe d'un rôle égal ou supérieur au vôtre.");
          if (role() === 'admin' && !adminRight('passwords')) fail('Droit retiré par le développeur.');
          if (role() !== 'admin' && !svcsOf(t).some(function (s) { return inMine(s); })) fail("Cette personne n'est pas dans vos services.");
        }
        if (pw != null && String(pw).length < 8) fail('Le mot de passe doit contenir au moins 8 caractères.');
        if (!t.email) fail("Renseignez d'abord l'e-mail du salarié.");
        var created = !t.has_account, code = pw != null ? String(pw) : tempCode();
        (db.passwords = db.passwords || {})[id] = code; t.has_account = true; t.must_change_pw = pw == null;
        return { ok: true, created: created, temp_password: code, email: t.email, mailed: false, demo: true };
      });
    },

    services: function () { return ok(db.services.filter(function (x) { return x.company_id === myCo(); }).sort(function (a, b) { return a.sort - b.sort || a.id - b.id; })); },
    saveService: function (s) {
      return run(function () {
        mustAdmin();
        var nameT = String(s.name || '').trim(); if (!nameT) fail('Indiquez le nom du service.');
        if (s.id && !inCo(s.id)) fail('Service introuvable.');
        if (db.services.some(function (x) { return x.company_id === myCo() && x.name.toLowerCase() === nameT.toLowerCase() && x.id !== s.id; })) fail('Ce service existe déjà.');
        var locs = (s.locations || []).map(function (x) { return String(x).trim(); }).filter(Boolean);
        if (s.id) { var row = db.services.find(function (x) { return x.id === s.id; }); Object.assign(row, { name: nameT, locations: locs, archived: !!s.archived, sort: s.sort != null ? +s.sort : row.sort }); if (s.staffing !== undefined) row.staffing = s.staffing; audit('services', row, 'UPDATE'); return row; }
        var n = { id: Math.max.apply(null, db.services.map(function (x) { return x.id; }).concat(0)) + 1, company_id: myCo(), name: nameT, locations: locs, sort: db.services.filter(function (x) { return x.company_id === myCo(); }).length + 1, archived: false };
        db.services.push(n); audit('services', n, 'INSERT'); return n;
      });
    },
    deleteService: function (id) {
      return run(function () {
        mustAdmin(); if (!inCo(id)) fail('Service introuvable.');
        if (db.profiles.some(function (p) { return svcsOf(p).indexOf(id) >= 0; }) || db.shifts.some(function (s) { return s.service_id === id; }) || db.published.some(function (p) { return p.service_id === id; }))
          fail('Ce service est encore utilisé (salariés, shifts ou semaines publiées) : archivez-le plutôt.');
        db.services = db.services.filter(function (x) { return x.id !== id; });
      });
    },
    templates: function () { return ok(db.templates.filter(function (x) { return x.company_id === myCo(); }).sort(function (a, b) { return a.sort - b.sort; })); },
    saveTemplate: function (t) {
      return run(function () {
        mustAdmin();
        if (!t.name || !t.start_time || !t.end_time) fail('Indiquez un nom, un début et une fin.');
        if (t.service_id && !inCo(+t.service_id)) fail('Service introuvable.');
        var row;
        if (t.id) {
          row = db.templates.find(function (x) { return x.id === t.id && x.company_id === myCo(); });
          if (!row) fail('Shift introuvable.');
          var o0 = { s: hm5(row.start_time), e: hm5(row.end_time), svc: row.service_id }; Object.assign(row, t);
          // nouvel horaire appliqué à tous les shifts de ce modèle à partir d'aujourd'hui (comme la base en ligne)
          if (o0.s !== hm5(row.start_time) || o0.e !== hm5(row.end_time)) {
            var d0 = today(), who = {};
            db.shifts.forEach(function (s) {
              if (s.kind !== 'work' || s.day < d0 || svcCo(s.service_id) !== row.company_id) return;
              if (s.template_id === row.id || (!s.template_id && hm5(s.start_time) === o0.s && hm5(s.end_time) === o0.e && (!o0.svc || s.service_id === o0.svc))) {
                s.start_time = hm5(row.start_time); s.end_time = hm5(row.end_time); s.template_id = row.id; s.updated_at = new Date().toISOString();
                if (isPublished(s.service_id, s.day)) who[s.employee_id] = 1;
              }
            });
            if (notifyOn('change')) Object.keys(who).forEach(function (e) { notify(e, 'Horaire modifié', 'Le shift « ' + row.name + ' » passe à ' + hm(row.start_time) + ' – ' + hm(row.end_time) + ' à partir d\'aujourd\'hui.'); });
          }
        }
        else { row = Object.assign({ active: true, service_id: null }, t, { company_id: myCo(), id: Math.max.apply(null, db.templates.map(function (x) { return x.id; }).concat(0)) + 1, sort: t.sort || db.templates.length + 1 }); db.templates.push(row); }
        audit('shift_templates', row, t.id ? 'UPDATE' : 'INSERT'); return row;
      });
    },
    deleteTemplate: function (id) { return run(function () { mustAdmin(); if (!db.templates.some(function (x) { return x.id === id && x.company_id === myCo(); })) fail('Shift introuvable.'); db.templates = db.templates.filter(function (x) { return x.id !== id; }); db.shifts.forEach(function (s) { if (s.template_id === id) s.template_id = null; }); }); },
    settings: function () { return ok(ST()); },
    saveSettings: function (patch) {
      return run(function () {
        mustAdmin();
        if (!adminRight('settings')) fail('Droit retiré par le développeur.');
        var cur = ST(), old = clone(cur); patch = Object.assign({}, patch); delete patch.id;
        if (role() !== 'developer') {
          delete patch.developer_email;
          if (patch.rights && JSON.stringify(patch.rights.admin || null) !== JSON.stringify((cur.rights || {}).admin || null)) fail("Seul le développeur peut modifier les droits de l'administrateur.");
        }
        Object.assign(cur, patch, { updated_at: nowIso(), updated_by: me.id }); audit('settings', cur, 'UPDATE', old); return cur;
      });
    },
    cpAccruals: function () { return ok(isAdm() ? db.accruals.filter(function (a) { return a.company_id === myCo(); }).sort(function (a, b) { return b.period_end.localeCompare(a.period_end); }) : []); },
    accrueCp: function (day) {
      return run(function () {
        mustAdmin();
        var st = ST(), ref = C.cpLastCredit(day || today(), st.cp_credit_month, st.cp_credit_day);
        var pe = C.addDays(ref, -1), ps = C.addMonths(ref, -12);
        if (db.accruals.some(function (a) { return a.company_id === myCo() && a.period_end === pe; })) fail('Les congés de la période du ' + dmy(ps) + ' au ' + dmy(pe) + ' ont déjà été crédités.');
        var n = 0, tot = 0;
        db.profiles.forEach(function (p) {
          if (!(p.company_id === myCo() && p.active && ['employee', 'assistant', 'manager', 'admin'].indexOf(p.role) >= 0 && st.cp_contracts.indexOf(p.contract_type) >= 0 && p.hire_date && p.hire_date <= pe)) return;
          var v = C.cpEarned(p.hire_date, ps, pe, +st.cp_monthly_days, false, +st.cp_cap); p.cp_balance = n1(p.cp_balance + v); n++; tot += v;
          if (notifyOn('credit')) notify(p.id, 'Congés payés crédités', 'Vos congés acquis du ' + dmy(ps) + ' au ' + dmy(pe) + ' ont été ajoutés à votre solde.');
        });
        db.accruals.push({ company_id: myCo(), period_start: ps, period_end: pe, employees: n, total_days: tot, done_at: nowIso() });
        return n;
      });
    },
    seniorityCredits: function () { return ok(db.seniority.filter(function (s) { return canSee(profile(s.employee_id)); })); },
    accrueSeniority: function (day) { return run(function () { mustAdmin(); return accrueSeniorityIn(db, day || today(), myCo()); }); },

    profiles: function () { return ok(db.profiles.filter(canSee).sort(function (a, b) { return a.full_name.localeCompare(b.full_name); })); },
    updateProfile: function (id, patch) {
      return run(function () {
        var t = profile(id); if (!t || !canSee(t)) fail('Fiche introuvable.');
        patch = Object.assign({}, patch);
        if (patch.role === 'developer' && t.role !== 'developer') fail('Ce rôle ne peut pas être attribué.');
        if (t.role === 'developer' && ((patch.role && patch.role !== 'developer') || patch.active === false)) fail('Le compte développeur garde son rôle et reste actif.');
        if ('hire_date' in patch && !patch.hire_date && t.role !== 'developer') fail("La date d'entrée est obligatoire.");
        if (!isAdm()) {
          var ro = role();
          if (!(ro === 'manager' || ro === 'assistant')) fail('Accès refusé.');
          if (t.role !== 'pending' && !svcsOf(t).some(function (s) { return can('team', s); })) fail('Vous ne pouvez modifier que les salariés de vos services.');
          if (['employee', 'pending'].indexOf(t.role) < 0) fail("Seul l'administrateur peut modifier cette fiche.");
          if ((patch.role && ['employee', 'pending'].indexOf(patch.role) < 0) || 'cp_balance' in patch || 'seniority_balance' in patch || 'recup_adjust_min' in patch) fail("Seul l'administrateur peut changer les rôles ou les soldes.");
          (patch.services || []).forEach(function (s) { if (!can('team', s)) fail('Vous ne gérez pas tous ces services.'); });
        }
        (patch.services || []).concat(patch.service_id ? [+patch.service_id] : []).forEach(function (s) { if (!inCo(+s)) fail("Service d'une autre entreprise."); });
        delete patch.company_id; if (t.company_id == null && t.id !== me.id) t.company_id = myCo();
        if ('email' in patch && t.has_account) delete patch.email;
        var old = clone(t);
        if (patch.services) { patch.services = patch.services.map(Number); if (patch.service_id == null || patch.services.indexOf(+patch.service_id) < 0) patch.service_id = patch.services[0] || null; }
        else if ('service_id' in patch && patch.service_id && svcsOf(t).indexOf(+patch.service_id) < 0) patch.services = svcsOf(t).concat([+patch.service_id]);
        Object.assign(t, patch); audit('profiles', t, 'UPDATE', old);
        return t;
      });
    },
    creditFerie: function (ids, days, holiday, reason) {
      return run(function () {
        if (!(days > 0 && days <= 5)) fail('Indiquez entre 0,5 et 5 jours.');
        var n = 0;
        ids.forEach(function (id) {
          var e = profile(id); if (!e || !svcsOf(e).some(function (s) { return can('owed', s); })) fail('Vous ne gérez pas les jours de ' + (e ? e.full_name : 'ce salarié') + '.');
          for (var k = days; k > 0; k -= Math.min(k, 1)) db.owed.push({ id: uid(), employee_id: id, service_id: e.service_id, type: 'ferie', origin_date: holiday || null, days: Math.min(k, 1), reason: reason || null, source_shift_id: null, rendered_shift_id: null, created_by: me.id, created_at: nowIso() });
          refreshOwed(id); n++;
          if (notifyOn('credit')) notify(id, 'Jour férié crédité', '+' + days + ' j' + (holiday ? ' (férié du ' + dmy(holiday) + ')' : '') + '.');
        });
        return n;
      });
    },
    owedDays: function (f) {
      f = f || {};
      return ok(db.owed.filter(function (o) {
        if (f.employeeId && o.employee_id !== f.employeeId) return false;
        if (f.serviceId && !worksIn(o.employee_id, f.serviceId)) return false;
        return o.employee_id === me.id || anySvc(o.employee_id, staffOf);
      }).sort(function (a, b) { return (a.origin_date || '').localeCompare(b.origin_date || ''); }));
    },
    addOwed: function (o) {
      return run(function () {
        var e = profile(o.employee_id); if (!e || !svcsOf(e).some(function (s) { return can('owed', s); })) fail('Vous ne gérez pas les jours dus de ce salarié.');
        if (['ferie', 'recup', 'rendre'].indexOf(o.type) < 0) fail('Type inconnu.');
        var row = { id: uid(), employee_id: e.id, service_id: e.service_id, type: o.type, origin_date: o.origin_date || null, days: +o.days === 0.5 ? 0.5 : 1, reason: o.reason || null, source_shift_id: null, rendered_shift_id: null, created_by: me.id, created_at: nowIso() };
        db.owed.push(row); refreshOwed(e.id); audit('owed_days', row, 'INSERT');
        if (notifyOn('credit')) notify(e.id, { ferie: 'Jour férié crédité', recup: 'Jour à récupérer ajouté', rendre: 'Jour à rendre ajouté' }[o.type], (o.type === 'rendre' ? '' : '+') + row.days + ' j' + (row.origin_date ? ' (' + dmy(row.origin_date) + ')' : '') + '.');
        return row;
      });
    },
    deleteOwed: function (id) {
      return run(function () {
        var o = db.owed.find(function (x) { return x.id === id; });
        if (!o || !svcsOf(profile(o.employee_id)).some(function (s) { return can('owed', s); })) fail('Vous ne gérez pas les jours dus de ce salarié.');
        if (o.rendered_shift_id) fail("Ce jour a déjà été rendu : retirez-le d'abord du planning.");
        if (o.source_shift_id) fail('Ce jour vient du planning : retirez la journée ou décochez la case dans le planning.');
        db.owed = db.owed.filter(function (x) { return x.id !== id; }); refreshOwed(o.employee_id); audit('owed_days', null, 'DELETE', o);
      });
    },
    addStaff: function (p) {
      return run(function () {
        var services = (p.services || [p.service_id]).map(Number).filter(Boolean);
        if (services.some(function (s) { return !inCo(s); })) fail("Service d'une autre entreprise.");
        var r = isAdm() && ['employee', 'assistant', 'manager', 'admin'].indexOf(p.role) >= 0 ? p.role : 'employee';
        if (!isAdm()) { if (!services.length || services.some(function (s) { return !can('team', s); })) fail('Accès refusé.'); }
        if (!services.length && r !== 'admin') fail('Choisissez un service.');
        if (!p.full_name || !p.full_name.trim()) fail('Indiquez le nom du salarié.');
        if (!p.hire_date) fail("La date d'entrée est obligatoire.");
        var access = !!(p.access || p.password);
        if (p.password && String(p.password).length < 8) fail('Le mot de passe doit contenir au moins 8 caractères.');
        if (access && !(p.email || '').trim()) fail("Indiquez l'e-mail de connexion.");
        var email = (p.email || '').trim().toLowerCase() || null;
        if (email && db.profiles.some(function (x) { return x.email && x.email.toLowerCase() === email; })) fail('Un salarié existe déjà avec cet e-mail.');
        var row = { id: uid(), company_id: myCo(), full_name: p.full_name.trim(), email: email, has_account: access, must_change_pw: access && !p.password, role: r, services: services, service_id: services[0] || null,
          location: p.location || null, job_title: p.job_title || null, weekly_rest: p.weekly_rest || [], contract_type: p.contract_type || 'extra',
          contract_hours: +p.contract_hours || 39, hire_date: p.hire_date, cp_balance: 0, ferie_balance: 0, recup_days: 0, rendre_days: 0, seniority_balance: 0, recup_adjust_min: 0, active: true, last_sign_in_at: null };
        db.profiles.push(row); audit('profiles', row, 'INSERT');
        if (!access) return row;
        var code = p.password || tempCode();   // démonstration : aucun e-mail réellement envoyé
        (db.passwords = db.passwords || {})[row.id] = code;
        return Object.assign({}, row, { temp_password: code, mailed: false, demo: true });
      });
    },
    lastSignIns: function () { var m = {}; db.profiles.filter(canSee).forEach(function (p) { if (p.last_sign_in_at) m[p.id] = p.last_sign_in_at; }); return ok(m); },

    shifts: function (from, to, f) {
      f = f || {};
      return ok(db.shifts.filter(function (s) {
        if (s.day < from || s.day > to) return false;
        if (f.serviceId && s.service_id !== f.serviceId) return false;
        if (f.employeeId && s.employee_id !== f.employeeId) return false;
        return staffOf(s.service_id) || (s.employee_id === me.id && (s.request_id || isPublished(s.service_id, s.day))) ||
          (role() === 'employee' && empRight('team_planning') && inMine(s.service_id) && isPublished(s.service_id, s.day) && canSee(profile(s.employee_id)));
      }).sort(function (a, b) { return (a.day + (a.start_time || '')).localeCompare(b.day + (b.start_time || '')); }));
    },
    saveShift: function (sh) { return run(function () { return writeShift(sh); }); },
    /* Remplace en une seule opération : supprime les éléments de la case puis pose le nouveau */
    replaceCell: function (deleteIds, sh) { return run(function () { (deleteIds || []).forEach(dropShift); var row = Object.assign({}, sh); delete row.id; return writeShift(row); }); },
    deleteShift: function (id) { return run(function () { dropShift(id); }); },
    /* repos hebdomadaire posé automatiquement sur les jours vides (comme la base en ligne) */
    applyWeeklyRest: function (emp, from, to) {
      return run(function () {
        var e = profile(emp); if (!e) fail('Salarié introuvable.');
        var svc = e.service_id || svcsOf(e)[0];
        if (!svc || !can('planning', svc)) fail("Vous n'avez pas le droit de modifier le planning de ce salarié.");
        if (e.hire_date && e.hire_date > from) from = e.hire_date;
        var rest = (e.weekly_rest || []).map(Number), isoDow = function (d) { var w = C.dow(d); return w === 0 ? 7 : w; }, n = 0;
        db.shifts.filter(function (s) { return s.employee_id === e.id && s.kind === 'repos' && s.note === 'Repos hebdomadaire' && s.day >= from && s.day <= to && rest.indexOf(isoDow(s.day)) < 0; })
          .forEach(function (s) { dropShift(s.id); });
        for (var d = from, k = 0; d <= to && k < 400; d = C.addDays(d, 1), k++) {
          if (rest.indexOf(isoDow(d)) < 0 || db.shifts.some(function (s) { return s.employee_id === e.id && s.day === d; })) continue;
          writeShift({ employee_id: e.id, service_id: svc, day: d, kind: 'repos', note: 'Repos hebdomadaire' }); n++;
        }
        return n;
      });
    },
    staffingValues: function (svc, from, to) { return ok(db.staffing.filter(function (v) { return v.service_id === svc && v.day >= from && v.day <= to && staffOf(svc); })); },
    saveStaffingValue: function (svc, day, key, value) {
      return run(function () {
        if (!can('planning', svc)) fail("Vous n'avez pas le droit de modifier le planning de ce service.");
        db.staffing = db.staffing.filter(function (v) { return !(v.service_id === svc && v.day === day && v.key === key); });
        if (value === null || value === '' || isNaN(value)) return null;
        var row = { service_id: svc, day: day, key: key, value: Math.max(0, Math.round(+value)), updated_by: me.id, updated_at: nowIso() };
        db.staffing.push(row); return row;
      });
    },
    saveStaffingValues: function (svc, list) {
      return run(function () {
        if (!can('planning', svc)) fail("Vous n'avez pas le droit de modifier le planning de ce service.");
        list.forEach(function (x) {
          db.staffing = db.staffing.filter(function (v) { return !(v.service_id === svc && v.day === x.day && v.key === x.key); });
          if (x.value != null) db.staffing.push({ service_id: svc, day: x.day, key: x.key, value: Math.max(0, Math.round(+x.value)), updated_by: me.id, updated_at: nowIso() });
        });
        return list.length;
      });
    },
    publishedMonths: function (svc) { return ok(db.published.filter(function (p) { return (!svc || p.service_id === svc) && (staffOf(p.service_id) || inMine(p.service_id)); })); },
    publishMonth: function (svc, month) {
      return run(function () {
        if (!can('publish', svc)) fail("Vous n'avez pas le droit de publier ce service.");
        var m = monthOf(month);
        if (!isPublished(svc, m)) db.published.push({ service_id: svc, month: m, published_at: nowIso(), published_by: me.id });
        var ML = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
        if (notifyOn('publish')) db.profiles.forEach(function (p) { if (svcsOf(p).indexOf(svc) >= 0 && ['employee', 'assistant', 'manager'].indexOf(p.role) >= 0) notify(p.id, 'Planning publié', 'Le planning de ' + ML[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4) + ' est disponible.'); });
      });
    },
    unpublishMonth: function (svc, month) {
      return run(function () {
        if (!can('publish', svc)) fail("Vous n'avez pas le droit de dépublier ce service.");
        var m = monthOf(month);
        db.published = db.published.filter(function (p) { return !(p.service_id === svc && p.month === m); });
      });
    },

    overtime: function (from, to, f) {
      f = f || {};
      return ok(db.overtime.filter(function (o) {
        if (!(can('overtime', o.service_id) || (o.employee_id === me.id && empRight('balances')))) return false;
        if (o.day < from || o.day > to) return false;
        if (f.serviceId && o.service_id !== f.serviceId) return false;
        if (f.employeeId && o.employee_id !== f.employeeId) return false;
        return true;
      }).sort(function (a, b) { return b.day.localeCompare(a.day); }));
    },
    otBalance: function (empId) { return ok(otBalance(empId || me.id)); },
    saveOvertime: function (o) {
      return run(function () {
        var sh = db.shifts.find(function (x) { return x.id === o.shift_id; });
        if (!sh) fail('Shift introuvable.');
        if (sh.kind !== 'work') fail('Les heures supp ne peuvent être inscrites que sur un shift travaillé.');
        if (!can('overtime', sh.service_id)) fail("Vous n'avez pas le droit d'inscrire des heures supp.");
        if (!(o.minutes > 0 && o.minutes <= 960)) fail('Indiquez une durée entre 0h01 et 16h00.');
        var row = db.overtime.find(function (x) { return x.shift_id === sh.id; });
        if (row) Object.assign(row, { minutes: o.minutes, reason: o.reason || null });
        else { row = { id: uid(), shift_id: sh.id, minutes: o.minutes, reason: o.reason || null, created_by: me.id, created_at: nowIso() }; db.overtime.push(row); }
        Object.assign(row, { employee_id: sh.employee_id, service_id: sh.service_id, day: sh.day });
        audit('overtime_entries', row, 'UPSERT'); return row;
      });
    },
    deleteOvertime: function (id) {
      return run(function () {
        var row = db.overtime.find(function (o) { return o.id === id; });
        if (!row || !can('overtime', row.service_id)) fail("Vous n'avez pas le droit de modifier les heures supp.");
        db.overtime = db.overtime.filter(function (o) { return o.id !== id; }); audit('overtime_entries', null, 'DELETE', row);
      });
    },

    requests: function () {
      return ok(db.requests.filter(function (r) { return inCo(r.service_id) && (r.employee_id === me.id || r.created_by === me.id || can('requests', r.service_id)); }).filter(function (r) { return r.employee_id === me.id || r.created_by === me.id || can('requests', r.service_id); })
        .sort(function (a, b) { return b.created_at.localeCompare(a.created_at); }));
    },
    createRequest: function (r) {
      return run(function () {
        if (!me || role() === 'pending') fail('Compte non activé.');
        var p = profile(r.employee_id || me.id); if (!p) fail('Salarié introuvable.');
        var svc = p.service_id || svcsOf(p)[0]; if (!svc) fail("Ce salarié n'a pas de service.");
        if (r.start_date > r.end_date) fail('La date de fin doit suivre la date de début.');
        // saisie par l'encadrement pour un salarié, jamais par le salarié lui-même
        if (p.id === me.id && !isAdm()) fail('Les demandes sont saisies par votre manager.');
        if (!svcsOf(p).some(function (s) { return can('requests', s); })) fail('Vous ne pouvez saisir des demandes que pour les salariés que vous gérez.');
        if (['manager', 'assistant', 'admin'].indexOf(p.role) >= 0 && !isAdm()) fail("La demande d'un membre de l'encadrement est saisie par l'administrateur.");
        r = Object.assign({}, r);
        // CP en jours ouvrables : le 1er jour de repos qui suit la fin est décompté aussi
        if (r.type === 'cp') { var nx = C.addDays(r.end_date, 1); if (isoDow(nx) === cpRestDay(p) && C.countOuvrables(nx, nx) === 1) r.end_date = nx; }
        var days = r.type === 'cp' ? C.countOuvrables(r.start_date, r.end_date) : C.daysBetween(r.start_date, r.end_date) + 1;
        if (!days) fail('La période choisie ne contient aucun jour ouvrable.');
        var pending = db.requests.filter(function (x) { return x.employee_id === p.id && x.type === r.type && /^pending/.test(x.status); }).reduce(function (a, x) { return a + x.days; }, 0);
        if (r.type === 'cp' && days + pending > p.cp_balance) fail('Solde de congés insuffisant (' + p.cp_balance + ' j disponibles, ' + pending + ' j déjà demandés).');
        if (r.type === 'ferie' && days + pending > p.ferie_balance) fail('Solde de jours fériés insuffisant (' + p.ferie_balance + ' j disponibles).');
        if (r.type === 'recup' && days + pending > (p.recup_days || 0)) fail('Pas assez de jours à récupérer (' + (p.recup_days || 0) + ' j dus).');
        if (r.type === 'anciennete' && days + pending > (p.seniority_balance || 0)) fail("Solde de jours d'ancienneté insuffisant (" + (p.seniority_balance || 0) + ' j).');
        if (r.type === 'ot_day') { var b = otBalance(p.id); if ((days + pending) * ST().ot_day_minutes > b) fail("Solde d'heures supp insuffisant (" + C.fmt(Math.max(b, 0)) + ' disponibles).'); }
        var row = { id: uid(), employee_id: p.id, service_id: svc, type: r.type, start_date: r.start_date, end_date: r.end_date, days: days, comment: r.comment || '', status: 'pending_manager', created_by: me.id, created_at: nowIso() };
        db.requests.push(row); audit('requests', row, 'INSERT');
        if (notifyOn('request')) db.profiles.forEach(function (x) {
          if ((x.role === 'manager' || x.role === 'assistant') && x.id !== p.id && svcsOf(x).indexOf(svc) >= 0 && (ST().rights[x.role] || {}).requests)
            notify(x.id, 'Nouvelle demande', p.full_name + ' : ' + label(r.type) + ' du ' + dm(r.start_date) + ' au ' + dm(r.end_date) + ' (' + days + ' j).');
        });
        return row;
      });
    },
    decide: function (id, approve, reason) {
      return run(function () {
        var r = db.requests.find(function (x) { return x.id === id; });
        if (!r || !inCo(r.service_id)) fail('Demande introuvable.');
        if (!approve && !String(reason || '').trim()) fail('Indiquez le motif du refus.');
        var lbl = label(r.type) + ' du ' + dm(r.start_date) + ' au ' + dm(r.end_date), now = nowIso(), dec = notifyOn('decision');
        if (r.status === 'pending_manager') {
          if (!can('requests', r.service_id)) fail('Vous ne gérez pas les demandes de ce service.');
          if (r.employee_id === me.id && !isAdm()) fail('Vous ne pouvez pas valider votre propre demande.');
          if (!isAdm() && ['manager', 'assistant', 'admin'].indexOf((profile(r.employee_id) || {}).role) >= 0) fail("Les demandes de l'encadrement sont validées par l'administrateur.");
          r.manager_id = me.id; r.manager_at = now;
          if (!approve) { r.status = 'refused'; r.refusal_reason = reason; if (dec) notify(r.employee_id, 'Demande refusée', lbl + ' — ' + reason); }
          else if (r.type === 'cp' && !isAdm()) {
            r.status = 'pending_admin';
            if (dec) { notify(r.employee_id, 'Demande validée par votre manager', lbl + ' : en attente de la validation finale.'); db.profiles.forEach(function (p) { if (p.role === 'admin' && p.company_id === svcCo(r.service_id)) notify(p.id, 'Congés à valider', lbl + ' — validé par le manager.'); }); }
          } else { applyRequest(r); r.status = 'approved'; if (r.type === 'cp') { r.admin_id = me.id; r.admin_at = now; } if (dec) notify(r.employee_id, 'Demande acceptée', lbl); }
        } else if (r.status === 'pending_admin') {
          if (!isAdm()) fail("Seul l'administrateur peut donner la validation finale.");
          r.admin_id = me.id; r.admin_at = now;
          if (approve) { applyRequest(r); r.status = 'approved'; if (dec) notify(r.employee_id, 'Congés acceptés', lbl); }
          else { r.status = 'refused'; r.refusal_reason = reason; if (dec) notify(r.employee_id, 'Congés refusés', lbl + ' — ' + reason); }
        } else fail('Cette demande a déjà été traitée.');
        audit('requests', r, 'UPDATE');
        return r;
      });
    },
    cancel: function (id) {
      return run(function () {
        var r = db.requests.find(function (x) { return x.id === id && (x.employee_id === me.id || x.created_by === me.id || can('requests', x.service_id)); });
        if (!r || !/^pending/.test(r.status)) fail('Seule une demande en attente peut être annulée.');
        r.status = 'cancelled';
      });
    },

    auditEntries: function (limit) {
      if (!isAdm() || !adminRight('journal')) return ok([]);
      return ok(db.audit.filter(function (a) { return a.company_id === myCo(); }).reverse().slice(0, limit || 200).map(function (a) {
        var p = profile(a.actor);
        return { at: a.at, actor_name: p ? (p.role === 'developer' ? 'Développeur' : p.full_name) : 'Système', table_name: a.table_name, action: a.action, row_id: a.row_id, old_data: a.old_data, new_data: a.new_data };
      }));
    },
    /* ---- Entreprises ---- */
    companies: function () { return ok(db.companies.filter(function (c) { return role() === 'developer' || c.id === myCo(); })); },
    saveCompany: function (c) {
      return run(function () {
        var row, F = ['name', 'legal_name', 'siret', 'ape_code', 'vat_number', 'address', 'postal_code', 'city', 'country', 'phone', 'email', 'website', 'director', 'contact_name', 'contact_email', 'collective_agreement', 'category', 'rooms', 'notes'];
        if (c.id) {
          row = db.companies.find(function (x) { return x.id === +c.id; }); if (!row) fail('Entreprise introuvable.');
          if (!(role() === 'developer' || (isAdm() && row.id === myCo() && adminRight('company')))) fail('Accès refusé.');
        } else {
          if (role() !== 'developer') fail('Seul le développeur peut créer une entreprise.');
          var nm = String(c.name || '').trim(); if (!nm) fail("Indiquez le nom de l'entreprise.");
          row = { id: Math.max.apply(null, db.companies.map(function (x) { return x.id; })) + 1, name: nm, country: 'France', active: true, features: clone(((c.copy_from && db.companies.find(function (x) { return x.id === +c.copy_from; })) || {}).features || {}), created_at: nowIso() };
          db.companies.push(row);
          var src = c.copy_from ? db.settingsBy[+c.copy_from] : null, base = src ? clone(src) : clone(db.settingsBy[1]);
          if (!src) { base.rights = clone(DEFAULT_RIGHTS); base.day_types = {}; }
          db.settingsBy[row.id] = Object.assign(base, { id: row.id, hotel_name: nm, company_name: (c.legal_name || nm), presence_hotel_label: nm.toUpperCase(), pointage_title: nm.toUpperCase(), updated_at: nowIso() });
          var nextSvc = function () { return Math.max.apply(null, db.services.map(function (x) { return x.id; }).concat(0)) + 1; };
          var nextTpl = function () { return Math.max.apply(null, db.templates.map(function (x) { return x.id; }).concat(0)) + 1; };
          if (src) {
            db.services.filter(function (x) { return x.company_id === +c.copy_from && !x.archived; }).forEach(function (x) {
              var nid = nextSvc(); db.services.push({ id: nid, company_id: row.id, name: x.name, locations: clone(x.locations), sort: x.sort, archived: false, staffing: clone(x.staffing) });
              db.templates.filter(function (t) { return t.service_id === x.id; }).forEach(function (t) { db.templates.push(Object.assign(clone(t), { id: nextTpl(), company_id: row.id, service_id: nid })); });
            });
            db.templates.filter(function (t) { return t.company_id === +c.copy_from && !t.service_id; }).forEach(function (t) { db.templates.push(Object.assign(clone(t), { id: nextTpl(), company_id: row.id })); });
          } else (c.services || []).map(function (x) { return String(x).trim(); }).filter(Boolean).forEach(function (x, i) { db.services.push({ id: nextSvc(), company_id: row.id, name: x, locations: [], sort: i + 1, archived: false }); });
        }
        F.forEach(function (k) { if (k in c) row[k] = k === 'rooms' ? (c[k] === '' || c[k] == null ? null : +c[k]) : (String(c[k] == null ? '' : c[k]).trim() || (k === 'name' ? row.name : k === 'country' ? 'France' : null)); });
        if ('active' in c && role() === 'developer') row.active = !!c.active;
        if (c.features && typeof c.features === 'object' && role() === 'developer') row.features = clone(c.features);
        var st = db.settingsBy[row.id]; st.hotel_name = row.name; if (row.legal_name) st.company_name = row.legal_name;
        audit('companies', row, c.id ? 'UPDATE' : 'INSERT');
        return row;
      });
    },
    switchCompany: function (id) {
      return run(function () {
        if (role() !== 'developer') fail('Réservé au développeur.');
        if (!db.companies.some(function (c) { return c.id === +id; })) fail('Entreprise introuvable.');
        me.company_id = +id; return me;
      });
    },
    notifications: function () { return ok(db.notifications.filter(function (n) { return n.user_id === me.id; }).slice(0, 40)); },
    markAllRead: function () { return run(function () { db.notifications.forEach(function (n) { if (n.user_id === me.id && !n.read_at) n.read_at = nowIso(); }); }); },
    savePush: function () { return Promise.resolve(); }
  };
})();
