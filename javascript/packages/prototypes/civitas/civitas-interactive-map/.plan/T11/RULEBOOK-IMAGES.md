# Rulebook images — faithful transcription

Source article: `[CLM] ЭКОНОМИЧЕСКАЯ СИСТЕМА`
<https://vk.ru/@the_great_empire-clm-ekonomicheskaya-sistema>
Parsed markdown: `javascript/packages/prototypes/faenwald/faenwald-parser/out/174454458-clm-ekonomicheskaya-sistema.md`

**15 images referenced, 15 fetched, 15 verified as real JPEGs, 15 read.**
Downloaded copies: `<scratchpad>/rulebook-images/img01.jpg` … `img15.jpg`.
Fetched with `curl -L -A "Mozilla/5.0 …" -e "https://vk.com/"`; every response was HTTP 200
and `file` reported `JPEG image data` at exactly the dimensions the markdown recorded, so
none of them is an HTML error page.

**What these images actually are.** They are screenshots of the "economic calculator"
spreadsheet, filled in for a standard starting country (GDP 100,000,000; five sectors of
20,000,000 each; credit rating 70 points = B; control scale 50; emission 0%; military
spending 10%; all resource stocks 0). They are therefore *instances*, not formulas. The
row labels, band tables, and the italic explanatory notes inside the sheet are the real
recovered rules. The numeric cells are one worked example of the standard start.

