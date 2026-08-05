import assert from "node:assert/strict";
import test from "node:test";
import { PANEL_DOM_ID, closePanel, openPanel, openPanelId, togglePanel } from "./panel-store";
import { STATE_KEY, createMemoryStorage } from "./persistence";
import { addCountry, flushState, initWorldStore } from "./world-store";
import type { PanelId } from "./panel-store";

test("no panel is open until one is asked for", () => {
  closePanel();
  assert.equal(openPanelId.value, null);
});

test("openPanel opens, closePanel closes, and both are idempotent", () => {
  closePanel();

  openPanel("country");
  assert.equal(openPanelId.value, "country");
  openPanel("country");
  assert.equal(openPanelId.value, "country", "opening the open panel is a no-op");

  closePanel();
  assert.equal(openPanelId.value, null);
  closePanel();
  assert.equal(openPanelId.value, null, "closing nothing is a no-op");
});

test("openPanel on a second id switches: one panel at a time", () => {
  closePanel();

  openPanel("provinces");
  openPanel("economics");
  assert.equal(openPanelId.value, "economics", "the three share one dock");
});

test("togglePanel closes the same id and switches to a different one", () => {
  closePanel();

  togglePanel("country");
  assert.equal(openPanelId.value, "country");

  togglePanel("country");
  assert.equal(openPanelId.value, null, "the same button closes what it opened");

  togglePanel("provinces");
  togglePanel("economics");
  assert.equal(openPanelId.value, "economics", "a different button switches, not closes");

  closePanel();
});

// --- T08 regressions ------------------------------------------------------

test("togglePanel from nothing open opens", () => {
  closePanel();

  togglePanel("economics");
  assert.equal(openPanelId.value, "economics");

  closePanel();
});

test("all three panel ids are reachable, and only those three", () => {
  // The bar has three buttons and the dock holds one panel at a time. A fourth
  // id would need a fourth button, so the list is pinned here.
  const ids: readonly PanelId[] = ["country", "provinces", "economics"];
  assert.equal(ids.length, 3);

  for (const id of ids) {
    openPanel(id);
    assert.equal(openPanelId.value, id);
  }

  closePanel();
});

test("PANEL_DOM_ID is the single id the bar buttons point aria-controls at", () => {
  // One panel is mounted at a time, so one DOM id. A change here breaks the
  // `aria-controls` target on the open button.
  assert.equal(PANEL_DOM_ID, "civ-panel");
});

test("the open panel is session state and never reaches civitas.state.v1", () => {
  // DESIGN §12: T08 adds no key, no field and no migration. The persisted
  // document still has exactly the five keys T05 wrote.
  const storage = createMemoryStorage();
  initWorldStore({ storage });
  openPanel("economics");
  addCountry("A");
  flushState();

  const raw = storage.getItem(STATE_KEY);
  assert.ok(raw !== null, "the country write landed");
  const doc = JSON.parse(raw) as Record<string, unknown>;
  assert.deepEqual(Object.keys(doc).sort(), [
    "countries",
    "economics",
    "nextCountryId",
    "provinceOverrides",
    "version",
  ]);

  closePanel();
});
