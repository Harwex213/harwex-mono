import { signal } from "@preact/signals-react";

// Hash routing, so the prototype keeps working from `file://` and from any
// static server without rewrite rules.
const route = signal(readRoute());

window.addEventListener("hashchange", () => {
  route.value = readRoute();
});

function readRoute(): string {
  return window.location.hash.replace(/^#\/?/, "");
}

function hrefFor(pageId: string): string {
  return `#/${pageId}`;
}

export { hrefFor, route };
