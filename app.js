/* ==========================================================================
   Suivi congés — appli de planification des congés de stage
   Sommaire :
     1. Dates (ISO AAAA-MM-JJ, calculs en UTC pour éviter les soucis d'heure d'été)
     2. Jours fériés (Allemagne – NRW, France)
     3. Calculs (acquisition, décompte, soldes, périodes, ponts)
     4. Formatage
     5. Stockage (localStorage + export / import JSON)
     6. Interface
   ========================================================================== */

const APP_VERSION = '1.0.0'; // affichée en haut de l'écran ; garder identique à VERSION dans sw.js

/* ==========================================================================
   1. DATES
   ========================================================================== */
const Dates = {
  /** 'AAAA-MM-JJ' → Date UTC à minuit */
  parse(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  },
  iso(date) { return date.toISOString().slice(0, 10); },
  today() {
    const n = new Date();
    return Dates.iso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
  },
  isValid(iso) {
    return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) && Dates.iso(Dates.parse(iso)) === iso;
  },
  addDays(iso, n) {
    const d = Dates.parse(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return Dates.iso(d);
  },
  /** Ajoute n mois ; le jour est ramené au dernier jour du mois si besoin (31/01 + 1 mois → 28/02). */
  addMonths(iso, n) {
    const d = Dates.parse(iso);
    const day = d.getUTCDate();
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return Dates.iso(t);
  },
  diffDays(a, b) { return Math.round((Dates.parse(b) - Dates.parse(a)) / 86400000); },
  /** 0 = lundi … 6 = dimanche */
  weekday(iso) { return (Dates.parse(iso).getUTCDay() + 6) % 7; },
  /** Itère de a à b inclus */
  *range(a, b) {
    for (let d = a; d <= b; d = Dates.addDays(d, 1)) yield d;
  },
};

/* ==========================================================================
   2. JOURS FÉRIÉS
   ========================================================================== */
const Holidays = {
  REGIONS: {
    'DE-NW': 'Allemagne – Rhénanie-du-Nord-Westphalie',
    'FR': 'France',
    'none': 'Aucun',
  },

  /** Dimanche de Pâques (algorithme grégorien anonyme) */
  easter(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },

  /** { 'AAAA-MM-JJ': 'Nom' } pour une année et une région */
  forYear(year, region) {
    const E = Holidays.easter(year);
    const p = (md) => `${year}-${md}`;
    const r = (n) => Dates.addDays(E, n);
    if (region === 'DE-NW') {
      return {
        [p('01-01')]: 'Nouvel An (Neujahr)',
        [r(-2)]: 'Vendredi saint (Karfreitag)',
        [r(1)]: 'Lundi de Pâques (Ostermontag)',
        [p('05-01')]: 'Fête du Travail (Tag der Arbeit)',
        [r(39)]: 'Ascension (Christi Himmelfahrt)',
        [r(50)]: 'Lundi de Pentecôte (Pfingstmontag)',
        [r(60)]: 'Fête-Dieu (Fronleichnam)',
        [p('10-03')]: 'Fête de l\'Unité allemande',
        [p('11-01')]: 'Toussaint (Allerheiligen)',
        [p('12-25')]: 'Noël (1. Weihnachtstag)',
        [p('12-26')]: 'Saint-Étienne (2. Weihnachtstag)',
      };
    }
    if (region === 'FR') {
      return {
        [p('01-01')]: 'Jour de l\'An',
        [r(1)]: 'Lundi de Pâques',
        [p('05-01')]: 'Fête du Travail',
        [p('05-08')]: 'Victoire 1945',
        [r(39)]: 'Ascension',
        [r(50)]: 'Lundi de Pentecôte',
        [p('07-14')]: 'Fête nationale',
        [p('08-15')]: 'Assomption',
        [p('11-01')]: 'Toussaint',
        [p('11-11')]: 'Armistice 1918',
        [p('12-25')]: 'Noël',
      };
    }
    return {};
  },

  /** Fériés entre deux dates (incluses) */
  between(a, b, region) {
    const out = {};
    const y0 = Number(a.slice(0, 4)), y1 = Number(b.slice(0, 4));
    for (let y = y0; y <= y1; y++) {
      for (const [d, name] of Object.entries(Holidays.forYear(y, region))) {
        if (d >= a && d <= b) out[d] = name;
      }
    }
    return out;
  },
};

/* ==========================================================================
   3. CALCULS
   ========================================================================== */
