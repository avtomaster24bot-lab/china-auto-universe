// Транспорт ELM327 через Web Bluetooth (BLE) + демо-адаптер с имитацией ответов.

// Распространённые сервисы BLE-адаптеров ELM327 (у разных клонов отличаются).
export const BLE_SERVICES = [
  0xfff0,                                      // много дешёвых клонов
  0xffe0,                                      // HM-10-подобные модули
  0x18f0,                                      // некоторые адаптеры Vgate/Veepeak
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',      // встречается у Vgate iCar Pro BLE
];

export function webBluetoothSupport() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  const isFirefox = /Firefox\//.test(ua);
  const isSafari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
  const available = !!(nav.bluetooth && nav.bluetooth.requestDevice);
  let reason = '';
  if (isIOS) reason = 'На iPhone и iPad Web Bluetooth не поддерживается ни в одном браузере (все используют движок Safari).';
  else if (isFirefox) reason = 'Firefox не поддерживает Web Bluetooth.';
  else if (isSafari) reason = 'Safari не поддерживает Web Bluetooth.';
  else if (!available) reason = 'Этот браузер не поддерживает Web Bluetooth.';
  else if (typeof window !== 'undefined' && !window.isSecureContext) reason = 'Web Bluetooth работает только по HTTPS (или на localhost).';
  return { ok: available && !reason, reason, isIOS };
}

class BaseAdapter {
  constructor() { this.log = []; this.onlog = null; }
  _log(dir, text) {
    const entry = { t: new Date(), dir, text };
    this.log.push(entry);
    if (this.onlog) this.onlog(entry);
  }
}

export class BleElm327 extends BaseAdapter {
  constructor() { super(); this.device = null; this.rx = null; this.tx = null; this.buf = ''; this.waiter = null; this.queue = Promise.resolve(); }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [
        ...BLE_SERVICES.map((s) => ({ services: [s] })),
        { namePrefix: 'OBD' }, { namePrefix: 'ELM' }, { namePrefix: 'V-LINK' }, { namePrefix: 'Vgate' }, { namePrefix: 'IOS-Vlink' }, { namePrefix: 'VEEPEAK' },
      ],
      optionalServices: BLE_SERVICES,
    });
    this._log('sys', `Устройство: ${this.device.name || 'без имени'}`);
    const server = await this.device.gatt.connect();
    const services = await server.getPrimaryServices();
    for (const svc of services) {
      let chars = [];
      try { chars = await svc.getCharacteristics(); } catch { continue; }
      for (const ch of chars) {
        if (!this.rx && (ch.properties.notify || ch.properties.indicate)) this.rx = ch;
        if (!this.tx && (ch.properties.write || ch.properties.writeWithoutResponse)) this.tx = ch;
      }
      if (this.rx && this.tx) break;
    }
    if (!this.rx || !this.tx) throw new Error('Не найдены характеристики для обмена данными. Возможно, это не ELM327 BLE.');
    await this.rx.startNotifications();
    this.rx.addEventListener('characteristicvaluechanged', (e) => {
      this.buf += new TextDecoder().decode(e.target.value);
      if (this.buf.includes('>') && this.waiter) {
        const out = this.buf; this.buf = '';
        const w = this.waiter; this.waiter = null; w.resolve(out);
      }
    });
    this.device.addEventListener('gattserverdisconnected', () => this._log('sys', 'Адаптер отключился'));
    return this.device.name || 'ELM327 BLE';
  }

  send(cmd, timeoutMs = 5000) {
    // Команды выполняются строго по очереди: ELM327 обрабатывает одну за раз.
    const run = () => new Promise((resolve, reject) => {
      this.buf = '';
      const timer = setTimeout(() => { this.waiter = null; reject(new Error(`Нет ответа на ${cmd}`)); }, cmd === 'ATZ' ? 8000 : timeoutMs);
      this.waiter = { resolve: (v) => { clearTimeout(timer); this._log('rx', v.trim()); resolve(v); } };
      this._log('tx', cmd);
      const data = new TextEncoder().encode(cmd + '\r');
      const write = this.tx.properties.writeWithoutResponse && this.tx.writeValueWithoutResponse
        ? this.tx.writeValueWithoutResponse(data) : this.tx.writeValue(data);
      Promise.resolve(write).catch((e) => { clearTimeout(timer); this.waiter = null; reject(e); });
    });
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async disconnect() { try { this.device?.gatt?.disconnect(); } catch { /* ignore */ } }
}

