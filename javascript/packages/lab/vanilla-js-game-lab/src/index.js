import { createStore } from "./store.js"
import { createInitialState, tickSim } from "./game/sim.js"
import { createLoop } from "./game/loop.js"
import { createHud } from "./components/hud.js"
import { createBuildMenu } from "./components/build-menu.js"
import { createGameCanvas } from "./components/game-canvas.js"

const store = createStore(createInitialState())

const hud = createHud({ store })
const menu = createBuildMenu({ store })
const canvas = createGameCanvas({
  store,
  onRestart: () => store.set(() => createInitialState()),
})

document.querySelector("#app").append(hud.el, menu.el, canvas.el)

createLoop({
  tickRate: 60,
  tick: (dt) => store.set((s) => tickSim(s, dt)),
  render: canvas.render,
}).start()
