import { STAT_META, UNIT_TYPES } from "../../data/unit.js";
import { computeUnitStats } from "../../state/battle-config-state/battle-config-state.js";
import { allModifiers, findModifier, getCollection } from "../../state/modifiers-state/modifiers-state.js";

/**
 * Pure HTML builders, one per dynamic region of the page skeleton: everything
 * arrives as parameters, nothing reads the store. `viewState` threads the two
 * shared inputs — the modifiers catalog and which unit's combobox is open
 * ({ modifiers, openComboUnitId }).
 */

const refKey = (collectionId, modifierId) => `${collectionId}:${modifierId}`;

// attribute-safe interpolation for user-entered text (map names come from the store)
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// user-facing copy for validateConfig() problem codes
const PROBLEM_TEXT = {
  NO_MAP: () => "select a map.",
  EMPTY_SIDE: (problem) => `${problem.side} needs at least one unit.`,
  UNTYPED_UNIT: () => "Every unit needs a type.",
};

const problemsHint = (problems) =>
  problems.map((problem) => PROBLEM_TEXT[problem.code](problem)).join(" ");

const statsHtml = (unit, modifiers) => {
  const s = computeUnitStats(unit, modifiers);
  return `<span class="stats">${STAT_META.map((m) => `${s[m.id]} ${m.emoji}`).join(" ")}</span>`;
};

const comboHtml = (unit, remaining) => `
  <div class="combo" data-role="combo">
    <input data-role="combo-input" data-unit-id="${unit.id}" placeholder="search modifier…">
    <ul>
      ${remaining
  .map(
    (x) => `
            <li>
              <button data-action="pick-modifier" data-unit-id="${unit.id}" data-collection-id="${x.collectionId}" data-modifier-id="${x.modifier.id}">
                ${x.collectionName} / ${x.modifier.name} — ${x.modifier.description}
              </button>
            </li>`,
  )
  .join("")}
    </ul>
  </div>
`;

const modifiersHtml = (unit, { modifiers, openComboUnitId }) => {
  const rows = unit.modifiers
    .map((ref) => {
      const modifier = findModifier(modifiers, ref.collectionId, ref.modifierId);
      if (!modifier) {
        return null; // ref's collection/modifier was deleted — skip
      }
      const collection = getCollection(modifiers, ref.collectionId);
      const prefix = collection ? `${collection.name} / ` : "";
      return `
        <div class="modifier-row">
          <span class="modifier-name">${prefix}${modifier.name} — ${modifier.description}</span>
          <button data-action="remove-modifier" data-unit-id="${unit.id}" data-collection-id="${ref.collectionId}" data-modifier-id="${ref.modifierId}" title="Remove modifier">🗑️</button>
        </div>`;
    })
    .filter(Boolean)
    .join("");

  // every modifier across all collections, minus those already picked, sorted
  // by modifier name (collection name breaks ties)
  const picked = new Set(unit.modifiers.map((ref) => refKey(ref.collectionId, ref.modifierId)));
  const remaining = allModifiers(modifiers)
    .filter((x) => !picked.has(refKey(x.collectionId, x.modifier.id)))
    .sort(
      (a, b) =>
        a.modifier.name.localeCompare(b.modifier.name) ||
        a.collectionName.localeCompare(b.collectionName),
    );
  let footer = "";
  if (openComboUnitId === unit.id) {
    footer = comboHtml(unit, remaining);
  } else if (remaining.length > 0) {
    footer = `<button class="add-modifier" data-action="open-combo" data-unit-id="${unit.id}">＋ add modifier</button>`;
  }

  return rows + footer;
};

const unitHtml = (unit, viewState) => {
  const options = UNIT_TYPES.map(
    (t) => `<option value="${t.id}" ${t.id === unit.typeId ? "selected" : ""}>${t.name}</option>`,
  ).join("");

  return `
    <div class="unit">
      <div class="unit-row">
        <select data-action="set-type" data-unit-id="${unit.id}">
          ${unit.typeId ? "" : `<option value="" selected>choose type…</option>`}
          ${options}
        </select>
        ${unit.typeId ? statsHtml(unit, viewState.modifiers) : ""}
        <button data-action="remove-unit" data-unit-id="${unit.id}" title="Remove unit">🗑️</button>
      </div>
      ${unit.typeId ? modifiersHtml(unit, viewState) : ""}
    </div>
  `;
};

const sideHtml = (side, units, viewState) => `
  <div class="side side--${side}">
    <div class="side-label">${side === "attacker" ? "🗡️ Attacker" : "🛡️ Defender"}</div>
    ${units.map((unit) => unitHtml(unit, viewState)).join("")}
    <button data-action="add-unit" data-side="${side}">＋ Add Unit</button>
  </div>
`;

const mapCardHtml = (m, selectedMapId) => `
  <label class="map-card">
    ${m.image ? `<img src="${esc(m.image)}" alt="${esc(m.name)}">` : `<span class="map-thumb">⬡</span>`}
    <span>${esc(m.name)}</span>
    <input type="radio" name="map" data-action="select-map" value="${m.id}" ${String(m.id) === String(selectedMapId) ? "checked" : ""}>
  </label>
`;

/**
 * @param {HexMap[]} maps
 * @param {string | null} mapId
 * @returns {string}
 */
const mapsHtml = (maps, mapId) =>
  maps.length
    ? maps.map((m) => mapCardHtml(m, mapId)).join("")
    : `<p class="hint">No maps yet — <a href="#/maps">create one in the Maps Store</a>.</p>`;

/**
 * @param {BattleConfigUnit[]} attacker
 * @param {BattleConfigUnit[]} defender
 * @param {{ modifiers: ModifiersState, openComboUnitId: number | null }} viewState
 * @returns {string}
 */
const sidesHtml = (attacker, defender, viewState) =>
  sideHtml("attacker", attacker, viewState) + sideHtml("defender", defender, viewState);

/**
 * @param {BattleConfigProblem[]} problems
 * @returns {string}
 */
const startHtml = (problems) => {
  const valid = problems.length === 0;
  return `
    <button data-action="start-battle" ${valid ? "" : "disabled"}>Start battle</button>
    ${valid ? "" : `<p class="hint">${problemsHint(problems)}</p>`}
  `;
};

export { mapsHtml, sidesHtml, startHtml };
