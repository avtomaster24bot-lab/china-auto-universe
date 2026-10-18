// Проверка структуры JSON-данных (запускается в npm test и в CI).
import { readFileSync } from 'node:fs';
const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url)));
const errors = [];
const need = (cond, msg) => { if (!cond) errors.push(msg); };

const dtc = read('data/dtc/generic.json');
const seen = new Set();
for (const d of dtc.items) {
  need(/^[PCBU][0-3][0-9A-F]{3}$/.test(d.code), `DTC: неверный код ${d.code}`);
  need(!seen.has(d.code), `DTC: дубликат ${d.code}`); seen.add(d.code);
  need(/^[PU]0/.test(d.code), `DTC: в generic-базе только P0/U0 коды, а не ${d.code}`);
  need(d.title?.ru && d.title?.en, `DTC ${d.code}: нет названия RU/EN`);
  need(['high', 'medium', 'low'].includes(d.severity), `DTC ${d.code}: severity`);
  need(d.causes?.length > 0 && d.causes.every((c) => c.text && ['high', 'medium', 'low'].includes(c.likelihood)), `DTC ${d.code}: causes`);
  need(d.steps?.length > 0, `DTC ${d.code}: steps`);
  need(d.tools?.length > 0, `DTC ${d.code}: tools`);
  need(d.system, `DTC ${d.code}: system`);
}
const wmi = read('data/vehicles/wmi.json');
need(wmi._meta?.partial === true && wmi._meta?.source_url, 'WMI: нет пометки partial или источника');
const brands = read('data/vehicles/brands.json');
for (const b of brands.items) need(wmi.items.some((w) => w.brands.includes(b.name)), `Марка ${b.name}: нет ни одного WMI`);
const sym = read('data/symptoms/symptoms.json');
for (const s of sym.items) for (const c of s.codes) need(seen.has(c), `Симптом ${s.id}: код ${c} нет в базе`);

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Данные в порядке: ${dtc.items.length} кодов, ${wmi.items.length} WMI, ${brands.items.length} марок, ${sym.items.length} симптомов.`);
