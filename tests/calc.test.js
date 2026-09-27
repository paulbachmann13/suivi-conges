/* Tests des calculs — lancer avec : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Dates, Holidays, Calc, Store, APP_VERSION } = require('../app.js');

const settings = (over = {}) => ({
  start: '2026-09-01', end: '2027-02-28', rate: 2.5, adjust: 0,
  region: 'DE-NW', countSaturday: false, closedDays: [], configured: true, ...over,
});
const state = (days = {}, over = {}) => ({ settings: settings(over), days, theme: 'dark', lastExport: null });

test('version identique dans app.js et sw.js', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(sw, new RegExp(`const VERSION = '${APP_VERSION.replace(/\./g, '\\.')}'`));
});

test('dates : ajout de mois, jour de semaine', () => {
  assert.equal(Dates.addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(Dates.addMonths('2026-09-01', 6), '2027-03-01');
  assert.equal(Dates.weekday('2026-09-28'), 0); // lundi
  assert.equal(Dates.weekday('2026-10-03'), 5); // samedi
  assert.equal(Dates.addDays('2026-10-25', 1), '2026-10-26'); // passage à l'heure d'hiver
  assert.ok(Dates.isValid('2027-02-28'));
  assert.ok(!Dates.isValid('2027-02-30'));
});

test('Pâques et fériés NRW', () => {
  assert.equal(Holidays.easter(2026), '2026-04-05');
  assert.equal(Holidays.easter(2027), '2027-03-28');
  const h = Holidays.forYear(2027, 'DE-NW');
  assert.ok(h['2027-03-26']); // Vendredi saint
  assert.ok(h['2027-05-06']); // Ascension
  assert.ok(h['2027-05-27']); // Fronleichnam
  assert.equal(Object.keys(h).length, 11);
  assert.deepEqual(Object.keys(Holidays.between('2026-09-01', '2027-02-28', 'DE-NW')).sort(),
    ['2026-10-03', '2026-11-01', '2026-12-25', '2026-12-26', '2027-01-01']);
});

test('stage de 6 mois à 2,5 j/mois = 15 jours', () => {
  assert.equal(Calc.stageMonths('2026-09-01', '2027-02-28'), 6);
  assert.equal(Calc.totalEntitlement(settings()), 15);
  assert.equal(Calc.totalEntitlement(settings({ adjust: 2 })), 17);
  // 6 mois et demi (15 jours sur un mois de 30) → 16,25 → arrondi à 16,5
  assert.equal(Calc.totalEntitlement(settings({ start: '2026-09-15', end: '2027-03-29' })), 16.5);
});

test('acquisition mois par mois', () => {
  const s = settings();
  assert.equal(Calc.acquiredAt(s, '2026-08-31'), 0);
  assert.equal(Calc.acquiredAt(s, '2026-09-29'), 0);
  assert.equal(Calc.acquiredAt(s, '2026-09-30'), 2.5);
  assert.equal(Calc.acquiredAt(s, '2026-12-15'), 7.5);
  assert.equal(Calc.acquiredAt(s, '2027-02-28'), 15);
  assert.equal(Calc.acquiredAt(s, '2027-06-01'), 15);
});

test('seuls les jours travaillés du stage sont décomptés', () => {
  const st = state({
    '2026-10-02': 1,   // vendredi : compte
    '2026-10-03': 1,   // samedi férié : ignoré
    '2026-10-04': 1,   // dimanche : ignoré
    '2026-12-25': 1,   // Noël : ignoré
    '2027-03-01': 1,   // hors stage : ignoré
    '2026-11-02': 0.5, // demi-journée
  });
  const s = Calc.summary(st, '2026-10-15');
  assert.equal(s.placed, 1.5);
  assert.equal(s.taken, 1);
  assert.equal(s.planned, 0.5);
  assert.equal(s.remaining, 13.5);
  assert.equal(s.acquiredToday, 2.5);
  assert.equal(s.balanceToday, 1.5);
});

test('samedi décompté en jours ouvrables', () => {
  const s = Calc.summary(state({ '2026-10-10': 1 }, { countSaturday: true }), '2026-09-01');
  assert.equal(s.placed, 1);
});

test('jours offerts par l\'entreprise ne coûtent rien', () => {
  const st = state({ '2026-12-24': 1, '2026-12-23': 1 }, { closedDays: ['2026-12-24'] });
  assert.equal(Calc.summary(st, '2026-09-01').placed, 1);
});

test('congés posés avant d\'être acquis', () => {
  // 28/09 : rien d'acquis ; en octobre 2,5 j acquis → le 3e et le 4e jour sont en avance
  const st = state({ '2026-09-28': 1, '2026-10-05': 1, '2026-10-06': 1, '2026-10-07': 1 });
  const s = Calc.summary(st, '2026-09-01');
  assert.deepEqual(s.days.map((d) => d.advance), [true, false, true, true]);
  assert.equal(s.advanceCount, 3);
});

test('trop de congés posés', () => {
  const days = {};
  for (const d of Dates.range('2027-01-04', '2027-01-29')) if (Dates.weekday(d) < 5) days[d] = 1;
  const s = Calc.summary(state(days), '2026-09-01');
  assert.equal(s.placed, 20);
  assert.equal(s.remaining, -5);
  assert.ok(s.overbooked);
});

test('périodes : week-ends et fériés inclus dans le repos', () => {
  // Du lundi 21 au jeudi 31 décembre (25 et 26 fériés), puis le 1er janvier férié
  const days = {};
  for (const d of Dates.range('2026-12-21', '2026-12-31')) if (Dates.weekday(d) < 5) days[d] = 1;
  const p = Calc.periods(state(days));
  assert.equal(p.length, 1);
  assert.equal(p[0].days, 8);
  assert.equal(p[0].offFrom, '2026-12-19'); // samedi avant
  assert.equal(p[0].offTo, '2027-01-03');   // dimanche après le 1er janvier
  assert.equal(p[0].offDays, 16);
});

test('périodes : un jour travaillé sépare deux congés', () => {
  const p = Calc.periods(state({ '2026-10-05': 1, '2026-10-07': 1 }));
  assert.equal(p.length, 2);
});

test('ponts : férié un jeudi', () => {
  // Stage au printemps 2027 : Ascension jeudi 6 mai, Fronleichnam jeudi 27 mai
  const b = Calc.bridges(state({}, { start: '2027-04-01', end: '2027-06-30' }));
  assert.deepEqual(b.map((x) => x.bridge), ['2027-05-07', '2027-05-28']);
  // Stage d'hiver 2026-2027 : aucun pont
  assert.equal(Calc.bridges(state()).length, 0);
});

test('cycle du toucher : journée → demi → rien', () => {
  assert.equal(Calc.nextValue(undefined), 1);
  assert.equal(Calc.nextValue(1), 0.5);
  assert.equal(Calc.nextValue(0.5), 0);
});

test('tableau mensuel', () => {
  const rows = Calc.monthly(state({ '2026-10-05': 1, '2026-10-06': 1, '2026-12-28': 1 }));
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[1], { month: '2026-10', used: 2, cumUsed: 2, acquired: 5, balance: 3 });
  assert.equal(rows[5].balance, 12);
});

test('import : données nettoyées', () => {
  const d = Store.sanitize({
    settings: { start: '2026-09-01', end: 'n/a', rate: 'x', region: 'XX', closedDays: ['2026-12-24', 'bad', '2026-12-24'] },
    days: { '2026-10-05': 1, '2026-10-06': 0.5, '2026-10-07': 3, bad: 1 },
  });
  assert.equal(d.settings.rate, 2.5);
  assert.equal(d.settings.region, 'DE-NW');
  assert.ok(Dates.isValid(d.settings.end));
  assert.deepEqual(d.settings.closedDays, ['2026-12-24']);
  assert.deepEqual(d.days, { '2026-10-05': 1, '2026-10-06': 0.5 });
  assert.throws(() => Store.sanitize({ foo: 1 }));
});
