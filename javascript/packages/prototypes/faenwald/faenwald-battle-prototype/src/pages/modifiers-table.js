import { ROUTE_LINKS } from "../data/routing.js";
import { STAT_META } from "../data/catalog.js";
import {
  getCollection,
  renameCollection,
  createModifier,
  updateModifier,
  deleteModifier,
  addEntry,
  removeEntry,
  updateEntry,
} from "../modules/modifiers-store.js";

const STYLE = `
  <style>
    .mt { font-family: sans-serif; padding: 16px; }
    .mt a { color: inherit; }
    .mt .header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
    .mt .coll-name { font: inherit; padding: 8px 12px; border: 1px solid #000; min-width: 240px; }
    .mt .title { text-align: center; margin: 0 0 16px; }
    .mt .title span { display: inline-block; padding: 10px 20px; border: 1px solid #000; font-size: 16px; }
    .mt hr { border: none; border-top: 1px solid #999; margin: 16px 0; }
    .mt .row { padding-bottom: 16px; border-bottom: 1px solid #999; margin-bottom: 16px; }
    .mt .row--open { background: #fffbe6; padding: 12px; }
    .mt .row-main { display: flex; align-items: center; gap: 12px; }
    .mt .field { font: inherit; padding: 10px 12px; border: 1px solid #000; }
    .mt .id { padding: 10px 12px; border: 1px solid #000; min-width: 90px; text-align: center; background: #f4f4f4; }
    .mt .name { width: 160px; }
    .mt .desc { flex: 1; }
    .mt button { font: inherit; background: #fff; border: 1px solid #000; padding: 10px 12px; cursor: pointer; }
    .mt .editor { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 16px; }
    .mt .col { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
    .mt .col + .col { padding-left: 24px; border-left: 1px solid #999; }
    .mt .kind { padding: 8px 16px; border: 1px solid #000; }
    .mt .entry { display: flex; align-items: center; gap: 8px; margin-left: 24px; }
    .mt .entry select { font: inherit; padding: 8px 10px; border: 1px solid #000; }
    .mt .val { width: 90px; font: inherit; padding: 8px 10px; border: 1px solid #000; }
    .mt .missing { color: #999; }
  </style>
`;

