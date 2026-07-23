import { ROUTE_LINKS } from "../data/routing.js";
import { STAT_META } from "../data/unit.js";
import { addEntry, createModifier, deleteModifier, getCollection, removeEntry, renameCollection, updateEntry, updateModifier } from "../state/modifiers.js";

// attribute-safe interpolation for user-entered text
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const statOptions = (selected) =>
  STAT_META.map(
    (s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${s.label} ${s.emoji}</option>`,
  ).join("");

/**
 * @param {{ store: Store, router: Router, params: { collectionId?: string } }} deps
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
const createModifiersTablePage = ({ store, router, params = {} }) => {
  const collectionId = params.collectionId;

  // transient UI state: which modifier row is expanded into its flat/percent editor
  let editingModifierId = null;

  // live edits commit to the store (and localStorage) on every keystroke, but
  // must NOT repaint: nothing on the page is derived from these values live,
  // and repainting a focused <input type=number> mid-edit corrupts the caret
  // and rejects an in-progress "-". The DOM already shows what was typed, so
  // those dispatches run muted; structural changes repaint via the subscription.
  let muteRender = false;
  const dispatchMuted = (mutate) => {
    muteRender = true;
    store.set(mutate);
    muteRender = false;
  };

  const el = document.createElement("section");
  el.className = "modifiers-table";
  el.innerHTML = `
    <div class="modifiers-table-header">
      <a href="${ROUTE_LINKS.MODIFIERS_COLLECTIONS}">← Collections</a>
      <input class="modifiers-table-coll-name" data-role="coll-name" data-focus="coll-name">
    </div>
    <h2 class="modifiers-table-title"><span>Modifiers Table</span></h2>
    <hr>
    <div data-role="rows"></div>
    <button data-action="add-modifier">＋ Add</button>
  `;
  const collNameEl = el.querySelector('[data-role="coll-name"]');
  const rowsEl = el.querySelector('[data-role="rows"]');

  const entryHtml = (modifierId, kind, entry) => {
    // percent is stored as a fraction (0.3); the field shows it as a whole number
    const shown = kind === "percent" ? Math.round(entry.value * 100) : entry.value;
    return `
      <div class="modifiers-table-entry">
        <select data-role="entry-stat" data-modifier-id="${esc(modifierId)}" data-kind="${kind}" data-entry-id="${entry.id}">
          ${statOptions(entry.stat)}
        </select>
        <input type="number" class="modifiers-table-val" data-role="entry-value" data-focus="val:${kind}:${entry.id}"
               data-modifier-id="${esc(modifierId)}" data-kind="${kind}" data-entry-id="${entry.id}" value="${shown}">
        ${kind === "percent" ? "<span>%</span>" : ""}
        <button data-action="remove-entry" data-modifier-id="${esc(modifierId)}" data-kind="${kind}" data-entry-id="${entry.id}" title="Remove">🗑️</button>
      </div>
    `;
  };

  const editorColumnHtml = (modifier, kind) => `
    <div class="modifiers-table-col">
      <div class="modifiers-table-kind">${kind}</div>
      ${modifier[kind].map((entry) => entryHtml(modifier.id, kind, entry)).join("")}
      <button data-action="add-entry" data-modifier-id="${esc(modifier.id)}" data-kind="${kind}">＋ Add ${kind} modifier</button>
    </div>
  `;

  const modifierEl = (modifier) => {
    const open = editingModifierId === modifier.id;
    const row = document.createElement("div");
    row.className = `modifiers-table-row ${open ? "modifiers-table-row--open" : ""}`;
    row.innerHTML = `
      <div class="modifiers-table-row-main">
        <span class="modifiers-table-id">${esc(`${collectionId}:${modifier.id}`)}</span>
        <input class="modifiers-table-name" data-role="name" data-focus="name:${esc(modifier.id)}"
               data-modifier-id="${esc(modifier.id)}" value="${esc(modifier.name)}" placeholder="name">
        <input class="modifiers-table-desc" data-role="description" data-focus="desc:${esc(modifier.id)}"
               data-modifier-id="${esc(modifier.id)}" value="${esc(modifier.description)}" placeholder="description">
        <button data-action="toggle-edit" data-modifier-id="${esc(modifier.id)}" title="Edit">✏️</button>
        <button data-action="delete-modifier" data-modifier-id="${esc(modifier.id)}" title="Delete">🗑️</button>
      </div>
      ${open ? `<div class="modifiers-table-editor">${editorColumnHtml(modifier, "flat")}${editorColumnHtml(modifier, "percent")}</div>` : ""}
    `;
    return row;
  };

  const render = (s) => {
    if (muteRender) {
      return;
    }

    const collection = getCollection(s.modifiers, collectionId);

    if (!collection) {
      el.innerHTML = `
        <p class="modifiers-table-missing">Collection not found.</p>
        <a href="${ROUTE_LINKS.MODIFIERS_COLLECTIONS}">← Back to collections</a>
      `;
      return;
    }

    // capture focus so a rows rebuild doesn't drop the caret. the active
    // field's raw value is preserved too, so mid-edit text ("-", "1.") isn't
    // clobbered by the store's normalized value.
    const active = document.activeElement;
    const focusKey = active?.dataset?.focus;
    const savedValue = active?.value;
    const selStart = active?.selectionStart ?? null;
    const selEnd = active?.selectionEnd ?? null;

    if (document.activeElement !== collNameEl) {
      collNameEl.value = collection.name;
    }
    rowsEl.replaceChildren(...collection.modifiers.map(modifierEl));

    if (focusKey) {
      const focused = el.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
      if (focused) {
        if (savedValue !== undefined && focused.value !== savedValue) {
          focused.value = savedValue;
        }
        focused.focus();
        if (selStart !== null) {
          try {
            focused.setSelectionRange(selStart, selEnd);
          } catch {
            // number inputs reject setSelectionRange in some browsers — ignore
          }
        }
      }
    }
  };

  el.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }

    const modifierId = target.dataset.modifierId;
    const kind = target.dataset.kind;

    switch (target.dataset.action) {
      case "add-modifier": {
        let modifier;
        // muted: editingModifierId must point at the new row before the repaint
        dispatchMuted((s) => {
          modifier = createModifier(s.modifiers, collectionId);
        });
        if (modifier) {
          editingModifierId = modifier.id;
        }
        render(store.get());
        break;
      }
      case "toggle-edit":
        editingModifierId = editingModifierId === modifierId ? null : modifierId;
        render(store.get());
        break;
      case "delete-modifier":
        if (editingModifierId === modifierId) {
          editingModifierId = null;
        }
        store.set((s) => deleteModifier(s.modifiers, collectionId, modifierId));
        break;
      case "add-entry":
        store.set((s) => addEntry(s.modifiers, collectionId, modifierId, kind));
        break;
      case "remove-entry":
        store.set((s) => removeEntry(s.modifiers, collectionId, modifierId, kind, target.dataset.entryId));
        break;
    }
  });

  el.addEventListener("input", (event) => {
    const target = event.target;
    const modifierId = target.dataset.modifierId;

    switch (target.dataset.role) {
      case "coll-name":
        dispatchMuted((s) => renameCollection(s.modifiers, collectionId, target.value));
        break;
      case "name":
        dispatchMuted((s) => updateModifier(s.modifiers, collectionId, modifierId, { name: target.value }));
        break;
      case "description":
        dispatchMuted((s) => updateModifier(s.modifiers, collectionId, modifierId, { description: target.value }));
        break;
      case "entry-value": {
        const raw = target.value.trim();
        // an in-progress "" / "-" commits as 0; the field keeps the raw text
        const parsed = raw === "" || raw === "-" ? 0 : Number(raw);
        if (Number.isNaN(parsed)) {
          return;
        }
        const value = target.dataset.kind === "percent" ? parsed / 100 : parsed;
        dispatchMuted((s) => updateEntry(s.modifiers, collectionId, modifierId, target.dataset.kind, target.dataset.entryId, { value }));
        break;
      }
    }
  });

  el.addEventListener("change", (event) => {
    if (event.target.dataset.role === "entry-stat") {
      dispatchMuted((s) => updateEntry(s.modifiers, collectionId, event.target.dataset.modifierId, event.target.dataset.kind, event.target.dataset.entryId, {
        stat: event.target.value,
      }));
    }
  });

  const unsubscribe = store.subscribe(render);

  return { el, destroy: unsubscribe };
};

export { createModifiersTablePage };
