---
name: verify
description: Build/launch/drive recipe for verifying changes to the faenwald battle prototype in a real browser.
---

# Verifying faenwald-battle-prototype

No build step — plain ES modules served statically.

## Launch

```bash
cd javascript/packages/prototypes/faenwald/faenwald-battle-prototype
yarn :static   # http-server on a random free port; port is printed in "Available on:"
```

Run it in the background and read the output file for the port (e.g. `http://127.0.0.1:8081`).

## Drive

Use the claude-in-chrome tools; the app is a hash-routed SPA:

- `#/maps` — maps store (tiles with thumbnails, ＋ Add, delete)
- `#/maps/:id` — canvas map editor (left-drag paints, middle/right-drag pans, wheel zooms)
- `#/game`, `#/modifiers` — other sections via top nav

State is in `localStorage` under keys like `hw.faenwald.maps.v2` — inspect with
`javascript_tool` (`JSON.parse(localStorage.getItem("hw.faenwald.maps.v2"))`).
Prototype data is disposable; wiping the key reseeds on next load.

## Gotchas

- The maps-store delete button calls `confirm()` — a blocking dialog that hangs the
  Chrome extension. Do NOT click delete; mutate localStorage instead if cleanup is needed.
- Hash navigation runs page teardown; simulating a killed tab requires
  `location.reload()` via `javascript_tool`.
- A full-page reload is also needed before reading console messages from page load.
