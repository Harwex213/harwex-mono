import { UNIT_TYPES, STAT_META } from "../data/catalog.js";
import {
  SIDES,
  battleConfig,
  createUnit,
  findUnit,
  removeUnit,
  computeStats,
  isConfigValid,
} from "../modules/battle-config.js";
import { allModifiers, findModifier, getCollection } from "../modules/modifiers-store.js";
import { getMaps, getMap } from "../modules/maps-store.js";
import { topNavHtml } from "../components/top-nav.js";

const refKey = (collectionId, modifierId) => `${collectionId}:${modifierId}`;

// attribute-safe interpolation for user-entered text (map names come from the store)
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const STYLE = `
  <style>
    .bc { font-family: var(--font-body); color: var(--text-primary); padding: var(--space-8); }
    .bc .box-label { display: inline-block; margin: 0 0 var(--space-7); padding: var(--space-5) var(--space-8); font-family: var(--font-display); font-size: var(--font-size-xl); color: var(--text-accent); }
    .bc .maps { display: flex; gap: var(--space-8); margin-bottom: var(--space-8); }
    .bc .map-card { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); cursor: pointer; }
    .bc .map-card img, .bc .map-card .map-thumb { width: 96px; height: 88px; object-fit: cover; border: 1px solid var(--border-default); border-radius: var(--radius-sm); }
    .bc .map-card .map-thumb { display: flex; align-items: center; justify-content: center; background: var(--card-bg); font-size: var(--font-size-xl); color: var(--text-faint); }
    .bc .map-card:hover img, .bc .map-card:hover .map-thumb { border-color: var(--border-accent-muted); }
    .bc hr { border: none; border-top: 1px solid var(--border-default); margin: 0 0 var(--space-8); }
    .bc .sides { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8); }
    .bc .side { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-7); padding: 0 var(--space-8) var(--space-8) 0; }
    .bc .side--defender { align-items: flex-end; padding: 0 0 var(--space-8) var(--space-8); border-left: 1px solid var(--border-default); }
    .bc .side-label { padding: var(--space-4) var(--space-7); font-family: var(--font-display); font-size: var(--font-size-lg); color: var(--text-secondary); }
    .bc .unit { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--card-padding); background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--card-radius); }
    .bc .side--defender .unit { align-items: flex-end; }
    .bc .unit-row { display: flex; align-items: center; gap: var(--space-6); }
    .bc select, .bc button, .bc input { font: inherit; color: var(--text-primary); background: var(--bg-control); border: 1px solid var(--border-medium); border-radius: var(--radius-sm); padding: var(--space-4) var(--space-6); }
    .bc select:hover, .bc input:focus { border-color: var(--border-accent-muted); outline: none; }
    .bc button { cursor: pointer; }
    .bc button:hover { background: var(--bg-control-hover); }
    .bc button:disabled { color: var(--text-muted); border-color: var(--border-default); background: transparent; cursor: default; }
    .bc .stats { padding: var(--space-4) var(--space-6); border: 1px solid var(--border-default); border-radius: var(--radius-sm); color: var(--text-secondary); white-space: nowrap; }
    .bc .modifier-row { display: flex; align-items: center; gap: var(--space-6); margin-left: var(--space-8); }
    .bc .side--defender .modifier-row { margin-left: 0; margin-right: var(--space-8); }
    .bc .modifier-name { min-width: 220px; padding: var(--space-4) var(--space-6); background: var(--bg-control-subtle); border: 1px solid var(--border-default); border-radius: var(--radius-sm); color: var(--text-secondary); text-align: center; }
    .bc .combo { position: relative; margin-left: var(--space-8); }
    .bc .side--defender .combo { margin-left: 0; margin-right: var(--space-8); }
    .bc .combo ul { position: absolute; z-index: 1; left: 0; right: 0; margin: 0; padding: 0; list-style: none; background: var(--bg-surface-raised); border: 1px solid var(--border-medium); border-top: none; border-radius: 0 0 var(--radius-sm) var(--radius-sm); }
    .bc .combo li button { display: block; width: 100%; border: none; border-radius: 0; background: transparent; text-align: left; }
    .bc .combo li button:hover { background: var(--bg-control-hover); }
    .bc .start { display: flex; align-items: center; gap: var(--space-7); margin-top: var(--space-4); }
    .bc .hint { margin: 0; color: var(--text-muted); }
  </style>
`;

