import { RADIUS, worldToCell } from "../game/hex.js"
import { draw } from "../game/render.js"
import { clickAt } from "../game/sim.js"

export const SQRT3 = Math.sqrt(3)
// world-unit extents of a radius-N pointy-top hex board
export const BOARD_W = SQRT3 * (2 * RADIUS + 1)
export const BOARD_H = 3 * RADIUS + 2

/** Center panel: DPR-aware canvas, pointer input → sim actions, game-over overlay. */
export function createGameCanvas({ store, onRestart }) {
  const el = document.createElement("main")
  el.className = "game-canvas"
  el.innerHTML = `
    <canvas></canvas>
    <div class="game-over" hidden>
      <p>🏰 The keep fell on day <b data-day></b></p>
      <button type="button" data-restart>Restart</button>
    </div>
  `
  const canvas = el.querySelector("canvas")
  const ctx = canvas.getContext("2d")
  const overlay = el.querySelector(".game-over")

  let view = { size: 24, ox: 0, oy: 0, w: 0, h: 0 }
  let hover = null

  function resize() {
    const dpr = window.devicePixelRatio || 1
    const w = el.clientWidth
    const h = el.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const size = Math.min(w / BOARD_W, h / BOARD_H) * 0.95
    view = { size, ox: w / 2, oy: h / 2, w, h }
  }
  new ResizeObserver(resize).observe(el)

  const toWorld = (ev) => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: (ev.clientX - rect.left - view.ox) / view.size,
      y: (ev.clientY - rect.top - view.oy) / view.size,
    }
  }

  canvas.addEventListener("pointermove", (ev) => {
    const p = toWorld(ev)
    hover = worldToCell(p.x, p.y)
  })
  canvas.addEventListener("pointerleave", () => {
    hover = null
  })
  canvas.addEventListener("click", (ev) => {
    const p = toWorld(ev)
    store.set((s) => clickAt(s, p, worldToCell(p.x, p.y)))
  })
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      store.set((s) => {
        s.selected = null
      })
    }
  })

  el.querySelector("[data-restart]").addEventListener("click", onRestart)

  const unsub = store.subscribe((s) => {
    overlay.hidden = !s.gameOver
    if (s.gameOver) {
      overlay.querySelector("[data-day]").textContent = s.day
    }
    el.classList.toggle("is-placing", Boolean(s.selected))
  })

  return {
    el,
    /** Called every animation frame by the loop. */
    render() {
      draw(ctx, store.get(), view, hover)
    },
    destroy: unsub,
  }
}
