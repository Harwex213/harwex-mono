import { ROUTE_LINKS } from "../data/routing.js";

const STYLE = `
  <style>
    .mp { display: flex; flex-direction: column; align-items: center; gap: var(--space-7); padding-top: 96px; }
    .mp a { display: block; width: 220px; padding: var(--space-6) 0; background: var(--bg-control); border: 1px solid var(--border-medium); border-radius: var(--radius-sm); font-family: var(--font-display); font-size: var(--font-size-lg); text-align: center; text-decoration: none; color: var(--text-primary); }
    .mp a:hover { background: var(--bg-control-hover); border-color: var(--border-accent-muted); color: var(--text-accent); opacity: 1; }
  </style>
`;

const renderMainPage = () => {
  const root = document.querySelector("main");

  root.innerHTML = `
    ${STYLE}
    <nav class="mp">
      <a href="${ROUTE_LINKS.GAME}">Battle Creation</a>
      <a href="${ROUTE_LINKS.MODIFIERS_COLLECTIONS}">Modifiers Collection</a>
    </nav>
  `;

  return () => {
    root.innerHTML = "";
  };
};

export { renderMainPage }