// attribute-safe interpolation for user-entered text
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const renderModifiersTable = (params = {}) => {
  const root = document.querySelector("main");
  const collectionId = params.collectionId;

  // transient UI state: which modifier row is expanded into its flat/percent editor
  let editingModifierId = null;

  const statOptions = (selected) =>
    STAT_META.map(
      (s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${s.label} ${s.emoji}</option>`,
    ).join("");

  const entryHtml = (modifierId, kind, entry) => {
    // percent is stored as a fraction (0.3); the field shows it as a whole number
    const shown = kind === "percent" ? Math.round(entry.value * 100) : entry.value;
    return `
      <div class="entry">
        <select data-role="entry-stat" data-modifier-id="${esc(modifierId)}" data-kind="${kind}" data-entry-id="${entry.id}">
          ${statOptions(entry.stat)}
        </select>
        <input type="number" class="val" data-role="entry-value" data-focus="val:${kind}:${entry.id}"
               data-modifier-id="${esc(modifierId)}" data-kind="${kind}" data-entry-id="${entry.id}" value="${shown}">
        ${kind === "percent" ? "<span>%</span>" : ""}
        <button data-action="remove-entry" data-modifier-id="${esc(modifierId)}" data-kind="${kind}" data-entry-id="${entry.id}" title="Remove">🗑️</button>
      </div>
    `;
  };

  const editorColumnHtml = (modifier, kind) => `
    <div class="col">
      <div class="kind">${kind}</div>
      ${modifier[kind].map((entry) => entryHtml(modifier.id, kind, entry)).join("")}
      <button data-action="add-entry" data-modifier-id="${esc(modifier.id)}" data-kind="${kind}">＋ Add ${kind} modifier</button>
    </div>
  `;

  const modifierHtml = (modifier) => {
    const open = editingModifierId === modifier.id;
    return `
      <div class="row ${open ? "row--open" : ""}">
        <div class="row-main">
          <span class="id">${esc(`${collectionId}:${modifier.id}`)}</span>
          <input class="field name" data-role="name" data-focus="name:${esc(modifier.id)}"
                 data-modifier-id="${esc(modifier.id)}" value="${esc(modifier.name)}" placeholder="name">
          <input class="field desc" data-role="description" data-focus="desc:${esc(modifier.id)}"
                 data-modifier-id="${esc(modifier.id)}" value="${esc(modifier.description)}" placeholder="description">
          <button data-action="toggle-edit" data-modifier-id="${esc(modifier.id)}" title="Edit">✏️</button>
          <button data-action="delete-modifier" data-modifier-id="${esc(modifier.id)}" title="Delete">🗑️</button>
        </div>
        ${open ? `<div class="editor">${editorColumnHtml(modifier, "flat")}${editorColumnHtml(modifier, "percent")}</div>` : ""}
      </div>
    `;
  };

  const render = () => {
    const collection = getCollection(collectionId);

    if (!collection) {
      root.innerHTML = `
        ${STYLE}
        <section class="mt">
          <p class="missing">Collection not found.</p>
          <a href="${ROUTE_LINKS.MODIFIERS_COLLECTIONS}">← Back to collections</a>
        </section>
      `;
      return;
    }

    // capture focus so a full re-render doesn't drop the caret. the active
    // field's raw value is preserved too, so mid-edit text ("-", "1.") isn't
    // clobbered by the store's normalized value.
    const active = document.activeElement;
    const focusKey = active?.dataset?.focus;
    const savedValue = active?.value;
    const selStart = active?.selectionStart ?? null;
    const selEnd = active?.selectionEnd ?? null;

    root.innerHTML = `
      ${STYLE}
      <section class="mt">
        <div class="header">
          <a href="${ROUTE_LINKS.MODIFIERS_COLLECTIONS}">← Collections</a>
          <input class="coll-name" data-role="coll-name" data-focus="coll-name" value="${esc(collection.name)}">
        </div>
        <h2 class="title"><span>Modifiers Table</span></h2>
        <hr>
        ${collection.modifiers.map(modifierHtml).join("")}
        <button data-action="add-modifier">＋ Add</button>
      </section>
    `;

    if (focusKey) {
      const el = root.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
      if (el) {
        if (savedValue !== undefined && el.value !== savedValue) el.value = savedValue;
        el.focus();
        if (selStart !== null) {
          try {
            el.setSelectionRange(selStart, selEnd);
          } catch {
            // number inputs reject setSelectionRange in some browsers — ignore
          }
        }
      }
    }
  };

  const onClick = (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;

    const modifierId = el.dataset.modifierId;
    const kind = el.dataset.kind;

    switch (el.dataset.action) {
      case "add-modifier": {
        const modifier = createModifier(collectionId);
        if (modifier) editingModifierId = modifier.id;
        render();
        break;
      }
      case "toggle-edit":
        editingModifierId = editingModifierId === modifierId ? null : modifierId;
        render();
        break;
      case "delete-modifier":
        deleteModifier(collectionId, modifierId);
        if (editingModifierId === modifierId) editingModifierId = null;
        render();
        break;
      case "add-entry":
        addEntry(collectionId, modifierId, kind);
        render();
        break;
      case "remove-entry":
        removeEntry(collectionId, modifierId, kind, el.dataset.entryId);
        render();
        break;
    }
  };

  // live edits commit to the store (and localStorage) on every keystroke, but we
  // deliberately do NOT re-render here: nothing on the page is derived from these
  // values live, and repainting a focused <input type=number> mid-edit corrupts
  // the caret and rejects an in-progress "-". Structural changes re-render instead.
  const onInput = (event) => {
    const el = event.target;
    const modifierId = el.dataset.modifierId;

    switch (el.dataset.role) {
      case "coll-name":
        renameCollection(collectionId, el.value);
        break;
      case "name":
        updateModifier(collectionId, modifierId, { name: el.value });
        break;
      case "description":
        updateModifier(collectionId, modifierId, { description: el.value });
        break;
      case "entry-value": {
        const raw = el.value.trim();
        // an in-progress "" / "-" commits as 0; the field keeps the raw text
        const parsed = raw === "" || raw === "-" ? 0 : Number(raw);
        if (Number.isNaN(parsed)) return;
        const value = el.dataset.kind === "percent" ? parsed / 100 : parsed;
        updateEntry(collectionId, modifierId, el.dataset.kind, el.dataset.entryId, { value });
        break;
      }
    }
  };

  const onChange = (event) => {
    if (event.target.dataset.role === "entry-stat") {
      updateEntry(collectionId, event.target.dataset.modifierId, event.target.dataset.kind, event.target.dataset.entryId, {
        stat: event.target.value,
      });
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  render();

  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
    root.removeEventListener("change", onChange);
    root.innerHTML = "";
  };
};

export { renderModifiersTable };
