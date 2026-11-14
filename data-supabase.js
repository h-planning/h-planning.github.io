/* HPG — accès aux données réelles (Supabase).
   Les règles (droits, validation, soldes) sont appliquées par la base elle-même. */
(function () {
  'use strict';
  var cfg = window.RELEVE_CONFIG || {};
  if (!cfg.SUPABASE_URL || !window.supabase) return;
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var me = null;

  function must(res) {
    if (res.error) throw new Error(translate(res.error.message));
    return res.data;
  }
  function translate(m) {
    if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
    if (/Email not confirmed/i.test(m)) return 'Confirmez votre e-mail avec le lien reçu avant de vous connecter.';
    if (/User already registered/i.test(m)) return 'Un compte existe déjà avec cet e-mail.';
    if (/Password should be at least/i.test(m)) return 'Le mot de passe est trop court (8 caractères minimum).';
    if (/rate limit|seconds/i.test(m)) return 'Trop de tentatives. Patientez une minute puis réessayez.';
    if (/Signups not allowed for otp|User not found/i.test(m)) return 'Aucun compte avec cette adresse.';
    return m;
  }

  async function manageUser(body) {
    var r = await sb.functions.invoke('manage-user', { body: body });
    if (r.error) {
      var msg = r.error.message;
      try { var j = await r.error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
      if (/Failed to send|not found|404/i.test(msg)) msg = 'La fonction « manage-user » n\'est pas installée dans Supabase (guide, étape 6c).';
      throw new Error(msg);
    }
    if (r.data && r.data.error) throw new Error(r.data.error);
    return r.data;
  }

  function withServices(p) {
    if (!p) return p;
    p.services = (p.profile_services || []).map(function (x) { return x.service_id; }).sort(function (a, b) { return a - b; });
    delete p.profile_services; return p;
  }
  async function loadMe() {
    var u = (await sb.auth.getUser()).data.user;
    if (!u) { me = null; return null; }
    me = withServices(must(await sb.from('profiles').select('*, profile_services(service_id)').eq('id', u.id).maybeSingle()));
    // session ouverte sans le code e-mail : la base ne renvoie rien → on referme la session
    if (!me) { await sb.auth.signOut(); return null; }
    return me;
  }

  window.Store = {
    mode: 'live',
    me: function () { return me; },
    init: loadMe,
    onAuthChange: function (cb) { sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') cb(); }); },
    /* Étape 1 : mot de passe. Si le code e-mail est exigé, on referme la session et on envoie le code. */
    signIn: async function (email, pw) {
      must(await sb.auth.signInWithPassword({ email: email, password: pw }));
      var st = await sb.from('settings').select('require_email_code').limit(1).maybeSingle();  // paramètres de son entreprise
      if (st.data && st.data.require_email_code === false) { await loadMe(); return { needCode: false }; }
      await sb.auth.signOut();
      must(await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } }));
      return { needCode: true };
    },
    /* Étape 2 : code à 6 chiffres reçu par e-mail */
    verifyCode: async function (email, code) {
      var r = await sb.auth.verifyOtp({ email: email, token: code, type: 'email' });
      if (r.error) throw new Error(/expired|invalid/i.test(r.error.message) ? 'Code incorrect ou expiré. Demandez un nouveau code.' : translate(r.error.message));
      return loadMe();
    },
    resendCode: async function (email) {
      var r = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } });
      if (r.error) throw new Error(/seconds|rate/i.test(r.error.message) ? 'Patientez une minute avant de redemander un code.' : translate(r.error.message));
      return {};
    },
    signOut: async function () { await sb.auth.signOut(); me = null; },
    resetPassword: async function (email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
    updatePassword: async function (pw) { must(await sb.auth.updateUser({ password: pw })); },

    services: async function () { return must(await sb.from('services').select('*').order('sort').order('id')); },
    saveService: async function (s) {
      var row = { name: String(s.name || '').trim(), locations: s.locations || [], archived: !!s.archived };
      if (s.staffing !== undefined) row.staffing = s.staffing;
      if (s.sort != null) row.sort = s.sort;
      if (s.mark_code !== undefined) { row.mark_code = s.mark_code || null; row.mark_bg = s.mark_bg || null; row.mark_fg = s.mark_fg || null; }
      if (s.id) return must(await sb.from('services').update(row).eq('id', s.id).select().single());
      return must(await sb.from('services').insert(row).select().single());
    },
    deleteService: async function (id) {
      var r = await sb.from('services').delete().eq('id', id);
      if (r.error) throw new Error(/foreign key|violates/i.test(r.error.message) ? 'Ce service est encore utilisé (salariés, shifts ou semaines publiées) : archivez-le plutôt.' : translate(r.error.message));
    },
    templates: async function () { return must(await sb.from('shift_templates').select('*').order('sort')); },
    profiles: async function () { return must(await sb.from('profiles').select('*, profile_services(service_id)').order('full_name')).map(withServices); },
    lastSignIns: async function () { var m = {}; must(await sb.rpc('last_sign_ins')).forEach(function (r) { if (r.last_sign_in_at) m[r.id] = r.last_sign_in_at; }); return m; },
    updateProfile: async function (id, patch) { return must(await sb.rpc('update_profile', { p_id: id, p: patch })); },

    shifts: async function (from, to, f) {
      var q = sb.from('shifts').select('*').gte('day', from).lte('day', to).order('day').order('start_time');
      if (f && f.serviceId) q = q.eq('service_id', f.serviceId);
      if (f && f.employeeId) q = q.eq('employee_id', f.employeeId);
      return must(await q);
    },
    otherServiceDays: async function (svc, from, to) { var r = await sb.rpc('other_service_days', { p_svc: svc, p_from: from, p_to: to }); return r.error ? [] : r.data || []; },
    saveShift: async function (sh) {
      var row = Object.assign({}, sh); delete row.updated_at; delete row.updated_by;
      if (row.id) return must(await sb.from('shifts').update(row).eq('id', row.id).select().single());
      delete row.id;
      return must(await sb.from('shifts').insert(row).select().single());
    },
    deleteShift: async function (id) { must(await sb.from('shifts').delete().eq('id', id)); },
    /* Remplace en une seule opération (si la pose est refusée, rien ne change) */
    replaceCell: async function (deleteIds, sh) {
      var row = Object.assign({}, sh); delete row.id; delete row.updated_at; delete row.updated_by;
      return must(await sb.rpc('replace_cell', { p_delete: deleteIds || [], p_row: row }));
    },
    staffingValues: async function (svc, from, to) {
      return must(await sb.from('staffing_values').select('service_id,day,key,value').eq('service_id', svc).gte('day', from).lte('day', to));
    },
    saveStaffingValue: async function (svc, day, key, value) {
      if (value === null || value === '' || isNaN(value)) { must(await sb.from('staffing_values').delete().eq('service_id', svc).eq('day', day).eq('key', key)); return null; }
      return must(await sb.from('staffing_values').upsert({ service_id: svc, day: day, key: key, value: Math.max(0, Math.round(+value)), updated_at: new Date().toISOString() }).select().single());
    },
    /* collage depuis Excel : plusieurs valeurs en une fois ({ day, key, value|null }) */
    saveStaffingValues: async function (svc, list) {
      var up = list.filter(function (x) { return x.value != null; }).map(function (x) { return { service_id: svc, day: x.day, key: x.key, value: Math.max(0, Math.round(+x.value)), updated_at: new Date().toISOString() }; });
      var del = list.filter(function (x) { return x.value == null; });
      if (up.length) must(await sb.from('staffing_values').upsert(up));
      for (var i = 0; i < del.length; i++) must(await sb.from('staffing_values').delete().eq('service_id', svc).eq('day', del[i].day).eq('key', del[i].key));
      return up.length;
    },
    publishedMonths: async function (svc) {
      var q = sb.from('published_months').select('service_id,month,published_at');
      if (svc) q = q.eq('service_id', svc);
      return must(await q);
    },
    publishMonth: async function (svc, month) { must(await sb.rpc('publish_month', { p_service: svc, p_month: month.slice(0, 7) + '-01' })); },
    unpublishMonth: async function (svc, month) { must(await sb.rpc('unpublish_month', { p_service: svc, p_month: month.slice(0, 7) + '-01' })); },

    requests: async function () { return must(await sb.from('requests').select('*').order('created_at', { ascending: false })); },
    createRequest: async function (r) {
      var row = { type: r.type, start_date: r.start_date, end_date: r.end_date, comment: r.comment || null };
      if (r.employee_id) row.employee_id = r.employee_id;
      return must(await sb.from('requests').insert(row).select().single());
    },
    decide: async function (id, approve, reason) { return must(await sb.rpc('decide_request', { p_id: id, p_approve: approve, p_reason: reason || null })); },
    cancel: async function (id) { must(await sb.rpc('cancel_request', { p_id: id })); },


    overtime: async function (from, to, f) {
      var q = sb.from('overtime_entries').select('*').gte('day', from).lte('day', to).order('day', { ascending: false });
      if (f && f.serviceId) q = q.eq('service_id', f.serviceId);
      if (f && f.employeeId) q = q.eq('employee_id', f.employeeId);
      return must(await q);
    },
    saveOvertime: async function (o) {
      return must(await sb.from('overtime_entries').upsert({ shift_id: o.shift_id, minutes: o.minutes, reason: o.reason || null }, { onConflict: 'shift_id' }).select().single());
    },
    deleteOvertime: async function (id) { must(await sb.from('overtime_entries').delete().eq('id', id)); },
    otBalance: async function (empId) { return must(await sb.rpc('ot_balance', { p_emp: empId || me.id })); },

    settings: async function () { return must(await sb.from('settings').select('*').eq('id', me.company_id).single()); },
    saveSettings: async function (patch) { patch = Object.assign({}, patch); delete patch.id; return must(await sb.from('settings').update(patch).eq('id', me.company_id).select().single()); },

    /* Entreprises : l'administrateur voit et modifie la sienne ; le développeur les voit toutes, en crée et passe de l'une à l'autre */
    companies: async function () { return must(await sb.from('companies').select('*').order('id')); },
    saveCompany: async function (c) { return must(await sb.rpc('save_company', { p: c })); },
    switchCompany: async function (id) { must(await sb.rpc('set_my_company', { p_company: +id })); return loadMe(); },
    cpAccruals: async function () { return must(await sb.from('cp_accruals').select('*').order('period_end', { ascending: false }).limit(10)); },
    accrueCp: async function (day) { return must(await sb.rpc('accrue_cp', { p_date: day })); },
    seniorityCredits: async function () { return must(await sb.from('seniority_credits').select('*')); },
    accrueSeniority: async function (day) { return must(await sb.rpc('accrue_seniority', { p_date: day })); },
    auditEntries: async function (limit) { return must(await sb.rpc('audit_entries', { p_limit: limit || 200 })); },
    creditFerie: async function (ids, days, holiday, reason) { return must(await sb.rpc('credit_ferie', { p_ids: ids, p_days: days, p_holiday: holiday || null, p_reason: reason || null })); },
    owedDays: async function (f) {
      var q = sb.from('owed_days').select('*').order('origin_date', { ascending: true, nullsFirst: false });
      if (f && f.employeeId) q = q.eq('employee_id', f.employeeId);
      var rows = must(await q);
      if (f && f.serviceId) {
        var ids = must(await sb.from('profile_services').select('profile_id').eq('service_id', f.serviceId)).map(function (x) { return x.profile_id; });
        rows = rows.filter(function (o) { return ids.indexOf(o.employee_id) >= 0; });
      }
      return rows;
    },
    addOwed: async function (o) { return must(await sb.from('owed_days').insert({ employee_id: o.employee_id, type: o.type, origin_date: o.origin_date || null, days: o.days || 1, reason: o.reason || null }).select().single()); },
    deleteOwed: async function (id) { must(await sb.from('owed_days').delete().eq('id', id)); },
    /* Sans mot de passe : fiche seule (extra sans accès). Avec mot de passe : compte de connexion créé par la fonction manage-user. */
    addStaff: async function (p) {
      if (!p.access) return must(await sb.rpc('add_staff', { p: p }));
      return manageUser(Object.assign({ action: 'create' }, p));
    },
    applyWeeklyRest: async function (emp, from, to) { return must(await sb.rpc('apply_weekly_rest', { p_emp: emp, p_from: from, p_to: to })); },
    setUserPassword: async function (profileId) { return manageUser({ action: 'set_password', profile_id: profileId }); },
    pwChanged: async function () { must(await sb.rpc('pw_changed')); },
    saveTemplate: async function (t) {
      var row = { name: t.name, start_time: t.start_time, end_time: t.end_time, color: t.color, sort: t.sort || 0, service_id: t.service_id || null, active: t.active !== false, rooms: t.rooms == null || t.rooms === '' ? null : +t.rooms, label: t.label || null, bg: t.bg || null, fg: t.bg ? (t.fg || '#000000') : null };
      if (t.id) return must(await sb.from('shift_templates').update(row).eq('id', t.id).select().single());
      return must(await sb.from('shift_templates').insert(row).select().single());
    },
    deleteTemplate: async function (id) { must(await sb.from('shift_templates').delete().eq('id', id)); },

    /* Extras : registre (fiches) et contrats d'extra. Les contrats ne se suppriment pas (historique). */
    extras: async function () { return must(await sb.from('extras').select('*').order('last_name').order('first_name')); },
    saveExtra: async function (x) {
      var row = {}; ['services', 'profile_id', 'last_name', 'first_name', 'address', 'postal_code', 'city', 'phone', 'email', 'job_title', 'level', 'echelon', 'qualified', 'notes', 'archived'].forEach(function (k) { if (x[k] !== undefined) row[k] = x[k] === '' ? null : x[k]; });
      if (x.id) return must(await sb.from('extras').update(row).eq('id', x.id).select().single());
      return must(await sb.from('extras').insert(row).select().single());
    },
    deleteExtra: async function (id) {
      var r = await sb.from('extras').delete().eq('id', id);
      if (r.error) throw new Error(/foreign key|violates/i.test(r.error.message) ? 'Cet extra a des contrats : archivez sa fiche plutôt (les contrats restent dans l\'historique).' : translate(r.error.message));
    },
    extraContracts: async function (f) {
      var q = sb.from('extra_contracts').select('*').order('day', { ascending: false }).order('start_time');
      f = f || {};
      if (f.serviceId) q = q.eq('service_id', f.serviceId);
      if (f.shiftId) q = q.eq('shift_id', f.shiftId);
      if (f.extraId) q = q.eq('extra_id', f.extraId);
      if (f.from) q = q.gte('day', f.from);
      if (f.to) q = q.lte('day', f.to);
      return must(await q);
    },
    createExtraContract: async function (c) {
      return must(await sb.from('extra_contracts').insert({ service_id: c.service_id, extra_id: c.extra_id, shift_id: c.shift_id || null, day: c.day, start_time: c.start_time, end_time: c.end_time, break_min: c.break_min || 0, job_title: c.job_title || null }).select().single());
    },
    updateExtraContract: async function (id, patch) {
      var row = {}; ['day', 'start_time', 'end_time', 'break_min', 'job_title'].forEach(function (k) { if (patch[k] !== undefined) row[k] = patch[k]; });
      return must(await sb.from('extra_contracts').update(row).eq('id', id).select().single());
    },
    setExtraContractStatus: async function (id, status, reason) {
      var row = { status: status }; if (status === 'cancelled') row.cancel_reason = reason || null;
      return must(await sb.from('extra_contracts').update(row).eq('id', id).select().single());
    },
    markExtraPrinted: async function (id) { must(await sb.from('extra_contracts').update({ printed_at: new Date().toISOString() }).eq('id', id)); },

    notifications: async function () { return must(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(40)); },
    markAllRead: async function () { must(await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).eq('user_id', me.id)); },

    savePush: async function (sub) {
      var j = sub.toJSON();
      must(await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, user_id: me.id, subscription: j }));
    }
  };
})();
