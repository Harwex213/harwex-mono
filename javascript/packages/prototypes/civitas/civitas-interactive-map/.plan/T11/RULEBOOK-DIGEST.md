# Rulebook digest — CLM economic system

Source: `[CLM] ЭКОНОМИЧЕСКАЯ СИСТЕМА` by CIVITAS LUMINA, published 26 Jul.
<https://vk.ru/@the_great_empire-clm-ekonomicheskaya-sistema>
Parsed markdown: `javascript/packages/prototypes/faenwald/faenwald-parser/out/174454458-clm-ekonomicheskaya-sistema.md`

Companion file: **`RULEBOOK-IMAGES.md`** holds the transcriptions of the 15 calculator
screenshots embedded in the article. All 15 were recovered. Wherever this digest cites a
number that the prose does not contain, the number comes from an image, and the image is
named.

## How to read this file

The article opens with a warning in bold capitals:

> **«ОСОБО ОТМЕТИМ, ЧТО В ДАННОЙ СТАТЬЕ НЕ ПРИВОДИТСЯ КОНКРЕТНЫХ ЭКОНОМИЧЕСКИХ ФОРМУЛ,
> ГОВОРИТСЯ ЛИШЬ О СОДЕРЖАНИИ ЭКОНОМИЧЕСКИХ ПОКАЗАТЕЛЕЙ, ИХ ВЗАИМОЗАВИСИМОСТИ И ДИНАМИКЕ.
> ВСЕ КОНКРЕТНЫЕ ФОРМУЛЫ НАХОДЯТСЯ В ЭКОНОМИЧЕСКОМ КАЛЬКУЛЯТОРЕ И НЕИЗМЕННЫ.»**

— "We note specially that this article gives no concrete economic formulas. It describes
only the content of the economic indicators, their interdependence, and their dynamics.
All concrete formulas live in the economic calculator and are fixed."

Part II repeats the point: *«Все формулы… уже вшиты в калькулятор и вручную их считать НЕ
НАДО КАТЕГОРИЧЕСКИ»* — the formulas are baked into the calculator and must not be computed
by hand.

**This fact is confirmed.** The prose is a design description, not a specification. The
calculator spreadsheet is the authority, and this repository does not have it. The images
are screenshots of that spreadsheet, so they yield the calculator's *labels, thresholds,
and rate constants* but not its cell formulas.

`**NOT SPECIFIED**` below means the document and its images define no value. Do not fill
these in with plausible numbers.

---

## Turn / game time

- **A turn is one calendar year.** The article never states this in one sentence, but every
  reference agrees: GDP is "the value of all goods and services produced in your country
  **in one year**"; growth is "how much per year on average your economy grows"; the
  calculator "must be filled in **annually**"; the nationalization cooldown is written both
  as "once a **year**" and "once per 2 **years**". The calculator's own field is
  `Год / ход` — "Year / turn" — treating the two as the same unit (Image 1).
- The starting turn is **turn 1** (Image 1).
- **Spending is booked to the year it happened. A verdict's results are booked to the year
  the verdict arrived.** These can be different years.
- Each turn the player publishes the filled calculator into their game thread.

---

## 1. GDP and its 5 sectors

GDP (ВВП) is the total value of all goods and services the country produces in one year. A
larger GDP means a larger and stronger economy. GDP rises and falls with the player's
actions, with the credit rating, and with state policy.

