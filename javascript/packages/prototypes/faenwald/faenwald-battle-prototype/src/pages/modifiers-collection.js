import { ROUTES } from "../data/routing.js";
import { getCollections, createCollection, deleteCollection } from "../modules/modifiers-store.js";

const STYLE = `
  <style>
    .mc { font-family: sans-serif; padding: 16px; }
    .mc .box-label { display: inline-block; margin: 0 0 16px; padding: 10px 20px; border: 1px solid #000; font-size: 16px; font-weight: normal; }
    .mc hr { border: none; border-top: 1px solid #999; margin: 0 0 16px; }
    .mc .row { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
    .mc .name { width: 280px; padding: 12px 16px; border: 1px solid #000; text-align: center; }
    .mc .count { width: 200px; padding: 12px 16px; border: 1px solid #000; text-align: center; }
    .mc button { font: inherit; background: #fff; border: 1px solid #000; padding: 10px 14px; cursor: pointer; }
    .mc .create { margin-top: 4px; }
    .mc .empty { color: #999; margin: 0 0 16px; }
  </style>
`;

// attribute-safe interpolation for user-entered text
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const renderModifiersCollections = () => {
  const root = document.querySelector("main");

  const rowHtml = (collection) => `
    <div class="row">
      <span class="name">${esc(collection.name)}</span>
      <span class="count">${collection.modifiers.length} modifiers</span>
      <button data-action="open" data-collection-id="${collection.id}" title="Edit">✏️</button>
      <button data-action="delete" data-collection-id="${collection.id}" title="Delete">🗑️</button>
    </div>
  `;

  const render = () => {
    const collections = getCollections();
    root.innerHTML = `
      ${STYLE}
      <section class="mc">
        <h2 class="box-label">Existed collection of modifiers</h2>
        <hr>
        ${
          collections.length
            ? collections.map(rowHtml).join("")
            : `<p class="empty">No collections yet.</p>`
        }
        <hr>
        <button class="create" data-action="create">＋ Create modifier collection</button>
      </section>
    `;
  };

  const onClick = (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;

    const collectionId = el.dataset.collectionId;

    switch (el.dataset.action) {
      case "create": {
        const collection = createCollection();
        location.hash = `${ROUTES.MODIFIERS_COLLECTIONS}/${collection.id}`;
        break;
      }
      case "open":
        location.hash = `${ROUTES.MODIFIERS_COLLECTIONS}/${collectionId}`;
        break;
      case "delete":
        // destructive: cascades to the collection's modifiers
        if (confirm("Delete this collection and all its modifiers?")) {
          deleteCollection(collectionId);
          render();
        }
        break;
    }
  };

  root.addEventListener("click", onClick);
  render();

  return () => {
    root.removeEventListener("click", onClick);
    root.innerHTML = "";
  };
};

export { renderModifiersCollections };
