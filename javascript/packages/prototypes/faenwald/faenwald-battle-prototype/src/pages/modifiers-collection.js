import { ROUTES } from "../data/routing.js";
import { createCollection, deleteCollection } from "../state/modifiers.js";

// attribute-safe interpolation for user-entered text
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * @param {{ store: Store, router: Router }} deps
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
const createModifiersCollectionPage = ({ store, router }) => {
  const el = document.createElement("section");
  el.className = "modifiers-collection";
  el.innerHTML = `
    <h2 class="modifiers-collection-label">Existed collection of modifiers</h2>
    <hr>
    <div data-role="rows"></div>
    <hr>
    <button class="modifiers-collection-create" data-action="create">＋ Create modifier collection</button>
  `;
  const rowsEl = el.querySelector('[data-role="rows"]');

  const rowEl = (collection) => {
    const row = document.createElement("div");
    row.className = "modifiers-collection-row";
    row.innerHTML = `
      <span class="modifiers-collection-name">${esc(collection.name)}</span>
      <span class="modifiers-collection-count">${collection.modifiers.length} modifiers</span>
      <button data-action="open" data-collection-id="${collection.id}" title="Edit">✏️</button>
      <button data-action="delete" data-collection-id="${collection.id}" title="Delete">🗑️</button>
    `;
    return row;
  };

  const render = (s) => {
    const collections = s.modifiers.collections;
    if (collections.length === 0) {
      rowsEl.innerHTML = `<p class="modifiers-collection-empty">No collections yet.</p>`;
      return;
    }
    rowsEl.replaceChildren(...collections.map(rowEl));
  };

  el.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }
    // don't leak the action past the page — a navigation here can mount a
    // legacy page mid-dispatch whose <main> listener would see this event
    event.stopPropagation();

    const collectionId = target.dataset.collectionId;

    switch (target.dataset.action) {
      case "create": {
        let collection;
        store.set((s) => {
          collection = createCollection(s.modifiers);
        });
        router.push(ROUTES.MODIFIERS, { collectionId: collection.id });
        break;
      }
      case "open":
        router.push(ROUTES.MODIFIERS, { collectionId });
        break;
      case "delete":
        // destructive: cascades to the collection's modifiers
        if (confirm("Delete this collection and all its modifiers?")) {
          store.set((s) => deleteCollection(s.modifiers, collectionId));
        }
        break;
    }
  });

  const unsubscribe = store.subscribe(render);

  return { el, destroy: unsubscribe };
};

export { createModifiersCollectionPage };
