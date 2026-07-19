import { ROUTES } from "../data/routing.js";
import { MODIFIERS_MODULE } from "../modules/modifiers.js";
import { MODEL } from "../model/model.js";
import { topNavHtml } from "../components/top-nav.js";

const STYLE = `
  <style>
    .mc {
      font-family: var(--font-body);
      color: var(--text-primary);
      padding: var(--space-8);
    }

    .mc .box-label {
      display: inline-block;
      margin: 0 0 var(--space-7);
      padding: var(--space-5) var(--space-8);
      font-family: var(--font-display);
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-normal);
      color: var(--text-accent);
    }

    .mc hr {
      border: none;
      border-top: 1px solid var(--border-default);
      margin: 0 0 var(--space-7);
    }

    .mc .row {
      display: flex;
      align-items: center;
      gap: var(--space-7);
      margin-bottom: var(--space-6);
    }

    .mc .name {
      width: 280px;
      padding: var(--space-6) var(--space-7);
      background: var(--bg-control-subtle);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      text-align: center;
    }

    .mc .count {
      width: 200px;
      padding: var(--space-6) var(--space-7);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      text-align: center;
    }

    .mc button {
      font: inherit;
      color: var(--text-primary);
      background: var(--bg-control);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-sm);
      padding: var(--space-5) var(--space-6);
      cursor: pointer;
    }

    .mc button:hover {
      background: var(--bg-control-hover);
    }

    .mc .create {
      margin-top: var(--space-2);
    }

    .mc .empty {
      color: var(--text-muted);
      margin: 0 0 var(--space-7);
    }
  </style>
`;

// attribute-safe interpolation for user-entered text
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const renderModifiersCollections = ({ root, params, router }) => {
  const rowHtml = (collection) => `
    <div class="row">
      <span class="name">${esc(collection.name)}</span>
      <span class="count">${collection.modifiers.length} modifiers</span>
      <button data-action="open" data-collection-id="${collection.id}" title="Edit">✏️</button>
      <button data-action="delete" data-collection-id="${collection.id}" title="Delete">🗑️</button>
    </div>
  `;

  const render = () => {
    const collections = MODEL.modifiers.collections;
    root.innerHTML = `
      ${topNavHtml(router)}
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
    if (!el) {
      return;
    }

    const collectionId = el.dataset.collectionId;

    switch (el.dataset.action) {
      case "create": {
        const collection = MODIFIERS_MODULE.createCollection(MODEL.modifiers);
        router.push(ROUTES.MODIFIERS, { collectionId: collection.id });
        break;
      }
      case "open":
        router.push(ROUTES.MODIFIERS, { collectionId });
        break;
      case "delete":
        // destructive: cascades to the collection's modifiers
        if (confirm("Delete this collection and all its modifiers?")) {
          MODIFIERS_MODULE.deleteCollection(MODEL.modifiers, collectionId);
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
