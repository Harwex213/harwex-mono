# Huge Waves Protection Game — memory

Браузерная игра-выживалка (Vampire Survivors clone).

## Стек (жёстко)
Plain HTML + ES modules + Canvas 2D. БЕЗ шага сборки, БЕЗ npm-зависимостей.
Запуск только через статический HTTP-сервер (`python3 -m http.server` / `npx serve`),
не через `file://` (нужны ES-модули).

## Контракт слоёв (ключевое)
Системы мутируют общий `state` в `update(state, dt)`. Рендер ТОЛЬКО читает `state`,
никогда не мутирует. Все системы работают над одним общим объектом состояния.

## Модули
- `index.html` — точка входа, полноэкранный `<canvas id="game">`, подключает `src/main.js` (type="module").
- `src/main.js` — bootstrap + game loop. Держит `canvas`/`ctx`, `resize()`, `update(state, dt)`, `frame()`,
  `restart()`. Создаёт `levelup = initLevelUp(...)` (T7) и `screens = initScreens(state, canvas, { restart })`
  (T8). В `frame`: `levelup.sync()` → симуляция идёт ТОЛЬКО если `phase===PLAYING && pendingLevelUps===0`
  (иначе `accumulator=0`, мир стоит — покрывает start/gameover/level-up паузу единым условием).
  В конце `update` проверка `player.hp<=0` → `phase=GAMEOVER` + `pendingLevelUps=0` (единый источник
  истины по фазе; гасим pending, чтобы level-up оверлей не всплыл поверх Game Over при совпадении смерти
  и level up в одном шаге). `restart()`: `Object.assign(state, createState(seed))` (сброс in-place —
  сохраняет ссылку у input/levelup/screens) + `createPlayer` + `phase=PLAYING` + сброс accumulator/lastTime.
  Порядок рендера: `render` (сцена) → `renderHud` → `levelup.render` → `screens.render` (start/gameover поверх всего).
- `src/core/state.js` — `createState(seed)` → начальное состояние; `FIXED_DT=1/60`, `DEFAULT_SEED`, `GamePhase`.
  Содержит `spawn: { timer }` (накопитель для системы спавна), `projectiles: []`, `pickups: []`
  (XP-гемы), `kills: 0`, прогрессию (`level`, `xp`, `xpToNext`, `pendingLevelUps`, `pickupRange`),
  `xpGainMult` (множитель XP, T6) и `abilities: {}` (карта `id→level` взятых перков, T6 — здесь ради
  чистого рестарта). Импортирует `xpToNextForLevel` из leveling для инициализации `xpToNext`.
- `src/core/math.js` — `clamp, lerp, vec, len, lenSq, dist, distSq, norm`. Вектор = `{x, y}`. Чистые функции.
- `src/core/rng.js` — `createRng(seed)` (mulberry32): `next, range, int, pick, getState`. Детерминирован.
- `src/core/input.js` — `initInput(state, target=window)` вешает keydown/keyup (WASD+стрелки,
  по `event.code`), пишет нормализованный `state.input.move` (диагональ не быстрее прямой),
  сброс клавиш на `blur`. Возвращает `dispose()`. Единственный мутатор ввода.
- `src/entities/player.js` — `createPlayer(world)` (центр мира, `hp/maxHp/speed/radius` +
  `weapon:{fireRate,damage,projectileSpeed,projectileRadius,projectileLife}`, `fireTimer`, `invulnTimer`,
  а также модифицируемые способностями (T6) `projectileCount=1`, `pierce=0`, `regen=0`),
  `updatePlayer(state, dt)` двигает по `move*speed*dt`, клампит в границы мира с учётом radius,
  затем применяет `regen*dt` (лечение до maxHp).
- `src/render/camera.js` — `updateCamera(state)` (мутатор: центр камеры = игрок),
  `cameraOrigin(state)` и `worldToScreen(state,x,y)` — чистые, для рендера.
- `src/entities/enemies.js` — `ENEMY_TYPES` (data-driven таблица: grunt/runner/brute/stalker с
  `minTime/weight/baseHp/baseSpeed/radius/color`), `waveScaling(time)` (множители hp/speed от времени),
  `xp` в типах/инстансе (опыт XP-гема при смерти: grunt/runner=1, brute=5, stalker=4),
  `createEnemy(typeKey, x, y, time)` (фабрика с масштабированием статов),
  `updateEnemies(state, dt)` (chase: нормализованный вектор к игроку × speed × dt).
