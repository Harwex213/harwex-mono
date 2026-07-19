# M8 — Finished page & losses

Goal: the battle ends somewhere meaningful; the full losses math from doc §1.5 (with the agreed ruling).

## Pure helper

- `losses.js` — `computeLosses(units)` per side, per unit:
  - survivor or routed-off-field → casualties = 50% of HP lost (rounded arithmetically);
  - destroyed → 100% of full HP lost, half of that becomes the winner's prisoners;
  - medics reduction skipped (not in roster this iteration).
  Returns per-unit rows + per-side totals (casualties, prisoners taken).

## Page — battle-finished

- Guard (M1) + top nav + scoped style block.
- Winner banner (or draw / «capitulated» reason from state).
- Per side: three groups — survivors (remaining HP/morale), routed, destroyed — each unit with its
  casualties row; side totals and prisoners.
- Full battle log (read-only, scrollable).
- «New battle» button → `ACTIVE_BATTLE_MODULE.reset` → battle-creation (the M1 creation guard already
  allows this in FINISHED phase).

## Polish (this milestone closes the flow)

- Log entries carry round numbers; canvas on the active page greys out when phase flips mid-render.
- Re-read every new `<style>` block against the token rules (`grep -nE '#[0-9a-f]{3,8}\b|rgba?\(|[0-9]+px'`).
- Final CLAUDE.md pass: architecture section gains the battle-runtime modules and the new helper files
  (present the diff to the user for review — CLAUDE.md diffs are API changes).

## Done when

- Tests: losses math rows/totals/rounding, prisoner split, draw handling.
- `/verify`: full end-to-end run — create, place with facings + ruler, fight with melee/ranged/specials,
  finish by annihilation AND by capitulation, read the losses table, start a new battle.
