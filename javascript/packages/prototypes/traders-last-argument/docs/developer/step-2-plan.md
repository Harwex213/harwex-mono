# План реализации — Степ 2. Пешки

## Обзор

Добавляем сущности-пешки на карту. Пешка имеет имя, здоровье, перемещается по карте со скоростью ~1 клетка в секунду.
Пешку можно выбрать кликом — открывается панель с информацией. На старте у игрока 5 пешек.

## Ключевые решения

### Игровой цикл: update + render

Сейчас game loop только рендерит. Для движения пешек нужна фаза **update** с delta time:

```
let lastTime = performance.now();

const loop = (now) => {
  const dt = (now - lastTime) / 1000; // секунды
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
};
```

### Состояние игры

Вместо хранения `mapRef` и будущих `pawnsRef` по отдельности, создаём единый **GameState**:

```ts
interface GameState {
  map: GameMap;
  pawns: Pawn[];
  selectedPawnId: number | null;
}
```

`GameState` хранится в `useRef` (как и камера — для высокочастотных обновлений без ре-рендеров React).

Для панели выбранной пешки используем `useState<number | null>` — при клике на пешку устанавливаем ID, React
перерисовывает панель. Панель читает данные пешки из `gameStateRef.current.pawns`.

### Движение пешек

Пешки свободно бродят по плодородной земле (idle wander):

1. Пешка хранит `x, y` (текущая позиция, float) и `targetCol, targetRow` (целевая клетка, int)
2. Каждый кадр пешка движется к цели со скоростью 1 тайл/сек
3. При достижении цели — выбирается новая случайная соседняя клетка (4 стороны), которая является плодородной землёй
4. Если нет доступных соседей — пешка стоит на месте 1 секунду, затем пробует снова

Горы блокируют движение. Объекты (деревья, камни) не блокируют.

### Спавн пешек

При генерации мира:
1. Находим все клетки `FertileLand` без объектов
2. Выбираем 5 случайных из них (ближе к центру карты — в радиусе 20 клеток от центра)
3. Создаём пешки на этих позициях

### Выбор пешки (клик vs. drag)

Нужно отличать клик от перетаскивания камеры:
- При `mousedown` запоминаем начальную позицию мыши
- При `mouseup` проверяем: если мышь сдвинулась менее чем на 5 пикселей — это клик
- При клике: переводим координаты в мировые, проверяем попадание в пешку (расстояние до центра пешки < 0.5 тайла)
- Клик по пустому месту — снимает выделение

### Генерация имён

Простой генератор имён из набора слогов (фэнтезийные имена):

```ts
const PREFIXES = ["Ар", "Бар", "Гор", "Дан", "Зар", "Кор", "Лан", "Мор", "Рон", "Тор"];
const SUFFIXES = ["ак", "ен", "ик", "ин", "ис", "ок", "ор", "ус", "эль", "ан"];

function generateName(): string {
  return randomChoice(PREFIXES) + randomChoice(SUFFIXES);
}
```

## Структура файлов

```
src/
├── config/
│   └── map.ts                  # + PAWN_CONFIG (скорость, начальное HP, радиус спавна)
├── core/
│   ├── types.ts                # + Pawn, GameState
│   ├── map-generator.ts        # без изменений
│   ├── pawn-spawner.ts         # NEW: создание начальных пешек
│   └── systems/
│       └── movement.ts         # NEW: система перемещения пешек
├── engine/
│   ├── camera.ts               # без изменений
│   └── game-loop.ts            # NEW: update + render цикл с delta time
├── ui/
│   ├── GameWorld/
│   │   ├── GameWorld.tsx        # Рефакторинг: используем GameState, добавляем клик-выделение
│   │   ├── GameWorld.module.css # + стили для контейнера
│   │   └── renderer.ts         # + отрисовка пешек (иконка + выделение)
│   ├── panels/
│   │   └── PawnInfoPanel.tsx    # NEW: панель информации о выбранной пешке
│   │   └── PawnInfoPanel.module.css # NEW: стили панели
│   ├── App.tsx
│   └── App.module.css
```

## Детали реализации

### 1. Типы (`src/core/types.ts`)

Добавляем:

```ts
interface Pawn {
  id: number;
  name: string;
  health: number;
  maxHealth: number;
  x: number;        // текущая позиция (float, в тайлах)
  y: number;
  targetCol: number; // целевая клетка
  targetRow: number;
  idleTimer: number; // таймер ожидания если нет пути (секунды)
}

interface GameState {
  map: GameMap;
  pawns: Pawn[];
}
```

### 2. Конфигурация (`src/config/map.ts`)

Добавляем параметры пешек:

```ts
const PAWN_CONFIG = {
  initialCount: 5,         // начальное количество пешек
  speed: 1.0,              // тайлов в секунду
  maxHealth: 100,          // начальное здоровье
  spawnRadius: 20,         // радиус спавна от центра карты (в тайлах)
  idleDuration: 1.0,       // секунд ожидания при тупике
};
```

### 3. Спавнер пешек (`src/core/pawn-spawner.ts`)

```ts
function spawnPawns(map: GameMap): Pawn[]
```

