# Faenwald — War (Battle) System — Game Design Document

> **Audience:** the developer implementing the tactical battle simulator.
> **Goal of the system (from the source):** produce battle outcomes that are
> *obvious and verifiable*, minimising judge discretion. The simulator must be
> **deterministic** given the same inputs and seeds — every modifier, rounding
> rule and resolution order below is normative, not flavour.

## 0. Sources, scope, status

**Primary sources (translated from Russian):**

- `faenwald-parser/faenwald-cf-boevaya-sistema.txt` — **Combat System** (the tactical
  battle: hexes, facing, actions, damage, terrain, unit stats, abilities). This is
  the core of what the simulator implements.
- `faenwald-parser/faenwald-cf-voenaya-sistema.txt` — **Military System** (ranks,
  count-scaling, recruitment, and the strategic war layer). Only the parts that feed
  the battle (ranks, count scaling, pre-battle stat modifiers, post-battle losses)
  are in scope here; the strategic war layer is summarised in §13 as context.

**Scope of this document:** full, faithful specification of a **single tactical
battle** on a hex map. The strategic/campaign layer (war phases, action points,
supply, sieges, war exhaustion, contributions) is **out of tactical scope** and only
appears as named inputs/outputs (§13).

**Status markers used below:**

- 🟢 **Normative** — taken directly from source, implement as written.
- 🟡 **Inferred** — a reasonable interpretation where the source is silent or
  judge-driven; flagged so it can be confirmed.
- 🔴 **Open question** — genuinely ambiguous or self-contradictory in the source;
  see §14. Pick a default, make it configurable, and surface it.

---

## 1. Glossary

| Term | Meaning |
| --- | --- |
| **TF / Отряд (Unit)** | A *tactical formation* of up to 100 soldiers of **one** type. Occupies exactly **one hex**. The atomic combat entity. |
| **Side** | A belligerent (the source uses **Blue** = attacker-order-first, **Red** = second). Generalise to N sides if needed, but rules below assume two. |
| **Facing / Direction of attack** | The way a unit "points" (where the spear tip points). Determines its front/flank/rear zones. |
| **Battle turn (ход боя)** | One full round in which every unit acts once in initiative order. |
| **Combat phase** | The moment a single attack's damage is applied (the source's "фаза боя"). |
| **Ram / Charge (разбег / таранный удар)** | Cavalry bonus that accumulates per consecutive hex moved straight forward. |
| **Opportunity attack (оппортун)** | A free reactive attack triggered by an enemy moving through one's attack zone. |
| **Rank (ранг)** | Veterancy I–VI; scales base HP/attack/morale (not speed). |
| **Rout (бегство)** | Morale-0 state; the unit must leave the field by the shortest path. |
| **Ruler (правитель)** | A commander attached to one unit; grants morale aura, has a capture/death table. |

---

## 2. The battlefield

### 2.1 Hex grid

🟢 The map is a grid of hexagons. **One unit = one hex** regardless of soldier count.
Each hex has a **terrain type** (§10) and an **elevation level** (plain / foothill /
hill, see §10.4–10.5). Some hexes are impassable (mountain, water) or block line of
sight (mountain).

**Recommended representation** 🟡: **cube/axial coordinates** (`q, r`, with derived
`s = -q-r`). The six neighbours are the six unit cube-vectors. This makes distance,
neighbour, and line-drawing math trivial — use it internally even if the UI renders
flat-top or pointy-top.

### 2.2 Facing and the three zones

🟢 A unit has a **facing** = "where the spear tip points". From it, the six
neighbouring hexes split into **three zones**, two hexes each:

```
            FRONT   FRONT
                 \ /
        L-FLANK --U-- R-FLANK
                 / \
             REAR   REAR
```

- **Front** — the 2 hexes the unit points between. It may **attack only into its
  front**, and incoming damage from the front is the baseline (×1.0) unless a
  defensive ability applies.
- **Flank** — the 1 hex on each side (2 total). A hit landing from a flank hex deals
  **×1.25 morale damage** (physical unaffected, unless an ability says otherwise).
- **Rear** — the 2 hexes behind. A hit from a rear hex deals **×1.5 morale damage**.

🟡 **Facing model:** represent facing as one of **6 directions, each pointing at the
shared vertex between two adjacent neighbour hexes** (so the two hexes flanking that
vertex are the Front). This is what yields the clean 2/2/2 split. Consequence: "move
forward" can target **either** of the two front hexes — the commander chooses (§7.2).

🟡 **Zone of an attack** is determined by **the hex the attacker occupies relative to
the defender's facing** — i.e. which of the defender's zones the attacking hex falls
in — not by the attacker's own facing.

### 2.3 Line of fire (for ranged) — see §5.4

