import { decodeVin, normalizeVin } from './vin.js';
import { INIT_COMMANDS, parseDtcResponse, parsePidResponse, protocolName, isCanProtocol, responseError, PIDS, decodeDtc, parseMessages } from './obd.js';
import { BleElm327, DemoElm327, webBluetoothSupport } from './elm327.js';

const app = document.getElementById('app');
const state = { data: {}, obd: { adapter: null, name: '', can: undefined, protocol: '', live: false, timer: null, codes: null, demo: false } };

// ---------- утилиты ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
async function load(name, path) {
  if (!state.data[name]) state.data[name] = fetch(path).then((r) => { if (!r.ok) throw new Error(path); return r.json(); });
  return state.data[name];
}
const dtcDb = () => load('dtc', 'data/dtc/generic.json');
const wmiDb = () => load('wmi', 'data/vehicles/wmi.json');
const brandsDb = () => load('brands', 'data/vehicles/brands.json');
const symptomsDb = () => load('symptoms', 'data/symptoms/symptoms.json');
const SEV = { high: 'Серьёзно', medium: 'Средне', low: 'Не срочно' };
const LIKE = { high: 'часто', medium: 'иногда', low: 'редко' };

const ICONS = {
  engine: '<svg viewBox="0 0 24 24"><path d="M4 10h2V8h4V6h4v2h2l2 2h2v6h-2l-2 2H8l-2-2H4z"/><path d="M12 10v3M12 15.5v.01"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="7.5" cy="14.5" r="3.5"/><path d="M10 12l9-9M15 7l3 3M17 5l2 2"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  car: '<svg viewBox="0 0 24 24"><path d="M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v5h-3v-2H6v2H3z"/><path d="M3 13h18"/><circle cx="7" cy="15" r=".5"/><circle cx="17" cy="15" r=".5"/><path d="M9 3l6 6M15 3L9 9" stroke="#dc2626"/></svg>',
  lang: '<svg viewBox="0 0 24 24"><path d="M3 5h8M7 3v2M5 5c0 4 2 7 6 8M9 5c0 4-2 7-6 8"/><path d="M13 20l4-9 4 9M14.5 17h5"/></svg>',
  vin: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4M10 10v4M13 10v4M16 10v4"/></svg>',
  plug: '<svg viewBox="0 0 24 24"><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/></svg>',
};