const renderBattleCreation = () => {
  const root = document.querySelector("main");

  // local UI state: which unit's modifier combobox is open
  let comboForUnitId = null;

  const validationHint = () => {
    const hints = [];
    if (!getMap(battleConfig.mapId)) hints.push("select a map.");
    for (const side of SIDES) {
      if (battleConfig[side].length === 0) hints.push(`${side} needs at least one unit.`);
    }
    if (SIDES.some((side) => battleConfig[side].some((u) => !u.typeId))) {
      hints.push("Every unit needs a type.");
    }
    return hints.join(" ");
  };

  const statsHtml = (unit) => {
    const s = computeStats(unit);
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

  const modifiersHtml = (unit) => {
    const rows = unit.modifiers
      .map((ref) => {
        const modifier = findModifier(ref.collectionId, ref.modifierId);
        if (!modifier) return null; // ref's collection/modifier was deleted — skip
        const collection = getCollection(ref.collectionId);
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
    const remaining = allModifiers()
      .filter((x) => !picked.has(refKey(x.collectionId, x.modifier.id)))
      .sort(
        (a, b) =>
          a.modifier.name.localeCompare(b.modifier.name) ||
          a.collectionName.localeCompare(b.collectionName),
      );
    let footer = "";
    if (comboForUnitId === unit.id) {
      footer = comboHtml(unit, remaining);
    } else if (remaining.length > 0) {
      footer = `<button class="add-modifier" data-action="open-combo" data-unit-id="${unit.id}">＋ add modifier</button>`;
    }

    return rows + footer;
  };

  const unitHtml = (unit) => {
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
          ${unit.typeId ? statsHtml(unit) : ""}
          <button data-action="remove-unit" data-unit-id="${unit.id}" title="Remove unit">🗑️</button>
        </div>
        ${unit.typeId ? modifiersHtml(unit) : ""}
      </div>
    `;
  };

  const sideHtml = (side) => `
    <div class="side side--${side}">
      <div class="side-label">${side === "attacker" ? "🗡️ Attacker" : "🛡️ Defender"}</div>
      ${battleConfig[side].map(unitHtml).join("")}
      <button data-action="add-unit" data-side="${side}">＋ Add Unit</button>
    </div>
  `;

  const mapCardHtml = (m) => `
    <label class="map-card">
      ${m.image ? `<img src="${esc(m.image)}" alt="${esc(m.name)}">` : `<span class="map-thumb">⬡</span>`}
      <span>${esc(m.name)}</span>
      <input type="radio" name="map" value="${m.id}" ${String(m.id) === String(battleConfig.mapId) ? "checked" : ""}>
    </label>
  `;

  const render = () => {
    // maps live in the store now: a mapId pointing at a deleted map self-heals
    // to the first available one instead of leaving a phantom selection
    if (!getMap(battleConfig.mapId)) battleConfig.mapId = getMaps()[0]?.id ?? null;

    const maps = getMaps();
    const valid = isConfigValid();

    root.innerHTML = `
      ${topNavHtml()}
      ${STYLE}
      <section class="bc">
        <h2 class="box-label">Select a map</h2>
        <div class="maps">
          ${maps.length ? maps.map(mapCardHtml).join("") : `<p class="hint">No maps yet — <a href="#/maps">create one in the Maps Store</a>.</p>`}
        </div>
        <hr>
        <h2 class="box-label">Specify units</h2>
        <div class="sides">
          ${sideHtml("attacker")}
          ${sideHtml("defender")}
        </div>
        <div class="start">
          <button data-action="start-battle" ${valid ? "" : "disabled"}>Start battle</button>
          ${valid ? "" : `<p class="hint">${validationHint()}</p>`}
        </div>
      </section>
    `;

    if (comboForUnitId !== null) {
      root.querySelector("[data-role=combo-input]")?.focus();
    }
  };

  const pickModifier = (unitId, collectionId, modifierId) => {
    findUnit(unitId).modifiers.push({ collectionId, modifierId });
    comboForUnitId = null;
    render();
  };

  const onClick = (event) => {
    const el = event.target.closest("[data-action]");

    if (!el) {
      // click outside an open combobox closes it
      if (comboForUnitId !== null && !event.target.closest("[data-role=combo]")) {
        comboForUnitId = null;
        render();
      }
      return;
    }

    const unitId = Number(el.dataset.unitId);

    switch (el.dataset.action) {
      case "add-unit":
        battleConfig[el.dataset.side].push(createUnit());
        render();
        break;
      case "remove-unit":
        removeUnit(unitId);
        if (comboForUnitId === unitId) comboForUnitId = null;
        render();
        break;
      case "remove-modifier": {
        const unit = findUnit(unitId);
        unit.modifiers = unit.modifiers.filter(
          (ref) =>
            !(
              String(ref.collectionId) === el.dataset.collectionId &&
              String(ref.modifierId) === el.dataset.modifierId
            ),
        );
        render();
        break;
      }
      case "open-combo":
        comboForUnitId = unitId;
        render();
        break;
      case "pick-modifier":
        pickModifier(unitId, el.dataset.collectionId, el.dataset.modifierId);
        break;
      case "start-battle":
        window.location.hash = "/battle";
        break;
    }
  };

  const onChange = (event) => {
    if (event.target.matches("input[name=map]")) {
      battleConfig.mapId = event.target.value;
      render();
      return;
    }
    if (event.target.dataset.action === "set-type") {
      findUnit(Number(event.target.dataset.unitId)).typeId = event.target.value || null;
      render();
    }
  };

  // typing filters the open combobox locally — no re-render, so focus survives
  const onInput = (event) => {
    if (event.target.dataset.role !== "combo-input") return;
    const query = event.target.value.toLowerCase();
    for (const item of event.target.nextElementSibling.querySelectorAll("li")) {
      item.hidden = !item.textContent.toLowerCase().includes(query);
    }
  };

  const onKeydown = (event) => {
    if (comboForUnitId === null) return;
    if (event.key === "Escape") {
      comboForUnitId = null;
      render();
      return;
    }
    if (event.key === "Enter" && event.target.dataset.role === "combo-input") {
      const first = event.target.nextElementSibling.querySelector("li:not([hidden]) button");
      if (first) pickModifier(Number(first.dataset.unitId), first.dataset.collectionId, first.dataset.modifierId);
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKeydown);

  render();

  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
    root.removeEventListener("input", onInput);
    root.removeEventListener("keydown", onKeydown);
    root.innerHTML = "";
  };
};

export { renderBattleCreation };