- `src/systems/spawn.js` — `updateSpawn(state, dt)`: накопительный таймер, спавнит пачки за краями
  вьюпорта. `SPAWN_CONFIG` (интервал/размер пачки/потолки) — data-driven. Интервал падает и размер
  пачки растёт со временем; тип выбирается взвешенно среди разблокированных через `state.rng`
  (не Math.random). Позиция спавна: угол вокруг камеры, дистанция > полудиагонали вьюпорта, клампится
  в границы мира.
- `src/entities/projectiles.js` — `createProjectile(x,y,dirX,dirY,{speed,damage,radius,life,pierce})`
  (снаряд = `{x,y,vx,vy,damage,radius,life,alive,pierce,hits}`; `pierce` — сквозные попадания сверх
  первого, `hits` — ленивый `Set` задетых врагов, T6), `updateProjectile(p,dt)` (движение + списание
  life). Данные-объект без методов; жизненным циклом управляет combat.
- `src/systems/combat.js` — `updateCombat(state, dt)`: единая точка боя. Порядок: тик i-frames →
  авто-выстрел в ближайшего живого врага (`nearestEnemy` по `distSq`) → движение снарядов + cull по
  life/выходу за мир → коллизии снаряд↔враг (сумма радиусов, снаряд расходуется, без пробивания) →
  снятие мёртвых врагов (`alive=false` → фильтр, `state.kills++`, роняет XP-гем `createGem` в точке
  смерти) → контактный урон игроку с i-frames.
  Авто-выстрел учитывает способности T6: стреляет `player.projectileCount` снарядами веером
  (симметричный угловой разброс `spreadStep` вокруг направления на цель, без rng), каждый снаряд
  получает `player.pierce`. Коллизии: с `pierce>0` снаряд проходит сквозь врагов (декремент pierce,
  задетые пишутся в `pr.hits`, чтобы не бить одного дважды), иначе гибнет на первом.
  `COMBAT_CONFIG` (iframeDuration/contactDamage/worldMargin/spreadStep) — data-driven.
- `src/entities/pickups.js` — `createGem(x,y,xp)` → `{x,y,xp,radius,alive}`, `GEM_RADIUS`.
  Данные-объект без методов; жизненным циклом управляет leveling. Гемы живут в `state.pickups`.
- `src/systems/leveling.js` — `updateLeveling(state, dt)`: единая точка прогрессии. Порядок:
  притяжение гемов в радиусе `state.pickupRange` (скорость растёт при сближении, шаг ≤ дистанции,
  не перелетает) → подбор при контакте (сумма радиусов, `xp` += , `alive=false` → filter) →
  `resolveLevelUps` (while: `xp -= xpToNext`, `level++`, пересчёт порога, `pendingLevelUps++`).
  `xpToNextForLevel(level) = round(baseXp * level^curveExp)` (baseXp=5, curveExp=1.5).
  `LEVELING_CONFIG` (baseXp/curveExp/attractSpeedFar/attractSpeedNear) — data-driven.
- `src/render/renderer.js` — `render(ctx, state)`: фон + грид большого мира (сдвиг по камере) +
  рамка границ мира + XP-гемы (`drawPickups`, ромбы, culling) + враги + снаряды (`drawProjectiles`,
  culling) + игрок. Всё с учётом камеры.

- `src/systems/abilities.js` — data-driven пул перков (T6). Экспорт: `ABILITIES` (42 записи
  `{id,name,desc,maxLevel,apply(state)}`), `rollChoices(state,count=3)`, `applyAbility(state,id)`,
  `getAbility(id)`, `abilityLevel(state,id)`. Категории: урон, скорострельность, скорость, maxHP/heal,
  доп.снаряд/pierce, радиус подбора, прирост XP, регенерация, area (радиус снаряда), скорость/жизнь
  снаряда. `apply` мутирует поля `state`/`player`/`weapon` немедленно; уровни в `state.abilities`
  (стак). `rollChoices` — частичная перетасовка Фишера–Йетса через `state.rng` среди доступных
  (не достигших maxLevel), без дублей, вырожденный случай (<count) возвращает сколько есть.
  `applyAbility` не превышает maxLevel; неизвестный id / достигнутый maxLevel — no-op (false).
  Не подключён к main loop — вызовы делает UI выбора при level-up (T7).

- `src/ui/hud.js` — `renderHud(ctx, state)` (T7): Canvas-оверлей поверх сцены, ТОЛЬКО читает state.
  Полоса XP (тонкая, во всю ширину сверху, заполнение `xp/xpToNext`), левая панель (номер уровня +
  полоса HP `hp/maxHp` с текстом и цветом hi/lo по порогу 0.35), таймер `mm:ss` из `state.time` по
  центру, счётчик `state.kills` справа. Рисуется после `render` в CSS-пикселях (dpr уже применён).
