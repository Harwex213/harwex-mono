# План реализации — Степ 1. Карта

## Обзор

Реализуем тайловую карту 100x100 с генерацией ландшафта через Perlin Noise, двумя типами тайлов (плодородная земля,
гора), двумя типами объектов (дерево, камень) и камерой с перемещением/зумом.

## Рендеринг: HTML5 Canvas

Карта 100x100 = 10 000 тайлов. DOM-элементы для такого количества — слишком дорого. Используем **HTML5 Canvas**.
React-компонент будет обёрткой над `<canvas>`, вся отрисовка — через Canvas API.

## Зависимости

Установить npm-пакет для генерации шума:

```
yarn add simplex-noise
```

[simplex-noise](https://github.com/jwagner/simplex-noise.js) — маленькая, типизированная библиотека. Поддерживает 2D/3D
noise, seed-based генерацию.

## Структура файлов

```
src/
├── config/
│   └── map.ts                  # Конфигурация карты (константы/переменные)
├── core/
│   ├── map-generator.ts        # Алгоритм генерации карты (Perlin Noise)
│   └── types.ts                # Типы игровых данных (Tile, TileType, ObjectType, GameMap)
├── engine/
│   └── camera.ts               # Логика камеры (pan, zoom, bounds)
├── ui/
│   ├── GameWorld/
│   │   ├── GameWorld.tsx        # React-компонент: canvas + обработка ввода
│   │   ├── GameWorld.module.css # Стили
│   │   └── renderer.ts         # Функция отрисовки карты на canvas
│   ├── App.tsx                 # Корневой компонент (монтирует GameWorld)
│   └── App.module.css
```

## Детали реализации

### 1. Типы (`src/core/types.ts`)

```ts
enum TileType {
  FertileLand = "fertile_land",
  Mountain = "mountain",
}

enum ObjectType {
  Tree = "tree",
  Stone = "stone",
}

interface Tile {
  type: TileType;
  object: ObjectType | null;
}

type GameMap = Tile[][];
```

### 2. Конфигурация (`src/config/map.ts`)

```ts
const MAP_CONFIG = {
  width: 100,            // тайлов по горизонтали
  height: 100,           // тайлов по вертикали
  tileSize: 50,          // пикселей на тайл

  // Perlin noise параметры
  seed: undefined,       // undefined = случайный seed каждый раз

  // Пороги для генерации
  mountainThreshold: 0.55,  // elevation выше этого = гора
  treeThreshold: 0.3,       // moisture выше этого на плодородной земле = дерево
  stoneThreshold: 0.6,      // moisture ниже этого на горе = камень

  // Камера
  minZoom: 0.2,
  maxZoom: 2.0,
  defaultZoom: 1.0,
} as const;
```

### 3. Генерация карты (`src/core/map-generator.ts`)

Следуем концепции статьи Red Blob Games "Terrain from Noise":

**Алгоритм:**

1. Создаём два независимых шумовых слоя: **elevation** (высота) и **moisture** (влажность)
2. Для каждого слоя используем octaved noise (3 октавы):
   ```
   e = 1.0 * noise(1*nx, 1*ny) + 0.5 * noise(2*nx, 2*ny) + 0.25 * noise(4*nx, 4*ny)
   e = e / (1.0 + 0.5 + 0.25)
   ```
3. Применяем redistribution через `Math.pow(e, exponent)` для более интересного рельефа
4. По elevation определяем тип тайла:
   - `elevation >= mountainThreshold` → **Гора**
   - `elevation < mountainThreshold` → **Плодородная земля**
5. По moisture определяем объект на тайле:
   - Плодородная земля + высокая moisture → **Дерево**
   - Гора + низкая moisture → **Камень**
   - Иначе → пусто (`null`)

**Seed:** передаётся в `createNoise2D` из `simplex-noise` через кастомную PRNG.

### 4. Камера (`src/engine/camera.ts`)

```ts
interface Camera {
  x: number;      // смещение в пикселях
  y: number;
  zoom: number;   // масштаб (0.2 — 2.0)
}
```

**Функциональность:**

- **Pan (перемещение):** зажатие левой кнопки мыши + перетаскивание
- **Zoom (масштаб):** колесо мыши, масштабирование к позиции курсора
- **Bounds:** камера не выходит за пределы мира (0...5000px с учётом zoom)

**Реализация:** чистые функции `clampCamera(camera, config)` и `screenToWorld(screenX, screenY, camera)`.

### 5. Renderer (`src/ui/GameWorld/renderer.ts`)

**Оптимизация:** рисуем только видимые тайлы (viewport culling).

1. Вычисляем видимую область в мировых координатах по камере
2. Определяем диапазон тайлов `[startCol, endCol]` × `[startRow, endRow]`
3. Для каждого видимого тайла:
   - Рисуем цветной квадрат (тип тайла):
     - Плодородная земля → зелёный (`#4a7c3f`)
     - Гора → серый (`#8b8b83`)
   - Если есть объект, рисуем иконку (emoji через `fillText`):
     - Дерево → 🌲
     - Камень → 🪨

### 6. GameWorld компонент (`src/ui/GameWorld/GameWorld.tsx`)

React-компонент:

- Создаёт `<canvas>` на полный экран
- При монтировании генерирует карту через `generateMap()`
- Хранит состояние камеры через `useRef`
- Навешивает обработчики:
  - `mousedown` / `mousemove` / `mouseup` — pan
  - `wheel` — zoom
- Использует `requestAnimationFrame` для перерисовки
- Ресайз canvas при изменении окна

### 7. App (`src/ui/App.tsx`)

Упрощаем: просто рендерим `<GameWorld />` на весь экран.

## Порядок реализации

| # | Задача                         | Файлы                                  |
|---|--------------------------------|----------------------------------------|
| 1 | Установить `simplex-noise`     | `package.json`                         |
| 2 | Описать типы                   | `src/core/types.ts`                    |
| 3 | Описать конфигурацию           | `src/config/map.ts`                    |
| 4 | Реализовать генератор карты    | `src/core/map-generator.ts`            |
| 5 | Реализовать камеру             | `src/engine/camera.ts`                 |
| 6 | Реализовать рендерер           | `src/ui/GameWorld/renderer.ts`         |
| 7 | Реализовать GameWorld          | `src/ui/GameWorld/GameWorld.tsx + .css` |
| 8 | Обновить App                   | `src/ui/App.tsx + .css`                |
| 9 | Проверить и настроить пороги   | Тюнинг параметров в `map.ts`          |

## Заметки

- Emoji-иконки (`fillText`) — самый быстрый способ отобразить объекты без загрузки спрайтов. Для прототипа достаточно.
- `simplex-noise` поддерживает seed, что позволит в будущем воспроизводить карты.
- Viewport culling критически важен: при zoom=0.2 видна вся карта, но рисуем все 10 000 тайлов, при zoom=2.0 рисуем
  ~200 тайлов. В среднем производительность будет хорошей.
- Структура файлов готова к расширению для степа 2 (пешки, здания).
