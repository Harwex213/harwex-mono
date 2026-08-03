# Промпты аватарок юнитов

Аватарки 1:1 для всех типов отрядов боевой системы Фенвальда. Матчасть взята из
`faenwald-battle-prototype/docs/faenwald-cf-boevaya-sistema.md`.

## Как устроен промпт

Каждый промпт склеен из трёх блоков. Два из них — константы, их нельзя менять от юнита к юниту.
Только так вся линейка выглядит одной серией.

### STYLE (константа)

```text
Cinematic dark-fantasy character portrait, photoreal-painterly hybrid, grounded historical realism. Muted desaturated palette: moss green, teal-grey, bone white, oxidised gold, dried-blood red. Overcast diffuse daylight, soft cool rim light from behind, no harsh highlights. Heavy atmospheric haze, drifting snow and ash specks in the air. Shallow depth of field, blurred dead-forest background. Fine film grain, gentle chromatic aberration, lifted blacks, low contrast, 35mm anamorphic look. Layered weathered fabrics, worn leather, tarnished pitted metal, honest dirt, sweat and battle wear on every surface.
```

### FRAMING (константа, пеший юнит)

```text
Square 1:1 composition. Chest-up three-quarter view, head turned slightly off-axis, gaze past camera. Subject centred, fills ~70% of frame, clear headroom. Background dissolves into dark haze toward the edges, natural vignette so the portrait reads cleanly inside a UI frame. Aspect ratio 1:1.
```

### FRAMING (константа, конный юнит)

Всадника по грудь нельзя отличить от пехотинца. Поэтому у кавалерии в кадр входит голова коня —
это единственное отступление от общей рамки.

```text
Square 1:1 composition. Chest-up three-quarter view of the rider, head turned slightly off-axis; the horse's head and arched neck cut into the lower-left of the frame. Rider centred, fills ~60% of frame, clear headroom. Background dissolves into dark haze toward the edges, natural vignette so the portrait reads cleanly inside a UI frame. Aspect ratio 1:1.
```

### NEGATIVE (константа)

```text
bright saturated colours, orange teal grading, glossy plastic armour, clean polished metal, fantasy overdesign, spikes, oversized pauldrons, glowing runes, magic effects, anime, cel shading, cartoon, 3D render look, smooth skin, beauty retouch, symmetrical front pose, full body, text, watermark, logo, UI, border, frame, multiple characters
```

### SUBJECT (меняется)

Единственный блок, который отличается у юнитов. Лежит внутри готового промпта в каждом файле.

## Варианты стиля

Блоки выше — вариант А, кинематографичный фотореализм. В `01-lko-light-spearman.md` лежат ещё два:

- **Б — живописный боевой скетч.** Видимый мазок, светлый фон, форма пятном.
- **В — эпический кей-арт.** Грозовое небо, контровой золотой свет, угли в воздухе, нижний ракурс.

Оба описаны только в файле ЛКо, на остальных юнитах пока не раскатаны. Выбери один вариант до
генерации всей линейки — смешивать их нельзя.

## Правила серии

- Держи один seed на всю фракцию. STYLE и FRAMING не трогай ни в одном промпте.
- Цвет фракции задаётся повязкой на руке (`company band`). На маленькой аватарке это самый
  читаемый признак стороны.
- Внутри ветки лёгкий → средний → тяжёлый растёт только количество металла. Лицо, свет и фон
  остаются теми же.
- Рендерь в 2048×2048, в игру клади 512×512. Грейн и дымка собираются на даунскейле. Генерация
  сразу в 512 даёт кашу.

## Файлы

| # | Юнит | Код | Файл |
| --- | --- | --- | --- |
| 1 | Лёгкий копейщик | ЛКо | `01-lko-light-spearman.md` |
| 2 | Средний копейщик | СКо | `02-sko-medium-spearman.md` |
| 3 | Тяжёлый копейщик | ТКо | `03-tko-heavy-spearman.md` |
| 4 | Лёгкий пехотинец | ЛПо | `04-lpo-light-infantry.md` |
| 5 | Средний пехотинец | СПо | `05-spo-medium-infantry.md` |
| 6 | Тяжёлый пехотинец | ТПо | `06-tpo-heavy-infantry.md` |
| 7 | Лёгкая кавалерия | ЛКа | `07-lka-light-cavalry.md` |
| 8 | Средняя кавалерия | СКа | `08-ska-medium-cavalry.md` |
| 9 | Тяжёлая кавалерия | ТКа | `09-tka-heavy-cavalry.md` |
| 10 | Лучник | Луч | `10-luch-archer.md` |
| 11 | Конный лучник | КЛуч | `11-kluch-horse-archer.md` |
| 12 | Лонгбоумен | Лонг | `12-long-longbowman.md` |
| 13 | Арбалетчик | Арб | `13-arb-crossbowman.md` |
| 14 | Инженеры | Инж | `14-inzh-engineer.md` |
