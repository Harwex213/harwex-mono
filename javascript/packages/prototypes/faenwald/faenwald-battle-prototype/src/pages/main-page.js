import { ROUTE_LINKS } from "../data/routing.js";

const renderMainPage = () => {
  const root = document.querySelector("main");

  root.innerHTML = `
    <nav style="display: flex; flex-direction: column; align-items: center; gap: 16px; padding-top: 96px;">
      <a href="${ROUTE_LINKS.GAME}" style="display: block; width: 170px; padding: 12px 0; border: 1px solid #000; text-align: center; text-decoration: none; color: inherit; font-family: sans-serif;">Battle Creation</a>
      <a href="${ROUTE_LINKS.MODIFIERS_COLLECTIONS}" style="display: block; width: 170px; padding: 12px 0; border: 1px solid #000; text-align: center; text-decoration: none; color: inherit; font-family: sans-serif;">Modifiers Collection</a>
    </nav>
  `;

  return () => {
    root.innerHTML = "";
  };
};

export { renderMainPage }
