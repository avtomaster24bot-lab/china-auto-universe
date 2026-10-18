import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeVin, computeCheckDigit, modelYearCandidates, likelyModelYear, normalizeVin } from '../web/js/vin.js';

const wmi = JSON.parse(readFileSync(new URL('../data/vehicles/wmi.json', import.meta.url))).items;
const NOW = new Date('2026-10-18');

function withCheck(v16) { // вставить правильную контрольную цифру в позицию 9
  const v = v16.slice(0, 8) + '0' + v16.slice(9);
  return v.slice(0, 8) + computeCheckDigit(v) + v.slice(9);
}

test('классический пример контрольной цифры (Wikipedia): 1M8GDM9AXKP042788 → X', () => {
  assert.equal(computeCheckDigit('1M8GDM9AXKP042788'), 'X');
  const r = decodeVin('1M8GDM9AXKP042788', wmi, NOW);
  assert.ok(r.ok); assert.ok(r.check.ok);
});

test('17 единиц — валидный VIN с контрольной 1', () => {
  assert.equal(computeCheckDigit('11111111111111111'), '1');
});

test('нормализация: пробелы, дефисы, регистр', () => {
  assert.equal(normalizeVin(' lvv-dc11b 4ad 123456 '), 'LVVDC11B4AD123456');
});

test('ошибки длины и запрещённых символов I/O/Q', () => {
  assert.equal(decodeVin('LVV123', wmi).ok, false);
  const r = decodeVin('LVVDB11BOID123456', wmi);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /I, O/);
});

test('секции WMI / VDS / VIS', () => {
  const vin = withCheck('LVVDB21B0RD123456');
  const r = decodeVin(vin, wmi, NOW);
  assert.equal(r.sections.wmi, 'LVV');
  assert.equal(r.sections.vds.length, 6);
  assert.equal(r.sections.vis.length, 8);
  assert.equal(r.manufacturer.manufacturer, 'Chery Automobile');
  assert.equal(r.country, 'Китай');
  assert.ok(r.check.ok);
  assert.equal(r.year.likely, 2024);
});

test('неверная контрольная цифра у китайского VIN → предупреждение про GB 16735', () => {
  const good = withCheck('L6T7824Z0SN123456');
  const badDigit = good[8] === '1' ? '2' : '1';
  const bad = good.slice(0, 8) + badDigit + good.slice(9);
  const r = decodeVin(bad, wmi, NOW);
  assert.ok(r.ok); assert.equal(r.check.ok, false);
  assert.match(r.warnings.join(' '), /GB 16735/);
  assert.deepEqual(r.manufacturer.brands, ['Geely', 'Lynk & Co', 'Zeekr']);
});

test('коды модельного года (цикл 30 лет)', () => {
  assert.deepEqual(modelYearCandidates('A'), [1980, 2010, 2040]);
  assert.equal(likelyModelYear('A', NOW), 2010);
  assert.equal(likelyModelYear('L', NOW), 2020);
  assert.equal(likelyModelYear('S', NOW), 2025);
  assert.equal(likelyModelYear('T', NOW), 2026);
  assert.equal(likelyModelYear('V', NOW), 2027);
  assert.equal(likelyModelYear('9', NOW), 2009);
  assert.equal(likelyModelYear('Y', NOW), 2000);
  assert.deepEqual(modelYearCandidates('U'), []);
  assert.deepEqual(modelYearCandidates('0'), []);
});

test('неизвестный WMI → предупреждение', () => {
  const r = decodeVin(withCheck('LZZ1234500R123456'), wmi, NOW);
  assert.equal(r.manufacturer, null);
  assert.match(r.warnings.join(' '), /не найден/);
});

test('WMI-таблица: только уникальные трёхсимвольные коды', () => {
  const set = new Set(wmi.map((w) => w.wmi));
  assert.equal(set.size, wmi.length);
  for (const w of wmi) assert.match(w.wmi, /^[A-HJ-NPR-Z0-9]{3}$/);
});