- `src/ui/levelup.js` — `initLevelUp(state, canvas)` → `{ sync, render, isActive, dispose }` (T7).
  `sync()` роллит `rollChoices(state,3)` ОДИН раз на level-up (guard `!choices`), кэширует в замыкании
  (не переролит на каждом кадре — rng не двигается); вырожденный случай (0 доступных) поглощает
  level-up (декремент), чтобы не зависнуть на паузе. Выбор: клик по карточке (`mousemove`+`click` на
  canvas, hit-тест по общей чистой раскладке `cardRects`) и клавиши 1/2/3 (`Digit`/`Numpad`, keydown на
  window). `pick(i)` → `applyAbility(state,id)` (эффект немедленно) → `pendingLevelUps--` → `choices=null`
  (следующий `sync` перероллит, пока `pendingLevelUps>0`). `render(ctx)` рисует затемнение + заголовок +
  до 3 карточек (бейдж клавиши, имя, «Новая»/«Ур. X→X+1», описание с переносом) — не мутирует state.
  Мутации только в обработчиках ввода/`sync`, не в `render` (слои разделены).

- `src/ui/screens.js` — `initScreens(state, canvas, { restart })` → `{ render, isActive, dispose }` (T8).
  Экраны start и game over. ТОЛЬКО читает state в `render`; мутации фаз — в обработчиках ввода
  (`keydown` Space/Enter на window + `click` на canvas). На фазе START рисует заголовок + приглашение,
  по пробелу/клику → `state.phase = PLAYING`. На фазе GAMEOVER рисует статистику (время `mm:ss`,
  убийства, уровень — читает `state.time/kills/level`) и по пробелу/клику вызывает переданный
  `restart()` (сброс — забота main). Переход в GAMEOVER (hp<=0) делает НЕ этот модуль, а main.
  `isActive()` = фаза START или GAMEOVER. Рисуется последним, поверх всего.

## Ключевые решения (T1)
- Game loop: fixed timestep через accumulator, `dt = 1/60` — детерминированная симуляция.
- Защита от спирали смерти: `MAX_STEPS_PER_FRAME = 5`, накопленное время клампится.
- Canvas: размер = `innerWidth/Height`, буфер × `devicePixelRatio`, `ctx.setTransform(dpr,...)` —
  рисуем в CSS-пикселях, картинка не размыта. `state.viewport = {width, height, dpr}` в CSS-пикселях.
- Контекст создаётся с `{ alpha: false }`.
- `createState` — фабрика (не синглтон), чтобы рестарт давал чистое состояние.
- Мировые координаты отдельно от вьюпорта: `state.world` большой, камера в `state.camera` (для T2).

## Ключевые решения (T2)
- Ввод по `event.code` (KeyW/ArrowUp/…) — раскладконезависимо. Вектор нормализуется через `norm`.
- `main.js` создаёт `state.player`, вызывает `initInput(state)`, разово `updateCamera` до рендера.
- Порядок в `update`: `updatePlayer` → `updateCamera` (камера следует за уже сдвинутым игроком).
- Экранный/мировой Y растёт вниз (up = -1). Мир 4000×4000, вьюпорт меньше — грид доказывает камеру.
- Грид рисуется от `cameraOrigin` с модульным сдвигом; линии на `.5px` для резкости в 1px.
- Разделение слоёв соблюдено: input/player/camera мутируют state, renderer только читает.

## Ключевые решения (T3)
- Порядок в `update`: `updatePlayer` → `updateCamera` → `updateSpawn` → `updateEnemies`.
  Камера обновляется до спавна, чтобы спавнить за краями актуального обзора; враги чейзят игрока.
- Прогрессия волн полностью функция от `state.time` (без внешнего state, кроме `spawn.timer`):
  hp/speed множители и интервал/размер пачки считаются из времени → детерминировано.
- Скорость врагов масштабируется ограниченно (cap ×1.8), чтобы не обгоняли игрока (speed=220).
- Спавн детерминирован: все случайности через `state.rng` (угол, выбор типа).
- Потолок `maxEnemies=400` и culling при рендере — защита производительности при больших волнах.
- Enemy имеет `alive` флаг (задел под T4 combat), пока не используется.

## Ключевые решения (T4)
- Порядок в `update`: `updatePlayer` → `updateCamera` → `updateSpawn` → `updateEnemies` → `updateCombat`.
  Combat последним: работает по уже сдвинутым игроку/врагам этого шага.
