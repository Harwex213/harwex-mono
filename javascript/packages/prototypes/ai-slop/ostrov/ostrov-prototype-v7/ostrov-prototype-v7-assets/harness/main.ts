import { pages } from "./pages";
import type { AssetPage } from "./pages";
import { createTile } from "./tile";

const list = pages();
const first = list[0];

if (!first) {
  throw new Error("The asset library declares no assets");
}

const selected = (): AssetPage => {
  const id = window.location.hash.replace("#", "");

  const page = list.find((item) => {
    return item.id === id;
  });

  return page ?? first;
};

const createNav = (): HTMLElement => {
  const nav = document.createElement("nav");

  for (const page of list) {
    const link = document.createElement("a");
    link.href = `#${page.id}`;
    link.textContent = page.title;
    link.dataset.asset = page.id;
    nav.append(link);
  }

  return nav;
};

const nav = createNav();
const stage = document.createElement("div");
stage.className = "stage";

const render = (): void => {
  const page = selected();

  const heading = document.createElement("h1");
  heading.textContent = page.title;

  const tiles = document.createElement("div");
  tiles.className = "tiles";

  for (const preview of page.previews) {
    tiles.append(createTile(preview));
  }

  stage.replaceChildren(heading, tiles);

  for (const link of nav.querySelectorAll("a")) {
    link.classList.toggle("current", link.dataset.asset === page.id);
  }
};

const sidebar = document.createElement("aside");
sidebar.append(nav);

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Root element is missing");
}

root.append(sidebar, stage);
window.addEventListener("hashchange", render);
render();
