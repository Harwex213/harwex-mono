import { MAPS, UNIT_TYPES, STAT_META } from "../data/catalog.js";
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

const refKey = (collectionId, modifierId) => `${collectionId}:${modifierId}`;

const STYLE = `
  <style>
    .bc { font-family: sans-serif; padding: 16px; }
    .bc .box-label { display: inline-block; margin: 0 0 16px; padding: 10px 20px; border: 1px solid #000; font-size: 16px; font-weight: normal; }
    .bc .maps { display: flex; gap: 32px; margin-bottom: 24px; }
    .bc .map-card { display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer; }
    .bc .map-card img { width: 96px; height: 88px; object-fit: cover; border: 1px solid #000; }
    .bc hr { border: none; border-top: 1px solid #999; margin: 0 0 24px; }
    .bc .sides { display: grid; grid-template-columns: 1fr 1fr; }
    .bc .side { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 0 24px 24px 0; }
    .bc .side--defender { align-items: flex-end; padding: 0 0 24px 24px; border-left: 1px solid #999; }
    .bc .side-label { padding: 8px 16px; border: 1px solid #000; }
    .bc .unit { display: flex; flex-direction: column; gap: 8px; }
    .bc .side--defender .unit { align-items: flex-end; }
    .bc .unit-row { display: flex; align-items: center; gap: 12px; }
    .bc select, .bc button, .bc input { font: inherit; background: #fff; border: 1px solid #000; padding: 8px 12px; }
    .bc button { cursor: pointer; }
    .bc button:disabled { color: #999; border-color: #999; cursor: default; }
    .bc .stats { padding: 8px 12px; border: 1px solid #000; white-space: nowrap; }
    .bc .modifier-row { display: flex; align-items: center; gap: 12px; margin-left: 24px; }
    .bc .side--defender .modifier-row { margin-left: 0; margin-right: 24px; }
    .bc .modifier-name { min-width: 220px; padding: 8px 12px; border: 1px solid #000; text-align: center; }
    .bc .combo { position: relative; margin-left: 24px; }
    .bc .side--defender .combo { margin-left: 0; margin-right: 24px; }
    .bc .combo ul { position: absolute; z-index: 1; left: 0; right: 0; margin: 0; padding: 0; list-style: none; background: #fff; border: 1px solid #000; border-top: none; }
    .bc .combo li button { display: block; width: 100%; border: none; text-align: left; }
    .bc .combo li button:hover { background: #eee; }
    .bc .start { display: flex; align-items: center; gap: 16px; margin-top: 8px; }
    .bc .hint { margin: 0; color: #999; }
  </style>
`;

const renderBattleCreation = () => {
  const root = document.querySelector("main");

  // local UI state: which unit's modifier combobox is open
  let comboForUnitId = null;

  const validationHint = () => {
    const hints = [];
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

  const render = () => {
    const valid = isConfigValid();

    root.innerHTML = `
      ${STYLE}
      <section class="bc">
        <h2 class="box-label">Select a map</h2>
        <div class="maps">
          ${MAPS.map(
            (m) => `
              <label class="map-card">
                <img src="${m.image}" alt="${m.name}">
                <span>${m.name}</span>
                <input type="radio" name="map" value="${m.id}" ${m.id === battleConfig.mapId ? "checked" : ""}>
              </label>`,
          ).join("")}
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