- Авто-атака детерминирована от dt: `fireTimer += dt`, интервал `= 1/weapon.fireRate`, `while`-выстрелы.
  Нет цели → `fireTimer = interval` (кап, не копится бесконечно) → выстрел сразу как появится враг.
- Цель — ближайший живой враг по `distSq` (без sqrt). Вырожденный случай (враг в точке игрока) → вправо.
- Снаряд расходуется при попадании (без пробивания), поражает одного врага (`break`).
- Смерть/удаление через флаг `alive=false` + одноразовый `filter` за шаг (снаряды и враги) — без утечки массивов.
  `state.kills` растёт на число снятых врагов.
- Урон игроку через i-frames: `contactDamage` при контакте, затем `invulnTimer=iframeDuration`; один тик
  урона за шаг. `hp` клампится в `[0, maxHp]` (задел под Game Over T8 при hp<=0).
- Вся боевая логика в `updateCombat(state,dt)`; рендер снарядов только читает state. Случайностей в бою нет.

## Ключевые решения (T5)
- Порядок в `update`: … → `updateCombat` → `updateLeveling`. Leveling после combat: combat роняет
  гемы в точке смерти врага (в `reapDeadEnemies`, импортирует `pickups`), leveling их обрабатывает.
- Гемы живут в существующем `state.pickups` (не отдельный массив). XP-значение гема берётся с
  врага (`e.xp`, задан в `ENEMY_TYPES`) — data-driven, детерминировано.
- Притяжение: только в радиусе `state.pickupRange`; скорость = lerp(attractSpeedFar→Near) по близости;
  шаг клампится оставшейся дистанцией (гем не перелетает игрока). Случайностей в прогрессии нет.
- Кривая порога `round(baseXp * level^1.5)` детерминирована; множественные level up за шаг — через
  `while` с переносом остатка XP. Каждый level up растит `state.pendingLevelUps` (событие UI для T7).
- Все поля прогрессии в `createState` → чистый сброс при рестарте. `xpToNext` инициализируется
  `xpToNextForLevel(1)` (единый источник кривой, без дублирования магии).
- Разделение слоёв: leveling/combat мутируют state; renderer только читает (`drawPickups`).

## Ключевые решения (T6)
- Способности чисто data-driven: пул из 42 записей, эффект = функция `apply(state)`, стакается
  повторным выбором. Уровни хранятся отдельно в `state.abilities` (id→level), сами эффекты
  «запечены» в мутируемые поля (нет пересчёта из уровней) — просто и предсказуемо.
- Эффекты реально потребляются системами (не мёртвые поля): combat читает `projectileCount`/`pierce`
  и `weapon.*`; `updatePlayer` применяет `regen`; leveling множит подобранный XP на `state.xpGainMult`
  (XP-перки реально ускоряют прокачку); `pickupRange` уже читался притяжением гемов.
- Флат- и процентные варианты в одной категории — процентные множат уже изменённое значение
  (мультипликативный стак), это осознанно.
- `rollChoices` детерминирован: перетасовка только через `state.rng.int` (проверено — один seed даёт
  один и тот же набор). Без дублей (перетасовка распределения без замен), корректный вырожденный
  случай (доступных < 3).
- Веер снарядов симметричен относительно направления на цель, разброс без rng (детерминизм боя
  сохранён). Pierce: `hits`-Set аллоцируется лениво только при `pierce>0` (нет накладных на обычный
  снаряд), предотвращает повторное попадание по одному врагу.
- abilities не в main loop: применение перков — задача UI level-up (T7); модуль предоставляет API.

## Ключевые решения (T7)
- Пауза при level-up решается в main по `state.pendingLevelUps>0` (единственный источник истины);
  на паузе `update` не вызывается и `accumulator=0` — после снятия паузы нет рывка «наверстывания».
- Набор вариантов ролится ровно раз на level-up: `levelup` кэширует `choices` в замыкании, `sync`
  роллит только при `!choices`. Так `state.rng` не двигается покадрово (детерминизм сохранён).
- Повтор выбора: после `pick` `choices=null`, следующий `sync` перероллит новый набор — экран
  показывается подряд, пока `pendingLevelUps>0` (несколько уровней за раз).
- Раскладка карточек — чистая функция от вьюпорта (`cardRects`), общая для рендера и hit-теста →
  клик всегда совпадает с отрисовкой; координаты мыши через `getBoundingClientRect` (canvas на весь экран).
- HUD/оверлей — чистые читатели state (кроме обработчиков ввода levelup, которые и есть мутаторы UI).
  Рисуются поверх сцены в порядке scene→HUD→overlay в тех же CSS-пикселях.