Mountains block line of fire. Forest and elevation impose the constraints in §10.
Ranged attack areas are **cone-shaped** (🟡 model as: the wedge of hexes within range
that lies within the firer's front arc).

---

## 3. Unit model

### 3.1 Combat stats

🟢 Every unit has four **combat stats**:

| Stat | Symbol | Meaning |
| --- | --- | --- |
| **Health (Здоровье)** | ❤️ | Damage the unit absorbs before it is **destroyed** (HP = 0). Derived from armour level. |
| **Attack / Damage (Урон)** | ⚔️ | Damage dealt to **both health and morale** per combat phase (see §9 — dual channel). Fixed, but matchup-dependent. |
| **Morale (Мораль)** | 📯 | "Combat shock" the unit endures before it **routs** (morale = 0). Derived from rank. |
| **Speed (Скорость)** | — | Movement hexes per turn. Fixed base; can be temporarily increased (acceleration). |

🟢 Stats in the catalog (§4) are given **per 100 soldiers**.

### 3.2 Count scaling

🟢 If a unit has fewer than 100 soldiers, **HP, attack and morale** are multiplied by
`count / 100` (10 soldiers → ×0.1). 🟡 Speed does **not** scale. 🟡 Round derived
values per §9.6 (arithmetic rounding) when a concrete integer is needed; keep the
fraction internally to avoid compounding error.

### 3.3 Rank (veterancy) — feeds base stats

🟢 Six ranks (I–VI). Ranks scale **base HP, attack and morale — never speed.**
Rank II is the baseline (the catalog values). Relative to base:

| Rank | Modifier vs base | Notes |
| --- | --- | --- |
| I | **−25%** | Recruits. |
| II | **base (×1.0)** | Catalog values; max hireable rank. |
| III | **+25%** | |
| IV | **+50%** | |
| V | **+75%** | Guard starts here. |
| VI | **+100%** | |

🟢 **Rounding rule (important, non-obvious):** the bonus is **+25% of the base value
per rank step, applied iteratively with rounding at each step**, *not* a single
compounded multiply. Source worked example (base 50 ❤️ / 20 ⚔️ / 100 📯):

- III: `round(50 + 12.5)=63`, `25`, `125`
- IV: `round(63 + 12.5)=76`, `30`, `150`  *(explicitly "76, not 78")*

> Implement as: `value_n = round(value_{n-1} + 0.25 * base)` for n ≥ III, with
> `value_II = base`, `value_I = round(0.75 * base)`. Use round-half-up (§9.6).

🟡 **Ordering of scaling:** apply **rank first, then count scaling, then in-battle
degradation** (§3.4). Pre-battle strategic modifiers (§3.5) are folded into the
"entering" stats before the battle starts.

### 3.4 In-battle degradation (the half-health rule)

🟢 A unit deals **full attack** until it has lost **half its health**. Once current
HP < 50% of max, its **attack output is halved (×0.5)** for the rest of the battle.

🟡 Model as a boolean `bloodied = currentHp < maxHp/2` checked at damage-dealing
time; this multiplies into the physical **and** morale base (it is an attack-output
reduction, not zone-specific).

### 3.5 Pre-battle stat modifiers (strategic input)

🟢 A unit may **enter** a battle already modified (e.g. lost 20% strength to supply →
enters at 80% HP / attack / morale). These come from the strategic layer (§13) and
are simply the unit's starting stats for this battle. The half-health degradation
(§3.4) is then measured against the **entering** max, not the pristine 100-soldier max.

### 3.6 Categories & subtypes

🟢 Five categories. The first four fight; the fifth does not.

1. **Spearmen (Копейщики)** — hold the line; ability *Close Formation*.
2. **Shock Infantry (Ударная пехота)** — break formations; ability *Breakthrough*.
3. **Cavalry (Кавалерия)** — mobile shock; abilities *Ram Strike* + *Maneuverability* + *Dismount*.
4. **Ranged (Дальнобойные)** — fire at range; ability *Ranged Attack* (3 modes).
5. **Special (Особые)** — Engineers, Medics; **do not participate in battle** (§4.5).

Each combat category has **light / medium / heavy** subtypes (ranged differs — §4.4).
Armour level → HP; lighter → faster.

---

## 4. Unit catalog

> All values are **per 100 soldiers, at rank II (base)**. Apply §3.2–3.4 for actual
> combat values. "Charge" = ram/разбег. "Ranged" = damage from ranged-attack soldiers.

### 4.1 Spearmen — ability **Close Formation** (§5.1)

| Subtype | ❤️ HP | ⚔️ Atk | 📯 Morale | Speed | Cost | Subtype perks |
| --- | --- | --- | --- | --- | --- | --- |
| Light spearman | 80 | 12 | 70 | 3 | 30 000 | Takes **×1.5** from ranged |
| Medium spearman | 120 | 15 | 85 | 2 | 50 000 | Takes **×0.75** from charge |
| Heavy spearman | 160 | 18 | 110 | 1 | 70 000 | Takes **×0.5** from charge **and** from ranged |

### 4.2 Shock Infantry — ability **Breakthrough** (§5.2)

| Subtype | ❤️ HP | ⚔️ Atk | 📯 Morale | Speed | Cost | Subtype perks |
| --- | --- | --- | --- | --- | --- | --- |
| Light infantry | 60 | 20 | 70 | 3 | 30 000 | Takes **×1.5** from ranged |
| Medium infantry | 90 | 25 | 85 | 2 | 50 000 | — |
| Heavy infantry | 120 | 30 | 100 | 1 | 70 000 | Takes **×0.75** from charge, **×0.5** from ranged |

🟢 For shock infantry, **damage into the rear is treated as flank damage** (i.e. their
rear uses the ×1.25 morale multiplier, not ×1.5).

### 4.3 Cavalry — abilities **Ram Strike** + **Maneuverability** + **Dismount** (§5.3)

| Subtype | ❤️ HP | ⚔️ Atk | 📯 Morale | Speed | Cost | Ram mod | Subtype perks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Light cavalry | 70 | 10 | 80 | 5 | 40 000 | **8** | Deals **×1.5** to rear (stacks) **and** to ranged soldiers; takes **×1.5** from ranged; **cannot be the target of a ranged opportunity attack**; **cannot move while an enemy ranged unit is in an adjacent hex** |
| Medium cavalry | 95 | 15 | 90 | 4 | 90 000 | **16** | Deals **+×0.25** more to rear (stacks) |
| Heavy cavalry | 120 | 25 | 100 | 3 | 160 000 | **24** | Takes **×0.5** from ranged |

### 4.4 Ranged — ability **Ranged Attack** (3 modes, §5.4)

| Subtype | ❤️ HP | ⚔️ Atk | 📯 Morale | Speed | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Archer | 50 | 6 | 70 | 3 | 25 000 | Baseline ranged unit |
| Horse archer | 80 | 6 | 80 | 5 | 60 000 | Maneuverability + Dismount (→ archers). Arcing **2** hexes, direct fire **adjacent** hex only. May fire into its **flank & rear** hexes. **No** hill bonuses. **Cannot be meleed in any hex except the one it began its turn in**; while that holds it takes no close-combat penalty but cannot direct-fire until it moves 1 hex away. Deals **×1.5** to rear. **Counts as cavalry for terrain** bonuses/penalties. |
| Longbowman | 60 | 10 | 80 | 3 | — | **Not hireable.** A rank III+ archer can be retrained over 5 years into a longbowman **one rank lower** with the "Long Bows" tech. (Strategic; not produced in-battle.) |
| Crossbowman | 60 | 40 (direct) | 80 | 3 | 75 000 | **No arcing.** Direct fire **+1 hex** range. **Fires once per 2 turns.** Deals **full damage to heavy** soldiers (🔴 see §14). Close-combat penalty **×0.75**. Requires "Crossbow Mechanisms" tech. |

🟢 **Ammo:** every ranged unit has **8 shots per battle**. When spent, it must travel
to the supply train (north/south map edge) for arrows. Another unit can carry arrows
to it, but **one carrier can resupply at most 3 archer units**, and a carrier **cannot
attack** while carrying (unless the carrier is itself an archer).

### 4.5 Special units — **do not fight**

🟢 Hired only at full strength (100). Cannot be rank I.

- **Engineers** — cost 40 000. Build/siege specialists: **+0.5 build speed**, and
  **+0.25 and +10% siege-weapon damage per level from III**. (Strategic only.)
- **Medics** — cost 30 000. **Reduce post-battle losses by 10% per rank from II**, up
  to a **70% cap** (§12.3). Scale down if unit > 1000. Cannot heal a unit that did not
  escape the field.

### 4.6 Individual templates (custom modifications)

🟢 A unit may be given a custom modification granting an extra ability (e.g. swordsmen
with darts → "throw dart for 1 hex of movement, dealing 25% of the unit's damage").
Increases unit cost; coordinated with the game master. 🟡 Model as an optional list of
**custom abilities** on the unit; the engine should support data-driven abilities
(see §15.1) so templates need no code change.

---

## 5. Special abilities (formal rules)

### 5.1 Close Formation (all spearmen)

🟢
1. **Shielding:** if a **flank is covered** by another spearmen unit facing the **same
   direction**, OR by impassable terrain / the map edge → the unit takes **×0.8** to
   **any incoming damage from the front**. **Both** flanks covered → **×0.6**.
2. **Lateral shuffle:** may move into its **rear or flank hex without turning** (if
   possible) at **×2 speed cost**.
3. **Rear vulnerability:** takes an **additional ×1.5 physical** damage in the rear
   (morale is *not* additionally increased beyond the standard ×1.5 rear morale).
4. **Charge reflection:** if attacked **in the front** while it **has a Close-Formation
   bonus** (i.e. ≥1 flank covered), it **reflects the charge damage** back onto the
   attacker (deals the attacker's charge damage to the attacker). **This is not an
   attack** (does not consume the action, does not prevent opportunity, etc.).

### 5.2 Breakthrough (all shock infantry)

🟢
1. **Push:** if the **combined damage your forces deal to a unit ≥ that enemy unit's
   attack stat**, then on attacking you may **optionally push the enemy one hex into
   its rear and occupy its vacated hex** (even if you already spent movement). If a
   unit stands behind the pushed unit, it is **also** pushed, and so on (a chain). If
   the rear hex is unavailable, push to **any available hex — flank first, then front**.
   If two shock units attack the same target, **one of them** (attacker's choice) moves in.
2. **No breakthrough in an opportunity attack.**

🟡 "Combined damage your forces deal to a unit" = sum of damage dealt to that target
**this turn** by all your units (clarify timing with §14).

### 5.3 Cavalry abilities

🟢 **Ram Strike (Таранный удар):**
- For **each consecutive hex moved straight forward** this turn, accumulate **+(ram
  mod)%** to charge damage (see ram mod per subtype in §4.3). The charge multiplier is
  `1 + (accumulated %)/100` (§9.3).
- If the run is **≥3 hexes**, the attack also deals **×1.25 morale** damage.
- **Morale damage is applied before physical.** If morale reaches 0 from it, the
  defender makes **no counterattack** (but still **reflects** charge damage if §5.1.4
  applies).
- **Charge bonus lasts only the turn it was built.**

🟢 **Maneuverability:** may **move after attacking** on the same turn (if possible).

🟢 **Dismount / Mount (Спешивание/Седлание):**
- For **1 hex of movement**, a cavalry unit becomes the **analogous spearmen unit** for
  the battle (HP converted by percentage). Horse archers dismount into **archers**.
- The **horses remain** in the dismount hex. A **Mount** action can re-saddle them.
- If a battle happens in the horses' hex, or a ranged attack passes through it, the
  **horses flee** (disappear).
- If a *different* spearmen unit of a similar type mounts the horses, it becomes
  cavalry but its **rank drops to I**. If that unit **finishes the battle** as cavalry,
  it may **remain cavalry permanently** (strategic outcome).

### 5.4 Ranged Attack (three modes)

🟢 An archer fires in exactly one of three modes per shot:

| Mode | Damage | Range / rule |
| --- | --- | --- |
| **Arcing (навес)** | **×1** | Fires **4 hexes** in front; **may fire over units**. (Blocked over settlements as targets; mountains block all.) |
| **Direct (прямая наводка)** | **×2** | Fires "hex-through-hex" in front; **cannot fire over units** unless they are a level below the firer (on hill → may overshoot foothill; on foothill → may overshoot anything lower). |
| **Close combat (ближний бой)** | **×0.5** | Only vs an adjacent enemy; the firer **takes ×1.5 morale** damage. |

🟢 **On a hill**, a ranged unit gets **no hill attack bonus/debuff**, but its **range
extends**: +1 hex past foothill, +2 hexes past hill.

🟢 **Cone-shaped area** (🟡 wedge within the front arc, see §2.3). Horse archer and
crossbowman ranges differ per §4.4.

---

## 6. Turn structure & initiative

🟢 The battle proceeds in **turns**. Within a turn, units act in **initiative order**:

### 6.1 Initiative ordering

1. **By current movement speed, fastest first.** (Acceleration affects speed; resolve
   ordering using the speed *at the start of the turn* 🟡.)
2. **Ties broken by category:** cavalry → ranged → melee. Within melee, **shock
   infantry before spearmen**.
3. **Within the same speed+category bracket, sides alternate**: the more-maneuverable
   **Blue** unit acts, then the corresponding **Red** unit, then the next, …

🟢 Worked example (both sides have archers + light spearmen):

```
Blue archers → Red archers → Blue spearmen → Red spearmen
```

🟡 **Defender first-move advantage:** the strategic layer grants the defender the
first move and choice of map side (§13). Expose as a battle setup flag; the simplest
model is that the defending side is "Blue" (acts first) for the alternation above.

### 6.2 A unit's turn

🟢 On its turn a unit **moves and (if able) attacks, or declines either**. A turn ends
when **all units of all sides have finished**.

---

## 7. Actions

🟢 Actions: **Attack, Move, Acceleration**, plus category specials. Performing each is
the commander's choice.

### 7.1 Attack

🟢 Attack an enemy in the unit's **front**, dealing damage per §9. **Once per turn.**
**After attacking, the unit cannot move** — **unless** an ability says otherwise
(cavalry Maneuverability §5.3; opportunity-attack turn §8).

### 7.2 Move

🟢 Spend **1 hex of movement** to either:
- **Step into a front hex** (commander chooses which of the two; if unobstructed), **or**
- **Turn to face any direction** (a full reorientation costs 1 hex 🟡 — see §14).

🟢 If the unit's available movement is **< 1 hex**, it actually moves only once it has
**accumulated 1 hex across multiple turns**.

🟢 **Heavy units may turn once per turn for free** (no movement spent).

🟢 Spearmen lateral shuffle (§5.1.2) and cavalry post-attack move (§5.3) are movement
variants.

### 7.3 Acceleration

🟢 Costs **10 morale**; **doubles speed for one battle turn**. **At most once per
turn.** May be activated at any moment in the turn, but **only the remaining (unspent)
hexes are doubled**. 🟢 In Forest, cavalry **cannot** accelerate (§10.3).

---

## 8. Opportunity attacks (оппортун)

🟢 Trigger: a unit **moves into another unit's attack zone** (e.g. cavalry enters
archers' range). The threatening unit may make a **free reactive attack without
moving**, immediately, out of initiative order.

**Timing & resolution:**
1. 🟢 The opportunity strike lands **after the moving unit declares its first action
   but before that action executes.** Example: if the unit in your cell decides to
   turn its rear to you, **you strike its front first**, *then* it turns.
2. 🟢 After making an opportunity attack, the attacker is **considered to have acted**;
   it may then **only turn** to a desired facing. The attacked unit **may continue its
   movement**.
3. 🟢 If the **moving unit attacks the very unit that is opportunity-attacking it, the
   moving unit deals damage first.**

**Restrictions:**
- 🟢 If a unit performs **no actions**, it **cannot be opportunity-attacked**.
- 🟢 A unit that **has already attacked this turn cannot make** an opportunity attack.
- 🟢 **Breakthrough (§5.2) cannot be used** in an opportunity attack.
- 🟢 Light cavalry **cannot be the target of a ranged opportunity attack** (§4.3).

---

## 9. Damage resolution — the core algorithm

This is the heart of the engine and must be deterministic. **Every attack produces
two parallel results: physical (→ health) and morale (→ morale).** Both use the same
**base damage** but different modifier sets.

### 9.1 Inputs

- Attacker `A` (effective stats per §3: rank → count → degradation), defender `D`.
- The **attacking hex's zone** relative to `D`'s facing (front/flank/rear, §2.2).
- Terrain of both hexes, elevation, charge state, formation coverage, matchup, ability flags.

### 9.2 Base (natural) damage

```
naturalDamage = A.attack            // already includes rank, count, degradation (§3)
```

🟢 The **natural damage** is what the ×3 cap (§9.5) is measured against
(archer 8 → cap 24; heavy cav 25 → cap 75 — the source uses the table attack value).
🟡 Treat "natural" as the unit's *current effective* attack (post rank/count/degrade),
since those are intrinsic to the unit, while terrain/charge/zone/formation are the
**tactical multipliers** the cap restrains.

### 9.3 Multiplier set

🟢 **All applicable multipliers (offensive and defensive) multiply together** — order
of multiplication does not matter (commutative). Collect every applicable factor:

**Physical channel factors:**
- Terrain attack mods of the attacker's hex (hill/foothill elevation deltas, mud, …) (§10).
- **Charge multiplier** = `1 + (accumulatedRam%)/100` (cavalry only, §5.3). E.g. ram
  mod 24 × 2 consecutive hexes = +48% → **×1.48**; if accumulated % exceeds 100 (e.g.
  120) → **×2.2**.
- **Matchup** mods (e.g. light cav ×1.5 vs ranged; subtype-specific).
- **Defender's incoming reductions:** Close-Formation ×0.8/×0.6 (front only, §5.1.1);
  anti-charge ×0.75/×0.5 (§4.1–4.3); anti-ranged ×0.75/×0.5/×1.5 (§4); terrain
  defensive mods (brush ×0.75 / forest ×0.5 vs ranged, §10.2–10.3).
- **Spearmen rear** ×1.5 physical (§5.1.3); shock-infantry-rear-as-flank rule (§4.2).

**Morale channel factors:**
- **Zone:** flank **×1.25**, rear **×1.5** (§2.2). (Shock infantry rear → ×1.25, §4.2.)
- **Cavalry charge morale** ×1.25 if run ≥ 3 hexes (§5.3).

### 9.4 Apply

```
rawPhysical = naturalDamage * Π(physicalFactors)
rawMorale   = naturalDamage * Π(moraleFactors)
```

### 9.5 Damage cap

🟢 After all modifiers, **a unit cannot deal more than ×3 of its natural damage.**

```
physical = min(rawPhysical, 3 * naturalDamage)
morale   = min(rawMorale,   3 * naturalDamage)
```

🟢 **Exception:** **cavalry morale damage is never capped** — skip the cap on the
morale channel when `A` is cavalry.

### 9.6 Rounding

🟢 **Round to integers by ordinary arithmetic rules** (round-half-up: 22.5 → 23,
8.4375 → 8). Round **once, at the end**, per channel. Keep full precision through the
multiplier chain.

### 9.7 Application order (matters for morale-zeroing)

🟢 For a **cavalry charge**, apply **morale before physical** (§5.3): if morale hits 0
first, the defender makes **no counterattack** this exchange (it still **reflects**
charge damage if §5.1.4 holds). 🟡 For non-cavalry attacks, apply both channels
together; order is immaterial unless a future ability depends on it.

### 9.8 Charge reflection (spearmen)

🟢 If §5.1.4 applies, after resolving the cavalry's charge, compute the **charge
damage** and apply it **back to the attacker** as reflected damage. It is **not an
attack** (no action cost, no opportunity, not subject to the attacker's own counter).
🔴 Whether reflection is capped/rounded like a normal hit — see §14.

### 9.9 Worked example (from source §1.6)

> Heavy spearmen in close formation (both flanks) on a **hill**, attacked frontally by
> heavy cavalry charging from a **foothill** over 2 hexes.

**Spearmen's damage (uphill defender striking down):**
```
natural 18 ⚔️ × 1.25 (hill vs foothill) = 22.5 → 23
```

**Cavalry's damage:**
```
0.75 (foothill→hill debuff) × 25 (natural) × 1.48 (charge, ram 24 ×2 hex)
     × 0.5 (heavy spearman anti-charge) × 0.6 (close formation, both flanks)
  = ~8.3 → 8        + charge reflected back into the cavalry (§5.1.4)
```

> ⚠️ The source text writes "×1.48" but then computes with "×1.5" (→ 8.4375 → 8).
> This is a **source inconsistency** — see §14. The pipeline above is the
> authoritative shape; the ram multiplier is `1 + ramMod·hexes/100`.

---

## 10. Terrain reference

Each hex has a terrain type. 🟢 unless noted.

| # | Terrain | Effects |
| --- | --- | --- |
| 1 | **Plain** | No features. May turn into **Mud** (see below). |
| 2 | **Brush/Thicket** | Cavalry entry costs **2 hexes** of speed. All units take **×0.75** from ranged. |
| 3 | **Forest** | Cavalry moves **only 1 hex** and **cannot accelerate**. Archers: cannot arc-fire onto other forest hexes; may direct-fire a forest hex only into an **adjacent** hex (no close-combat penalty there); if forest lies between archer and target, **no direct fire**; an archer fires **out of** the forest without restriction only from an **edge** forest hex. All units take **×0.5** from ranged. |
| 4 | **Foothill** (elev 1) | Moving onto it from a non-elevated hex costs **×2** speed. Deals **×1.25** (takes ×0.75) vs a unit **one level below**; deals **×0.75** (takes ×1.25) vs a unit **on a hill**. |
| 5 | **Hill** (elev 2) | Moving onto it from a non-hill hex costs **×2** speed. Deals **×1.25** (takes ×0.75) vs a unit on a **foothill**; vs **another adjacent (lower) hex** deals **×1.5** (takes ×0.5). |
| 6 | **Mountain / Water** | **Impassable.** Mountain also **blocks line of fire**. In winter, water **freezes → behaves like plain**, but may **crack** on entry: light/medium **5%**, heavy **10%**, cavalry **15%**, heavy cavalry **25%**. On a crack: unit takes **50% of full health** as damage and **retreats one hex**. |
| 7 | **Bog/Swamp** | Like Mud, but movement cost **×3**. |
| 8 | **Road** | Movement cost **×0.5** (halved). |
| 9 | **Settlement** | Special: **no unit can be targeted by arcing fire** here. **Spearmen** +5% close-formation bonus; **Shock infantry** none; **Cavalry** −2 hexes speed; **Archers** none. |

🟢 **Mud (Грязь)** (a state of a Plain hex): movement cost in the hex **×2**; **heavy
units take double damage from light units**, and **light units deal double to heavy**
— *provided the heavy unit is also in mud*.

🟡 **Elevation modifiers** generalise: a higher unit vs a lower-by-one deals ×1.25 /
takes ×0.75; hill vs a hex two levels down (or "another adjacent lower hex") is the
stronger ×1.5 / ×0.5. Implement as a function of elevation delta and adjacency.

---

## 11. Morale, rout, and the ruler

### 11.1 Zero thresholds

🟢
- **HP = 0** → unit is **destroyed** (removed from the battle).
- **Morale = 0** → unit **routs**: you **must** lead it off the field by the **shortest
  route**.

### 11.2 Cascade morale penalties

🟢 When any unit is **destroyed or routs**, allied units suffer morale loss:

- **Adjacent** allied unit: **−10 morale**.
- **One hex away** (через клетку): **−5 morale**.
- If the lost unit is the **ruler's unit**, the penalty is **doubled** (−20 / −10).

### 11.3 Ruler (правитель)

🟢
- A ruler is **assigned to one unit** (marked with a **crown**).
- While present on the field, **all of that ruler's units gain +10 morale** (aura).
- If the ruler's unit is **destroyed**, roll **d3**: **1 = killed, 2 = captured,
  3 = fled.**
- If the ruler's unit **routs** (rather than is destroyed), the ruler **escapes by
  default**.

### 11.4 Battle end

🟢 A battle ends when, for one side, **all units are destroyed or routed**, OR a side
**retreats** (by initiative), **capitulates**, or both sides **agree** to stop.
🟡 (Retreat eligibility — "after the first 5 battle turns, or on defeat" — is a
strategic-layer rule, §13; expose as a flag.)

---

## 12. Post-battle losses

> 🟢 Battle output. These convert in-battle HP loss into permanent soldier losses for
> the strategic layer.

### 12.1 Base losses

🟢 Permanent losses = **50% of the health the unit lost during the battle**, **if it
managed to retreat**. (Lose half your HP → lose a quarter of the unit.)

🟢 If the unit **did not retreat** (destroyed/couldn't escape) → it is **lost in full**.

### 12.2 Prisoners

🟢 If a unit does **not retreat**, **~half its soldiers are taken prisoner** by the
enemy (judge-adjustable). 🟡 Treat as a split of the "lost in full" pool into
killed/captured for the strategic layer.

### 12.3 Medics

🟢 Medic units reduce final losses by their percentage (**10% per rank from II**), to a
**maximum 70% reduction** of the original loss value. "Of the actual losses": lost 100
→ rank II medics → 90 lost; rank III → 80; … down to the 70% cap. 🟢 A unit that did
**not escape** the field cannot be healed.

---

## 13. Strategic layer (context — out of tactical scope)

The Military System article governs the campaign around battles. **The battle
simulator only consumes/produces the marked inputs/outputs**; do not implement the
campaign in this prototype.

**Inputs to a battle** (set up the units): unit **type, count, rank, side**, the unit
"view" tag (personal army / militia / mercenary / guard), pre-battle stat modifiers
from **supply** overage (§3.5), the **map preset** and **terrain layout**, which side
is **defender** (gets first move + side choice).

**Outputs from a battle:** per-unit survival/HP/morale end state, **rank changes**
(chevrons: +2 win / +1 loss), **post-battle losses** (§12), ruler fate (§11.3),
retreat destination, and "did the unit end as cavalry" (§5.3 dismount permanence).

**Not implemented here:** war phases/seasons, action points, supply limits & sanitary
losses, recruitment/upkeep/retraining, sieges & assaults, war exhaustion,
contributions, truces, transport, overlapping claims. (All defined in the Military
System article for the eventual full game.)

---

## 14. Open questions & source ambiguities (🔴 / decisions to confirm)

1. **Ram multiplier 1.48 vs 1.5** (§9.9): the source states the heavy-cav ram mod is
   24 (→ ×1.48 over 2 hexes) but its worked example multiplies by 1.5. **Default:** use
   the formula `1 + ramMod·hexes/100` (×1.48). Confirm.
2. **"Hex-through-hex" direct fire** (§5.4): the exact range pattern of direct fire
   ("простреливает гекс через гекс") is unclear — does it skip the adjacent hex and
   hit the one beyond? **Default 🟡:** direct fire reaches the 2nd hex in the front
   arc (one gap), extended by elevation/crossbow rules. Confirm the precise tile set.
3. **Turn cost** (§7.2): does a full reorientation always cost 1 hex, or only when
   turning beyond a single facing step? Source says "1 hex to step **or** turn to any
   direction". **Default:** any turn = 1 hex (heavy units: 1 free turn/turn).
4. **Crossbow "full damage to heavy"** (§4.4): does this mean it *ignores* heavy units'
   anti-charge/anti-ranged reductions, or that it simply isn't reduced by them?
   **Default 🟡:** the heavy subtype's anti-ranged reduction does not apply to crossbow
   hits.
5. **Breakthrough "combined damage" timing** (§5.2): is the threshold checked against
   damage already dealt this turn, or this single attack? **Default 🟡:** this attack's
   damage (plus any simultaneous co-attackers on the same target this turn).
6. **Charge reflection cap/rounding** (§9.8): does reflected damage obey the ×3 cap and
   round like a normal hit, and is it the cavalry's computed charge damage verbatim?
   **Default 🟡:** round; reflect the cavalry's computed charge component. Confirm.
7. **What counts as "natural" for the ×3 cap** (§9.2): pristine table value, or current
   effective (post rank/count/degrade)? **Default 🟡:** current effective.
8. **Acceleration & initiative** (§6.1/7.3): acceleration can be activated mid-turn, but
   initiative is by speed — does acceleration retroactively change ordering? **Default:**
   order by start-of-turn speed; acceleration only affects movement once activated.
9. **Number of sides:** rules are written for Blue vs Red. **Default:** two sides;
   design the data model for N but only validate two.

---

## 15. Implementation guidance

> Maps onto the prototype's **API → Model → View** (MobX) architecture (see README).
> The battle engine is a **pure, deterministic reducer** that lives in the Model layer
> and must be unit-testable without React.

### 15.1 Suggested core data model

```ts
type Axial = { q: number; r: number };          // cube-derivable
type Facing = 0 | 1 | 2 | 3 | 4 | 5;             // toward the 6 vertices
type Side = 'blue' | 'red';
type Zone = 'front' | 'flank' | 'rear';

type Category = 'spear' | 'shock' | 'cavalry' | 'ranged' | 'special';
type Subtype  = 'light' | 'medium' | 'heavy'
              | 'archer' | 'horseArcher' | 'longbow' | 'crossbow'
              | 'engineer' | 'medic';
type Rank = 1 | 2 | 3 | 4 | 5 | 6;

interface UnitDef {            // catalog entry, per 100 @ rank II
  category: Category; subtype: Subtype;
  baseHp: number; baseAtk: number; baseMorale: number; speed: number;
  ramMod?: number;            // cavalry only
  cost: number | null;
  perks: Perk[];              // data-driven flags & multipliers
  abilities: AbilityId[];     // closeFormation | breakthrough | ramStrike | ...
}

interface UnitState {
  id: string; side: Side; def: UnitDef;
  rank: Rank; count: number;                 // 0..100
  hex: Axial; facing: Facing;
  hp: number; morale: number;                // current
  maxHp: number; maxMorale: number;          // entering (post rank/count/strategic)
  shotsLeft: number;                         // ranged
  hasActed: boolean; hasAttacked: boolean;   // per-turn flags
  isRuler: boolean; dismounted: boolean;
}

interface Hex {
  coord: Axial; terrain: TerrainType; elevation: 0 | 1 | 2;
  state?: 'mud' | 'frozen' | null;
}
```

🟡 Implement **perks/abilities data-driven** (a registry keyed by id, each contributing
modifiers to the §9 pipeline and/or actions) so subtypes, custom templates (§4.6), and
terrain rules compose without branching code.

### 15.2 Engine shape

- `computeEffectiveStats(unit)` — rank (§3.3) → count (§3.2) → degradation (§3.4).
- `zoneOf(attackerHex, defender)` → front/flank/rear (§2.2).
- `resolveAttack(attacker, defender, context)` → `{ physical, morale, reflected? }`,
  the §9 pipeline. **Pure function** — the single most test-worthy unit.
- `initiativeOrder(units)` — §6.1.
- `legalActions(unit, board)` and `applyAction(action, board)` — §7, §8, §11.
- `checkBattleEnd(board)` — §11.4.
- `postBattleLosses(board)` — §12 (battle output).

### 15.3 Recommended build phasing (for a "full faithful" target)

Even targeting the full spec, build and verify in this order so each layer is testable:

1. **Board + units + rendering** — hex grid, facing zones (§2), unit cards/stats, the
   catalog (§4), rank & count scaling (§3). No combat yet.
2. **Damage pipeline** (§9) as a pure, tested function, plus basic Attack/Move/Turn
   actions (§7) and dual HP/morale tracking, degradation, rout/destroy (§11.1).
3. **Initiative & turn loop** (§6), terrain modifiers (§10), elevation, line-of-fire.
4. **Category abilities** (§5) — close formation, breakthrough, ram/charge, ranged
   modes & ammo, dismount.
5. **Reactive layer** — opportunity attacks (§8), charge reflection, cascade morale &
   ruler (§11.2–11.3).
6. **Battle end & post-battle losses** (§11.4, §12) — produce the strategic output.

Keep the engine deterministic; the only randomness is explicit dice (ice cracking
§10/#6, ruler fate §11.3) — route all of it through a **seeded RNG** so battles replay.

---

## Appendix A — Modifier cheat-sheet

| Source | Channel | Multiplier |
| --- | --- | --- |
| Flank hit | morale | ×1.25 |
| Rear hit | morale | ×1.5 (shock infantry: ×1.25) |
| Spearman rear | physical | ×1.5 (extra) |
| Close formation, 1 flank | incoming front | ×0.8 |
| Close formation, 2 flanks | incoming front | ×0.6 |
| Hill vs foothill | physical | ×1.25 / takes ×0.75 |
| Hill vs lower adjacent | physical | ×1.5 / takes ×0.5 |
| Foothill vs lower | physical | ×1.25 / takes ×0.75 |
| Brush vs ranged | physical | ×0.75 |
| Forest vs ranged | physical | ×0.5 |
| Mud: light↔heavy (both in mud) | physical | ×2 |
| Charge (cavalry) | physical | 1 + ramMod·hexes/100 |
| Charge ≥3 hexes (cavalry) | morale | ×1.25 |
| Arcing / Direct / Close (ranged) | physical | ×1 / ×2 / ×0.5 |
| Crossbow close combat | physical | ×0.75 |
| Below 50% HP (bloodied) | both | ×0.5 (output) |
| **Hard cap (all attacks)** | both | **≤ ×3 natural** (cavalry morale exempt) |

## Appendix B — Initiative quick reference

`speed desc → category (cav > ranged > shock > spear) → side-alternate (Blue, Red)`
