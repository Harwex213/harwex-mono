# `@hw/ostrov-prototype-v4` — traps

- **Register the wheel listener natively with `passive: false`.** The React `onWheel` prop is passive, so
  `preventDefault()` fails silently and the page scrolls instead of zooming.
- **Zoom touches the camera and nothing else.** `zoomAt` and `clampCamera` change `ui.camera`; the island data
  and the canvas buffer stay as they are, and the point under the cursor must not move.
- **Hex layout math lives in `src/core/hex.ts` only.** A renderer that needs a corner calls `hexCorners`; it
  never derives its own formula.
- **Every page and every canvas returns a teardown and uses it.** Cancel the RAF handle, remove the listeners,
  disconnect the `ResizeObserver`, dispose every three.js geometry, material, texture and the renderer. A
  forgotten teardown leaves a second render loop over the first.
- **Write exact dependency versions, never `^`,** and spell out `workspace:*`. `.yarnrc.yml` sets
  `defaultSemverRangePrefix: ""` and `enableTransparentWorkspaces: false`.
- **Keep `devServer.port: 0`.** A fixed dev port lets a forgotten server from an earlier run answer with a stale
  bundle. Port 8401 is a different thing: it is the probe's own `python3 -m http.server`.
- **The probe serves `dist/` with python and checks the listener first.** `lsof -nP -iTCP:8401 -sTCP:LISTEN`
  must be empty, and the server dies by process group (`process.kill(-pid)`). `yarn :static` cannot take a fixed
  port, and killing an `npx http-server` leaves its child on the port.
- **Playwright stays at 1.61.1 and launches chromium.** Only `chromium-1228` is installed. Headless chromium has
  no WebGL without `--use-gl=swiftshader --enable-unsafe-swiftshader`, and the globe needs it.
- **`yarn probe` never builds.** Run `yarn build` first; the probe fails loudly when `dist/index.html` is missing.
- **Building art is Pillow-encoded webp.** `cwebp` is absent and `sips` cannot write webp. The source PNGs are
  opaque with a checkerboard background baked in, which is flood-filled away from the border before encoding.
- **A landing toxicity glyph poisons its own hex** (`tickTax`), not just the ☣️ counter. Without that, hex
  toxicity never grows from normal play and both the output-decay rule and the insane conversion stay inert.
- **`stepBattleTicks` needs an input.** Called without one it replays the last input the canvas sent, which is
  all-false in a probe, and then the island never flies over an enemy island and nothing is absorbed.
- **The battle RAF loop stops at `battle.finished`.** An island whose defenders are dead can only be absorbed
  while another island still has live enemies; drive the rest through `stepBattleTicks`.
- **Actions read with `.peek()` and write with `.value =`;** components call `useSignals()` first and read
  `.value`. Signal contents are immutable and get replaced whole.
- **`src/core/exports.ts` is the only door into the core.** Nothing above it imports a core module directly.
- **A named function inside `page.evaluate` throws `__name is not defined`.** `tsx` compiles with esbuild's
  `keepNames`, which rewrites `const one = () => {}` into a call to an injected `__name` helper that never
  reaches the browser. Inline the helper, or hoist it out of the evaluated callback.
