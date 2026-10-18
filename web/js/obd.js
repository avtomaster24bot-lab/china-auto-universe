// Разбор ответов ELM327 и формулы SAE J1979 (Mode 01 / 02 / 03).
// Без зависимостей: работает в браузере и в Node.

/** Команды инициализации ELM327. ATH0 (заголовки выкл.) упрощает разбор. */
export const INIT_COMMANDS = ['ATZ', 'ATE0', 'ATL0', 'ATS1', 'ATH0', 'ATSP0'];

/** Протоколы по ответу ATDPN (A = автоматический выбор). */
export const PROTOCOLS = {
  '1': 'SAE J1850 PWM', '2': 'SAE J1850 VPW', '3': 'ISO 9141-2', '4': 'ISO 14230-4 KWP (5 бод)',
  '5': 'ISO 14230-4 KWP (быстрая)', '6': 'ISO 15765-4 CAN (11 бит, 500 кбит/с)', '7': 'ISO 15765-4 CAN (29 бит, 500 кбит/с)',
  '8': 'ISO 15765-4 CAN (11 бит, 250 кбит/с)', '9': 'ISO 15765-4 CAN (29 бит, 250 кбит/с)', 'A': 'SAE J1939 CAN',
};
export function protocolName(dpn) {
  const s = String(dpn || '').trim().toUpperCase().replace(/^A/, '');
  return PROTOCOLS[s] || 'неизвестен';
}
export function isCanProtocol(dpn) {
  const s = String(dpn || '').trim().toUpperCase().replace(/^A/, '');
  return ['6', '7', '8', '9'].includes(s);
}

const ERROR_RE = /(NO DATA|UNABLE TO CONNECT|CAN ERROR|BUS ERROR|BUS INIT[:. ]*ERROR|STOPPED|\?|ERR\d+|BUFFER FULL|DATA ERROR|FB ERROR|LV RESET)/i;

/** Ошибка адаптера в ответе (или null). */
export function responseError(raw) {
  const m = String(raw || '').replace(/SEARCHING\.\.\./gi, '').match(ERROR_RE);
  return m ? m[1].toUpperCase() : null;
}

