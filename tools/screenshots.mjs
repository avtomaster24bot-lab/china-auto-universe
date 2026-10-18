// Смоук-тест в headless Chromium + скриншоты в screenshots/.
// Запуск: сервер на BASE (по умолчанию http://localhost:8080/), затем `node tools/screenshots.mjs`.
// CHROME_PATH — путь к Chrome/Chromium (по умолчанию /usr/bin/google-chrome).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { computeCheckDigit } from '../web/js/vin.js';

const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const v = 'LVVDB21B0RD123456';
const VIN = v.slice(0, 8) + computeCheckDigit(v) + v.slice(9);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'ru-RU',
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));

async function go(hash, waitFor) {
  await page.goto(BASE + hash, { waitUntil: 'networkidle' });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 8000 });
}
const shot = async (name, full = true) => {
  // Для полноэкранных снимков меню ставим в конец страницы, иначе fixed-элементы «плавают» посередине
  if (full) await page.addStyleTag({ content: '.bottomnav{position:static!important}.topbar{position:static!important}body{padding-bottom:0!important}' });
  await page.screenshot({ path: OUT + name, fullPage: full }); console.log('📸', name); };

await go('#/', '.tiles .tile'); await shot('01-home.png');
await go(`#/vin/${VIN}`, '.vin-split'); await shot('02-vin-result.png');
await go('#/dtc/P0300', '.code-big'); await shot('03-dtc-card.png');
await go('#/obd', '#btn-demo');
await page.click('#btn-demo');
await page.waitForSelector('#btn-read', { timeout: 10000 });
await page.click('#btn-read');
await page.waitForSelector('#obd-result .dtc-list a', { timeout: 10000 });
await shot('04-obd-demo-codes.png');
await page.click('#btn-live');
await page.waitForFunction(() => document.querySelector('#g-0C .v')?.textContent !== '—', null, { timeout: 10000 });
await page.waitForTimeout(1500);
await shot('05-obd-demo-live.png');
await page.click('#btn-ff');
await page.waitForSelector('#obd-result table', { timeout: 10000 });
await shot('06-obd-demo-freeze-frame.png');

// Остальные страницы — смоук-проверка
for (const [hash, sel, name] of [
  ['#/dtc?q=лямбда', '.dtc-list a', '07-dtc-search.png'],
  ['#/symptom/nostart', 'ol.steps', '08-symptom.png'],
  ['#/rus', '.level', '09-rus.png'],
  ['#/pro', '.plans', '10-pro.png'],
  ['#/book', '#book', '11-book.png'],
  ['#/brand/haval', 'table.t', '12-brand.png'],
]) { await go(hash, sel); await shot(name); }

// Поиск с главной: код → карточка
await go('#/', '#q'); await page.fill('#q', 'p0171'); await page.press('#q', 'Enter');
await page.waitForSelector('.code-big'); const code = await page.textContent('.code-big');
if (code.trim() !== 'P0171') problems.push(`search→card: ожидали P0171, получили ${code}`);

// Service worker зарегистрирован
const sw = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then((r) => !!r.active), new Promise((r) => setTimeout(() => r(false), 8000))]));
if (!sw) problems.push('service worker не зарегистрирован');

// Офлайн: после установки SW главная и карточка кода открываются без сети
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 }).catch(() => {});
const before = problems.length;
await ctx.setOffline(true);
await page.goto(BASE + '#/dtc/P0420', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.code-big', { timeout: 8000 }).catch(() => problems.push('офлайн: карточка кода не открылась'));
await ctx.setOffline(false);
// сбои запросов в офлайне ожидаемы — убираем только их
const during = problems.splice(before);
problems.push(...during.filter((x) => !x.startsWith('requestfailed') && !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(x)));

// Десктоп-скриншот главной
await page.setViewportSize({ width: 1280, height: 900 });
await go('#/', '.tiles .tile'); await shot('13-home-desktop.png');

await browser.close();
if (problems.length) { console.error('ПРОБЛЕМЫ:\n' + problems.join('\n')); process.exit(1); }
console.log('OK: страницы загружаются, ошибок JS нет, SW зарегистрирован.');
