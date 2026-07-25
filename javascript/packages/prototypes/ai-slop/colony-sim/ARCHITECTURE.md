# Colony Sim — архитектура прототипа

Colony-sim (в духе RimWorld/DF) на Web. Источник данных — IndexedDB.

## Стек

| Слой | Выбор |
| --- | --- |
| Рендер | pixi.js 8 + `@pixi/tilemap` (CompositeTilemap для земли) |
| UI | Preact через alias `react → preact/compat` + `@preact/signals` |
| Язык | TypeScript, компиляция `builtin:swc-loader` (типы стрипаются) |
| Bundler | rspack (swc) |
| Персист | `idb` (тонкая promise-обёртка над IndexedDB) |
| Terragen | `simplex-noise` |

Типы не проверяются при сборке (swc стрипает) → отдельный `yarn typecheck` (`tsc --noEmit`).

## Ключевой принцип: одно направление данных

```
IndexedDB (defs + autosave snapshot)
   │  boot: load | newGame
   ▼
in-memory ECS world  ◄──── единственный источник правды в рантайме
   │  fixed tick (10/s, accumulator, pause / ×1 / ×2 / ×3)
   ├─► systems (по порядку): needs → jobAssign → animalWander → pathfollow → work(harvest/haul)
   │
   ├─► GameRenderer: реконсилиация Map<entityId, Sprite> каждый кадр,
   │        lerp(prevPos, pos, alpha) для плавности между тиками
   │        pixi-слои: tilemap(ground) → objects(ySort) → entities(ySort) → fx
   │
   └─► signals (ТОЛЬКО UI-граница): selected, resourceTotals, gameClock, buildMode
            ▼
        React HUD (DOM поверх canvas) — читает signals, шлёт команды
   │  autosave: интервал 10с + visibilitychange / beforeunload
   ▼
IndexedDB.put('saves', {schemaVersion, tick, seed, world}, 'autosave')
```

### Почему так

- **IndexedDB — не рантайм-БД, а persistence.** IDB асинхронный и медленный — 10 tick/s симуляция не может читать его в цикле. Живая правда в памяти; IDB хранит статические дефиниции и снапшоты сейва.
- **ECS (data-oriented).** Компоненты = чистые данные в `Map<entityId, T>`; системы = функции над world. Разделяет данные и поведение, дёшево масштабируется на сотни сущностей, тривиально сериализуется.
- **Signals только на UI-границе.** Пер-сущностные hot-данные (позиции, needs сотен колонистов) — обычные Map, pixi читает их напрямую каждый кадр. Signals держат лишь то, что видит DOM-HUD. Иначе тысячи signal-обновлений за тик убьют перф.
- **Fixed tick, decoupled от рендера.** Детерминизм и воспроизводимость; render на 60fps интерполирует между тиками. Pause/скорость = множитель accumulator'а.
- **Реконсилиация Map<id,Sprite>.** Рендерер каждый кадр сверяет пул спрайтов с world (создать новым, удалить исчезнувшим, обновить x/y). Никаких связей sim→render, легко не рассинхронизироваться.
- **structured-clone сейв.** IndexedDB клонирует структурно — world-объект с `Map`/`Set` кладётся напрямую, без `JSON.stringify`. В снапшоте только состояние; рантайм-кэш (спрайты, пулы) НЕ сериализуется.
- **GameEngine-синглтон.** Владеет world + systems + pixi Application + ticker, гонит луп. React монтируется поверх canvas, получает engine через context, читает signals, шлёт `engine.dispatch(cmd)`. React НЕ владеет игровым лупом (StrictMode/lifecycle сломали бы его).

## Структура пакета

```
src/
  index.tsx              boot: openDB → load|newGame → new GameEngine → mount React
  engine.ts              GameEngine: fixed-tick loop, pixi App, dispatch(command)
  commands.ts            Command-тип + CommandDispatcher (единственный писатель UI-signals)
  sim/
    world.ts             World (ECS-контейнер), createWorld, allocId
    components.ts        типы компонентов (Position, Needs, Job, Inventory, Animal…)
    grid.ts              64×64 сетка тайлов, tile↔px, walkable
    systems/
      needs.ts           декей голода/сна, флаги приоритета
      job-assign.ts      раздача задач из очереди ближайшим колонистам
      animal-wander.ts   короткие перебежки животных в радиусе + паузы
      path-follow.ts     движение по построенному пути
      work.ts            harvest дерева / haul на склад
    pathfinding/astar.ts A* 8-напр., диагональ √2, без срезания углов
    rng.ts               seeded PRNG (mulberry32)
  render/
    renderer.ts          GameRenderer: реконсилиация, lerp, слои, кадр анимации по тику
    ground.ts            разовая отрисовка земли в CompositeTilemap + декор (камни)
    textures.ts          загрузка PNG через Assets + нарезка листов на кадры (nearest)
    layers.ts            создание pixi-контейнеров (ground/objects/entities/fx)
    camera.ts            pan (drag / WASD-стрелки) + zoom к курсору поверх root, хоткеи → dispatcher
  ui/
    App.tsx              React HUD (часы, ресурсы, панель выбора)
    signals.ts           UI-signals + производные computed
    engine-context.tsx   EngineProvider / useEngine
  persistence/
    db.ts                openDB (idb), object stores: defs, saves
    snapshot.ts          сохранение/загрузка снапшота world
  data/
    defs.ts              статические дефиниции (типы деревьев/ресурсов/needs)
  types.d.ts             png-модули и общие типы
```

## Мир и координаты

