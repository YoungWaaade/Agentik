import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, nextCron, parseEvery, parseUntil, nextRun } from '../server/cron.js';

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('cron : toutes les 2 h à la 17e minute', () => {
  assert.equal(nextCron('17 */2 * * *', at(2026, 11, 7, 9, 30)), at(2026, 11, 7, 10, 17));
  assert.equal(nextCron('17 */2 * * *', at(2026, 11, 7, 10, 17)), at(2026, 11, 7, 12, 17));
  assert.equal(nextCron('17 */2 * * *', at(2026, 11, 7, 23, 0)), at(2026, 11, 8, 0, 17));
});

test('cron : chaque minute, listes, plages, jours', () => {
  assert.equal(nextCron('* * * * *', at(2026, 11, 7, 9, 30) + 12_000), at(2026, 11, 7, 9, 31));
  assert.equal(nextCron('0 8,18 * * 1-5', at(2026, 11, 7, 9, 0)), at(2026, 11, 9, 8, 0)); // samedi → lundi
  assert.equal(nextCron('30 9 1 * *', at(2026, 11, 7)), at(2026, 12, 1, 9, 30));
  assert.equal(nextCron('0 0 * * 7', at(2026, 11, 7)), at(2026, 11, 8)); // 7 = dimanche
  assert.equal(nextCron('@daily', at(2026, 11, 7, 5)), at(2026, 11, 8));
});

test('cron invalide', () => {
  assert.throws(() => parseCron('*/2 * *'), /5 champs/);
  assert.throws(() => parseCron('61 * * * *'), /minute/);
  assert.throws(() => parseCron('* * * * lundi'), /jour de semaine/);
});

test('intervalles et date de fin', () => {
  assert.equal(parseEvery('2h'), 120);
  assert.equal(parseEvery('1h30'), 90);
  assert.equal(parseEvery('45m'), 45);
  assert.equal(parseEvery('1d'), 1440);
  assert.throws(() => parseEvery('bientôt'));
  assert.throws(() => parseEvery('0m'));
  assert.equal(parseUntil('2026-11-08'), at(2026, 11, 8, 23, 59) + 59_999);
  assert.throws(() => parseUntil('demain'));
});

test('nextRun respecte la date de fin', () => {
  const until = parseUntil('2026-11-07');
  assert.equal(nextRun({ cron: '0 */6 * * *', until }, at(2026, 11, 7, 13)), at(2026, 11, 7, 18));
  assert.equal(nextRun({ cron: '0 */6 * * *', until }, at(2026, 11, 7, 19)), null);
  assert.equal(nextRun({ every_min: 30 }, at(2026, 11, 7, 10)), at(2026, 11, 7, 10, 30));
});

import { describeCron, describeEvery, describeFrequency } from '../server/cron.js';

test('fréquence lisible : intervalles', () => {
  assert.equal(describeEvery(30), 'toutes les 30 min');
  assert.equal(describeEvery(60), 'toutes les heures');
  assert.equal(describeEvery(120), 'toutes les 2 h');
  assert.equal(describeEvery(90), 'toutes les 1 h 30');
  assert.equal(describeEvery(1440), 'tous les jours');
  assert.equal(describeEvery(2880), 'tous les 2 jours');
});

test('fréquence lisible : cron', () => {
  assert.equal(describeCron('17 */2 * * *'), 'toutes les 2 h à :17');
  assert.equal(describeCron('0 9 * * *'), 'tous les jours à 9 h');
  assert.equal(describeCron('30 8,18 * * 1-5'), 'en semaine à 8 h 30 et 18 h 30');
  assert.equal(describeCron('0 10 * * 0,6'), 'le week-end à 10 h');
  assert.equal(describeCron('0 9 * * 1'), 'le lundi à 9 h');
  assert.equal(describeCron('0 9 1 * *'), 'le 1er du mois à 9 h');
  assert.equal(describeCron('*/15 * * * *'), 'toutes les 15 min');
  assert.equal(describeCron('5 * * * *'), 'toutes les heures à :05');
  assert.equal(describeCron('0 9 * 3 *'), 'cron « 0 9 * 3 * »'); // pas de traduction : l'expression telle quelle
  assert.equal(describeCron('n importe quoi'), 'cron « n importe quoi »');
  assert.equal(describeFrequency({ cron: null, every_min: 120 }), 'toutes les 2 h');
});

test('cron : deux fois par jour, à 9 h et 16 h', () => {
  assert.equal(nextCron('0 9,16 * * *', at(2026, 11, 13, 8, 0)), at(2026, 11, 13, 9, 0));
  assert.equal(nextCron('0 9,16 * * *', at(2026, 11, 13, 9, 0)), at(2026, 11, 13, 16, 0));
  assert.equal(nextCron('0 9,16 * * *', at(2026, 11, 13, 16, 30)), at(2026, 11, 14, 9, 0));
});
