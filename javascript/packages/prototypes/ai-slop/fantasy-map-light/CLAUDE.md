# @hw/faenwald-light

Веб-прототип для разбиения игровой карты на провинции: пользователь загружает
PNG-карту, рисует поверх неё слой провинций (каждая провинция — свой цвет,
white `#FFFFFF` = «нет провинции») и экспортирует PNG слоя + JSON метаданных.

Полные требования и бизнес-логика — `docs/requirements.md`; DoD/чеклист —
`docs/checklist.md`.

**Статус:** реализовано полностью — все пункты DoD закрыты и проверены
автоматизированным харнессом на реальном canvas (headless Chrome): загрузка PNG,
автосоздание white-слоя провинций под размер карты, прозрачность (только
отображение), инструменты «Рисовать»/«Ластик»/«Пипетка», генерация уникальных
не-white цветов, **Undo/Redo** (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`), **зум вокруг
курсора** (`Ctrl/Cmd+Wheel` + pinch тачпада), **cleanup «мёртвых» провинций**,
экспорт PNG+JSON.

## Техстек

- **Vite 7** — дев-сервер и сборка (стандарт для прототипов монорепы).
- **React 19 + TypeScript (strict)** — версии выровнены с корневыми `resolutions`.
- **`@vitejs/plugin-react-swc`** — SWC-трансформ (быстрый старт/HMR).
- **CSS Modules** (`*.module.css`, `localsConvention: "camelCaseOnly"`).
- **Алиас `@` → `./src`**. ESM везде.

Никаких сторонних графических библиотек: слой провинций — обычный offscreen
`<canvas>`, экспорт через `canvas.toBlob` + `Blob`.

## Как запустить

```sh
# из корня пакета
yarn start          # дев-сервер Vite (host 0.0.0.0)
yarn build          # tsc --noEmit + vite build (типы + прод-сборка)
```

`yarn install` — из корня монорепы (пакет входит в yarn workspaces).

## Структура

- `index.html` / `src/index.tsx` — bootstrap: `createRoot(#root)` → `<App/>`.
- `src/canvas/` — чистая логика (без React):
  - `color.ts` — `RgbaColor` (каналы 0..255), `WHITE`, hex↔rgba, `isWhite`.
  - `coordinates.ts` — контракт экран↔карта: `CanvasTransform`, `fitTransform`
    (contain-центрирование), `screenToMap`/`mapToScreen`, `isInsideMap`,
    `clampTransform` (пределы масштаба + карта не «улетает»), `zoomAt` (зум
    вокруг курсора: точка под курсором остаётся на месте).
  - `pixel-buffer.ts` — `PixelBuffer`: offscreen-буфер слоя провинций в
    натуральном разрешении карты (`willReadFrequently`). `fill`, `getPixel`,
    `fillRect`/`stamp` (точная запись без AA; возвращают `boolean` — попал ли
    штрих в границы), `snapshot`, `restore` (Undo/Redo), `canvas`.
  - `history.ts` — `EditHistory`: Undo/Redo со стеками состояний (`EditState` =
    пиксели + снимок реестра). `begin`/`commit`/`cancel` (единица — штрих),
    `undo`/`redo`; новый commit чистит ветку Redo; лимит `MAX_HISTORY`.
  - `canvas-model.ts` — `CanvasModel`: два слоя (карта снизу, провинции поверх),
    `provinces: PixelBuffer`, `setOpacity` (только отображение),
    `render(ctx, transform, w, h)` (source-over, `imageSmoothingEnabled = false`).
  - `load-map-image.ts` — загрузка/декодирование PNG: валидация типа,
    `createImageBitmap` с фолбэком на `<img>`, растеризация в offscreen-canvas.
- `src/provinces/` — доменная логика провинций:
  - `province-registry.ts` — `ProvinceRegistry`: реестр созданных провинций +
    `generateUniqueColor()` (golden-angle HSL-перебор → уникальный, не-white
    цвет; коллизии сдвигаются дальше). `snapshot`/`restore` (Undo/Redo),
    `prune(aliveHexes)` (cleanup «мёртвых»), монотонный счётчик имён.
  - `export.ts` — `exportProvinces`: сканирует ПИКСЕЛИ буфера → JSON
    (`buildProvincesJson`, ключ = hex цвета, метаданные + центроид), скачивает
    `provinces.png` (напрямую из буфера — без display-opacity) и `provinces.json`.
    `collectUsedHexes(buffer)` — множество живых не-white цветов (основа cleanup).
- `src/ui/` — представление (React):
  - `app.tsx` — корневой компонент, монтирует `CanvasStage`.
  - `canvas-stage.tsx` — весь UI: загрузка PNG, слайдер прозрачности, выбор
    инструмента (Рисовать/Ластик/Пипетка), размер кисти, «Отменить»/«Повторить»,
    «Новая провинция», «Скачать»; рендер (DPR + `ResizeObserver`, transform с
    учётом зума через `zoomAt`/`clampTransform`); рисование/ластик штампами кисти
    вдоль отрезка (без разрывов), пипетка; Undo/Redo через `EditHistory` (клавиши
    + кнопки), cleanup «мёртвых» провинций после штриха/Undo/Redo, зум по
    `Ctrl/Cmd+Wheel` (нативный listener `passive:false`).

## Ключевые контракты

- **Слои холста:** ровно два. База (карта) снизу, провинции поверх (source-over,
  порядок фиксирован). Слой провинций — offscreen `PixelBuffer` в НАТУРАЛЬНОМ
  разрешении карты, дефолт — сплошной white (`#FFFFFF` = «нет провинции»).
- **Пиксели ↔ отображение:** `opacity` и масштаб экрана меняют ТОЛЬКО композицию
  (`globalAlpha` при отрисовке провинций), не буфер. Поэтому экспортируемый PNG
  всегда содержит исходные цвета без артефактов прозрачности.
- **Точность рисования:** кисть пишет через `putImageData` — пиксели ровно
  выбранного цвета, без сглаживания/полупрозрачных краёв. Рисование/пипетка вне
  карты клипятся/возвращают `null` — не падают.
- **Уникальность цветов:** `generateUniqueColor` гарантирует цвет ≠ white и ≠
  любой уже созданной провинции.
- **Согласованность экспорта:** JSON строится сканированием фактических пикселей
  PNG-буфера, поэтому набор цветов в JSON в точности равен набору цветов в PNG.
  Пипетка по white не создаёт провинцию (явно определённое поведение).
- **История = штрих:** единица Undo/Redo — один законченный штрих (pointerdown→up),
  не штамп. `begin` снимает состояние ДО, `commit`/`cancel` завершает; штрих без
  реальной записи (весь вне карты) в историю не попадает. Состояние истории =
  пиксели буфера + снимок реестра → Undo/Redo восстанавливают их согласованно.
- **Cleanup «мёртвых»:** после каждого штриха/Undo/Redo реестр приводится к
  фактическим цветам буфера (`collectUsedHexes` → `prune`). Провинция без пикселей
  удаляется, её цвет освобождается (`generateUniqueColor` может выдать повторно),
  а если она была активной кистью — активный цвет сбрасывается.
- **Зум только отображение:** `zoomAt`/`clampTransform` меняют лишь `transform`
  (масштаб/сдвиг), буфер не трогается; `imageSmoothingEnabled=false` → пиксели
  чёткие. Масштаб зажат в `[fitScale, MAX_SCALE]`; экран↔карта всегда через
  актуальный `transform`, поэтому рисование/пипетка верны при любом зуме.

## Проверка

Логика проверяется прогоном харнесса на реальном canvas в headless Chrome
(создаётся синтетический PNG → загрузка → рисование → пипетка → экспорт →
re-decode PNG со сверкой цветов). Улучшения (Undo/Redo, cleanup, zoom, ластик)
проверены отдельным харнессом на реальном `PixelBuffer`/canvas — 32/32 PASS.
Отметки DoD — в `docs/current-task.md`.

## Конвенции кода

- Компоненты — `FC` + `memo`, именованный экспорт.
- Импорты внутри пакета — через алиас `@/…`. Отступ — 4 пробела.
