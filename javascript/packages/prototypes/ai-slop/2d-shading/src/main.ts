import "./styles.css";
import { createNav } from "./nav";
import { DEMOS, findDemo } from "./registry";
import type { Demo, Teardown } from "./demos/types";

const root = document.querySelector("#app");
if (root === null) {
  throw new Error("#app is missing");
}

const nav = createNav();
const content = document.createElement("main");
content.className = "content";
root.append(nav.el, content);

// One teardown at a time. Mounting is async (pixi's Application.init), so a fast
// double navigation can resolve out of order; `token` decides which resolution is
// still the current route and discards the loser instead of leaving two live apps.
let teardown: Teardown | null = null;
let token = 0;

function header(demo: Demo): HTMLElement {
  const box = document.createElement("header");
  box.className = "page-head";

  const title = document.createElement("h2");
  title.textContent = demo.title;

  const summary = document.createElement("p");
  summary.textContent = demo.summary;

  box.append(title, summary);
  return box;
}

function renderStub(): void {
  const note = document.createElement("div");
  note.className = "stub";
  note.textContent = "Демо не реализовано.";
  content.append(note);
}

async function route(): Promise<void> {
  const id = window.location.hash.replace(/^#\/?/, "");
  const demo = findDemo(id) ?? DEMOS[1];
  if (id !== demo.id) {
    window.location.hash = `#/${demo.id}`;
    return;
  }

  const mine = (token += 1);
  if (teardown !== null) {
    teardown();
    teardown = null;
  }
  content.replaceChildren(header(demo));
  nav.setActive(demo.id);

  if (demo.mount === null) {
    renderStub();
    return;
  }

  const dispose = await demo.mount(content);
  if (mine !== token) {
    dispose();
    return;
  }
  teardown = dispose;
}

window.addEventListener("hashchange", () => {
  void route();
});

void route();