- Собирает клетки `FertileLand` без объектов в радиусе `spawnRadius` от центра
- Перемешивает массив (Fisher-Yates shuffle)
- Берёт первые `initialCount` клеток
- Создаёт пешки с уникальным ID, сгенерированным именем, полным здоровьем
- Начальные `targetCol/targetRow` = текущая позиция

### 4. Система движения (`src/core/systems/movement.ts`)

```ts
function updateMovement(pawns: Pawn[], map: GameMap, dt: number): void
```

Для каждой пешки:
1. Если `idleTimer > 0` — уменьшаем на `dt`, skip
2. Вычисляем расстояние до цели
3. Если расстояние < 0.01 — прибыли:
   - Привязываем x/y к целевой клетке (snap)
   - Выбираем новую случайную соседнюю клетку `FertileLand` (не гора)
   - Если нет доступных — ставим `idleTimer = idleDuration`
4. Иначе — двигаемся к цели:
   - `dx = targetCol - x`, `dy = targetRow - y`
   - Нормализуем вектор, умножаем на `speed * dt`
   - Обновляем `x += vx`, `y += vy`

### 5. Game Loop (`src/engine/game-loop.ts`)

```ts
interface GameLoopCallbacks {
  update: (dt: number) => void;
  render: () => void;
}

function createGameLoop(callbacks: GameLoopCallbacks): { start: () => void; stop: () => void }
```

- Внутри: `requestAnimationFrame`, вычисление delta time
- Ограничение `dt` максимумом 0.1 сек (защита от "спирали смерти" при alt-tab)
- Вызывает `callbacks.update(dt)`, затем `callbacks.render()`

### 6. Renderer (`src/ui/GameWorld/renderer.ts`)

Добавляем функцию отрисовки пешек:

```ts
function renderPawns(
  ctx: CanvasRenderingContext2D,
  pawns: Pawn[],
  camera: Camera,
  selectedPawnId: number | null,
): void
```

- Для каждой пешки:
  - Вычисляем экранные координаты: `sx = x * tileSize * zoom + camera.x`
  - Рисуем иконку пешки: 🧑 (emoji)
  - Если пешка выбрана — рисуем обводку (круг) цветом `#FFD700` (золотой)

Вызывается после `renderMap` в основном рендере.

### 7. GameWorld (`src/ui/GameWorld/GameWorld.tsx`)

Рефакторинг:

- Заменяем `mapRef` на `gameStateRef: useRef<GameState | null>`
- Добавляем `useState<number | null>` для `selectedPawnId` (триггерит ре-рендер панели)
- Используем `createGameLoop` вместо ручного RAF
- В `update(dt)`: вызываем `updateMovement`
- В обработчике клика:
  - Проверяем расстояние от mousedown до mouseup < 5px
  - Переводим координаты в мировые
  - Ищем пешку в радиусе 0.5 тайла
  - Устанавливаем `selectedPawnId`
- GameWorld теперь оборачивает canvas и панель в div-контейнер
- Передаём `selectedPawnId` и `gameStateRef` в `PawnInfoPanel`

### 8. Панель информации (`src/ui/panels/PawnInfoPanel.tsx`)

React-компонент:

```tsx
interface PawnInfoPanelProps {
  pawnId: number | null;
  getPawn: (id: number) => Pawn | undefined;
}
```

- Если `pawnId === null` — не рендерим ничего
- Иначе — отображаем:
  - Имя пешки
  - Здоровье: `HP / MaxHP` с полоской здоровья (цветной div)
- Стили: полупрозрачная панель в правом верхнем углу, `position: absolute`
- Для обновления данных в реальном времени используем `setInterval` на ~200ms
  для перечитывания данных из ref

## Порядок реализации

| # | Задача                                     | Файлы                                   |
|---|--------------------------------------------|-----------------------------------------|
| 1 | Расширить типы (Pawn, GameState)           | `src/core/types.ts`                     |
| 2 | Добавить конфигурацию пешек                | `src/config/map.ts`                     |
| 3 | Создать спавнер пешек                      | `src/core/pawn-spawner.ts`              |
| 4 | Создать систему движения                   | `src/core/systems/movement.ts`          |
| 5 | Создать game loop с delta time             | `src/engine/game-loop.ts`               |
| 6 | Расширить renderer (отрисовка пешек)       | `src/ui/GameWorld/renderer.ts`          |
| 7 | Создать панель информации                  | `src/ui/panels/PawnInfoPanel.tsx + .css` |
| 8 | Рефакторинг GameWorld                      | `src/ui/GameWorld/GameWorld.tsx + .css`  |
| 9 | Тестирование и тюнинг                      | Параметры в конфигурации                |

## Заметки

- Пешки рендерятся поверх тайлов (вызов `renderPawns` после `renderMap`)
- Движение пешек — axis-aligned (по одной оси за раз), т.к. целевая клетка всегда соседняя по 4 сторонам
- `selectedPawnId` в useState, а не в ref, чтобы React знал о смене выделения и перерисовал панель
- Для панели используем чтение из ref (а не копирование всех данных в state) — это избегает лишних ре-рендеров каждый
  кадр, при этом данные всегда актуальны при обращении
- Генератор имён — на `Math.random()`, для прототипа достаточно
- Delta time ограничен 0.1 сек — если игрок сворачивает вкладку на 10 секунд, пешки не "телепортируются"
