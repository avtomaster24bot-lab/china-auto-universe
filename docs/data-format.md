# Формат данных

## data/dtc/generic.json
```json
{
  "_meta": { "standard": "...", "disclaimer": "..." },
  "items": [{
    "code": "P0300",
    "system": "Двигатель / зажигание",
    "title": { "ru": "...", "en": "..." },
    "severity": "high | medium | low",
    "symptoms": ["..."],
    "causes": [{ "text": "...", "likelihood": "high | medium | low" }],
    "steps": ["..."],
    "tools": ["..."],
    "related": ["Электросхема: ...", "Инструкция: ..."]
  }]
}
```
Правила: только generic-коды (P0xxx, U0xxx); причины и шаги — общие рекомендации без привязки к модели. Производительские коды будут в отдельных файлах `data/dtc/<brand>.json` с полями `models`, `years`, `source`, `verified`.

Исходник демо-контента — `tools/dev/make_dtc.py` (генерирует JSON). Дальше JSON можно править напрямую.

## data/vehicles/wmi.json
`{ wmi, manufacturer, brands[], country }` + `_meta` с источником, датой проверки и флагом `partial: true`. Добавлять только коды, подтверждённые источником.

## data/vehicles/brands.json
`{ id, name, nameRu, group, color }`.

## data/symptoms/symptoms.json
`{ id, title, icon, color, intro, actions[], checks[], codes[] }` — коды должны существовать в базе DTC (проверяет `tools/validate-data.mjs`).

## data/hidden-features/
Пока только шаблон. Каждая запись обязана иметь `verification: verified | community`; записи `community` показываются с пометкой «из сообщества, не проверено».