- Сетка **64×64**, логический тайл **16px** (базовый размер ассетов).
- Логика в tile-координатах; `worldPx = tile * 16`.
- **Камера** — единственный владелец трансформа `layers.root`: `zoom` ×1…×8 (старт ×3, шаг колесом якорится на курсоре), pan drag'ом (ЛКМ/СКМ) и WASD/стрелками, оба зажаты границами мира (мир меньше вьюпорта → центрируется). Offset хранится во float, в pixi уходит округлённым — иначе pixel-art дрожит при панораме. `scaleMode: "nearest"` на текстурах (без замыливания).
- Sim о камере не знает: экран→мир только через `camera.screenToTile()`.
- **Хоткеи** живут в камере (единственный слушатель клавиатуры), но не-view клавиши уходят в `CommandDispatcher`: `Space` — пауза, `1`/`2`/`3` — скорость. Тот же диспетчер держит `GameEngine.dispatch()` для HUD-кнопок, так что состояние меняется одним путём.
- **Цветокоррекция** — один `ColorMatrixFilter` (яркость + лёгкая десатурация) на `layers.root` в `render/layers.ts`: палитра ассет-пака слишком яркая, а грейд на рендере правится одной константой и не трогает исходную графику. Висит на `root`, а не на `stage`, — DOM-HUD поверх канваса он не задевает.
- **Земля** статична, поэтому рисуется один раз в `CompositeTilemap` (`render/ground.ts`): 64×64 тайла + декор сворачиваются в один draw call, тогда как `Sprite`/`Graphics` на тайл дали бы 4096 display-объектов. Правила выбора тайла: вода — рампа глубины по BFS-расстоянию до земли (мель → открытая вода), земля у воды — песок (иначе стык воды и травы выглядит цветовым обрывом), `Terrain.Rock` — сухая трава (`DeadGrass.png`) под плотным щебнем, остальное — трава. Оттенок травы берётся из **отдельного** simplex-поля мельче террейнового: по тайлу вышел бы шум, по квадратным патчам — плед.
- **Камни — декор рендера, не сущности.** Разброс выводится из `world.seed` хешем тайла, поэтому стабилен между перезагрузками и не попадает в сейв; запекается в тот же tilemap и не стоит ничего за кадр. Плата — камни не участвуют в y-сортировке с колонистами; для клаттера размером в тайл это приемлемо. Станут сущностями, когда камень превратится в добываемый ресурс.
- Вариант кроны дерева выбирается по `entityId` — как и facing, это производное рендера, в сейве не нужно.
- Животные — **16px** `Sprite` из листа 4×4 (`Chicken.png` 64×64: ряд = направление, столбец = цикл ходьбы). Кадр выбирается по `world.tick`, а не по `Ticker`: пауза замораживает анимацию, ×2/×3 ускоряет её, детерминизм не ломается — поэтому не `AnimatedSprite`. 32px-листы (Horse 128×192 = 4×6) режутся тем же `sliceSheet` с другим размером кадра.
- Facing — производное рендера (из `prevPos → pos`), не компонент: в сейве не нужен.

## MVP-слайс

Колонисты + A* pathfinding · needs (голод/сон) · глобальная job-queue · мини-ресурсы: деревья → `HarvestTree` (work N тиков → +wood в inventory) → `Haul` на единственный склад.

**Отложено:** режим строительства, множественные склады, множественные сейв-слоты, event-log/replay, чанкинг карты, изометрия.

## Заложенные дефолты

1. **Детерминизм:** seeded PRNG (mulberry32), seed в сейве. Команды применяются на границе тика, не мгновенно — оставляет дверь для event-log/replay.
2. **A*:** 8-направленный, диагональ √2, без срезания углов.
3. **Ассеты:** у PNG нет JSON-атласов → фрейм-раскладка описана вручную в `render/textures.ts` (`sliceSheet` режет лист на под-текстуры одного GPU-источника). Наружу отдаётся `sheets()` — кадры, разложенные по смысловым осям (`grass[оттенок][вариант]`, `water[глубина]`, `rocks[тон][размер]`), чтобы вызывающий код не индексировал сырые координаты листа. Прелоад — `await loadTextures()` в бутстрапе: `reconcile()` синхронный и ждать не может. Алиас `@assets` → `assets/`.
   Часть листов — blob-автотайлы (`Cliff.png`, `Cliff-Water.png`): их кромки требуют настоящего corner-matching, поэтому пока не используются — переходы делаются песчаной каймой и рампой глубины.
   **`@pixi/tilemap` — минимум 5.0.2.** С pixi ≥ 8.7 в instruction set попадают только наследники `ViewContainer`; в 5.0.1 `Tilemap extends Container`, поэтому tilemap молча не рисуется — без ошибок в консоли.
4. **entityId:** монотонный счётчик в world (персистится в снапшоте).
5. **Save-модель:** один autosave-slot; на буте есть слот → load, нет → newGame. `SCHEMA_VERSION` = 2 (добавлена Map `animals`); чужая версия → снапшот отбрасывается, новая игра. Версии одной мало: под HMR сейв уходит с новым `SCHEMA_VERSION`, хотя живой `world` ещё старый — поэтому `loadSnapshot` бэкфиллит отсутствующие Map'ы (`hydrate`).

## Bootstrap (последовательность)

```
1. openDB("colony-sim", 1)                 // persistence/db.ts
2. snap = await loadSnapshot(db)            // persistence/snapshot.ts
3. world = snap ? deserialize(snap) : newGame(seed)
4. app = new Application(); await app.init({...})
5. engine = new GameEngine(world, app, db)  // владеет лупом + рендерером
6. engine.start()                           // fixed-tick + ticker
7. render(<EngineProvider engine={engine}><App/></EngineProvider>, #app)
```