function setNav(route) {
  document.querySelectorAll('.bottomnav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === route));
}
function back(href = '#/', label = 'Назад') { return `<a class="back" href="${href}">← ${label}</a>`; }
function ctaBlock(text = 'Не хотите разбираться сами? Мастер проверит машину и объяснит простыми словами.') {
  return `<section class="cta"><h2>Запишитесь в Автомастер 24</h2><p>${esc(text)}</p><a class="btn" href="#/book">Записаться</a></section>`;
}
const footer = () => `<div class="footer">AutoChina Encyclopedia · демо-версия · Автомастер 24<br>Информация носит справочный характер. Перед ремонтом сверяйтесь с документацией производителя.</div>`;

// ---------- маршрутизация ----------
const routes = [
  [/^\/?$/, pageHome, 'home'],
  [/^\/vin\/?(.*)$/, pageVin, 'vin'],
  [/^\/dtc\/([A-Za-z0-9]{5})$/, pageDtcCard, 'dtc'],
  [/^\/dtc\/?$/, pageDtcSearch, 'dtc'],
  [/^\/obd\/?$/, pageObd, 'obd'],
  [/^\/rus\/?$/, pageRus, 'home'],
  [/^\/pro\/?$/, pagePro, 'pro'],
  [/^\/book\/?$/, pageBook, ''],
  [/^\/symptom\/([a-z]+)$/, pageSymptom, 'home'],
  [/^\/brand\/([a-z]+)$/, pageBrand, 'home'],
];

async function router() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = hash.split('?');
  const params = new URLSearchParams(qs || '');
  if (!path.startsWith('/obd')) stopLive();
  for (const [re, fn, nav] of routes) {
    const m = path.match(re);
    if (m) {
      setNav(nav);
      try { await fn(m, params); } catch (e) { console.error(e); app.innerHTML = `<div class="notice bad"><b>Ошибка загрузки</b>${esc(e.message)}</div>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  app.innerHTML = `${back()}<h1>Страница не найдена</h1>`;
}
window.addEventListener('hashchange', router);

// ---------- главная ----------
async function pageHome() {
  const [sym, brands] = await Promise.all([symptomsDb(), brandsDb()]);
  document.title = 'AutoChina — энциклопедия китайских авто | Автомастер 24';
  app.innerHTML = `
    <section class="hero">
      <h1>Что случилось с машиной?</h1>
      <p>Нажмите на картинку — подскажем, что делать.</p>
      <form class="search" id="q-form" role="search">
        <input id="q" placeholder="Код, VIN или слово" aria-label="Поиск" autocomplete="off">
        <button class="btn btn-accent" type="submit">Найти</button>
      </form>
    </section>
    <div class="tiles">
      ${sym.items.map((s) => `<a class="tile" href="${s.id === 'rus' ? '#/rus' : '#/symptom/' + s.id}">
        <span class="ico ${s.color}">${ICONS[s.icon]}</span>${esc(s.title)}</a>`).join('')}
      <a class="tile" href="#/vin"><span class="ico c-slate">${ICONS.vin}</span>Проверить VIN</a>
      <a class="tile wide" href="#/obd"><span class="ico c-blue">${ICONS.plug}</span><span>Диагностика через адаптер<br><small class="muted">ELM327 по Bluetooth · есть демо</small></span></a>
    </div>
    <h2>Ваша марка</h2>
    <div class="brands">
      ${brands.items.map((b) => `<a class="brand" href="#/brand/${b.id}"><span class="mark" style="background:${b.color}">${esc(b.name[0])}</span>${esc(b.name)}</a>`).join('')}
    </div>
    ${ctaBlock()}
    ${footer()}`;
  $('#q-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#q').value.trim();
    const v = normalizeVin(q);
    if (v.length === 17) location.hash = `#/vin/${encodeURIComponent(v)}`;
    else if (/^[PCBU][0-9A-F]{4}$/i.test(q)) location.hash = `#/dtc/${q.toUpperCase()}`;
    else location.hash = `#/dtc?q=${encodeURIComponent(q)}`;
  });
}

// ---------- симптом ----------
async function pageSymptom(m) {
  const [sym, dtc] = await Promise.all([symptomsDb(), dtcDb()]);
  const s = sym.items.find((x) => x.id === m[1]);
  if (!s) { app.innerHTML = `${back()}<h1>Не найдено</h1>`; return; }
  const codes = s.codes.map((c) => dtc.items.find((d) => d.code === c)).filter(Boolean);
  app.innerHTML = `${back()}
    <div class="row"><span class="tile" style="min-height:auto;padding:0;box-shadow:none;background:none"><span class="ico ${s.color}">${ICONS[s.icon]}</span></span>
    <h1 style="margin:0">${esc(s.title)}</h1></div>
    <p class="muted">${esc(s.intro)}</p>
    ${(s.actions || []).length ? `<div class="stack" style="margin:14px 0">${s.actions.map((a) => `<a class="btn btn-xl ${a.style}" href="${a.href}">${esc(a.label)}</a>`).join('')}</div>` : ''}
    ${s.checks.length ? `<div class="card"><h2 style="margin-top:0">Проверьте сами</h2><ol class="steps">${s.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ol></div>` : ''}
    ${!s.actions ? `<a class="btn btn-xl btn-accent" href="#/obd">Прочитать ошибки адаптером</a>` : ''}
    ${codes.length ? `<h2>Частые коды при этом симптоме</h2><div class="dtc-list">${codes.map(dtcRow).join('')}</div>` : ''}
    ${ctaBlock()}${footer()}`;
}

// ---------- марка ----------
async function pageBrand(m) {
  const [brands, wmi] = await Promise.all([brandsDb(), wmiDb()]);
  const b = brands.items.find((x) => x.id === m[1]);
  if (!b) { app.innerHTML = `${back()}<h1>Марка не найдена</h1>`; return; }
  const w = wmi.items.filter((x) => x.brands.some((n) => n.toLowerCase() === b.name.toLowerCase()));
  localStorage.setItem('brand', b.id);
  app.innerHTML = `${back()}
    <div class="row"><span class="mark" style="width:64px;height:64px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:900;font-size:26px;background:${b.color}">${esc(b.name[0])}</span>
    <div><h1 style="margin:0">${esc(b.name)}</h1><div class="muted">${esc(b.group)}</div></div></div>
    <div class="stack" style="margin:16px 0">
      <a class="btn btn-xl" href="#/obd">Диагностика адаптером</a>
      <a class="btn btn-xl btn-ghost" href="#/dtc">Коды ошибок</a>
      <a class="btn btn-xl btn-ghost" href="#/rus">Русификация</a>
    </div>
    <div class="card"><h2 style="margin-top:0">Как узнать ${esc(b.name)} по VIN</h2>
      <p class="small muted">Первые 3 символа VIN (WMI), которые встречаются у этой марки (по открытым источникам, таблица неполная):</p>
      ${w.length ? `<table class="t"><tr><th>WMI</th><th>Производитель</th><th>Страна</th></tr>${w.map((x) => `<tr><td class="mono"><b>${x.wmi}</b></td><td>${esc(x.manufacturer)}</td><td>${esc(x.country)}</td></tr>`).join('')}</table>` : '<p>Нет данных.</p>'}
    </div>
    <div class="notice"><b>Скоро</b>Модели, поколения, электросхемы, чертежи коробок и пошаговые инструкции по ${esc(b.name)}. В демо-версии раздел ещё не наполнен.</div>
    ${ctaBlock()}${footer()}`;
}

// ---------- VIN ----------
async function pageVin(m) {
  const wmi = await wmiDb();
  const initial = decodeURIComponent(m[1] || '');
  document.title = 'VIN-декодер — AutoChina';
  app.innerHTML = `${back()}
    <h1>Проверить VIN</h1>
    <p class="muted">17 символов. Найдите в СТС, под лобовым стеклом или на стойке водительской двери.</p>
    <form class="search" id="vin-form">
      <input id="vin" class="mono" maxlength="24" placeholder="Например, LVVDB21B0RD123456" value="${esc(initial)}" autocapitalize="characters" autocomplete="off" aria-label="VIN">
      <button class="btn" type="submit">Проверить</button>
    </form>
    <div id="vin-out"></div>
    <details class="card flat" style="margin-top:16px"><summary>Как устроен VIN (ISO 3779)</summary>
      <p><b>WMI</b> (1–3) — производитель. <b>VDS</b> (4–9) — описание машины: кузов, двигатель, коробка; кодировку каждый завод выбирает сам. 9-й символ — контрольная цифра.
      <b>VIS</b> (10–17) — 10-й символ: модельный год, 11-й: завод, 12–17: серийный номер.</p>
      <p class="small muted">Контрольная цифра: в ISO 3779 (Европа) необязательна, в Северной Америке и в Китае (GB 16735-2019) — обязательна.</p>
    </details>
    <details class="card flat"><summary>Таблица WMI (частичная, демо)</summary>
      <p class="small muted">Источник: <a href="${esc(wmi._meta.source_url)}" target="_blank" rel="noopener">${esc(wmi._meta.source)}</a>, проверено ${esc(wmi._meta.accessed)}. Включены только коды из источника. Таблица неполная.</p>
      <table class="t"><tr><th>WMI</th><th>Производитель</th><th>Марки</th></tr>
      ${wmi.items.map((x) => `<tr><td class="mono"><b>${x.wmi}</b></td><td>${esc(x.manufacturer)}<br><small class="muted">${esc(x.country)}</small></td><td>${esc(x.brands.join(', '))}</td></tr>`).join('')}</table>
    </details>${footer()}`;
  const run = () => {
    const v = $('#vin').value;
    if (!v.trim()) { $('#vin-out').innerHTML = ''; return; }
    $('#vin-out').innerHTML = renderVin(decodeVin(v, wmi.items));
    history.replaceState(null, '', `#/vin/${encodeURIComponent(normalizeVin(v))}`);
  };
  $('#vin-form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  if (initial) run();
}

function renderVin(r) {
  if (!r.ok) return `<div class="notice bad"><b>VIN не прошёл проверку</b>${r.errors.map(esc).join('<br>')}</div>`;
  const m = r.manufacturer;
  const maxY = new Date().getFullYear() + 1;
  const other = r.year.candidates.filter((y) => y !== r.year.likely && y <= maxY);
  const yearsTxt = other.length ? `или ${other.join(', ')} (код повторяется раз в 30 лет)` : '';
  return `
    <div class="vin-split">
      <div class="vin-seg seg-wmi"><div class="v">${r.sections.wmi}</div><div class="l">WMI · завод</div></div>
      <div class="vin-seg seg-vds"><div class="v">${r.sections.vds}</div><div class="l">VDS · описание</div></div>
      <div class="vin-seg seg-vis"><div class="v">${r.sections.vis}</div><div class="l">VIS · год, номер</div></div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">${m ? esc(m.brands.join(' / ')) : 'Производитель не определён'}</h2>
      <dl class="kv">
        <dt>Производитель</dt><dd>${m ? esc(m.manufacturer) : '— (нет в демо-таблице)'}</dd>
        <dt>Страна (по WMI)</dt><dd>${esc(m ? m.country : r.country)}</dd>
        <dt>Модельный год</dt><dd>${r.year.likely ?? '—'} <small class="muted">${esc(yearsTxt)}</small></dd>
        <dt>Код завода</dt><dd class="mono">${r.plantCode}</dd>
        <dt>Серийный номер</dt><dd class="mono">${r.serial}</dd>
        <dt>Контрольная цифра</dt><dd>${r.check.ok ? `<span class="badge low">совпадает (${r.check.actual})</span>` : `<span class="badge medium">не совпадает: ${r.check.actual}, ожидается ${r.check.expected}</span>`}</dd>
      </dl>
    </div>
    ${r.warnings.map((w) => `<div class="notice warn">${esc(w)}</div>`).join('')}
    <div class="notice"><b>Двигатель, коробка, комплектация</b>Расшифровка VDS (символы 4–8) у каждого завода своя. В демо её нет — появится в базе моделей. Год по 10-му символу — это модельный год, он может отличаться от года выпуска.</div>`;
}

// ---------- DTC ----------
function dtcRow(d) {
  return `<a href="#/dtc/${d.code}"><span class="code">${d.code}</span><span class="t">${esc(d.title.ru)}<small>${esc(d.system)}</small></span><span class="badge ${d.severity}">${SEV[d.severity]}</span></a>`;
}
async function pageDtcSearch(m, params) {
  const db = await dtcDb();
  document.title = 'Коды ошибок OBD-II — AutoChina';
  const q0 = params.get('q') || '';
  app.innerHTML = `${back()}
    <h1>Коды ошибок</h1>
    <form class="search" id="dtc-form" role="search">
      <input id="dtc-q" placeholder="P0300, «лямбда», «пропуски»…" value="${esc(q0)}" autocomplete="off" aria-label="Поиск кода">
      <button class="btn" type="submit">Найти</button>
    </form>
    <p class="small muted" id="dtc-count"></p>
    <div class="dtc-list" id="dtc-list"></div>
    <div class="notice small">${esc(db._meta.disclaimer)} ${esc(db._meta.manufacturer_specific)}</div>${footer()}`;
  const render = () => {
    const q = $('#dtc-q').value.trim().toLowerCase();
    const list = db.items.filter((d) => !q || [d.code, d.title.ru, d.title.en, d.system, ...d.symptoms].join(' ').toLowerCase().includes(q));
    $('#dtc-count').textContent = q ? `Найдено: ${list.length}` : `Всего кодов в демо-базе: ${list.length}`;
    $('#dtc-list').innerHTML = list.length ? list.map(dtcRow).join('')
      : `<div class="notice warn"><b>Ничего не нашли</b>${/^[PCBU][0-9A-F]{4}$/i.test(q) ? 'Этого кода пока нет в демо-базе. ' + (/^[PCBU]1/i.test(q) ? 'Коды с цифрой 1 после буквы — производительские, их расшифровка зависит от марки.' : '') : 'Попробуйте ввести код, например P0300.'}</div>`;
  };
  $('#dtc-q').addEventListener('input', render);
  $('#dtc-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#dtc-q').value.trim().toUpperCase();
    if (db.items.some((d) => d.code === q)) location.hash = `#/dtc/${q}`; else render();
  });
  render();
}

async function pageDtcCard(m) {
  const db = await dtcDb();
  const code = m[1].toUpperCase();
  const d = db.items.find((x) => x.code === code);
  document.title = `${code} — расшифровка кода | AutoChina`;
  if (!d) {
    const known = /^[PCBU]0/.test(code);
    app.innerHTML = `${back('#/dtc', 'Все коды')}<div class="code-big">${esc(code)}</div>
      <div class="notice warn"><b>Карточки пока нет</b>${known ? 'Это стандартный (generic) код, но в демо-базе его ещё нет.' : 'Это производительский код: расшифровка зависит от марки и модели.'} Мастер Автомастер 24 расшифрует его для вашей машины.</div>${ctaBlock()}`;
    return;
  }
  const kind = { P: 'Двигатель и трансмиссия', C: 'Шасси', B: 'Кузов', U: 'Сеть (связь блоков)' }[code[0]];
  app.innerHTML = `${back('#/dtc', 'Все коды')}
    <div class="card">
      <div class="row" style="justify-content:space-between"><div class="code-big">${d.code}</div><span class="badge ${d.severity}">${SEV[d.severity]}</span></div>
      <h1 style="font-size:22px;margin:12px 0 4px">${esc(d.title.ru)}</h1>
      <p class="muted small" lang="en">${esc(d.title.en)}</p>
      <p class="small"><span class="badge">${esc(d.system)}</span> <span class="badge">${kind}</span> <span class="badge">SAE J2012 generic</span></p>
      ${d.symptoms.length ? `<p><b>Как проявляется:</b> ${esc(d.symptoms.join(', '))}.</p>` : ''}
    </div>
    <div class="card"><h2 style="margin-top:0">Вероятные причины</h2>
      <ul class="clean">${d.causes.map((c) => `<li><span>${esc(c.text)}</span><span class="badge ${c.likelihood}">${LIKE[c.likelihood]}</span></li>`).join('')}</ul></div>
    <div class="card"><h2 style="margin-top:0">Что делать по шагам</h2><ol class="steps">${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
    <div class="card"><h2 style="margin-top:0">Что понадобится</h2><ul class="check">${d.tools.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <div class="card flat"><h3 style="margin-top:0">Связанные разделы энциклопедии</h3>
      <ul class="clean">${d.related.map((r) => `<li><span>${esc(r)}</span><span class="badge">скоро</span></li>`).join('')}</ul>
      <p class="small muted">Схемы и инструкции будут привязаны к модели и году выпуска.</p></div>
    <div class="notice small">${esc(db._meta.disclaimer)}</div>
    ${ctaBlock(`Код ${d.code} не уходит? Мастер найдёт причину и покажет, что именно сломалось.`)}${footer()}`;
}

// ---------- OBD ----------
const LIVE_PIDS = ['0C', '0D', '05', '04'];
const LIVE_MAX = { '0C': 7000, '0D': 200, '05': 130, '04': 100 };
function stopLive() { state.obd.live = false; clearTimeout(state.obd.timer); }

function logLine(e) {
  const box = $('#obd-log'); if (!box) return;
  const div = document.createElement('div');
  div.className = e.dir;
  div.textContent = `${e.dir === 'tx' ? '→' : e.dir === 'rx' ? '←' : '•'} ${e.text.replace(/\r/g, ' ')}`;
  box.appendChild(div); box.scrollTop = box.scrollHeight;
}

async function pageObd() {
  document.title = 'Онлайн-диагностика OBD2 — AutoChina';
  const sup = webBluetoothSupport();
  const o = state.obd;
  app.innerHTML = `${back()}
    <h1>Диагностика адаптером</h1>
    <div class="card"><div class="status"><span class="dot ${o.adapter ? 'on' : ''}" id="obd-dot"></span><span id="obd-status">${o.adapter ? esc(o.name) : 'Адаптер не подключён'}</span></div>
      <div class="small muted" id="obd-proto">${o.protocol ? esc(o.protocol) : ''}</div></div>
    ${sup.ok || o.adapter ? '' : `<div class="notice warn" id="bt-warn"><b>Bluetooth в этом браузере недоступен</b>${esc(sup.reason)}<br>Подключение работает в Chrome и Edge на Android и компьютере. Не работает на iPhone/iPad, в Safari и Firefox. Пока можно попробовать демо-режим.</div>`}
    <div id="obd-main"></div>
    <details class="card flat"><summary>Журнал обмена с адаптером</summary><div class="log" id="obd-log"></div></details>
    <details class="card flat"><summary>Какой адаптер подойдёт</summary>
      <ul class="small">
        <li>ELM327 с <b>Bluetooth LE (4.0+)</b>. Классический Bluetooth 2.0 и Wi-Fi-адаптеры браузер не видит.</li>
        <li>Разъём OBD2 обычно под рулём слева. Включите зажигание или заведите двигатель.</li>
        <li>Обычный ELM327 читает стандартные ошибки двигателя (OBD-II). Ошибки ABS, подушек безопасности и коробки у многих китайских марок требуют специального сканера.</li>
        <li>Поддерживаемые протоколы (через ELM327): ISO 15765-4 CAN, ISO 14230-4 KWP2000, ISO 9141-2, SAE J1850.</li>
      </ul></details>${footer()}`;
  (o.adapter?.log || []).slice(-60).forEach(logLine);
  renderObdMain(sup);
}

function renderObdMain(sup = webBluetoothSupport()) {
  const o = state.obd;
  const main = $('#obd-main'); if (!main) return;
  if (!o.adapter) {
    main.innerHTML = `<div class="stack">
      <button class="btn btn-xl" id="btn-ble" ${sup.ok ? '' : 'disabled'}>Подключить адаптер (Bluetooth)</button>
      <button class="btn btn-xl btn-accent" id="btn-demo">Демо-режим — без адаптера</button>
      <p class="small muted">Демо показывает, как всё работает, на имитированных ответах ELM327.</p></div>`;
    $('#btn-ble').onclick = () => connect(new BleElm327(), false);
    $('#btn-demo').onclick = () => connect(new DemoElm327(), true);
    return;
  }
  main.innerHTML = `
    ${o.demo ? '<div class="notice"><b>Демо-режим</b>Данные имитированы, машина не подключена.</div>' : ''}
    <div class="stack">
      <button class="btn btn-xl btn-accent" id="btn-read">Прочитать ошибки</button>
      <button class="btn btn-xl" id="btn-live">${o.live ? 'Остановить живые данные' : 'Живые данные'}</button>
      <div class="row"><button class="btn btn-ghost" id="btn-ff" style="flex:1">Стоп-кадр</button>
      <button class="btn btn-danger" id="btn-clear" style="flex:1">Стереть ошибки</button></div>
      <button class="btn btn-sm btn-ghost" id="btn-off">Отключить</button>
    </div>
    <div id="obd-result" style="margin-top:16px"></div>`;
  $('#btn-read').onclick = readCodes;
  $('#btn-live').onclick = toggleLive;
  $('#btn-ff').onclick = freezeFrame;
  $('#btn-clear').onclick = clearCodes;
  $('#btn-off').onclick = async () => { stopLive(); await o.adapter.disconnect(); Object.assign(o, { adapter: null, name: '', protocol: '', demo: false, codes: null }); pageObd(); };
  if (o.codes) showCodes(o.codes);
  if (o.live) { showGauges(); }
}

function setStatus(text, on) {
  if ($('#obd-status')) $('#obd-status').textContent = text;
  if ($('#obd-dot')) $('#obd-dot').classList.toggle('on', !!on);
}

async function connect(adapter, demo) {
  const o = state.obd;
  adapter.onlog = logLine;
  const main = $('#obd-main');
  main.innerHTML = `<div class="card"><h2 style="margin-top:0">Подключаемся…</h2><ol class="steps" id="init-steps"></ol></div>`;
  const step = (t) => { const li = document.createElement('li'); li.textContent = t; $('#init-steps')?.appendChild(li); };
  try {
    setStatus('Поиск адаптера…');
    const name = await adapter.connect();
    step(`Найден: ${name}`);
    for (const cmd of INIT_COMMANDS) {
      const r = await adapter.send(cmd);
      step(`${cmd} → ${r.replace(/[>\r\n]+/g, ' ').trim() || 'OK'}`);
    }
    // Первый запрос запускает автоопределение протокола (SEARCHING...)
    const probe = await adapter.send('0100', 15000);
    const err = responseError(probe);
    if (err && err !== 'NO DATA') throw new Error(`Адаптер не связался с машиной (${err}). Включите зажигание и попробуйте ещё раз.`);
    const dpn = (await adapter.send('ATDPN')).replace(/[>\r\n\s]/g, '');
    const volt = (await adapter.send('ATRV')).replace(/[>\r\n\s]/g, '');
    Object.assign(o, { adapter, name, demo, can: isCanProtocol(dpn) ? true : (dpn ? false : undefined), protocol: `Протокол: ${protocolName(dpn)} · Напряжение: ${volt}` });
    setStatus(name, true);
    $('#obd-proto').textContent = o.protocol;
    $('#bt-warn')?.remove();
    renderObdMain();
  } catch (e) {
    console.warn(e);
    await adapter.disconnect?.();
    o.adapter = null;
    setStatus('Адаптер не подключён');
    const cancelled = e && (e.name === 'NotFoundError' || /cancel/i.test(e.message));
    renderObdMain();
    $('#obd-main').insertAdjacentHTML('afterbegin', `<div class="notice ${cancelled ? 'warn' : 'bad'}"><b>${cancelled ? 'Подключение отменено' : 'Не удалось подключиться'}</b>${esc(cancelled ? 'Адаптер не выбран.' : e.message)}</div>`);
  }
}

async function readCodes() {
  const o = state.obd; stopLive();
  const out = $('#obd-result');
  out.innerHTML = '<p class="muted">Читаем ошибки…</p>';
  try {
    const mil = parsePidResponse(await o.adapter.send('0101'), '01');
    const raw = await o.adapter.send('03', 10000);
    const codes = parseDtcResponse(raw, { can: o.can });
    o.codes = { list: codes, mil: mil?.value };
    showCodes(o.codes);
  } catch (e) { out.innerHTML = `<div class="notice bad"><b>Ошибка чтения</b>${esc(e.message)}</div>`; }
}

async function showCodes({ list, mil }) {
  const db = await dtcDb();
  const out = $('#obd-result'); if (!out) return;
  const milHtml = mil ? `<div class="card mil"><svg viewBox="0 0 24 24" fill="none" stroke="${mil.mil ? '#d97706' : '#16a34a'}" stroke-width="2"><path d="M4 10h2V8h4V6h4v2h2l2 2h2v6h-2l-2 2H8l-2-2H4z"/></svg>
    <div><b>Лампа Check Engine: ${mil.mil ? 'горит' : 'не горит'}</b><div class="small muted">Сохранённых кодов по данным блока: ${mil.count}</div></div></div>` : '';
  if (!list.length) { out.innerHTML = `${milHtml}<div class="notice ok"><b>Ошибок нет</b>Блок двигателя не сообщает о сохранённых кодах.</div>`; return; }
  out.innerHTML = `${milHtml}<h2>Найдено ошибок: ${list.length}</h2><div class="dtc-list">${list.map((c) => {
    const d = db.items.find((x) => x.code === c);
    return d ? dtcRow(d) : `<a href="#/dtc/${c}"><span class="code">${c}</span><span class="t">${/^[PCBU]0/.test(c) ? 'Стандартный код — карточки пока нет' : 'Код производителя — нужна расшифровка по марке'}<small>Нажмите, чтобы узнать больше</small></span></a>`;
  }).join('')}</div>`;
}

function showGauges() {
  const out = $('#obd-result'); if (!out) return;
  out.innerHTML = `<div class="gauges">${LIVE_PIDS.map((p) => `<div class="gauge" id="g-${p}"><div class="n">${esc(PIDS[p].name)}</div><div><span class="v">—</span><span class="u">${PIDS[p].unit}</span></div><div class="bar"><i style="width:0"></i></div></div>`).join('')}</div>
    <p class="small muted">Обновление ~2 раза в секунду. Формулы SAE J1979, Mode 01: PID 0C, 0D, 05, 04.</p>`;
}

async function toggleLive() {
  const o = state.obd;
  if (o.live) { stopLive(); renderObdMain(); return; }
  o.live = true; o.codes = null;
  renderObdMain();
  showGauges();
  const tick = async () => {
    if (!o.live || !o.adapter) return;
    for (const p of LIVE_PIDS) {
      if (!o.live) return;
      try {
        const r = parsePidResponse(await o.adapter.send('01' + p), p);
        const g = $(`#g-${p}`);
        if (g && r) {
          g.querySelector('.v').textContent = p === '0C' ? Math.round(r.value) : Math.round(r.value * 10) / 10;
          g.querySelector('.bar i').style.width = Math.max(0, Math.min(100, (r.value / LIVE_MAX[p]) * 100)) + '%';
        }
      } catch (e) { console.warn(e); }
    }
    o.timer = setTimeout(tick, 300);
  };
  tick();
}

async function freezeFrame() {
  const o = state.obd; stopLive(); o.codes = null; renderObdMain();
  const out = $('#obd-result');
  out.innerHTML = '<p class="muted">Читаем стоп-кадр…</p>';
  try {
    const trig = parseMessages(await o.adapter.send('0202'))
      .map((m) => { const i = m.indexOf(0x42); return i >= 0 && m[i + 1] === 0x02 ? m.slice(i + 3, i + 5) : null; })
      .find((b) => b && b.length === 2);
    const code = trig && (trig[0] || trig[1]) ? decodeDtc(trig[0], trig[1]) : null;
    const rows = [];
    for (const p of LIVE_PIDS) {
      const r = parsePidResponse(await o.adapter.send(`02${p}00`), p, 0x02);
      if (r) rows.push(`<tr><td>${esc(r.name)}</td><td><b>${r.value}</b> ${r.unit}</td></tr>`);
    }
    out.innerHTML = rows.length || code ? `<div class="card"><h2 style="margin-top:0">Стоп-кадр (freeze frame)</h2>
      <p class="small muted">Условия в момент появления ошибки${code ? ` <a href="#/dtc/${code}"><b>${code}</b></a>` : ''}.</p>
      <table class="t">${rows.join('')}</table></div>` : '<div class="notice">Стоп-кадр не сохранён (ошибок нет или блок не поддерживает Mode 02).</div>';
  } catch (e) { out.innerHTML = `<div class="notice bad"><b>Ошибка</b>${esc(e.message)}</div>`; }
}

async function clearCodes() {
  const o = state.obd; stopLive();
  if (!confirm('Стереть коды ошибок и стоп-кадры?\n\nСотрутся также данные готовности (readiness) — машина может не пройти техосмотр по экологии, пока не проедет цикл самодиагностики. Причина неисправности при этом не устраняется.')) return;
  await o.adapter.send('04');
  o.codes = null;
  renderObdMain();
  $('#obd-result').innerHTML = '<div class="notice ok"><b>Команда отправлена</b>Прочитайте ошибки ещё раз, чтобы проверить.</div>';
}

// ---------- Русификация ----------
function pageRus() {
  document.title = 'Русификация китайских автомобилей — AutoChina';
  const level = (n, color, title, who, body) => `<div class="card"><div class="level"><span class="num ${color}">${n}</span><div><h2 style="margin:0">${title}</h2><div class="small muted">${who}</div></div></div>${body}</div>`;
  app.innerHTML = `${back()}
    <h1>Русификация</h1>
    <p>Русский язык в мультимедиа, на приборной панели и в голосовом помощнике. Идём от простого к сложному — <b>начинайте всегда с уровня 1</b>.</p>
    ${level(1, 'c-green', 'Обычные настройки', 'Может каждый · без риска', `
      <ol class="steps"><li>Откройте «Настройки» → «Система» → «Язык» (на китайском интерфейсе ищите значок шестерёнки и пункт 语言).</li>
      <li>Если русского нет — проверьте обновления ПО по воздуху (OTA) или у официального дилера: у машин для рынка РФ русский обычно уже есть.</li>
      <li>Приборная панель часто берёт язык из мультимедиа — перезапустите зажигание после смены.</li></ol>`)}
    ${level(2, 'c-amber', 'Установка приложений (APK) через ADB', 'Для уверенных пользователей · средний риск', `
      <p>Для мультимедиа на Android: можно поставить русскую клавиатуру, навигатор, голосовой ввод. Системный язык этим способом обычно не меняется.</p>
      <ol class="steps"><li>Узнайте точную версию ПО и железа мультимедиа (сфотографируйте экран «Об устройстве»).</li>
      <li>Включите режим разработчика и отладку по USB/Wi-Fi. На многих машинах доступ скрыт или закрыт производителем.</li>
      <li>Подключите ноутбук с Android platform-tools (adb), установите проверенные APK.</li>
      <li>Проверьте, что штатные функции (камера, климат, CarPlay/CarLife) работают.</li></ol>
      <div class="notice warn"><b>Риски</b>Возможен отказ в гарантии на мультимедиа. Обновление по воздуху может удалить приложения или вернуть заводское состояние. Сторонние APK могут быть небезопасны — ставьте только из проверенных источников.</div>`)}
    ${level(3, 'c-red', 'Прошивка языкового файла / замена прошивки', 'Только специалист · высокий риск', `
      <p>Замена системного языкового пакета или всей прошивки мультимедиа и приборной панели.</p>
      <div class="notice bad"><b>Риски</b>Неправильная прошивка может «окирпичить» блок (он перестанет включаться). Возможна потеря гарантии, отказ функций, связанных с CAN-шиной (климат, камеры, настройки авто), и блокировка обновлений. Делайте только с резервной копией и прошивкой точно под вашу аппаратную версию.</div>`)}
    <div class="card"><h2 style="margin-top:0">Чек-лист инструментов</h2><ul class="check">
      <li>Фото экранов «Об устройстве» (версия ПО и железа) и всех текущих настроек</li>
      <li>USB-флешка (FAT32/exFAT — уточните для своей модели)</li>
      <li>Кабель USB под разъём мультимедиа и ноутбук с Android platform-tools (уровень 2)</li>
      <li>Зарядное или бустер для АКБ — питание не должно пропасть во время работы</li>
      <li>Резервная копия текущей прошивки (уровень 3)</li>
      <li>Время: двигатель и ключ рядом, машина в зоне хорошего интернета</li></ul></div>
    <div class="notice"><b>Про пароли инженерного меню</b>Мы не публикуем пароли и коды инженерных меню без проверки. В будущей базе они будут помечены: «проверено мастером» или «из сообщества, не проверено».</div>
    ${ctaBlock('Русификация в Автомастер 24: подберём безопасный способ под вашу модель и версию ПО.')}${footer()}`;
}

// ---------- Pro ----------
function pagePro() {
  document.title = 'Тарифы — AutoChina';
  app.innerHTML = `${back()}
    <h1>Бесплатно и Pro</h1>
    <p class="muted">Главное — бесплатно навсегда. Pro — для тех, кому нужно больше.</p>
    <div class="plans">
      <div class="plan"><h3>Бесплатно</h3><div class="price">0 ₽</div><ul>
        <li>Чтение стандартных ошибок адаптером</li><li>Карточки кодов с решением</li><li>VIN-декодер</li><li>Живые данные: обороты, скорость, температура, нагрузка</li><li>Русификация: инструкции уровня 1</li>
        <li class="no">История и журналы</li></ul></div>
      <div class="plan featured"><h3>Pro</h3><div class="price">цена при запуске</div><ul>
        <li>Всё из бесплатного</li><li>Журналы поездок и графики параметров</li><li>Экспорт отчёта (PDF/CSV) для сервиса</li><li>Коды и функции под вашу марку</li><li>Схемы и инструкции по вашей модели и году</li></ul>
        <button class="btn btn-accent" style="width:100%;margin-top:12px" onclick="alert('Демо: оплата пока не подключена.')">Сообщить о запуске</button></div>
      <div class="plan"><h3>Для СТО</h3><div class="price">по запросу</div><ul>
        <li>Всё из Pro по всем маркам</li><li>Несколько мастеров</li><li>Отчёт клиенту с логотипом сервиса</li><li>Расширенные инструкции и моменты затяжки</li></ul></div>
    </div>
    <div class="notice small">Комплект «адаптер BLE + год Pro» — в планах. Цены и состав тарифов не утверждены.</div>
    ${ctaBlock()}${footer()}`;
}

// ---------- Запись ----------
async function pageBook() {
  const brands = await brandsDb();
  const pre = localStorage.getItem('brand') || '';
  document.title = 'Запись в Автомастер 24';
  app.innerHTML = `${back()}
    <h1>Записаться в Автомастер 24</h1>
    <p class="muted">Оставьте телефон — перезвоним и подберём время.</p>
    <form class="card" id="book">
      <div class="field"><label for="b-name">Имя</label><input id="b-name" required autocomplete="name"></div>
      <div class="field"><label for="b-phone">Телефон</label><input id="b-phone" type="tel" required placeholder="+7" autocomplete="tel"></div>
      <div class="field"><label for="b-brand">Марка</label><select id="b-brand"><option value="">— выберите —</option>${brands.items.map((b) => `<option value="${b.id}" ${b.id === pre ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}<option value="other">Другая</option></select></div>
      <div class="field"><label for="b-what">Что случилось</label><textarea id="b-what" rows="3" placeholder="Например: горит Check Engine, код P0300"></textarea></div>
      <button class="btn btn-xl btn-accent" type="submit">Отправить заявку</button>
      <p class="small muted">Демо-версия: заявка никуда не отправляется и не сохраняется.</p>
    </form>${footer()}`;
  $('#book').addEventListener('submit', (e) => {
    e.preventDefault();
    app.innerHTML = `<div class="card" style="text-align:center;padding:30px 18px"><div style="font-size:56px">✓</div><h1>Спасибо!</h1>
      <p>Это демо: заявка <b>не отправлена</b>. В рабочей версии мастер перезвонит вам.</p><a class="btn btn-xl" href="#/">На главную</a></div>`;
  });
}

// ---------- старт ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e)));
}
router();