/** Строки ответа без эха, приглашения '>' и служебного SEARCHING... */
export function cleanLines(raw) {
  return String(raw || '')
    .replace(/>/g, '')
    .replace(/SEARCHING\.\.\./gi, '')
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Превращает ответ в список сообщений (массивов байт).
 * Поддерживает многокадровые ответы CAN без заголовков: "00A", "0: 43 ...", "1: ...".
 */
export function parseMessages(raw) {
  const lines = cleanLines(raw);
  const messages = [];
  let multi = null;
  for (const line of lines) {
    if (/^[0-9A-F]{3}$/i.test(line)) { // длина многокадрового сообщения
      multi = { len: parseInt(line, 16), bytes: [] };
      messages.push(multi.bytes);
      continue;
    }
    const frame = line.match(/^([0-9A-F]):\s*(.*)$/i);
    if (frame && multi) {
      multi.bytes.push(...hexBytes(frame[2]));
      if (multi.bytes.length > multi.len) multi.bytes.length = multi.len;
      continue;
    }
    if (!/^[0-9A-F\s]+$/i.test(line)) continue; // текст (например, ELM327 v1.5)
    multi = null;
    // CAN 11 бит с заголовками (ATH1): "7E8 03 41 0D 3C" — отбрасываем заголовок
    const tokens = line.split(/\s+/);
    const body = tokens.length > 1 && tokens[0].length === 3 ? tokens.slice(1).join(' ') : line;
    const b = hexBytes(body);
    if (b.length) messages.push(b);
  }
  return messages;
}

export function hexBytes(s) {
  const clean = String(s).replace(/\s+/g, '');
  if (!/^[0-9A-F]*$/i.test(clean) || clean.length % 2) return [];
  const out = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

/** Два байта → код DTC по SAE J2012 (например, 0x01 0x33 → P0133). */
export function decodeDtc(a, b) {
  const letter = 'PCBU'[(a & 0xc0) >> 6];
  const d1 = (a & 0x30) >> 4;
  const d2 = (a & 0x0f).toString(16).toUpperCase();
  const rest = b.toString(16).toUpperCase().padStart(2, '0');
  return `${letter}${d1}${d2}${rest}`;
}

/**
 * Разбор ответа на Mode 03 (также 07 и 0A — меняется байт ответа).
 * @param {string} raw ответ адаптера
 * @param {{can?: boolean, responseByte?: number}} opts
 * @returns {string[]} уникальные коды
 */
export function parseDtcResponse(raw, opts = {}) {
  const rb = opts.responseByte ?? 0x43;
  if (responseError(raw) === 'NO DATA') return [];
  const codes = [];
  for (const msg of parseMessages(raw)) {
    const i = msg.indexOf(rb);
    if (i < 0) continue;
    let data = msg.slice(i + 1);
    let can = opts.can;
    if (can === undefined) can = data.length % 2 === 1; // у CAN есть байт количества кодов
    if (can) {
      const count = data[0];
      data = data.slice(1, 1 + count * 2);
    }
    for (let j = 0; j + 1 < data.length; j += 2) {
      if (data[j] === 0 && data[j + 1] === 0) continue;
      codes.push(decodeDtc(data[j], data[j + 1]));
    }
  }
  return [...new Set(codes)];
}

/** Формулы PID Mode 01 по SAE J1979. */
export const PIDS = {
  '01': { name: 'Статус MIL и число кодов', unit: '', bytes: 4, calc: ([a]) => ({ mil: !!(a & 0x80), count: a & 0x7f }) },
  '04': { name: 'Нагрузка двигателя', unit: '%', bytes: 1, calc: ([a]) => (a * 100) / 255 },
  '05': { name: 'Температура ОЖ', unit: '°C', bytes: 1, calc: ([a]) => a - 40 },
  '06': { name: 'Краткоср. топл. коррекция, ряд 1', unit: '%', bytes: 1, calc: ([a]) => (a - 128) * 100 / 128 },
  '07': { name: 'Долгоср. топл. коррекция, ряд 1', unit: '%', bytes: 1, calc: ([a]) => (a - 128) * 100 / 128 },
  '0B': { name: 'Давление во впуске', unit: 'кПа', bytes: 1, calc: ([a]) => a },
  '0C': { name: 'Обороты двигателя', unit: 'об/мин', bytes: 2, calc: ([a, b]) => (a * 256 + b) / 4 },
  '0D': { name: 'Скорость', unit: 'км/ч', bytes: 1, calc: ([a]) => a },
  '0F': { name: 'Температура воздуха на впуске', unit: '°C', bytes: 1, calc: ([a]) => a - 40 },
  '10': { name: 'Расход воздуха (ДМРВ)', unit: 'г/с', bytes: 2, calc: ([a, b]) => (a * 256 + b) / 100 },
  '11': { name: 'Положение дросселя', unit: '%', bytes: 1, calc: ([a]) => (a * 100) / 255 },
  '42': { name: 'Напряжение блока управления', unit: 'В', bytes: 2, calc: ([a, b]) => (a * 256 + b) / 1000 },
};

/**
 * Разбор ответа Mode 01 (0x41) или Mode 02 (0x42, freeze frame — после PID идёт номер кадра).
 * @returns {{pid:string, value:any, unit:string, name:string} | null}
 */
export function parsePidResponse(raw, pid, mode = 0x01) {
  const p = String(pid).toUpperCase().padStart(2, '0');
  const def = PIDS[p];
  const pidByte = parseInt(p, 16);
  const rb = 0x40 + mode;
  for (const msg of parseMessages(raw)) {
    for (let i = 0; i + 1 < msg.length; i++) {
      if (msg[i] === rb && msg[i + 1] === pidByte) {
        const offset = mode === 0x02 ? i + 3 : i + 2; // Mode 02: ещё байт номера кадра
        const data = msg.slice(offset, offset + (def ? def.bytes : 4));
        if (!def || data.length < def.bytes) return null;
        const v = def.calc(data);
        return { pid: p, name: def.name, unit: def.unit, value: typeof v === 'number' ? Math.round(v * 100) / 100 : v };
      }
    }
  }
  return null;
}