GDP is not a single number. It is the sum of its sectors. Each sector carries its own share
of the economy and its own growth rate, and the totals are computed from the sectors
(Image 1: *"Total GDP and growth above are computed automatically from sector volumes and
growth rates"*).

The 5 sectors:

| Sector | Russian | Covers |
| --- | --- | --- |
| Agriculture | Сельское хозяйство | Agrarian and food production, farms |
| Light industry | Лёгкая промышленность | Industry aimed first at civilian and household needs |
| Heavy industry | Тяжёлая промышленность | Industry aimed first at military and high-technology needs |
| Commercial | Коммерческий сектор | Financial and investment markets, commercial services (tourism, gambling, and so on) |
| Mining | Добывающий сектор | Extraction enterprises and their contribution |

**"Other" sectors.** The player may carve out a separate area during play and develop it
hard. That area is then recorded as **«Иное»** (Other). **At most 2 "Other" sectors are
allowed**, and weighty grounds are required to create one. The calculator has exactly two
such rows, `Иное 1` and `Иное 2` (Image 1).

**Standard start** (Image 1): GDP 100 000 000, split evenly — 20 000 000 in each of the 5
sectors, 0 in each "Other".

---

## 2. GDP growth

Growth is how much the economy grows or shrinks per year on average. **The value can be
negative.** Every sector has its own growth percentage, and that percentage moves with
domestic actions and events as well as with the international situation.

The calculator splits growth into three columns (Image 1):

| Column | Russian | Meaning |
| --- | --- | --- |
| Permanent growth | Пост. рост | The standing rate the sector grows at |
| Temporary growth | Врем. рост | A one-off modifier for this turn |
| Final growth | Итоговый рост | What actually applies to GDP |

- **Default permanent growth at the standard start is 3,00% for every sector** (Image 1).
- Only the final column drives GDP.
- Growth changes only through verdicts, whether global or personal. The article says the
  credit rating, the position on the control scale, and the resource situation likewise
  "cannot be changed by anything except verdicts".

**How the three columns combine into the final column is NOT SPECIFIED.** The screenshot
shows a resource-starved state, so its final-growth numbers are not a usable baseline. See
"Ambiguities and gaps".

Growth also receives:
- a bonus from **unspent FR and MIC points**, which count as invested at year end (§6 below);
- a penalty from **held FR reserves** (§7);
- a penalty from **emission** through inflation (§8);
- a penalty from **military spending** — indirectly, by shrinking the FR-generating share of the economy (§9);
- a penalty from **resource shortage**, floored at zero (§11);
- **+1,5 p.p. to every sector** while a concession is in force (§13);
- **−2 p.p.** while mobilized (§13);
- **−0,75 p.p.** from nationalization, or up to **+0,75 p.p.** from privatization (§13).

---

## 3. Credit rating (7 tiers, A+ to F)

The credit rating reflects how reliable international and domestic financial elites judge
the economy to be, and so whether the state can borrow and attract investment.

The rating is an **integer score from 0 to 100** (`Очки рейтинга`), bucketed into 7 tiers.
The tiers are named in the prose. **The thresholds come from Image 3 and appear nowhere in
the text:**

| Tier | Points | Condition (Состояние) |
| --- | --- | --- |
| A+ | 95–100 | отличный — excellent |
| A | 85–94 | хороший — good |
| B | 70–84 | стабильный — stable |
| C | 50–69 | сомнительный — doubtful |
| D | 30–49 | стагнация — stagnation |
| E | 10–29 | кризис — crisis |
| F | 0–9 | дефолт — default |

The bands are contiguous and cover 0–100 with no gaps.

**Standard start: 70 points, tier B** (Image 3).

The rating does two things:
1. It sets how much the state can borrow from international and domestic creditors, other players excluded (§12).
2. It feeds the FR points available at the start of the turn (§6).

The rating falls from late debt payments (§12), from emission (§8), and from nationalization
(§13).

**The rating's numeric effect on FR generation is NOT SPECIFIED.**
**How rating points are gained or lost outside the specific penalties listed here is NOT SPECIFIED.**

---

## 4. State control scale (0–100)

The scale records how far the state intervenes in the economy and tries to control economic
processes at every level. It runs from strict minarchism at one end to total control at the
other.

- **Below 50 leans to planning (dirigisme). Above 50 leans to the free market. 50 is
  neutral and grants neither bonus nor debuff.**
- A planned economy is bulkier and less profitable. A planned economy answers the player's
  immediate decisions and resists shocks better.
- A market economy grows faster and pays larger dividends. A market economy reacts painfully
  to crises and does not obey direct control.
- **The closer to planning, the slower the economy grows on its own, and the more free funds
  the player holds for orders and projects.**
- **The closer to the market, the faster the economy grows on its own, and the fewer free
  funds the player holds.**

The calculator divides the scale into **11 contiguous bands** (Image 4):

`0–5 | 6–20 | 21–30 | 31–44 | 45–49 | 50 | 51–55 | 56–69 | 70–79 | 80–94 | 95–100`

Red shading marks the planning side, blue marks the market side, and the single-value band
50 is yellow. **Standard start: 50, band name «Политика баланса» (Policy of balance).**

The scale drives three things:
1. Growth and free funds, in opposite directions, as above.
2. **The per-turn step for emission and military spending** (§10).
3. **A lockout on nationalization and privatization once deregulation or regulation passes
   some level** (§13).

**The names of the other 10 bands are NOT SPECIFIED** — the calculator renders only the
band the country currently occupies.
**The numeric effect of each band is NOT SPECIFIED.**
**The thresholds that lock out nationalization and privatization are NOT SPECIFIED.**

Movement along the scale comes from the player's decisions and orders and from outside
events. Nationalization shifts toward planning. Privatization shifts toward the market.

---

## 5. Spending points — FR and MIC

Spending points (расходные очки) are the free funds for the player's discretionary
spending, civil and military. Orders and armed forces are financed with them. There are two
kinds, and they are not interchangeable.

### 5.1 FR — financial resources (ФС, финансовые средства)

Free financial funds at the government's disposal. Non-military orders and actions are
financed through FR. FR can be spent on orders, lent out, or given to another state as a
subsidy.

- Measured in **FR points (очки ФС)**. **One point is nominally 1 million arlings**, the
  international reserve currency.
- The FR available at the start of a turn is set by: **the credit rating, the degree of
  state intervention, GDP, GDP growth, and whether the player is running emission**.
- The calculator applies a **regime multiplier** (`Множитель ФС режима`), which is 1,0×
  normally and 0,5× under mobilization (Images 5, 15).
- The calculator carries a **light-industry-share bonus** (`Бонус ФС: доля лёгкой пром.`),
  5,00% at the standard start (Image 5).

**Standard start: 8 294,76 FR points generated** (Image 5).

### 5.2 MIC — military-industrial complex points (ВПК)

Free funds and materials that can go to maintaining or strengthening the armed forces.

- Measured in **MIC points (очки ВПК, оВПК)**.
- Formed from **GDP, GDP growth, and the military spending percentage**.
- **Every military price in the game is quoted in MIC points.**
- The calculator applies a **regime multiplier** (`Множитель ВПК режима`), 1,0× normally
  and 2× under mobilization (Images 5, 15).
- The calculator carries a **heavy-industry-share bonus** (`Бонус ВПК: доля тяжёлой пром.`),
  10,00% at the standard start (Image 5).

**Standard start: 152,93 MIC points generated** (Image 5).

### 5.3 Points do not carry over

**Neither FR nor MIC accumulate automatically.** Every free FR or MIC point left at year end
counts as invested into the economy and raises economic growth, though not by much. The
opt-in alternative is savings (§7).

**The FR generation formula is NOT SPECIFIED.**
**The MIC generation formula is NOT SPECIFIED.**
**The growth bonus per auto-invested point is NOT SPECIFIED.**
**No price list in MIC points appears in this article** — Images 6 and 7 are blank
free-form expense ledgers.

---

## 6. Savings — FR reserves and MIC stockpiles

### 6.1 FR reserves

The player may set FR aside as financial reserves.

- **The reserve cap is 2 times the last income.** The calculator labels the field
  `Лимит накоплений (2 годовых дохода)` and shows **16 589,51 against an income of
  8 294,76** — exactly double (Image 8).
- **Holding reserves penalises growth.** The larger the reserve, the larger the penalty,
  because the money sits idle and only feeds inflation.
- **The penalty rate is a ratio, and it is recovered:** *«Каждый накопленный ФС снижает рост
  в 1,5 раза сильнее, чем тот же ФС повысил бы рост при автоматическом инвестировании»* —
  **each saved FR point cuts growth 1,5 times more than that same point would have raised
  growth under auto-investment** (Image 8).
- **The penalty is assessed on the end-of-turn stock**, not on the average or the peak.
- If the limit drops below the current stock, the stock survives. New additions are blocked
  until the stock is back under the limit (Image 8).

### 6.2 MIC stockpiles

The player may warehouse MIC points.

- **There is no cap on the MIC stockpile** (Image 9 shows `Лимит накоплений ВПК: Нет`).
- **Stockpiled MIC costs upkeep, paid in FR every turn. The rate is 2 FR per stockpiled MIC
  point per turn** (Image 9). The prose only said upkeep exists; the rate comes from the
  image.
- **Unmaintained reserved MIC is lost.**

**The growth rate per auto-invested FR point is NOT SPECIFIED, so the absolute size of the
reserve penalty cannot be computed — only its 1,5× relation to the bonus.**
**How much MIC is lost when upkeep goes unpaid is NOT SPECIFIED** — the prose says "they
will be lost" without saying whether that means all of it or a part.

---

## 7. Emission %

Emission (эмиссия) is money printing. The player sets it directly.

- **Raising emission raises the FR points received that turn.**
- **Raising emission raises inflation, and higher inflation lowers growth.**
- The calculator tracks a separate **`Штраф рейтинга эмиссии`** — an **emission rating
  penalty**, counted in integer credit-rating points, not in growth (Image 10).
- Emission cannot be raised without limit. The per-turn change is capped by the step (§9).

**Standard start: 0,00%** (Image 10).

**The FR gained per point of emission is NOT SPECIFIED.**
**The inflation-to-growth conversion is NOT SPECIFIED.**
**The rating penalty per point of emission is NOT SPECIFIED** — the field reads 0 at 0% emission.
**Any hard ceiling on the emission percentage is NOT SPECIFIED.**

---

## 8. Military spending %

Military spending (военные расходы) is the share of the economy directed at the military.
The player sets it directly.

- **Raising military spending raises the MIC points received that turn.**
- **Raising military spending lowers FR generation**, because FR is generated from the part
  of the economy that is free of military-industrial work.
- The calculator tracks a **`Штраф роста обороны`** — a **defence growth penalty**,
  expressed as a percentage (Image 10).
- The per-turn change is capped by the step (§9).

**Standard start: 10,00%** (Image 10).

**The MIC gained per point of military spending is NOT SPECIFIED.**
**The FR lost per point of military spending is NOT SPECIFIED.**
**The growth penalty per point of military spending is NOT SPECIFIED** — the field reads
0,0% at 10% spending, which suggests 10% is the penalty-free baseline, but the article does
not say so.
**Any hard ceiling on the military spending percentage is NOT SPECIFIED.**

---

## 9. The emission / military spending step

> **«Шаг**, на который вы можете поднять/опустить эмиссию/военные расходы за ход
> определяется степенью вашего государственного вмешательства в экономику… **Превысить этот
> шаг невозможно кроме как сдвижением по шкале государственного контроля.»**

- The **step** is the maximum by which emission or military spending may move in one turn,
  up or down.
- **The step is set by the position on the state control scale.**
- **The step cannot be exceeded by any means other than moving along the control scale** —
  with one exception, mobilization (§13).
- The calculator keeps the previous year's values (`Прошлый год`) for both indicators so the
  step can be validated (Image 10).

**Recovered value: at control scale 50, both step limits are 10,00 percentage points**
(`Лимит шага воен. расходов` = 10,00%, `Лимит шага эмиссии` = 10,00%, Image 10). Image 15
independently confirms the 10% military step at the unmobilized baseline.

**Mobilization adds +10 p.p. to the military spending step** (Image 15), so at control
scale 50 a mobilized country may move military spending by 20 p.p. per turn.

**The step for the other 10 control-scale bands is NOT SPECIFIED.** One data point exists
out of eleven. Whether the emission step and the military step are always equal is likewise
**NOT SPECIFIED** — they are equal at 50, and 50 is the only observed band.

---

## 10. Resources

The economy needs inputs to run. There is no clothing without fibre, no engines without
steel, no wire without copper. Resources are what sustains **growth**, not output — the
article is explicit that resources back *«роста вашей экономики»*.

### 10.1 The 8 resources

The calculator groups them into 3 categories (Image 11). The prose gives no grouping.

| Category | Resource | Russian (calculator wording) |
| --- | --- | --- |
| **ТОПЛИВО** (Fuel) | Coal | Уголь |
| | Oil | Нефть |
| **СЫРЬЁ** (Raw materials) | Fibre crops | Волокнистые культуры |
| | Ferrous metal ores | Руды чёрных металлов |
| | Non-ferrous metal ores | Руды цветных металлов |
| | Rubber | Каучук |
| | Chemical feedstock | Химическое сырьё |
| **РОСКОШЬ** (Luxury) | Precious metals / stones | Драгоценные металлы/камни |

### 10.2 Resource → sector dependency table

Reproduced exactly as the article gives it, including its own column order and its shorter
resource names:

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Ресурс | Сельское Хозяйство | Тяж. Пром. | Легк. Пром. | Коммерческий сектор | Добывающий сектор |
| Уголь |  | ✅ | ✅ |  | ✅ |
| Нефть |  | ✅ |  |  |  |
| Волокнистые культуры | ✅ |  |  | ✅ |  |
| Черн. Металлы |  | ✅ | ✅ |  |  |
| Цвет. Металлы |  | ✅ | ✅ |  |  |
| Каучук |  | ✅ |  |  |  |
| Хим. сырье | ✅ | ✅ | ✅ |  |  |
| Драг. металлы/камни |  |  |  | ✅ |  |

English restatement:

| Resource | Agriculture | Heavy ind. | Light ind. | Commercial | Mining | Dependent sectors |
| --- | --- | --- | --- | --- | --- | --- |
| Coal | | ✅ | ✅ | | ✅ | 3 |
| Oil | | ✅ | | | | 1 |
| Fibre crops | ✅ | | | ✅ | | 2 |
| Ferrous metals | | ✅ | ✅ | | | 2 |
| Non-ferrous metals | | ✅ | ✅ | | | 2 |
| Rubber | | ✅ | | | | 1 |
| Chemical feedstock | ✅ | ✅ | ✅ | | | 3 |
| Precious metals/stones | | | | ✅ | | 1 |

Note that the **mining sector depends only on coal**, and that **no resource is consumed by
more than 3 sectors**.

### 10.3 Extraction, consumption, and trade

- A resource map exists at game start.
- **A deposit of a resource on your territory yields +50 units of that resource per turn.**
- Extraction per turn can be raised by orders that develop the mining industry.
- Foreign deposits can be seized by soft or hard power, or the right to use them can be
  bought.
- **1 unit of a resource sustains stable growth of 1 million obor in each sector that
  depends on that resource.**
- Resources can be traded, but **only on the "Resource Exchange"**, a separate shared
  spreadsheet where sellers post an offer and a price and buyers accept. **Trade deals are
  not concluded on the project wall**, except rarely when they form part of a contribution
  treaty or another treaty.
- The effect of resources on the economy is automated. The calculator computes shortage on
  its own.

**Confirmation from Image 11.** The calculator's `Нужно` (needed) column at the standard
start reads: coal 60, oil 20, fibre 40, ferrous ore 40, non-ferrous ore 40, rubber 20,
chemical feedstock 60, precious metals 20. Each dependent sector holds 20 000 000 of GDP,
and 1 unit backs 1 000 000, so each dependent sector demands 20 units. Every requirement is
exactly `20 × (number of dependent sectors)`. **The dependency table and the "1 unit per 1
million" rule confirm each other with no exceptions.**

The calculator's per-resource balance is `Запас + Добыча + Импорт` against `Нужно`, leaving
`Своб.` (free) and `След. год` (carried to next year) — Image 11.

### 10.4 Shortage

- **A shortage zeroes growth in the affected sectors at worst. A shortage on its own can
  never drive growth negative.** Confirmed, verbatim: *«недостача ресурсов как максимум -
  обнуляет вашь экономический рост в тех секторах, которые затронуты дефицитом. Увести в
  минус рост сама по себе недостача не может.»*
- **Shortage penalties are computed differently per resource. The more sectors depend on a
  resource, the smaller the penalty for lacking it.**

**The shortage penalty formula is NOT SPECIFIED, and it is not recoverable from the
images.** See "Ambiguities and gaps".

### 10.5 Blockade

- A blockade may be imposed on the player for some reason.
- A blockade cuts the player off from importing a given resource, **fully or partially**.
- **The specifics are decided by a judge case by case.**
- The calculator carries a **per-resource** `Блокада` field, not a global flag. Its default
  value is `Отсутствует` (absent) — Image 11.

**The blockade's mechanical effect is NOT SPECIFIED by design** — it is judge-adjudicated.

---

## 11. Debt

The player may run short of FR. In that case the player may take domestic or international
loans.

- **How many FR points can be borrowed, for what term, and at what interest is set by the
  credit rating, and is computed automatically in the calculator.**
- **Failing to pay even the interest on time hits the credit rating very hard.**
- The player may also borrow from other players. Those players alone decide whether to lend
  and on what terms. **A player-to-player loan agreement must be published on the wall under
  the matching hashtags.**

**Recovered from Image 13, at credit rating 70 (tier B):**

| Field | Value |
| --- | --- |
| Total debt limit (`Лимит общего долга`) | **22 500,00 FR** |
| Interest rate on a new loan (`Ставка нового займа`) | **12,00%** |
| Available new loan | limit − current debt |
| Debt status (`Статус долга`) | `Норма` (normal) |

Debt is tracked as **individual loans in numbered slots**, each holding its own rate — so
the rate is fixed at the moment of borrowing and does not float. The calculator also models
underpayment: `Недостача платежа` (payment shortfall) drives a `Штраф рейтинга` (rating
penalty in integer points) and a `Дефолт прошл. год` (default last year) flag.

**The debt limit and interest rate for the other 6 rating tiers are NOT SPECIFIED.** One
tier out of seven is known.
**The loan term is NOT SPECIFIED** — the prose promises the term depends on the rating, and
no term column is visible in the calculator.
**The rating penalty for a payment shortfall is NOT SPECIFIED.**
**The consequences of default are NOT SPECIFIED**, beyond the F tier being named "default".

---

## 12. States and flags

### 12.1 Mobilization

Available when hard years of war arrive.

Effects, all four recovered verbatim from Image 15
(*«При включении: разрешённый шаг военных расходов +10 п.п.; генерация ФС ×0,5; генерация
ВПК ×2; стандартный рост ВВП −2 п.п.»*):

| Effect | Value |
| --- | --- |
| Military spending step limit | **+10 percentage points** |
| FR generation | **×0,5** |
| MIC generation | **×2** |
| Standard GDP growth | **−2 percentage points** |

The prose describes exactly these four effects in words, without numbers: mobilization
immediately raises the possible military spending step and MIC generation, and lowers FR
generation and GDP growth.

- **Mobilization is penalty-free only during a war, or during an international crisis that
  the administration has publicly announced and that concerns the player.**
- It is a boolean regime flag in the calculator (`Режим: Нет`).

**The penalty for mobilizing outside a war or an announced crisis is NOT SPECIFIED.**
**Whether mobilization has a cooldown or a minimum duration is NOT SPECIFIED.**

### 12.2 Nationalization and privatization

Once per action, the player may try to nationalize or privatize a civilian or military
enterprise to raise funds. **The bonus depends on a random success roll, thrown in a
dedicated chat, with success on a scale of 1 to 10.**

**Nationalization** — the player nationalizes an enterprise and temporarily sacrifices GDP
growth and credit rating for an immediate gain of MIC points (military enterprise) or FR
points (civilian enterprise). **Nationalization also shifts the country toward the planned
economy on the control scale.**

**Privatization** — the player privatizes a military or civilian enterprise and temporarily
sacrifices future FR growth (civilian) or MIC growth (military) in exchange for GDP growth.
**Privatization also shifts the country toward the market economy on the control scale.**

**Recovered numbers from Image 14** (*«Национализация: −0,75 п.п. роста и −4 рейтинга, до
+26,25% дохода. Приватизация: до +0,75 п.п. роста; провал −0,25 п.п. и −2 рейтинга. Перерыв
каждого действия — 2 хода.»*):

| Action | Cost | Gain |
| --- | --- | --- |
| Nationalization | **−0,75 p.p. growth, −4 rating points** (unconditional) | **up to +26,25% of income** |
| Privatization | **on failure: −0,25 p.p. growth, −2 rating points** | **up to +0,75 p.p. growth** |

**Cooldown: 2 turns per action** (`Перерыв каждого действия — 2 хода`), tracked separately
for each action (`Полных ходов после приватизации` / `…после национализации`).

**Reaching a certain level of deregulation or of regulation on the control scale closes off
nationalization and privatization entirely.**

**The roll-to-payout mapping is NOT SPECIFIED.** "Up to +26,25%" and "up to +0,75 p.p."
against a 1–10 roll implies scaling, but the article states no rule. A linear reading
(2,625% and 0,075 p.p. per roll point) is a guess and must not be implemented as fact.
**The control-scale lockout thresholds are NOT SPECIFIED.**
**The duration of the "temporary" sacrifice is NOT SPECIFIED.**

### 12.3 Concessions

Available **only to players of the regions Bengo (Бэньго), Aglan (Аглань), Sudhara
(Судхара), and Badiyat (Бадият)**. Confirmed — the region list is exactly these four.

These players may sell "concessions" to other states: they hand over the right to use ports
on their territory, opening the country to investment while temporarily giving up the
economic potential of those ports.

**For the grantor:**
- loses one **coastal province** to the concessionaire;
- loses turnover from **one sector of the grantor's choice**, proportional to the total
  province count;
- **+1,5% growth to all economic sectors** for as long as the concession lasts.

**For the concessionaire:**
- gains the coastal port province;
- gains the lost turnover, added to the same sector the grantor subtracted it from.

**The concessionaire may unilaterally break off cooperation and seize the concession.** The
grantor then loses the growth bonus, unless the grantor forces the concessionaire back into
compliance.

**Whether the +1,5% is a flat addition or a multiplier is NOT SPECIFIED.**
**The concession's duration is NOT SPECIFIED.**
**Any price paid for a concession is NOT SPECIFIED** — the article describes the transfer
but never a payment.
**Whether the concessionaire also receives the +1,5% is NOT SPECIFIED** — the text grants
it only to the grantor.

### 12.4 Blockade

Covered in §10.5. It is a per-resource flag, judge-adjudicated, full or partial.

---

## Worked examples

### Example A — the concession (the article's only numeric example, and it is inconsistent)

> *«если у вас 20 провинций и 100.000.000 ВВП - вы при передаче концессии потеряете
> 5.000.000 ВВП»*
> — "if you have 20 provinces and 100,000,000 GDP, then on transferring a concession you
> will lose 5,000,000 GDP"

**Correction to the prior analysis.** The prior note recorded this as "a concession costs
1/20th of one sector's turnover = 5,000,000". That reading does not hold.

- The rule text says the grantor loses *«пропорционального от общего числа провинций оборота
  одного из секторов на ваш выбор»* — a share, proportional to the total province count, of
  **one sector's** turnover.
- With 5 sectors at 20 000 000 each, 1/20 of **one sector** is **1 000 000**, not 5 000 000.
- The number 5 000 000 is 1/20 of **total GDP** (100 000 000 / 20).
- The example also says the loss is "5,000,000 **ВВП**" — GDP — not 5,000,000 of a sector.

**So the rule text and its own worked example disagree.** Either the divisor applies to
total GDP and the "one sector of your choice" clause only picks where the deduction is
booked, or the example is simply wrong. The article gives no third data point.
**This must be resolved with the calculator before implementation.**

### Example B — the standard start (reconstructed from the images)

Not a worked example from the prose. This is the state the calculator screenshots were taken
in, and it is the most useful reference point available.

| Quantity | Value | Source |
| --- | --- | --- |
| Turn | 1 | Image 1 |
| GDP | 100 000 000 | Image 1 |
| Sector split | 20 000 000 × 5, Other 1 and Other 2 at 0 | Image 1 |
| Permanent growth | 3,00% per sector | Image 1 |
| Credit rating | 70 points → tier B "stable" | Image 3 |
| Control scale | 50 → "Политика баланса" | Image 4 |
| Emission | 0,00% | Image 10 |
| Military spending | 10,00% | Image 10 |
| Emission step limit | 10,00 p.p. | Image 10 |
| Military step limit | 10,00 p.p. | Image 10 |
| **FR generated** | **8 294,76** | Image 5 |
| **MIC generated** | **152,93** | Image 5 |
| FR reserve cap | 16 589,51 = 2 × 8 294,76 | Image 8 |
| MIC stockpile cap | none | Image 9 |
| MIC upkeep | 2 FR per point per turn | Image 9 |
| Debt limit | 22 500,00 FR | Image 13 |
| New loan rate | 12,00% | Image 13 |
| Resource stocks | 0 across all 8 | Image 11 |
| Resource requirements | 20 × dependent sector count | Image 11 |

**The reserve cap of 16 589,51 is exactly twice the FR income of 8 294,76.** Two independent
screenshots agree, which confirms both the "2 annual incomes" rule and the FR figure.

### Example C — resource requirement arithmetic

Coal is used by heavy industry, light industry, and mining — 3 sectors. Each holds
20 000 000 of GDP. One unit of a resource backs 1 000 000, so each sector needs 20 units,
and coal needs 60. Image 11 shows exactly 60. The same check passes for all 8 resources.

A single coal deposit yields 50 units per turn, so **one deposit does not cover the standard
start's coal requirement of 60.** Two deposits, or one deposit plus imports, are needed.

---

## Ambiguities and gaps

### Contradictions inside the document

**C1 — Nationalization frequency. RESOLVED.**
§2 of Part III opens with *«Раз в год»* — "once a year". The same section closes with
*«проводить приватизацию и национализацию (отдельно каждую) можно не более раза в 2 года»* —
"no more than once per 2 years, each separately". These contradict each other.
**Image 14 resolves it: `Перерыв каждого действия — 2 хода` — a 2-turn cooldown per action,**
and the calculator tracks `Полных ходов после приватизации` and `Полных ходов после
национализации` as separate counters. **Implement the 2-turn cooldown. "Once a year" is
wrong.**

**C2 — The concession worked example contradicts its own rule.** See Example A. The rule
says one sector's turnover; the example computes total GDP divided by province count.
**Unresolved.**

**C3 — Two currency units, no exchange rate.**
GDP-side quantities are denominated in **obor**: "1 unit of a resource sustains stable growth
of 1 million **obor**".
Budget-side quantities are denominated in **arlings**: "each FR point is nominally
equivalent to 1 million **arlings**".
These are not necessarily the same thing — obor plausibly measures domestic product and
arling is explicitly called the *international reserve currency*. But the article uses
"1 million" of each as the natural unit and never relates them.
**The obor↔arling exchange rate is NOT SPECIFIED.** The engine needs it the moment FR is
spent on anything that moves GDP. Note that the standard start has GDP 100 000 000 obor and
FR income 8 294,76 points, so FR income is roughly 8,29% of GDP if 1 point = 1 million obor.
That is a plausible budget share, but it is an inference, not a stated rate.

### The formulas that remain missing

These are the highest-priority items to obtain from the calculator spreadsheet.

| Missing | Why it matters | Best available anchor |
| --- | --- | --- |
| **FR generation formula** | Every turn starts with it | One data point: 8 294,76 at the standard start. Inputs known: rating, control scale, GDP, growth, emission, military spending, light-industry share, regime multiplier |
| **MIC generation formula** | Every military action costs MIC | One data point: 152,93 at the standard start. Inputs known: GDP, growth, military spending %, heavy-industry share, regime multiplier |
| **Resource shortage penalty** | Determines whether a country grows at all | Rule direction known (more dependent sectors → smaller penalty). **No coefficients.** The observed values do not fit any simple per-resource model — a fit that matches agriculture fails for mining. Do not guess |
| **Control-scale band effects** | 11 bands, only band "50" observed | Growth and free-funds directions known; magnitudes unknown |
| **Control-scale step limits** | Gates emission and military spending | Only the band-50 value is known: 10 p.p. for both |
| **Credit rating → debt limit and rate** | 7 tiers, only tier B observed | Tier B: 22 500 FR at 12,00%. Six tiers unknown |
| **Credit rating → FR contribution** | Rating is a stated FR input | No values at all |
| **Auto-investment growth rate per unspent point** | Also fixes the reserve penalty via the 1,5× relation | Ratio known, base rate unknown |
| **Emission → FR gain, inflation, rating penalty** | Three separate effects | All read 0 at 0% emission. No rates |
| **Military spending → MIC gain, FR loss, growth penalty** | Three separate effects | All read 0 at the 10% baseline. No rates |
| **Success roll → nationalization/privatization payout** | 1–10 roll, "up to" caps known | Caps: +26,25% income, +0,75 p.p. growth. Scaling unstated |
| **Permanent + temporary → final growth** | The core growth equation | Three columns observed, combination rule unstated |
| **Military price list in MIC points** | Nothing military can be costed | Images 6 and 7 are blank ledgers |
| **Loan term by rating** | Promised by the prose | No term column visible |
| **Payment shortfall → rating penalty** | Debt failure path | Field exists, no rate |
| **Concession duration and price** | Concessions are a live mechanic | Neither stated |

### Structural gaps

- **The calculator itself is the specification and is not in this repository.** The article
  says so twice. Everything above is reconstructed from a design description plus 15
  screenshots of one filled-in instance.
- **The screenshots capture a resource-starved state.** All 8 resource stocks are 0 against
  non-zero requirements, so four of the five sectors show 0,00% final growth. The
  screenshots' growth numbers are not an unstarved baseline and must not be used as one.
- **The "Resource Exchange" spreadsheet is referenced but its link is a placeholder** —
  *«(тут будет ссылка)»*, "a link will be here".
- **Orders (приказы) are the main lever the player pulls, and their costs and effects are
  entirely outside this article.** Orders can change GDP, growth, state intervention, credit
  rating, and resource self-sufficiency, all through judge verdicts. No pricing or effect
  table exists here.
- **Verdicts are the mechanism for most change.** The article states that the credit rating,
  the control scale position, and the resource situation "cannot be changed by anything
  except global or personal verdicts". A rules engine cannot derive these; they are
  human-adjudicated inputs.