/** Демо-адаптер: имитирует ответы ELM327 v1.5 на CAN 11 бит 500 кбит/с. */
export class DemoElm327 extends BaseAdapter {
  constructor(opts = {}) {
    super();
    this.codes = opts.codes || ['P0301', 'P0171', 'U0100'];
    this.t0 = Date.now();
    this.delay = opts.delay ?? 120;
  }
  async connect() { this._log('sys', 'Демо-режим: настоящий адаптер не нужен'); return 'Демо ELM327 v1.5'; }
  async disconnect() {}

  static encodeDtc(code) {
    const letter = 'PCBU'.indexOf(code[0]);
    const a = (letter << 6) | (Number(code[1]) << 4) | parseInt(code[2], 16);
    const b = parseInt(code.slice(3), 16);
    return [a, b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  }

  respond(cmd) {
    const c = cmd.toUpperCase().replace(/\s/g, '');
    const t = (Date.now() - this.t0) / 1000;
    const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase().padStart(2, '0');
    if (c === 'ATZ') return '\r\rELM327 v1.5\r\r>';
    if (c === 'ATDPN') return 'A6\r\r>';
    if (c === 'ATRV') return '14.2V\r\r>';
    if (c.startsWith('AT')) return 'OK\r\r>';
    if (c === '03') {
      if (!this.codes.length) return '43 00\r\r>';
      const body = this.codes.map(DemoElm327.encodeDtc).join(' ');
      return `SEARCHING...\r43 ${hex(this.codes.length)} ${body}\r\r>`;
    }
    if (c === '04') { this.codes = []; return '44\r\r>'; }
    if (c === '0100') return '41 00 BE 3E B8 11\r\r>';
    if (c === '0101') return `41 01 ${hex(0x80 | this.codes.length)} 07 E5 00\r\r>`;
    if (c === '010C') { const rpm = 780 + 900 * Math.max(0, Math.sin(t / 3)) + 30 * Math.sin(t * 2.1); const v = Math.round(rpm * 4); return `41 0C ${hex(v >> 8)} ${hex(v & 255)}\r\r>`; }
    if (c === '010D') return `41 0D ${hex(Math.max(0, 40 * Math.sin(t / 6)))}\r\r>`;
    if (c === '0105') return `41 05 ${hex(40 + Math.min(90, 35 + t * 2))}\r\r>`;
    if (c === '0104') return `41 04 ${hex(255 * (0.18 + 0.25 * Math.max(0, Math.sin(t / 3))))}\r\r>`;
    if (c === '010F') return `41 0F ${hex(40 + 24)}\r\r>`;
    if (c === '0106') return `41 06 ${hex(128 + 6 + 4 * Math.sin(t))}\r\r>`;
    if (c === '0107') return `41 07 ${hex(128 + 14)}\r\r>`;
    if (c === '0111') return `41 11 ${hex(255 * (0.13 + 0.2 * Math.max(0, Math.sin(t / 3))))}\r\r>`;
    if (c === '0142') return '41 42 37 6E\r\r>';
    if (c === '0202') return `42 02 00 ${DemoElm327.encodeDtc(this.codes[0] || 'P0000')}\r\r>`;
    if (c === '020500') return '42 05 00 7B\r\r>';
    if (c === '020C00') return '42 0C 00 0B B8\r\r>';
    if (c === '020D00') return '42 0D 00 3C\r\r>';
    if (c === '020400') return '42 04 00 99\r\r>';
    if (/^0[12]/.test(c)) return 'NO DATA\r\r>';
    return '?\r\r>';
  }

  async send(cmd) {
    this._log('tx', cmd);
    await new Promise((r) => setTimeout(r, this.delay));
    const out = this.respond(cmd);
    this._log('rx', out.replace(/>/g, '').trim());
    return out;
  }
}
