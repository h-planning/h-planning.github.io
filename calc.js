/* Relève — logique de calcul des heures (convention HCR, contrat 39 h).
   Tout est calculé en minutes entières pour éviter les erreurs d'arrondi.
   Fichier sans dépendance : utilisé par l'application et par les tests. */
(function (root) {
  'use strict';

  var H = 60;
  var LEGAL = 35 * H;      // durée légale
  var T10_END = 39 * H;    // 36e → 39e heure : +10 %
  var T20_END = 43 * H;    // 40e → 43e heure : +20 % ; au-delà : +50 %
  var NIGHT_START = 22 * H; // travail de nuit HCR : 22 h – 7 h
  var NIGHT_END = 7 * H;
  var AUTO_BREAK_MIN = 30;
  var AUTO_BREAK_AFTER = 6 * H; // pause déduite si le shift dure plus de 6 h
  var CONTINGENT_H = 360;  // contingent annuel indicatif (hôtellerie)

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parseDate(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function addDays(s, n) { var d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function dow(s) { return parseDate(s).getUTCDay(); } // 0 = dimanche
  function toMin(t) { if (!t) return null; var p = String(t).split(':'); return (+p[0]) * H + (+p[1]); }
  function weekStart(s) { var w = dow(s); return addDays(s, w === 0 ? -6 : 1 - w); }
  function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 864e5); }

  /* Pâques (algorithme grégorien anonyme) */
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
        f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
        h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
        l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
        month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return y + '-' + pad(month) + '-' + pad(day);
  }
  var holidayCache = {};
  function holidays(y) {
    if (holidayCache[y]) return holidayCache[y];
    var e = easter(y), list = {};
    list[y + '-01-01'] = "Jour de l'an";
    list[addDays(e, 1)] = 'Lundi de Pâques';
    list[y + '-05-01'] = 'Fête du Travail';
    list[y + '-05-08'] = 'Victoire 1945';
    list[addDays(e, 39)] = 'Ascension';
    list[addDays(e, 50)] = 'Lundi de Pentecôte';
    list[y + '-07-14'] = 'Fête nationale';
    list[y + '-08-15'] = 'Assomption';
    list[y + '-11-01'] = 'Toussaint';
    list[y + '-11-11'] = 'Armistice';
    list[y + '-12-25'] = 'Noël';
    holidayCache[y] = list;
    return list;
  }
  function holidayName(s) { return holidays(+s.slice(0, 4))[s] || null; }

  /* Jours ouvrables (lundi → samedi, hors fériés) : unité de décompte des CP */
  function countOuvrables(start, end) {
    var n = 0;
    for (var d = start; d <= end; d = addDays(d, 1)) if (dow(d) !== 0 && !holidayName(d)) n++;
    return n;
  }

  function overlap(a1, a2, b1, b2) { return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)); }

  /* Détail d'un shift. Les heures réelles (corrigées par le manager) priment sur les prévues.
     Nuit / dimanche / férié sont calculés sur l'amplitude puis réduits au prorata de la pause. */
  function shiftDetail(sh) {
    var zero = { gross: 0, breakMin: 0, worked: 0, night: 0, sunday: 0, holiday: 0, corrected: false };
    // heures supplémentaires saisies à part par le manager : comptent comme du temps travaillé ce jour-là
    if (sh && sh.kind === 'ot') return { gross: +sh.minutes || 0, breakMin: 0, worked: +sh.minutes || 0, night: 0, sunday: 0, holiday: 0, corrected: false, extra: true };
    if (!sh || sh.kind !== 'work') return zero;
    var corrected = !!(sh.actual_start && sh.actual_end);
    var s = toMin(corrected ? sh.actual_start : sh.start_time);
    var e = toMin(corrected ? sh.actual_end : sh.end_time);
    if (s == null || e == null) return zero;
    if (e <= s) e += 24 * H; // shift qui passe minuit
    var gross = e - s;
    var explicitBreak = corrected ? sh.actual_break_min : sh.break_min;
    var br = (explicitBreak != null && explicitBreak !== '') ? +explicitBreak : (gross > AUTO_BREAK_AFTER ? AUTO_BREAK_MIN : 0);
    br = Math.min(br, gross);
    var worked = gross - br;
    var ratio = gross ? worked / gross : 0;

    var night = 0, sunday = 0, holiday = 0;
    // fenêtres de nuit : [-2h, 7h] (fin de la nuit précédente), [22h, 31h], [46h, 48h]
    night += overlap(s, e, -2 * H, NIGHT_END);
    night += overlap(s, e, NIGHT_START, 24 * H + NIGHT_END);
    night += overlap(s, e, 24 * H + NIGHT_START, 48 * H);
    var d0 = sh.day, d1 = addDays(sh.day, 1);
    var part0 = overlap(s, e, 0, 24 * H), part1 = overlap(s, e, 24 * H, 48 * H);
    if (dow(d0) === 0) sunday += part0;
    if (dow(d1) === 0) sunday += part1;
    if (holidayName(d0)) holiday += part0;
    if (holidayName(d1)) holiday += part1;

    return {
      gross: gross, breakMin: br, worked: worked,
      night: Math.round(night * ratio), sunday: Math.round(sunday * ratio), holiday: Math.round(holiday * ratio),
      corrected: corrected
    };
  }

  /* Début et fin absolus d'un shift prévu (minutes depuis une date de référence) */
  var EPOCH = '2000-01-03';
  function interval(sh) {
    if (!sh || sh.kind !== 'work' || !sh.start_time || !sh.end_time) return null;
    var base = daysBetween(EPOCH, sh.day) * 24 * H, s = toMin(sh.start_time), e = toMin(sh.end_time);
    if (e <= s) e += 24 * H;
    return { start: base + s, end: base + e };
  }
  /* Repos quotidien : vérifie un shift contre les autres shifts travaillés du même salarié.
     Renvoie null si tout va bien, sinon { type: 'overlap' | 'rest', other, gap (minutes) }. */
  function restCheck(sh, others, minRestHours) {
    var a = interval(sh); if (!a) return null;
    var min = Math.round((minRestHours == null ? 11 : minRestHours) * H), worst = null;
    (others || []).forEach(function (o) {
      if (o.id && o.id === sh.id) return;
      if (o.employee_id !== sh.employee_id) return;
      var b = interval(o); if (!b) return;
      if (a.start < b.end && b.start < a.end) { worst = { type: 'overlap', other: o, gap: 0 }; return; }
      var gap = a.start >= b.end ? a.start - b.end : b.start - a.end;
      if (gap < min && (!worst || (worst.type === 'rest' && gap < worst.gap))) worst = { type: 'rest', other: o, gap: gap };
    });
    return worst;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* Ventilation d'une semaine. contractHours = base du contrat (39 par défaut). */
  function weekStats(shifts, contractHours) {
    var contract = Math.round((contractHours == null ? 39 : contractHours) * H);
    var w = { worked: 0, night: 0, sunday: 0, holiday: 0, corrected: 0, days: 0 };
    var seenDays = {};
    (shifts || []).forEach(function (sh) {
      var d = shiftDetail(sh);
      w.worked += d.worked; w.night += d.night; w.sunday += d.sunday; w.holiday += d.holiday;
      if (d.corrected) w.corrected++;
      if ((sh.kind === 'work' || sh.kind === 'ot') && !seenDays[sh.day]) { seenDays[sh.day] = 1; w.days++; }
    });
    var h = w.worked;
    // tranches légales de majoration (HCR)
    w.t10 = clamp(h - LEGAL, 0, T10_END - LEGAL);
    w.t20 = clamp(h - T10_END, 0, T20_END - T10_END);
    w.t50 = Math.max(0, h - T20_END);
    w.overLegal = w.t10 + w.t20 + w.t50;          // compte dans le contingent annuel
    // heures au-delà du contrat (celles qui alimentent le compteur payé / récupéré)
    var beyond = Math.max(0, h - contract);
    w.beyondContract = beyond;
    var b10 = overlap(contract, h, LEGAL, T10_END);
    var b20 = overlap(contract, h, T10_END, T20_END);
    var b50 = overlap(contract, h, T20_END, Infinity);
    w.beyondSplit = { t10: b10, t20: b20, t50: b50 };
    // équivalent en repos si l'employé choisit la récupération (heure majorée = repos majoré)
    w.recupCredit = Math.round(b10 * 1.1 + b20 * 1.2 + b50 * 1.5);
    w.missing = Math.max(0, contract - h); // heures non faites par rapport au contrat (info)
    return w;
  }

  /* Regroupe une liste de shifts par semaine (clé = lundi). */
  function groupByWeek(shifts) {
    var g = {};
    (shifts || []).forEach(function (sh) { var k = weekStart(sh.day); (g[k] = g[k] || []).push(sh); });
    return g;
  }

  /* Synthèse annuelle d'un employé.
     choices : { 'AAAA-MM-JJ' (lundi) : 'pay' | 'recup' } ; défaut = payé.
     recupTaken : minutes de récupération déjà posées (demandes validées).
     uptoWeek : on ne crédite que les semaines terminées avant ce lundi. */
  function yearSummary(shifts, contractHours, choices, opts) {
    opts = opts || {};
    var year = opts.year, upto = opts.uptoWeek || '9999-12-31';
    var weeks = groupByWeek(shifts.filter(function (s) { return !year || +weekStart(s.day).slice(0, 4) === year || +s.day.slice(0, 4) === year; }));
    var keys = Object.keys(weeks).sort();
    var tot = { worked: 0, t10: 0, t20: 0, t50: 0, overLegal: 0, beyondContract: 0, paid: 0, recupEarned: 0, night: 0, sunday: 0, holiday: 0 };
    var list = keys.map(function (k) {
      var w = weekStats(weeks[k], contractHours);
      var choice = (choices && choices[k]) || 'pay';
      var closed = k < upto;
      ['worked', 't10', 't20', 't50', 'overLegal', 'beyondContract', 'night', 'sunday', 'holiday'].forEach(function (f) { tot[f] += w[f]; });
      if (closed && w.beyondContract) {
        if (choice === 'recup') tot.recupEarned += w.recupCredit; else tot.paid += w.beyondContract;
      }
      return { week: k, stats: w, choice: choice, closed: closed };
    });
    tot.contingentUsedH = tot.overLegal / H;
    tot.contingentH = opts.contingentH || CONTINGENT_H;
    tot.recupBalance = tot.recupEarned - (opts.recupTaken || 0) + (opts.recupAdjust || 0);
    return { weeks: list, totals: tot };
  }

  /* Congés acquis sur une période [ps, pe] (incluse) depuis la date d'entrée :
     rate jours par mois de présence, arrondi au jour supérieur, plafonné à 30 (même règle que la base). */
  function addMonths(s, m) { var d = parseDate(s), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m);
    var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return iso(d); }
  function cpMonths(hire, ps, pe) {
    if (!hire) return 0;
    var s = hire > ps ? hire : ps, end = addDays(pe, 1);
    if (s > pe) return 0;
    var m = 0; while (addMonths(s, m + 1) <= end) m++;
    return m + daysBetween(addMonths(s, m), end) / 30;
  }
  function cpEarned(hire, ps, pe, rate, exact, cap) {
    var v = (rate == null ? 2.5 : rate) * cpMonths(hire, ps, pe);
    return Math.min(cap == null ? 30 : cap, exact ? Math.floor(v * 10) / 10 : Math.ceil(v - 1e-6));
  }
  /* Années révolues entre deux dates (ancienneté) */
  function yearsBetween(a, b) {
    if (!a || !b || b < a) return 0;
    var y = +b.slice(0, 4) - +a.slice(0, 4);
    if (b.slice(5) < a.slice(5)) y--;
    return y;
  }
  /* Règles de pause réglables (Paramètres) : pause de breakMin minutes si le shift dépasse breakAfter minutes */
  function setRules(r) {
    if (!r) return;
    if (r.break_threshold_min != null) AUTO_BREAK_AFTER = +r.break_threshold_min;
    if (r.break_min != null) AUTO_BREAK_MIN = +r.break_min;
  }
  /* Dernière date de crédit (1er mai par défaut) au plus tard le jour donné */
  function cpLastCredit(day, month, dom) {
    var y = +day.slice(0, 4), d = y + '-' + pad(month || 5) + '-' + pad(dom || 1);
    return d <= day ? d : (y - 1) + d.slice(4);
  }

  function fmt(min, signed) {
    if (min == null || isNaN(min)) return '–';
    var neg = min < 0; min = Math.abs(Math.round(min));
    var s = Math.floor(min / H) + 'h' + pad(min % H);
    return (neg ? '−' : (signed && min ? '+' : '')) + s;
  }

  var api = {
    H: H, LEGAL: LEGAL, CONTINGENT_H: CONTINGENT_H,
    iso: iso, parseDate: parseDate, addDays: addDays, dow: dow, toMin: toMin, weekStart: weekStart, daysBetween: daysBetween,
    easter: easter, holidays: holidays, holidayName: holidayName, countOuvrables: countOuvrables,
    shiftDetail: shiftDetail, interval: interval, restCheck: restCheck, weekStats: weekStats, groupByWeek: groupByWeek, yearSummary: yearSummary, fmt: fmt, addMonths: addMonths, cpMonths: cpMonths, cpEarned: cpEarned, cpLastCredit: cpLastCredit, yearsBetween: yearsBetween, setRules: setRules
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Calc = api;
})(typeof window !== 'undefined' ? window : this);
