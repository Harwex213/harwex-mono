import { DEMOS } from "./registry";

// The nav is built once; routing only flips the `is-active` class. Rebuilding the
// list per navigation would be cheap here but would also throw away scroll
// position, which is the kind of thing a demo shell should not do.
function createNav(): { el: HTMLElement; setActive: (id: string) => void } {
  const nav = document.createElement("nav");
  nav.className = "nav";

  const title = document.createElement("h1");
  title.textContent = "Тени в 2D";
  nav.append(title);

  const links = new Map<string, HTMLAnchorElement>();
  for (const demo of DEMOS) {
    const link = document.createElement("a");
    link.href = `#/${demo.id}`;
    link.className = demo.mount === null ? "nav-item nav-item-todo" : "nav-item";

    const name = document.createElement("span");
    name.textContent = demo.title;
    link.append(name);

    if (demo.mount === null) {
      const badge = document.createElement("i");
      badge.textContent = "нет демо";
      link.append(badge);
    }

    links.set(demo.id, link);
    nav.append(link);
  }

  return {
    el: nav,
    setActive: (id: string) => {
      for (const [linkId, link] of links) {
        link.classList.toggle("is-active", linkId === id);
      }
    },
  };
}

export { createNav };