const Calc = {
  /** Arrondi au demi-jour supérieur (tolérance pour les erreurs d'arrondi flottant) */
  ceilHalf(x) { return Math.ceil(x * 2 - 1e-9) / 2; },

  /** Durée du stage en mois (fraction du dernier mois au prorata des jours) */
  stageMonths(start, end) {
    const endEx = Dates.addDays(end, 1);
    if (endEx <= start) return 0;
    let m = 0;
    while (Dates.addMonths(start, m + 1) <= endEx) m++;
    const from = Dates.addMonths(start, m), to = Dates.addMonths(start, m + 1);
    return m + Dates.diffDays(from, endEx) / Dates.diffDays(from, to);
  },

  /** Mois de stage entièrement écoulés au soir du jour `asOf` */
  completedMonths(start, end, asOf) {
    if (asOf < start) return 0;
    if (asOf >= end) return Calc.stageMonths(start, end);
    let m = 0;
    while (Dates.addDays(Dates.addMonths(start, m + 1), -1) <= asOf) m++;
    return m;
  },

  /** Total de jours acquis sur tout le stage (+ ajustement manuel) */
  totalEntitlement(s) {
    return Calc.ceilHalf(s.rate * Calc.stageMonths(s.start, s.end)) + s.adjust;
  },

  /** Jours acquis au soir du jour `asOf` (acquisition mois après mois) */
  acquiredAt(s, asOf) {
    return Calc.ceilHalf(s.rate * Calc.completedMonths(s.start, s.end, asOf)) + s.adjust;
  },

  /**
   * Contexte de calcul : fériés + jours offerts + fonction « jour travaillé ».
   * Un congé ne se pose (et ne se décompte) que sur un jour travaillé du stage.
   */
  context(s) {
    const holidays = Holidays.between(s.start, s.end, s.region);
    const closed = new Set(s.closedDays || []);
    const workDays = s.countSaturday ? 6 : 5;
    const isWorkday = (d) => d >= s.start && d <= s.end && Dates.weekday(d) < workDays && !holidays[d] && !closed.has(d);
    return { holidays, closed, isWorkday };
  },

  /** Jours posés valides, triés : [{ date, value }] */
  placed(state, ctx = Calc.context(state.settings)) {
    return Object.entries(state.days)
      .filter(([d, v]) => v > 0 && ctx.isWorkday(d))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, value]) => ({ date, value }));
  },

  /** Nombre de jours travaillés dans le stage */
  workdayCount(s, ctx = Calc.context(s)) {
    let n = 0;
    for (const d of Dates.range(s.start, s.end)) if (ctx.isWorkday(d)) n++;
    return n;
  },

  /**
   * Bilan global. `today` : date du jour (les jours posés avant ou ce jour-là
   * sont « pris », les suivants « prévus »).
   * Chaque jour posé reçoit `advance` = true s'il est posé avant d'avoir été acquis.
   */
  summary(state, today) {
    const s = state.settings;
    const ctx = Calc.context(s);
    const list = Calc.placed(state, ctx);
    const total = Calc.totalEntitlement(s);
    let cum = 0, taken = 0, planned = 0, advanceCount = 0;
    const days = list.map(({ date, value }) => {
      cum += value;
      if (date <= today) taken += value; else planned += value;
      // Acquis la veille au soir = disponible ce jour-là
      const advance = cum > Calc.acquiredAt(s, Dates.addDays(date, -1)) + 1e-9;
      if (advance) advanceCount++;
      return { date, value, advance };
    });
    const acquiredToday = Calc.acquiredAt(s, today);
    return {
      total,
      placed: taken + planned,
      taken,
      planned,
      remaining: total - taken - planned,
      acquiredToday,
      balanceToday: acquiredToday - taken,
      days,
      advanceCount,
      overbooked: taken + planned > total + 1e-9,
    };
  },

  /** Tableau mois par mois : acquis cumulés, posés dans le mois, solde en fin de mois */
  monthly(state) {
    const s = state.settings;
    const list = Calc.placed(state);
    const rows = [];
    let cursor = s.start.slice(0, 7) + '-01';
    let cum = 0;
    while (cursor <= s.end) {
      const monthEnd = Dates.addDays(Dates.addMonths(cursor, 1), -1);
      const last = monthEnd < s.end ? monthEnd : s.end;
      const used = list.filter((x) => x.date.slice(0, 7) === cursor.slice(0, 7)).reduce((a, x) => a + x.value, 0);
      cum += used;
      const acquired = Calc.acquiredAt(s, last);
      rows.push({ month: cursor.slice(0, 7), used, cumUsed: cum, acquired, balance: acquired - cum });
      cursor = Dates.addMonths(cursor, 1);
    }
    return rows;
  },

  /**
   * Regroupe les jours posés en périodes d'absence : deux congés séparés
   * seulement par des week-ends / fériés font partie de la même période.
   * `offFrom`/`offTo` étendent la période aux jours non travaillés qui l'entourent.
   */
  periods(state) {
    const s = state.settings;
    const ctx = Calc.context(s);
    const list = Calc.placed(state, ctx);
    const periods = [];
    const isOff = (d) => !ctx.isWorkday(d) || (state.days[d] || 0) >= 1;
    for (const { date, value } of list) {
      const cur = periods[periods.length - 1];
      let joined = false;
      if (cur) {
        // Tous les jours entre la fin de la période et ce jour sont-ils non travaillés ?
        joined = true;
        for (let d = Dates.addDays(cur.to, 1); d < date; d = Dates.addDays(d, 1)) {
          if (ctx.isWorkday(d)) { joined = false; break; }
        }
        // Une demi-journée coupe la continuité du repos
        if (joined && (state.days[cur.to] < 1 || value < 1)) joined = false;
      }
      if (joined) { cur.to = date; cur.days += value; }
      else periods.push({ from: date, to: date, days: value });
    }
    const limitA = Dates.addDays(s.start, -7), limitB = Dates.addDays(s.end, 7);
    for (const p of periods) {
      let a = p.from, b = p.to;
      if (state.days[a] >= 1) while (Dates.addDays(a, -1) >= limitA && isOffAround(Dates.addDays(a, -1))) a = Dates.addDays(a, -1);
      if (state.days[b] >= 1) while (Dates.addDays(b, 1) <= limitB && isOffAround(Dates.addDays(b, 1))) b = Dates.addDays(b, 1);
      p.offFrom = a; p.offTo = b;
      p.offDays = Dates.diffDays(a, b) + 1;
    }
    return periods;

    // Hors stage : on considère seulement les week-ends et fériés comme libres
    function isOffAround(d) {
      if (d >= s.start && d <= s.end) return isOff(d);
      const wd = Dates.weekday(d);
      return wd >= (s.countSaturday ? 6 : 5) || !!Holidays.between(d, d, s.region)[d];
    }
  },

  /**
   * Ponts : férié un mardi → poser le lundi ; un jeudi → poser le vendredi.
   * Renvoie [{ holiday, name, bridge, gain }] (gain = jours de repos d'affilée pour 1 jour posé).
   */
  bridges(state) {
    const s = state.settings;
    const ctx = Calc.context(s);
    const out = [];
    for (const [date, name] of Object.entries(ctx.holidays).sort()) {
      const wd = Dates.weekday(date);
      let bridge = null;
      if (wd === 1) bridge = Dates.addDays(date, -1);
      if (wd === 3) bridge = Dates.addDays(date, 1);
      if (bridge && ctx.isWorkday(bridge)) {
        out.push({ holiday: date, name, bridge, gain: 4, placed: (state.days[bridge] || 0) > 0 });
      }
    }
    return out;
  },

  /** Valeur suivante quand on touche un jour : rien → journée → demi-journée → rien */
  nextValue(v) {
    if (!v) return 1;
    if (v === 1) return 0.5;
    return 0;
  },
};