**Transcription convention.** Russian label text is reproduced verbatim, with an English
gloss. Decimal comma is the sheet's own separator (`8 294,76` = 8294.76). Cells shaded
yellow in the sheet are player inputs; the article states this explicitly ("в калькуляторе
ЖЁЛТЫМ отмечено то, что может самостоятельно или в результате вердиктов менять игрок").

---

## Image 1 — GDP and GDP growth block

- Position: line 75 of the markdown, in §1 "Внутренний Валовый Продукт (ВВП)", directly after the list of the 5 sectors.
- Size: 733×521. Recovered and fully legible.
- URL: `https://sun9-27.vkuserphoto.ru/s/v1/ig2/8tSUmzOo3IzMB3OKaIGSSh4iAk5rfbl_dNG_pa-MVByrar338yM2rERduaAJon1ZNHfYLWY1fQewm3E3qpkZS8Rq.jpg?quality=95&as=32x23,48x34,72x51,108x77,160x114,240x171,360x256,480x341,540x384,640x455,720x512,733x521&from=bu`

Title bar: **ВВП + процент роста ВВП** (GDP + GDP growth percent)

Summary rows:

| Label | Value | Label | Value |
| --- | --- | --- | --- |
| Год / ход (Year / turn) | **1** *(yellow, player input)* | ВВП на начало (GDP at start) | 100 000 000 |
| Средн. пост. рост (Avg. permanent growth) | 3,00% | Средн. врем. рост (Avg. temporary growth) | 0,00% |
| Итоговый рост (Final growth) | 0,29% | ВВП на конец (GDP at end) | 100 290 594 |
| Изменение ВВП (GDP change) | 290 594 | ВВП след. год (GDP next year) | 100 290 594 |

Per-sector table:

| Сфера (Sector) | ВВП на начало | Пост. рост | Врем. рост | Итоговый рост | ВВП на след. год |
| --- | --- | --- | --- | --- | --- |
| Тяжёлая промышленность (Heavy industry) | 20 000 000 | 3,00% | 0,00% | 0,00% | 20 000 000 |
| Лёгкая промышленность (Light industry) | 20 000 000 | 3,00% | 0,00% | 0,00% | 20 000 000 |
| Сельское хозяйство (Agriculture) | 20 000 000 | 3,00% | 0,00% | 1,45% | 20 290 594 |
| Коммерческий сектор (Commercial) | 20 000 000 | 3,00% | 0,00% | 0,00% | 20 000 000 |
| Добывающий сектор (Mining) | 20 000 000 | 3,00% | 0,00% | 0,00% | 20 000 000 |
| Иное 1 (Other 1) | 0 | 3,00% | 0,00% | 3,45% | 0 |
| Иное 2 (Other 2) | 0 | 3,00% | 0,00% | 3,45% | 0 |

Footer note (verbatim): *«Общие ВВП и рост выше рассчитываются автоматически из объёмов и темпов роста секторов.»*
— "Total GDP and growth above are computed automatically from sector volumes and growth rates."

Recovered facts:
- Growth is split into three columns: **Пост. рост** (permanent growth), **Врем. рост** (temporary growth), **Итоговый рост** (final growth). Only the final column feeds GDP.
- The default permanent growth for every sector at the standard start is **3,00%**.
- Total GDP and total growth are aggregated from the sectors, not entered directly.
- The 5 named sectors plus **Иное 1** and **Иное 2** are literal spreadsheet rows, confirming the article's "no more than 2 Others" rule.

Caveat that must not be lost: this screenshot is a **resource-starved** state (Image 11
shows every resource stock at 0 against non-zero requirements). That is why four sectors
show a final growth of 0,00% despite 3,00% permanent growth. These numbers are not the
unstarved baseline.

Observation, explicitly labelled as **inference, not stated anywhere**: the two "Иное"
rows carry no resource dependency and show 3,45% final growth against 3,00% permanent
growth, so something adds roughly +0,45 p.p. Agriculture shows 1,45%, exactly 2,00 p.p.
below that. No arithmetic that fits agriculture also fits the mining sector, so the
shortage-penalty formula is **not recoverable** from this screenshot. Do not implement a
guess.

---

## Image 2 — growth columns (crop of Image 1)

- Position: line 84, in §1.2 "Процент роста ВВП".
- Size: 306×285. Recovered and legible.
- URL: `https://sun9-6.vkuserphoto.ru/s/v1/ig2/KRxFAwGzTznzs9718dqSQ32xof3xQ_X6kKcMgUdpXAbxLA5fq4e1_5yhnsg4voY6TzlyzfFAgU7JBXqDvr1AZVG0.jpg?quality=95&as=32x30,48x45,72x67,108x101,160x149,240x224,306x285&from=bu`

This is a zoomed crop of the three growth columns of the same table as Image 1. It adds no
new numbers.

| Пост. рост | Врем. рост | Итоговый рост |
| --- | --- | --- |
| 3,00% | 0,00% | 0,00% |
| 3,00% | 0,00% | 0,00% |
| 3,00% | 0,00% | 1,45% |
| 3,00% | 0,00% | 0,00% |
| 3,00% | 0,00% | 0,00% |
| 3,00% | 0,00% | 3,45% |
| 3,00% | 0,00% | 3,45% |

Row order matches Image 1 (heavy, light, agriculture, commercial, mining, Other 1, Other 2).

---

## Image 3 — credit rating tier table ★ high value

- Position: line 91, in §2 "Кредитный рейтинг государства".
- Size: 655×324. Recovered and fully legible.
- URL: `https://sun9-8.vkuserphoto.ru/s/v1/ig2/XAXlgxrIvKteHeQji2o2ntLUGdOQ9OqqWv9NfpGnOiGAbWIx0sZ_7NifKPe6kVF6kBxCIVjhrsdK5EJ9RP6kxkbs.jpg?quality=95&as=32x16,48x24,72x36,108x53,160x79,240x119,360x178,480x237,540x267,640x317,655x324&from=bu`

Title bar: **Кредитный рейтинг** (Credit rating)

| Label | Value |
| --- | --- |
| Очки рейтинга (Rating points) | **70** *(yellow, player input)* |
| Очки след. год (Rating points next year) | 70 |
| Рейтинг (Rating) | **B** |

Tier table — this is the authoritative 7-tier mapping:

| Ранг (Rank) | Очки (Points) | Состояние (Condition) | Метка |
| --- | --- | --- | --- |
| A+ | 95–100 | отличный (excellent) | |
| A | 85–94 | хороший (good) | |
| B | 70–84 | стабильный (stable) | ● *(current)* |
| C | 50–69 | сомнительный (doubtful) | |
| D | 30–49 | стагнация (stagnation) | |
| E | 10–29 | кризис (crisis) | |
| F | 0–9 | дефолт (default) | |

Recovered facts:
- The credit rating is a **0–100 integer point score** bucketed into 7 named tiers. The article only named the tiers; the point thresholds come from this image alone.
- The bands are contiguous and exhaustive over 0–100: `[0,9] [10,29] [30,49] [50,69] [70,84] [85,94] [95,100]`.
- The standard start is 70 points = tier B.

---

## Image 4 — state control scale ★ high value

- Position: line 100, in §3 "Шкала государственного контроля".
- Size: 686×510. Recovered; the lower two thirds of the image is a decorative photograph of a neoclassical stock-exchange building, not data.
- URL: `https://sun9-74.vkuserphoto.ru/s/v1/ig2/gMhdH8cH7cC1k9SP4w2VoDLwScEIh_NEntYV2Kbc5N1dJhnNYusv7AvxGygf0J1bOrH3z3Ne63twHDXh_zuTkxiY.jpg?quality=95&as=32x24,48x36,72x54,108x80,160x119,240x178,360x268,480x357,540x401,640x476,686x510&from=bu`

Title bar: **Шкала государственного контроля** (State control scale)

| Label | Value |
| --- | --- |
| Баллы (Points) | **50** *(yellow, player input)* |
| Положение след. год (Position next year) | 50 |

Band name shown for the current position: **Политика баланса** (Policy of balance).

Band strip — 11 contiguous bands over 0–100, colour-coded red (plan) through yellow (50)
to dark blue (market):

| Band | Colour |
| --- | --- |
| 0–5 | saturated red |
| 6–20 | red |
| 21–30 | mid red |
| 31–44 | light red |
| 45–49 | palest red |
| **50** | **yellow — current position, marked with a red ▲** |
| 51–55 | palest blue |
| 56–69 | light blue |
| 70–79 | mid blue |
| 80–94 | blue |
| 95–100 | dark navy |

Recovered facts:
- The scale is **0–100 integer points**, split into 11 named bands, symmetric about the single-value band 50.
- Red = planning/dirigisme side (0–49), blue = market side (51–100), matching the article's prose.
- Only the band name for the *current* position is rendered ("Политика баланса" for 50). **The names and the numeric effects of the other 10 bands are NOT VISIBLE in any image.** This is the single largest gap in the recovered data.

---

## Image 5 — FR and MIC point generation ★ high value

- Position: line 115, in §4 "Расходные очки", before §4.1.
- Size: 379×239. Recovered; read at 3× upscale.
- URL: `https://sun9-7.vkuserphoto.ru/s/v1/ig2/O13go9ojh18x_fsnZfdAoovDHp0wsEW9q4TyZHlM-wrJbMgFrR7g2LDwQhhWYa1ym26h1zdt_EFhwUpyeSTNP_WZ.jpg?quality=95&as=32x20,48x30,72x45,108x68,160x101,240x151,360x227,379x239&from=bu`

Title bar: **Очки ФС и ВПК** (FR and MIC points)

| Label | Value | Label | Value |
| --- | --- | --- | --- |
| ФС сген. (FR generated) | 8 294,76 | ФС к трате (FR available to spend) | 8 294,76 |
| ФС расходы (FR spending) | 0,00 | ФС остаток (FR remainder) | 8 294,76 |
| ВПК сген. (MIC generated) | 152,93 | ВПК расходы (MIC spending) | 0,00 |
| ВПК остаток (MIC remainder) | 152,93 | | |
| Множитель ФС режима (FR regime multiplier) | 1,0× | Множитель ВПК режима (MIC regime multiplier) | 1,0× |
| Бонус ФС: доля лёгкой пром. (FR bonus: light-industry share) | 5,00% | Бонус ВПК: доля тяжёлой пром. (MIC bonus: heavy-industry share) | 10,00% |

Recovered facts:
- At the standard start (GDP 100,000,000; rating 70/B; control 50; emission 0%; military spending 10%; no mobilization) the country generates **8 294,76 FR points** and **152,93 MIC points** per turn.
- FR and MIC generation each carry a **regime multiplier** (`Множитель … режима`), 1,0× when not mobilized. Image 15 shows mobilization sets these to ×0,5 for FR and ×2 for MIC.
- There is a sector-share bonus term on each: FR gets a bonus tied to the **light industry share** (5,00%), MIC gets one tied to the **heavy industry share** (10,00%). At the standard start each sector is 20% of GDP, so these are not simply the sector share itself.
- **The generating formulas themselves are NOT VISIBLE.** Only the inputs and the one output pair are recoverable.

---

## Image 6 — FR expense ledger (no formula content)

- Position: line 120, immediately after §4.1 "Финансовые средства".
- Size: 677×93. Recovered and legible; read at 3× upscale.
- URL: `https://sun9-1.vkuserphoto.ru/s/v1/ig2/iqgdsTAWN8gtc8wqgARtykyT1-jzNBEUTvETMTyEcaLk_pRkhUYcNU-9rwdRzbdrN6HXnY_SBzu7TAX_tmQ6mNyW.jpg?quality=95&as=32x4,48x7,72x10,108x15,160x22,240x33,360x49,480x66,540x74,640x88,677x93&from=bu`

Title bar: **Расходы очков ФС** (FR point expenses)
Columns: `#` | **Статья расхода ФС** (FR expense line item) | **оФС** (FR points)
First data row: `1` | *(empty, yellow input)* | `0,00`

The image is cropped to the header plus one blank row. It is a free-form expense ledger the
player fills in. **It contains no formula, no price list, and no thresholds.**

---

## Image 7 — MIC expense ledger (no formula content)

- Position: line 125, immediately after §4.2 "Ресурсы ВПК".
- Size: 600×77. Recovered and legible; read at 3× upscale.
- URL: `https://sun9-17.vkuserphoto.ru/s/v1/ig2/uAgevUmgj-Zxts3Q0gslFKqZHv4oVrIkZsqpih1Gc9bx4ly5QcG4BgMjrTdFYH-XvSmZ4-kemqL0D6w8AdyL04X3.jpg?quality=95&as=32x4,48x6,72x9,108x14,160x21,240x31,360x46,480x62,540x69,600x77&from=bu`

Title bar: **Расходы очков ВПК** (MIC point expenses)
Columns: `#` | **Статья расхода ВПК** (MIC expense line item) | **оВПК** (MIC points)

Cropped to the header plus the top edge of the first blank row. The article says military
prices are quoted in MIC points, but **no price list appears in this image or any other.**

---

## Image 8 — FR reserves and the reserve penalty ★ high value

- Position: line 134, after the paragraph on forming financial reserves.
- Size: 679×350. Recovered and fully legible.
- URL: `https://sun9-10.vkuserphoto.ru/s/v1/ig2/-RIf36H59BwEcDTV--tc4_b_Bo8-5ryRypxdNRmwM3FPW_e2x5BvMidv0AHlJa0ttoIeFvzKqjWxm-MTkR2hitkU.jpg?quality=95&as=32x16,48x25,72x37,108x56,160x82,240x124,360x186,480x247,540x278,640x330,679x350&from=bu`

Title bar: **Накопления ФС** (FR savings)

Instruction line (verbatim): *«Введите запас, добавление и изъятие. Текущий запас
сохраняется при снижении лимита; новые добавления блокируются, пока запас выше лимита.»*
— "Enter the stock, the addition, and the withdrawal. The current stock is preserved when
the limit falls; new additions are blocked while the stock is above the limit."

| Label | Value |
| --- | --- |
| Текущие накопления на начало хода (Current savings at turn start) | 0,00 |
| **Лимит накоплений (2 годовых дохода)** (Savings limit — 2 annual incomes) | **16 589,51** |
| Добавить в накопления (Add to savings) | 0,00 *(yellow input)* |
| Изъять из накоплений (Withdraw from savings) | 0,00 *(yellow input)* |
| Накопления на конец хода (Savings at turn end) | 0,00 |
| Штраф к росту ВВП (GDP growth penalty) | 0,0000% |

Footer note (verbatim): *«Каждый накопленный ФС снижает рост в 1,5 раза сильнее, чем тот же
ФС повысил бы рост при автоматическом инвестировании. Штраф считается по запасу на конец
хода.»*
— "Each saved FR point reduces growth 1.5 times more strongly than that same FR point would
have raised growth under automatic investment. The penalty is computed from the stock at
turn end."

Recovered facts:
- The reserve cap is exactly **2 × annual FR income**. 16 589,51 = 2 × 8 294,76 (8294.755 × 2), confirming both this rule and the FR generation figure in Image 5.
- The penalty is expressed as a **ratio, not a curve**: saving costs 1.5× the growth that the auto-investment of unspent points would have produced. So the penalty and the auto-invest bonus share one underlying rate; only the multiplier 1,5 is exposed.
- The penalty is assessed on the **end-of-turn** stock.
- Overshooting the limit is not clawed back: the stock survives a limit drop, but further additions are blocked until it is back under the limit.
- **The underlying auto-investment growth rate per FR point is NOT VISIBLE**, so the absolute penalty cannot be computed from this image.

---

## Image 9 — MIC stockpiles and upkeep ★ high value

- Position: line 139, after the paragraph on warehousing MIC points.
- Size: 607×357. Recovered and fully legible.
- URL: `https://sun9-79.vkuserphoto.ru/s/v1/ig2/eUHu-Dev7Zld1vt_LlGeSExkyYqobW2gC3WZ3AKeoyWZsUBkutvLfpHegCSa8m6DUpLUX7XI-mLPUdChKuJXDRuS.jpg?quality=95&as=32x19,48x28,72x42,108x64,160x94,240x141,360x212,480x282,540x318,607x357&from=bu`

Title bar: **Накопления ВПК** (MIC savings)

Instruction line (verbatim): *«Введите запас, добавление и изъятие. Лимита накопления ВПК
нет; каждое накопленное очко требует 2 ФС на содержание за ход.»*
— "Enter the stock, the addition, and the withdrawal. There is no MIC stockpile limit; each
stockpiled point requires 2 FR of upkeep per turn."

| Label | Value |
| --- | --- |
| Текущие накопления на начало хода (Current stockpile at turn start) | 0,00 |
| **Лимит накоплений ВПК** (MIC stockpile limit) | **Нет** (None) |
| Добавить в накопления (Add to stockpile) | 0,00 *(yellow input)* |
| Изъять из накоплений (Withdraw from stockpile) | 0,00 *(yellow input)* |
| Накопления на конец хода (Stockpile at turn end) | 0,00 |
| Поддержание накоплений, ФС/ход (Upkeep, FR per turn) | 0,00 |

Footer note (verbatim): *«Лимит накопления ВПК отсутствует. Каждый накопленный ВПК требует
2 ФС на поддержание за ход.»*
— "There is no MIC stockpile limit. Each stockpiled MIC point requires 2 FR of upkeep per turn."

Recovered facts:
- **MIC upkeep is exactly 2 FR per stockpiled MIC point per turn.** This is a hard number and the article only said "requires upkeep".
- There is no cap on the MIC stockpile.
- Upkeep is paid in FR, not MIC — a genuine cross-resource coupling.
- The article adds that unpaid stockpiles are lost, but **the size of the loss on non-payment is NOT VISIBLE.**

---

## Image 10 — emission and military spending ★ high value

- Position: line 146, in §5 "Эмиссия и Военные расходы".
- Size: 446×231. Recovered; read at 3× upscale.
- URL: `https://sun9-68.vkuserphoto.ru/s/v1/ig2/kmnPtv8yHDLSYEENgjf9KySEgGDiba8F9zifddmlM696buZlD0mAdG_yYSAwMr-nW8twofL93AdVMb5jB7I0zuLC.jpg?quality=95&as=32x17,48x25,72x37,108x56,160x83,240x124,360x186,446x231&from=bu`

Title bar: **Эмиссия и военные расходы** (Emission and military spending)

| Label | Value | Label | Value |
| --- | --- | --- | --- |
| Военные расходы (Military spending) | **10,00%** *(yellow input)* | Прошлый год (Last year) | 10,00% *(yellow)* |
| Эмиссия (Emission) | **0,00%** *(yellow input)* | Прошлый год (Last year) | 0,00% *(yellow)* |
| Лимит шага воен. расходов (Military spending step limit) | **10,00%** | Лимит шага эмиссии (Emission step limit) | **10,00%** |
| Штраф роста обороны (Defence growth penalty) | 0,0% | Штраф рейтинга эмиссии (Emission rating penalty) | 0 |

Recovered facts:
- Both emission and military spending are **percentages**, both player-editable, both tracked against last year's value so the step can be validated.
- At control scale 50 the per-turn step limit is **10,00 percentage points for both**. This is the concrete value the article referred to as "determined by your degree of state intervention". The step limit for the other 10 control bands is **NOT VISIBLE**.
- The standard start is military spending 10%, emission 0%.
- The two penalties are distinct in kind: military spending costs **growth** (`Штраф роста обороны`, a percentage), emission costs **credit rating** (`Штраф рейтинга эмиссии`, an integer point count). Both read 0 at the standard start.
- The article separately states that emission also raises inflation and so lowers growth; that effect is not a visible row here.

---

## Image 11 — resource requirements table ★ high value

- Position: line 159, in §6 "Ресурсы", immediately before the markdown resource/sector dependency table.
- Size: 697×398. Recovered and fully legible; read at 2× upscale.
- URL: `https://sun9-8.vkuserphoto.ru/s/v1/ig2/2AYELUqRqZGNJIQRqAALS33U4SGi91BvZH1X8cGc5v0dhd2_tn1-rpxIS7Bp70PLHgv-AiiaWJ4ulOCTQZeu69Le.jpg?quality=95&as=32x18,48x27,72x41,108x62,160x91,240x137,360x206,480x274,540x308,640x365,697x398&from=bu`

Title bar: **РЕСУРСЫ** (Resources)

Columns: **Ресурс** (Resource) | **Вид** (Icon) | **Блокада** (Blockade) | **Запас** (Stock) |
**Добыча** (Extraction) | **Импорт** (Import) | **Нужно** (Needed) | **Своб.** (Free) | **След. год** (Next year)

The 8 resources are grouped under three category headers:

**ТОПЛИВО (FUEL)**

| Ресурс | Блокада | Запас | Добыча | Импорт | **Нужно** | Своб. | След. год |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Уголь (Coal) | Отсутствует (none) | 0 | 0 | 0 | **60** | 0 | 0 |
| Нефть (Oil) | Отсутствует | 0 | 0 | 0 | **20** | 0 | 0 |

**СЫРЬЁ (RAW MATERIALS)**

| Ресурс | Блокада | Запас | Добыча | Импорт | **Нужно** | Своб. | След. год |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Волокнистые культуры (Fibre crops) | Отсутствует | 0 | 0 | 0 | **40** | 0 | 0 |
| Руды чёрных металлов (Ferrous metal ores) | Отсутствует | 0 | 0 | 0 | **40** | 0 | 0 |
| Руды цветных металлов (Non-ferrous metal ores) | Отсутствует | 0 | 0 | 0 | **40** | 0 | 0 |
| Каучук (Rubber) | Отсутствует | 0 | 0 | 0 | **20** | 0 | 0 |
| Химическое сырьё (Chemical feedstock) | Отсутствует | 0 | 0 | 0 | **60** | 0 | 0 |

**РОСКОШЬ (LUXURY)**

| Ресурс | Блокада | Запас | Добыча | Импорт | **Нужно** | Своб. | След. год |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Драгоценные металлы/камни (Precious metals/stones) | Отсутствует | 0 | 0 | 0 | **20** | 0 | 0 |

Recovered facts — this is the most load-bearing image in the set:
- The 8 resources are grouped into **3 categories** (fuel / raw materials / luxury). The article never mentions this grouping.
- **Блокада is a per-resource field**, not a global flag. Its value at the standard start is `Отсутствует` (absent).
- The per-turn balance is `Запас + Добыча + Импорт` versus `Нужно`, leaving `Своб.` (free) and `След. год` (next year's carry).
- **The `Нужно` column arithmetically confirms the article's dependency table.** Each dependent sector holds 20,000,000 GDP, and the article says 1 resource unit sustains 1,000,000 of growth, so each dependent sector demands 20 units. The requirements are exactly 20 × (number of dependent sectors):

| Resource | Нужно | ÷20 | Dependent sectors per the article's table |
| --- | --- | --- | --- |
| Уголь | 60 | 3 | heavy, light, mining |
| Нефть | 20 | 1 | heavy |
| Волокнистые культуры | 40 | 2 | agriculture, commercial |
| Руды чёрных металлов | 40 | 2 | heavy, light |
| Руды цветных металлов | 40 | 2 | heavy, light |
| Каучук | 20 | 1 | heavy |
| Химическое сырьё | 60 | 3 | agriculture, heavy, light |
| Драгоценные металлы/камни | 20 | 1 | commercial |

  Every row matches. The dependency table in the markdown and the "1 unit per 1 million"
  rule are therefore both confirmed by independent evidence.
- The calculator's resource names are slightly more specific than the article's: it says **ores** (`Руды чёрных/цветных металлов`) where the article's table says just "Черн. Металлы" / "Цвет. Металлы".
- **The shortage penalty formula is NOT VISIBLE.** The article says the penalty per resource shrinks as more sectors depend on it, but no coefficients appear anywhere.

---

## Image 12 — decorative artwork, no data

- Position: line 214, in Part II "Общие положения", after the bullet list of in-turn actions.
- Size: 1920×998. Recovered successfully and viewed.
- URL: `https://sun9-78.vkuserphoto.ru/s/v1/ig2/mONaqAhz4iPz2cKQXGhuVK6XZf9ZkOs8IOtRM5ZQ_tw6mh_2-ljMx5o0t7KQ8SuAZglAO4af75fZThhmL9dX2sFV.jpg?quality=95&as=32x17,48x25,72x37,108x56,160x83,240x125,360x187,480x249,540x281,640x333,720x374,1080x561,1280x665,1440x748,1920x998&from=bu`

**Contains no tables, numbers, or rules.** It is a moody Victorian-industrial street scene:
gas lamps, an elevated railway with a tram, a clock tower, pedestrians in period dress,
storefront signs reading "MAYPOLE" and a partly obscured vertical sign. Mood art for the
setting only. Nothing to transcribe.

---

## Image 13 — debt and debt service ★ high value

- Position: line 253, in Part III §1 "Внутренние и международные займы".
- Size: 577×294. Recovered and fully legible; read at 3× upscale.
- URL: `https://sun9-59.vkuserphoto.ru/s/v1/ig2/Yq1O4zOBAa9Rqb4Hlr7-4lYnOesgneBGN7lAxQ9UCLizmzh-NRj6P32WTeVl9aYwqujaJEOtn4gwD8cQUYymABSX.jpg?quality=95&as=32x16,48x24,72x37,108x55,160x82,240x122,360x183,480x245,540x275,577x294&from=bu`

Title bar: **ДОЛГ И ОБСЛУЖИВАНИЕ** (Debt and servicing)

| Label | Value | Label | Value | Label | Value |
| --- | --- | --- | --- | --- | --- |
| Общий долг на начало (Total debt at start) | 0,00 | **Лимит общего долга** (Total debt limit) | **22 500,00** | **Ставка нового займа** (New loan rate) | **12,00%** |
| Займ ФС (Borrow FR) | 0,00 *(yellow input)* | Доступный новый займ (Available new loan) | 22 500,00 | Требуется ФС (FR required) | 0,00 |
| Выделено ФС всего (Total FR allocated) | 0,00 | Недостача платежа (Payment shortfall) | 0,00 | Штраф рейтинга (Rating penalty) | 0 |
| Общий долг на конец (Total debt at end) | 0,00 | Статус долга (Debt status) | **Норма** (Normal) | Дефолт прошл. год (Default last year) | **Нет** (No) |

Per-loan table, 6 numbered slots visible (rows 1–6, the sheet may continue below the crop):

| № | Долг на начало | Ставка | Выделено ФС | Требуется ФС | Долг на конец |
| --- | --- | --- | --- | --- | --- |
| 1 | 0,00 | 12,00% | 0,00 | 0,00 | 0,00 |
| 2 | 0,00 | 12,00% | 0,00 | 0,00 | 0,00 |
| 3 | 0,00 | 12,00% | 0,00 | 0,00 | 0,00 |
| 4 | 0,00 | 12,00% | 0,00 | 0,00 | 0,00 |
| 5 | 0,00 | 12,00% | 0,00 | 0,00 | 0,00 |
| 6 | 0,00 | 12,00% | 0,00 | 0,00 | 0,00 |

Recovered facts:
- At credit rating 70 (tier B) the **total debt limit is 22 500 FR** and the **interest rate on a new loan is 12,00%**. The article said both are a function of the credit rating; these are the tier-B values. **The values for the other 6 tiers are NOT VISIBLE.**
- Debt is tracked as **individual loans in numbered slots**, each carrying its own rate — the rate is locked in at borrowing time, not floated.
- `Доступный новый займ` = limit − current debt.
- Underpayment is modelled explicitly: **Недостача платежа** (payment shortfall) feeds a **Штраф рейтинга** (rating penalty, in integer rating points) and a **Статус долга** state machine with at least the states `Норма` and, implied by `Дефолт прошл. год`, a default state. **The shortfall→penalty mapping is NOT VISIBLE.**
- No loan term/duration column is visible, despite the article promising that the term depends on the rating.

---

## Image 14 — nationalization and privatization ★ high value

- Position: line 264, in Part III §2 "Национализация/Приватизация".
- Size: 694×270. Recovered and fully legible; the italic note read at 4× upscale.
- URL: `https://sun9-88.vkuserphoto.ru/s/v1/ig2/cTtVxf1681P_m8kgo98W19YF2k23IS79B5bAeUDfkYxKG7JC88edWygoIj2ILaLkort1iQ5roMp5f3WAz9W_z-AP.jpg?quality=95&as=32x12,48x19,72x28,108x42,160x62,240x93,360x140,480x187,540x210,640x249,694x270&from=bu`

Title bar: **Национализация и приватизация** (Nationalization and privatization)

| Label | Value | Label | Value | Label | Value |
| --- | --- | --- | --- | --- | --- |
| Действие (Action) | **Нет** (None) *(yellow input)* | Тип предприятия (Enterprise type) | **Гражданское** (Civilian) *(yellow input)* | Успешность (Success roll) | **0** *(yellow input)* |
| Штраф роста (Growth penalty) | 0,0% | Штраф рейтинга (Rating penalty) | 0 | | |

Explanatory note (verbatim, the single most valuable line in the whole image set):
*«Национализация: −0,75 п.п. роста и −4 рейтинга, до +26,25% дохода. Приватизация: до
+0,75 п.п. роста; провал −0,25 п.п. и −2 рейтинга. Перерыв каждого действия — 2 хода.»*

Translation:
- **Nationalization:** −0,75 percentage points of growth and −4 rating points, for up to **+26,25% of income**.
- **Privatization:** up to **+0,75 percentage points of growth**; on failure −0,25 p.p. and −2 rating points.
- **Cooldown for each action: 2 turns.**

Cooldown tracking rows:

| Label | Value |
| --- | --- |
| Полных ходов после приватизации (Full turns since privatization) | 2 *(yellow)* |
| Приватизация доступна (Privatization available) | – |
| Полных ходов после национализации (Full turns since nationalization) | 2 *(yellow)* |
| Национализация доступна (Nationalization available) | – |

Recovered facts:
- **This image resolves the article's internal contradiction.** The prose says "once a year" in §2's opening line and "no more than once per 2 years" in its closing line. The calculator says `Перерыв каждого действия — 2 хода` and tracks `Полных ходов после …` per action. **The 2-turn cooldown is authoritative;** "once a year" is wrong.
- The cooldowns are tracked **separately per action**, matching the prose's "(отдельно каждую)".
- `Успешность` is the 1–10 roll the article describes, entered by hand from the dice chat.
- The gain is scaled: **up to +26,25% of income** for nationalization, **up to +0,75 p.p. of growth** for privatization. The word "up to" plus a 1–10 roll implies the roll scales the payout, but **the roll→payout mapping is NOT VISIBLE.** 26,25% / 10 = 2,625% per roll point and 0,75 / 10 = 0,075 p.p. per roll point would be the obvious linear reading, but this is inference and is not stated.
- Privatization's downside is asymmetric: it only costs growth and rating **on failure**, whereas nationalization pays its −0,75 p.p. / −4 rating cost unconditionally.
- The article's extra rule — that reaching certain control-scale extremes locks both actions out — has no visible threshold anywhere.

---

## Image 15 — economic mobilization ★ high value

- Position: line 281, in Part III §3 "Мобилизация".
- Size: 284×401. Recovered and fully legible; read at 3× upscale.
- URL: `https://sun9-81.vkuserphoto.ru/s/v1/ig2/3J2Px_-Rzv8v9PB1GZPLpzirKVAVoE9fy0GpJ0kTHBnSVV_zUC9df93mB5gQ2JTcHiieSjAzLOfMZEZjb34rEMLs.jpg?quality=95&as=32x45,48x68,72x102,108x152,160x226,240x339,284x401&from=bu`

Title bar: **Мобилизация экономики** (Economic mobilization)

| Label | Value |
| --- | --- |
| Режим (Regime) | **Нет** (No) *(yellow input)* |
| Лимит шага военных расходов (Military spending step limit) | 10% |
| Генерация ФС (FR generation) | 1,0× |
| Генерация ВПК (MIC generation) | 1,0× |
| Штраф роста ВВП (GDP growth penalty) | 0,00% |

Explanatory note (verbatim): *«При включении: разрешённый шаг военных расходов +10 п.п.;
генерация ФС ×0,5; генерация ВПК ×2; стандартный рост ВВП −2 п.п.»*

Translation — **when mobilization is switched on:**
- allowed military spending step **+10 percentage points** (so 10% → 20% at control scale 50);
- FR generation **×0,5**;
- MIC generation **×2**;
- standard GDP growth **−2 percentage points**.

Recovered facts:
- Mobilization is a **boolean regime flag**, and it is exactly the source of the `Множитель ФС/ВПК режима` fields in Image 5.
- All four effects are hard numbers. This is the most completely specified mechanic in the set.
- The step bonus is **additive** (+10 p.p. on the step limit) while the generation effects are **multiplicative** (×0,5, ×2) and the growth effect is **additive** (−2 p.p.).
- The article adds that mobilizing outside a declared war or international crisis incurs penalties; **those penalties are NOT VISIBLE.**

---

## Summary of recovery

| # | Content | Status |
| --- | --- | --- |
| 1 | GDP + growth block, per-sector | Recovered, fully transcribed |
| 2 | Growth columns (crop of #1) | Recovered, no new data |
| 3 | Credit rating 7-tier thresholds | Recovered ★ |
| 4 | Control scale, 11 bands | Recovered ★ (band names/effects missing) |
| 5 | FR/MIC generation | Recovered ★ (formula itself not shown) |
| 6 | FR expense ledger | Recovered, contains no rules |
| 7 | MIC expense ledger | Recovered, contains no rules |
| 8 | FR reserve limit + 1,5× penalty rule | Recovered ★ |
| 9 | MIC stockpile, 2 FR/point upkeep | Recovered ★ |
| 10 | Emission / military spending, 10 p.p. step | Recovered ★ |
| 11 | Resource requirements, 3 categories | Recovered ★ |
| 12 | Decorative artwork | Recovered, contains no rules |
| 13 | Debt limit 22 500, rate 12% at B | Recovered ★ |
| 14 | Nationalization/privatization effects + 2-turn cooldown | Recovered ★ |
| 15 | Mobilization, all four effects | Recovered ★ |

15 of 15 fetched, 15 of 15 read, 12 of 15 carrying rule content.
