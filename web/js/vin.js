// VIN-декодер по ISO 3779 (+ GB 16735-2019 для Китая).
// Модуль без зависимостей: работает и в браузере, и в Node (тесты).

const TRANSLIT = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

// Код года (10-й символ): цикл 30 лет. I, O, Q, U, Z и 0 не используются.
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

/** Нормализация ввода: верхний регистр, без пробелов и дефисов. */
export function normalizeVin(input) {
  return String(input || '').toUpperCase().replace(/[\s\-]/g, '');
}

/** Значение символа для расчёта контрольной цифры. */
export function charValue(ch) {
  if (/[0-9]/.test(ch)) return Number(ch);
  return TRANSLIT[ch];
}

/** Расчёт контрольной цифры (9-я позиция): '0'..'9' или 'X'. */
export function computeCheckDigit(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const v = charValue(vin[i]);
    if (v === undefined) return null;
    sum += v * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

/** Кандидаты модельного года по 10-му символу (цикл 30 лет). */
export function modelYearCandidates(code) {
  const idx = YEAR_CODES.indexOf(code);
  if (idx < 0) return [];
  const base = 1980 + idx;
  return [base, base + 30, base + 60].filter((y) => y <= 2069);
}

/** Наиболее вероятный год: самый поздний кандидат, не превышающий текущий год + 1. */
export function likelyModelYear(code, now = new Date()) {
  const maxYear = now.getFullYear() + 1;
  const c = modelYearCandidates(code).filter((y) => y <= maxYear);
  return c.length ? c[c.length - 1] : null;
}

const REGION_BY_FIRST = [
  [/[A-C]/, 'Африка'],
  [/[H-R]/, 'Азия'],
  [/[S-Z]/, 'Европа'],
  [/[1-5]/, 'Северная Америка'],
  [/[6-7]/, 'Океания'],
  [/[8-9]/, 'Южная Америка'],
];

export function countryHint(wmi) {
  const a = wmi[0];
  const b = wmi[1];
  if (a === 'L' || a === 'H') return 'Китай';
  if (a === 'X') {
    if (/[A-C]/.test(b)) return 'Болгария';
    if (/[F-H]/.test(b)) return 'Греция';
    if (/[L-R]/.test(b)) return 'Нидерланды';
    if (/[XY]/.test(b)) return 'Люксембург';
    return 'Россия / СНГ';
  }
  if (a === 'Z' && /[6-90]/.test(b)) return 'Россия';
  if (a === 'E') return 'Россия';
  if (a === 'Y' && /[3-5]/.test(b)) return 'Беларусь';
  if (a === 'J') return 'Япония';
  if (a === 'K' && /[L-R]/.test(b)) return 'Южная Корея';
  if (a === 'W') return 'Германия';
  for (const [re, name] of REGION_BY_FIRST) if (re.test(a)) return name;
  return 'Неизвестно';
}

/**
 * Полный разбор VIN.
 * @param {string} input
 * @param {Array<{wmi:string, manufacturer:string, brands:string[]}>} wmiTable
 */
export function decodeVin(input, wmiTable = [], now = new Date()) {
  const vin = normalizeVin(input);
  const errors = [];
  const warnings = [];

  if (vin.length !== 17) errors.push(`VIN должен содержать 17 символов, сейчас ${vin.length}.`);
  const bad = [...new Set(vin.replace(/[A-HJ-NPR-Z0-9]/g, '').split(''))].filter(Boolean);
  if (bad.length) errors.push(`Недопустимые символы: ${bad.join(', ')}. Буквы I, O, Q в VIN не используются (часто путают с 1 и 0).`);
  if (errors.length) return { ok: false, vin, errors, warnings };

  const wmi = vin.slice(0, 3);
  const vds = vin.slice(3, 9);
  const vis = vin.slice(9, 17);
  const yearCode = vin[9];
  const plantCode = vin[10];
  const serial = vin.slice(11);

  const match = wmiTable.find((w) => w.wmi === wmi) || null;
  const expected = computeCheckDigit(vin);
  const actual = vin[8];
  const checkOk = expected === actual;
  const country = countryHint(wmi);
  if (!checkOk) {
    if (country === 'Китай') {
      warnings.push(`Контрольная цифра не совпадает (в VIN «${actual}», расчёт даёт «${expected}»). По китайскому стандарту GB 16735-2019 она обязательна — проверьте, не ошиблись ли при вводе.`);
    } else {
      warnings.push(`Контрольная цифра не совпадает (в VIN «${actual}», расчёт даёт «${expected}»). По ISO 3779 она необязательна: у машин европейской и российской сборки это нормально.`);
    }
  }

  const years = modelYearCandidates(yearCode);
  const year = likelyModelYear(yearCode, now);
  if (!years.length) warnings.push(`Символ года «${yearCode}» не входит в таблицу кодов (I, O, Q, U, Z, 0 не используются).`);

  if (!match) warnings.push('Производитель по WMI не найден в нашей (неполной, демо) таблице.');

  return {
    ok: true,
    vin,
    sections: { wmi, vds, vis },
    country,
    manufacturer: match,
    check: { expected, actual, ok: checkOk },
    year: { code: yearCode, likely: year, candidates: years },
    plantCode,
    serial,
    errors,
    warnings,
  };
}