/* ==========================================================================
   4. FORMATAGE
   ========================================================================== */
const Fmt = {
  num(x) {
    const r = Math.round(x * 100) / 100;
    return r.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  },
  days(x) {
    const n = Fmt.num(x);
    return `${n} j`;
  },
  daysLong(x) { return `${Fmt.num(x)} jour${Math.abs(x) >= 2 ? 's' : ''}`; },
  date(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
    return Dates.parse(iso).toLocaleDateString('fr-FR', { ...opts, timeZone: 'UTC' });
  },
  dateLong(iso) { return Fmt.date(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); },
  month(ym) {
    const s = Dates.parse(ym + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  monthShort(ym) {
    return Dates.parse(ym + '-01').toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' });
  },
  parseNumber(str) {
    const n = Number(String(str).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  },
};

/* ==========================================================================
   5. STOCKAGE
   ========================================================================== */
const Store = {
  KEY: 'suivi-conges:v1',

  defaults(today = Dates.today()) {
    // Par défaut : stage de 6 mois commençant le 1er du mois courant
    const start = today.slice(0, 7) + '-01';
    return {
      settings: {
        start,
        end: Dates.addDays(Dates.addMonths(start, 6), -1),
        rate: 2.5,
        adjust: 0,
        region: 'DE-NW',
        countSaturday: false,
        closedDays: [],
        configured: false,
      },
      days: {},
      theme: 'dark',
      lastExport: null,
    };
  },

  /** Nettoie des données lues (localStorage ou import) ; lève une erreur si inexploitable */
  sanitize(data) {
    if (!data || typeof data !== 'object' || !data.settings || typeof data.days !== 'object') {
      throw new Error('fichier non reconnu');
    }
    const def = Store.defaults();
    const s = data.settings;
    const settings = {
      start: Dates.isValid(s.start) ? s.start : def.settings.start,
      end: Dates.isValid(s.end) ? s.end : def.settings.end,
      rate: Number.isFinite(s.rate) && s.rate >= 0 ? s.rate : def.settings.rate,
      adjust: Number.isFinite(s.adjust) ? s.adjust : 0,
      region: Holidays.REGIONS[s.region] ? s.region : def.settings.region,
      countSaturday: !!s.countSaturday,
      closedDays: Array.isArray(s.closedDays) ? [...new Set(s.closedDays.filter(Dates.isValid))].sort() : [],
      configured: !!s.configured,
    };
    if (settings.end < settings.start) settings.end = Dates.addDays(Dates.addMonths(settings.start, 6), -1);
    const days = {};
    for (const [d, v] of Object.entries(data.days)) {
      if (Dates.isValid(d) && (v === 1 || v === 0.5)) days[d] = v;
    }
    return {
      settings,
      days,
      theme: data.theme === 'light' ? 'light' : 'dark',
      lastExport: Dates.isValid(data.lastExport) ? data.lastExport : null,
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(Store.KEY);
      if (raw) return Store.sanitize(JSON.parse(raw));
    } catch (e) { console.warn('Données illisibles, valeurs par défaut', e); }
    return Store.defaults();
  },

  save(state) {
    try { localStorage.setItem(Store.KEY, JSON.stringify(state)); }
    catch (e) { App.toast('Enregistrement impossible (stockage plein ?)'); }
  },
};

/* ==========================================================================
   6. INTERFACE
   ========================================================================== */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const App = {
  state: null,
  today: null,

  init() {
    App.state = Store.load();
    App.today = Dates.today();
    App.applyTheme();
    $('version-badge').textContent = `v${APP_VERSION}`;
    $('app-version').textContent = `Suivi congés v${APP_VERSION}`;
    App.bindTabs();
    App.bindCalendar();
    App.bindSettings();
    App.bindRangeDialog();
    App.fillSettings();
    App.renderAll();
    App.registerServiceWorker();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    // Premier lancement : direction les réglages pour saisir les dates du stage
    if (!App.state.settings.configured) App.showView('settings');
    // Au retour dans l'appli (le lendemain…), « aujourd'hui » change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Dates.today() !== App.today) {
        App.today = Dates.today();
        App.renderAll();
      }
    });
  },

  persist() { Store.save(App.state); },

  renderAll() {
    App.renderSummary();
    App.renderCalendar();
    App.renderReport();
  },

  /* ---------- Onglets ---------- */
  bindTabs() {
    document.querySelectorAll('.tabbar a').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        App.showView(a.dataset.view);
      });
    });
  },

  showView(name) {
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
    $('view-title').textContent = $(`view-${name}`).dataset.title;
    window.scrollTo(0, 0);
    if (name === 'calendar') App.scrollToToday();
  },

  /* ---------- Résumé (haut du calendrier) ---------- */
  renderSummary() {
    const sum = Calc.summary(App.state, App.today);
    App.sum = sum;
    $('kpi-remaining').textContent = Fmt.num(sum.remaining);
    $('kpi-remaining').classList.toggle('neg', sum.remaining < 0);
    $('kpi-remaining-label').textContent = sum.remaining < 0
      ? `jour${sum.remaining <= -2 ? 's' : ''} de trop`
      : `jour${sum.remaining >= 2 ? 's' : ''} restant${sum.remaining >= 2 ? 's' : ''} à placer`;
    if (sum.remaining < 0) $('kpi-remaining').textContent = Fmt.num(-sum.remaining);
    $('kpi-total').textContent = Fmt.days(sum.total);
    $('kpi-taken').textContent = Fmt.days(sum.taken);
    $('kpi-planned').textContent = Fmt.days(sum.planned);

    // Jauge : pris | prévus | restants
    const t = Math.max(sum.total, sum.placed, 0.0001);
    $('gauge-taken').style.width = `${(sum.taken / t) * 100}%`;
    $('gauge-planned').style.width = `${(sum.planned / t) * 100}%`;
    $('gauge-free').style.width = `${(Math.max(sum.remaining, 0) / t) * 100}%`;

    // Version courte ici (le résumé reste affiché en haut), explication dans le Bilan
    const warn = [];
    if (sum.overbooked) warn.push(`⚠︎ ${Fmt.daysLong(sum.placed - sum.total)} de trop`);
    if (sum.advanceCount) warn.push(`⚠︎ ${sum.advanceCount} jour${sum.advanceCount > 1 ? 's' : ''} en avance sur l'acquisition`);
    $('summary-warning').hidden = !warn.length;
    $('summary-warning').textContent = warn.join(' · ');
  },

  /* ---------- Calendrier ---------- */
  bindCalendar() {
    $('calendar').addEventListener('click', (e) => {
      const cell = e.target.closest('button.day');
      if (!cell) return;
      const d = cell.dataset.date;
      const ctx = App.ctx;
      if (ctx.holidays[d]) { App.toast(`Férié : ${ctx.holidays[d]}`); return; }
      if (ctx.closed.has(d)) { App.toast('Jour offert / fermeture'); return; }
      if (!ctx.isWorkday(d)) return;
      const v = Calc.nextValue(App.state.days[d]);
      if (v) App.state.days[d] = v; else delete App.state.days[d];
      App.persist();
      App.renderSummary();
      App.renderCalendar();
      App.renderReport();
      App.toast(v === 1 ? `${Fmt.date(d)} : journée posée` : v === 0.5 ? `${Fmt.date(d)} : demi-journée` : `${Fmt.date(d)} : retiré`);
    });
    $('btn-range').addEventListener('click', () => App.openRange());
    $('btn-today').addEventListener('click', () => App.scrollToToday(true));
  },

  renderCalendar() {
    const s = App.state.settings;
    const ctx = Calc.context(s);
    App.ctx = ctx;
    const advance = new Set(App.sum.days.filter((x) => x.advance).map((x) => x.date));
    const wdNames = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    let html = '';
    let cursor = s.start.slice(0, 7) + '-01';
    while (cursor <= s.end) {
      const ym = cursor.slice(0, 7);
      const monthEnd = Dates.addDays(Dates.addMonths(cursor, 1), -1);
      const used = App.sum.days.filter((x) => x.date.slice(0, 7) === ym).reduce((a, x) => a + x.value, 0);
      html += `<section class="month card" id="m-${ym}"><div class="month-head"><h3>${Fmt.month(ym)}</h3>`
        + `<span class="month-used">${used ? Fmt.days(used) + ' posé' + (used >= 2 ? 's' : '') : ''}</span></div>`
        + `<div class="grid">${wdNames.map((n, i) => `<span class="wd${i >= 5 ? ' we' : ''}">${n}</span>`).join('')}`;
      for (let i = 0; i < Dates.weekday(cursor); i++) html += '<span></span>';
      for (const d of Dates.range(cursor, monthEnd)) {
        const inStage = d >= s.start && d <= s.end;
        const v = App.state.days[d] || 0;
        const cls = ['day'];
        let label = Fmt.dateLong(d);
        if (!inStage) cls.push('out');
        else if (ctx.holidays[d]) { cls.push('holiday'); label += `, férié : ${ctx.holidays[d]}`; }
        else if (ctx.closed.has(d)) { cls.push('closed'); label += ', jour offert'; }
        else if (!ctx.isWorkday(d)) cls.push('weekend');
        else if (v) {
          cls.push(v === 1 ? 'leave' : 'half', d <= App.today ? 'taken' : 'planned');
          if (advance.has(d)) cls.push('advance');
          label += v === 1 ? ', congé' : ', demi-journée de congé';
        }
        if (d === App.today) cls.push('today');
        const disabled = !inStage ? ' disabled' : '';
        html += `<button type="button" class="${cls.join(' ')}" data-date="${d}" aria-label="${esc(label)}"${disabled}>${Number(d.slice(8))}</button>`;
      }
      html += '</div></section>';
      cursor = Dates.addMonths(cursor, 1);
    }
    $('calendar').innerHTML = html;
    $('stage-range').textContent = `Stage du ${Fmt.date(s.start, { day: 'numeric', month: 'long', year: 'numeric' })} au ${Fmt.date(s.end, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  },

  scrollToToday(smooth) {
    const s = App.state.settings;
    const target = App.today < s.start ? s.start : App.today > s.end ? s.end : App.today;
    const el = $(`m-${target.slice(0, 7)}`);
    if (!el) return;
    if (!smooth && target.slice(0, 7) === s.start.slice(0, 7)) return; // déjà en haut
    const y = el.getBoundingClientRect().top + window.scrollY - 76;
    window.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' });
  },

  /* ---------- Poser une période ---------- */
  bindRangeDialog() {
    $('range-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const from = f.from.value, to = f.to.value;
      if (!Dates.isValid(from) || !Dates.isValid(to) || to < from) { $('range-error').textContent = 'Dates invalides.'; return; }
      const ctx = Calc.context(App.state.settings);
      let n = 0;
      for (const d of Dates.range(from, to)) {
        if (!ctx.isWorkday(d)) continue;
        if (f.mode.value === 'remove') { if (App.state.days[d]) { delete App.state.days[d]; n++; } }
        else if (App.state.days[d] !== 1) { App.state.days[d] = 1; n++; }
      }
      App.persist();
      $('range-dialog').close();
      App.renderAll();
      App.toast(f.mode.value === 'remove' ? `${n} jour(s) retiré(s)` : `${n} jour(s) posé(s)`);
    });
    $('range-form').addEventListener('input', App.updateRangePreview);
    $('btn-range-cancel').addEventListener('click', () => $('range-dialog').close());
  },

  openRange(from, to) {
    const f = $('range-form');
    const s = App.state.settings;
    const def = App.today >= s.start && App.today <= s.end ? App.today : s.start;
    f.from.value = from || def;
    f.to.value = to || from || def;
    f.from.min = f.to.min = s.start;
    f.from.max = f.to.max = s.end;
    f.mode.value = 'add';
    $('range-error').textContent = '';
    App.updateRangePreview();
    $('range-dialog').showModal();
  },

  updateRangePreview() {
    const f = $('range-form');
    const from = f.from.value, to = f.to.value;
    const out = $('range-preview');
    if (!Dates.isValid(from) || !Dates.isValid(to) || to < from) { out.textContent = ''; return; }
    const ctx = Calc.context(App.state.settings);
    let work = 0, newDays = 0;
    for (const d of Dates.range(from, to)) {
      if (!ctx.isWorkday(d)) continue;
      work++;
      if (f.mode.value === 'remove') newDays += App.state.days[d] || 0;
      else newDays += 1 - (App.state.days[d] || 0);
    }
    const span = Dates.diffDays(from, to) + 1;
    out.textContent = f.mode.value === 'remove'
      ? `${Fmt.daysLong(newDays)} rendu${newDays >= 2 ? 's' : ''}.`
      : `${span} jour${span > 1 ? 's' : ''} calendaire${span > 1 ? 's' : ''}, ${work} jour${work > 1 ? 's' : ''} travaillé${work > 1 ? 's' : ''} → coûte ${Fmt.daysLong(newDays)} de congé. Il t'en resterait ${Fmt.num(App.sum.remaining - newDays)}.`;
  },

  /* ---------- Bilan ---------- */
  renderReport() {
    const s = App.state.settings;
    const sum = App.sum;
    $('rep-acquired').textContent = Fmt.days(sum.acquiredToday);
    $('rep-balance').textContent = Fmt.days(sum.balanceToday);
    $('rep-balance').classList.toggle('neg', sum.balanceToday < 0);
    $('rep-rule').textContent = `${Fmt.num(s.rate)} j par mois × ${Fmt.num(Calc.stageMonths(s.start, s.end))} mois`
      + (s.adjust ? ` ${s.adjust > 0 ? '+' : '−'} ${Fmt.num(Math.abs(s.adjust))} j d'ajustement` : '')
      + ` = ${Fmt.days(sum.total)} · ${Calc.workdayCount(s)} jours travaillés dans le stage`;

    const notes = [];
    if (sum.overbooked) notes.push(`Tu as posé ${Fmt.daysLong(sum.placed - sum.total)} de plus que ton total : il faudra en retirer, ou négocier des jours sans solde.`);
    if (sum.advanceCount) notes.push(`${sum.advanceCount} jour${sum.advanceCount > 1 ? 's sont posés' : ' est posé'} avant d'être acquis (⚠︎ dans le calendrier). Beaucoup d'entreprises l'acceptent : à valider avec ton tuteur.`);
    $('rep-warning').hidden = !notes.length;
    $('rep-warning').textContent = notes.join(' ');

    // Périodes posées
    const periods = Calc.periods(App.state);
    $('periods').innerHTML = periods.length ? periods.map((p) => {
      const range = p.from === p.to ? Fmt.date(p.from) : `${Fmt.date(p.from)} → ${Fmt.date(p.to)}`;
      const off = p.offDays > Math.ceil(p.days)
        ? `<span class="hint-inline">${p.offDays} jours de repos d'affilée (${Fmt.date(p.offFrom, { day: 'numeric', month: 'short' })} → ${Fmt.date(p.offTo, { day: 'numeric', month: 'short' })})</span>`
        : '';
      const state = p.to <= App.today ? '<span class="chip chip-taken">pris</span>' : p.from > App.today ? '<span class="chip chip-planned">prévu</span>' : '<span class="chip chip-taken">en cours</span>';
      return `<div class="period"><div class="period-top"><strong>${range}</strong>${state}</div>`
        + `<div class="period-meta"><b>${Fmt.daysLong(p.days)}</b>${off}</div></div>`;
    }).join('') : '<p class="empty">Aucun congé posé pour l\'instant.<br>Touche un jour dans le calendrier.</p>';

    // Mois par mois
    $('monthly').innerHTML = `<table><thead><tr><th>Mois</th><th>Acquis</th><th>Posés</th><th>Solde</th></tr></thead><tbody>`
      + Calc.monthly(App.state).map((r) =>
        `<tr${r.month === App.today.slice(0, 7) ? ' class="current"' : ''}><td>${Fmt.month(r.month)}</td><td>${Fmt.num(r.acquired)}</td>`
        + `<td>${r.used ? Fmt.num(r.used) : '–'}</td><td class="${r.balance < 0 ? 'neg' : ''}">${Fmt.num(r.balance)}</td></tr>`).join('')
      + '</tbody></table>';

    // Ponts
    const bridges = Calc.bridges(App.state);
    $('bridges').innerHTML = bridges.length ? bridges.map((b) =>
      `<div class="bridge"><div><strong>${Fmt.date(b.holiday, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>`
      + `<p class="hint">${esc(b.name)} — pose le ${Fmt.date(b.bridge, { weekday: 'long', day: 'numeric' })} : 4 jours off pour 1 jour.</p></div>`
      + (b.placed ? '<span class="chip chip-planned">posé</span>' : `<button class="btn btn-small" data-bridge="${b.bridge}" type="button">Poser</button>`)
      + '</div>').join('') : '<p class="hint">Pas de pont possible pendant ton stage (aucun férié un mardi ou un jeudi).</p>';

    // Fériés
    const ctx = Calc.context(s);
    const hol = Object.entries(ctx.holidays).sort();
    $('holidays').innerHTML = hol.length ? hol.map(([d, n]) => {
      const we = Dates.weekday(d) >= (s.countSaturday ? 6 : 5);
      return `<div class="holiday-row${we ? ' muted' : ''}"><span>${Fmt.date(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span><span>${esc(n)}${we ? ' (week-end)' : ''}</span></div>`;
    }).join('') : '<p class="hint">Aucun jour férié pendant le stage.</p>';
  },

  /* ---------- Réglages ---------- */
  bindSettings() {
    $('settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const start = f.start.value, end = f.end.value;
      const rate = Fmt.parseNumber(f.rate.value);
      const adjust = f.adjust.value.trim() === '' ? 0 : Fmt.parseNumber(f.adjust.value);
      const err = $('settings-error');
      if (!Dates.isValid(start) || !Dates.isValid(end)) { err.textContent = 'Saisis les dates de début et de fin.'; return; }
      if (end < start) { err.textContent = 'La fin doit être après le début.'; return; }
      if (Dates.diffDays(start, end) > 800) { err.textContent = 'Stage trop long (plus de 2 ans ?).'; return; }
      if (!Number.isFinite(rate) || rate < 0 || rate > 10) { err.textContent = 'Jours par mois invalides.'; return; }
      if (!Number.isFinite(adjust)) { err.textContent = 'Ajustement invalide.'; return; }
      err.textContent = '';
      Object.assign(App.state.settings, {
        start, end, rate, adjust,
        region: f.region.value,
        countSaturday: f.countSaturday.checked,
        configured: true,
      });
      App.persist();
      App.renderAll();
      App.toast('Réglages enregistrés');
      App.showView('calendar');
    });
    $('settings-form').addEventListener('input', App.updateSettingsPreview);

    $('closed-add').addEventListener('click', () => {
      const d = $('closed-date').value;
      if (!Dates.isValid(d)) { App.toast('Choisis une date'); return; }
      const list = App.state.settings.closedDays;
      if (!list.includes(d)) { list.push(d); list.sort(); }
      delete App.state.days[d];
      $('closed-date').value = '';
      App.persist();
      App.renderClosed();
      App.renderAll();
    });
    $('closed-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-date]');
      if (!b) return;
      App.state.settings.closedDays = App.state.settings.closedDays.filter((d) => d !== b.dataset.date);
      App.persist();
      App.renderClosed();
      App.renderAll();
    });

    $('bridges').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-bridge]');
      if (!b) return;
      App.state.days[b.dataset.bridge] = 1;
      App.persist();
      App.renderAll();
      App.toast(`Pont posé le ${Fmt.date(b.dataset.bridge)}`);
    });

    $('btn-theme').addEventListener('click', () => {
      App.state.theme = App.state.theme === 'dark' ? 'light' : 'dark';
      App.persist();
      App.applyTheme();
    });
    $('btn-export').addEventListener('click', App.exportJSON);
    $('import-file').addEventListener('change', App.importJSON);
    $('btn-clear').addEventListener('click', () => {
      const n = Object.keys(App.state.days).length;
      if (!n) { App.toast('Aucun congé posé'); return; }
      if (!confirm(`Effacer les ${n} jour(s) posé(s) ? Les réglages sont conservés.`)) return;
      App.state.days = {};
      App.persist();
      App.renderAll();
      App.toast('Congés effacés');
    });
    $('btn-refresh').addEventListener('click', App.refreshApp);
    $('btn-reload').addEventListener('click', () => location.reload());
  },

  fillSettings() {
    const s = App.state.settings;
    const f = $('settings-form');
    f.start.value = s.start;
    f.end.value = s.end;
    f.rate.value = Fmt.num(s.rate);
    f.adjust.value = s.adjust ? Fmt.num(s.adjust) : '';
    f.region.value = s.region;
    f.countSaturday.checked = s.countSaturday;
    $('settings-intro').hidden = s.configured;
    App.renderClosed();
    App.updateSettingsPreview();
  },

  updateSettingsPreview() {
    const f = $('settings-form');
    const out = $('settings-preview');
    const rate = Fmt.parseNumber(f.rate.value);
    const adjust = f.adjust.value.trim() === '' ? 0 : Fmt.parseNumber(f.adjust.value);
    if (!Dates.isValid(f.start.value) || !Dates.isValid(f.end.value) || f.end.value < f.start.value || !Number.isFinite(rate) || !Number.isFinite(adjust)) {
      out.textContent = '';
      return;
    }
    const months = Calc.stageMonths(f.start.value, f.end.value);
    const total = Calc.ceilHalf(rate * months) + adjust;
    out.textContent = `${Fmt.num(months)} mois de stage → ${Fmt.daysLong(total)} de congé au total.`;
  },

  renderClosed() {
    const list = App.state.settings.closedDays;
    $('closed-list').innerHTML = list.map((d) =>
      `<div class="closed-row"><span>${Fmt.date(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>`
      + `<button class="btn btn-small" type="button" data-date="${d}" aria-label="Retirer">✕</button></div>`).join('');
  },

  applyTheme() {
    const t = App.state.theme;
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#0d0d0d' : '#f9f9f7');
    $('btn-theme').textContent = t === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre';
  },

  /* ---------- Sauvegarde ---------- */
  /** Sur iPhone : feuille de partage (« Enregistrer dans Fichiers ») ; ailleurs : téléchargement. */
  async exportJSON() {
    const name = `suivi-conges-${Dates.today()}.json`;
    const json = JSON.stringify({ ...App.state, lastExport: Dates.today() }, null, 2);
    const done = () => { App.state.lastExport = Dates.today(); App.persist(); };
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Sauvegarde Suivi congés' });
        done();
        App.toast('Sauvegarde exportée');
      } catch (e) {
        if (e.name !== 'AbortError') App.toast('Export impossible : ' + e.message);
      }
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    done();
  },

  importJSON(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = Store.sanitize(JSON.parse(reader.result));
        if (!confirm(`Remplacer les données actuelles par cette sauvegarde (${Object.keys(data.days).length} jour(s) posé(s)) ?`)) return;
        App.state = data;
        App.persist();
        App.applyTheme();
        App.fillSettings();
        App.renderAll();
        App.toast('Sauvegarde importée');
      } catch (err) {
        alert('Import impossible : ' + err.message);
      }
    };
    reader.readAsText(file);
  },

  /* ---------- Service worker ---------- */
  swReg: null,
  reloadOnUpdate: false,

  registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (App.reloadOnUpdate) location.reload();
      else if (hadController) $('update-banner').hidden = false;
    });
    navigator.serviceWorker.register('sw.js')
      .then((reg) => { App.swReg = reg; return reg.update(); })
      .catch((e) => console.warn('SW non enregistré', e));
  },

  /** Bouton ↻ : cherche une nouvelle version (utile dans l'appli installée sur iPhone) */
  async refreshApp() {
    const btn = $('btn-refresh');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('spinning');
    try {
      const reg = App.swReg;
      if (!reg) { location.reload(); return; }
      await reg.update();
      if (reg.installing || reg.waiting) {
        App.reloadOnUpdate = true;
        App.toast('Mise à jour en cours…');
        setTimeout(() => location.reload(), 8000);
        return;
      }
      App.toast(`Appli à jour (v${APP_VERSION})`);
    } catch (e) {
      App.toast('Actualisation impossible (hors ligne ?)');
    }
    btn.disabled = false;
    btn.classList.remove('spinning');
  },

  toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(App._toastT);
    App._toastT = setTimeout(() => { el.hidden = true; }, 2200);
  },
};

/* ---------- Démarrage (navigateur) / export (tests Node) ---------- */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', App.init);
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Dates, Holidays, Calc, Fmt, Store, APP_VERSION };
}