- Клавиши 1/2/3: и `Digit*`, и `Numpad*`; активны только когда `isActive()` (иначе не мешают игре).

## Ключевые решения (T8)
- Фаза — единый источник истины (`state.phase`, `GamePhase`). `createState` теперь стартует с `START`
  (не PLAYING): свежая загрузка и рестарт дают чистое состояние, симуляция ждёт старта.
- Симуляция идёт ТОЛЬКО в `PLAYING` без ожидающих level-up: одно условие в `frame` покрывает все 4 фазы;
  на start/gameover/паузе `accumulator=0` (нет рывка «наверстывания» при возобновлении). Пауза level-up
  из T7 сохранена этим же условием (`pendingLevelUps>0`).
- Переход в GAMEOVER решает main (в хвосте `update` по `hp<=0`), а НЕ модуль screens — screens только
  читает state и мутирует фазу в обработчиках ввода (старт/рестарт). Слои разделены.
- Рестарт — `Object.assign(state, createState(seed))` in-place, НЕ переприсваивание `state`: модули
  (input/levelup/screens) захватили ссылку на объект в замыкании, сброс полей сохраняет её валидной.
  Рестарт ведёт сразу в `PLAYING` (минуя стартовый экран — один клик/пробел). Проверено headless:
  kills/level/xp/pendingLevelUps/enemies/projectiles/pickups/abilities/hp/time полностью сброшены.
- Гашение `pendingLevelUps=0` при смерти: смерть могла совпасть с выдачей level-up в одном шаге —
  иначе level-up оверлей всплыл бы поверх Game Over. Так на gameover `choices` всегда null → чисто.
- Статистика Game Over (время `mm:ss`/убийства/уровень) читается из state и заморожена, т.к. на gameover
  симуляция не тикает (`state.time` не растёт) — отдельный снимок статов не нужен.

## Ключевые решения (T9 — баланс/полиш)
- Корневая проблема раннего баланса была не в XP-кривой, а в СБОРЕ XP: снаряды летели далеко
  (`projectileLife 1.2 × speed 520 ≈ 624px`), враги умирали далеко, гемы падали вне `pickupRange 120`
  и не собирались → первый level-up за 50-77с. Решение — «стянуть» бой к игроку:
  - оружие: `fireRate 2→2.4`, `damage 6→8`, `projectileSpeed 520→500`, `projectileLife 1.2→0.55`
    (дальность ~275px), `projectileRadius 5→6`. Бой ведётся вплотную → гемы падают в радиусе подбора.
  - `pickupRange 120→200` (≈ дальности снаряда): опыт с убитых рядом врагов реально собирается.
- Ранний темп: `grunt.baseSpeed 70→88` (подходит с края экрана за ~9с, старт не пустой),
  spawn `baseInterval 1.6→1.1`, `baseBatch 1→2`, `batchGrowthPerMin 1.5→2`, `intervalDecay 0.35→0.22`,
  `maxBatch 12→16`. `player.speed 220→230` (можно кайтить).
- Плавность волн: `waveScaling` hp `+0.6→+0.45`/мин, speed cap `1.8→1.6` (без пиков непроходимости);
  типы врагов раньше и живее (runner minTime 30→25/xp 1→2, brute 75→65, stalker 150→130).
- Замер баланса — headless-симом на РЕАЛЬНЫХ модулях (не хардкод): создаём state+player, гоняем
  update-порядок main вручную N×FIXED_DT, простой kite-AI (repulsion от врагов + wall-avoidance +
  тангенциальный обход) + жадный выбор перков. Итог по нескольким сидам и вьюпортам (1280×720/1920×1080):
  первый level-up 11-28с (цель 10-30 ✓), при грамотном кайте выживание 5 мин, уровень 7-9, сотни
  убийств; пик врагов упирается в `maxEnemies 400` — значит cap + culling реально держат FPS.
- Консоль: ни одного `console.*`/`debugger`/`alert` в `src/` (grep-проверено). Все API — стандартный
  Canvas/DOM; обработчики ввода снимаются `dispose()`; слои строго разделены (render не мутирует state).

## Проверка
`node --check <file>` — синтаксис модулей. Баланс/логику гоняли headless-симом (см. T9):
`import()` модулей по `file://`, ручной прогон update-порядка, замер time-to-first-levelup,
выживания, пика врагов, утечек снарядов/гемов. Реальный браузер — статический сервер
(`python3 -m http.server`) + открыть `index.html`.

## Документы
`docs/requirements.md`, `docs/ai/checklist.md` (общий DoD), `docs/ai/backlog.md` (T1..T9),
`docs/ai/current-task.md` (DoD текущей задачи).
