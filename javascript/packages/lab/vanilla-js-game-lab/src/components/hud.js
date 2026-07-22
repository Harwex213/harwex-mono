import { CYCLE } from "../game/sim.js"

/** Top bar: coins, day + cycle progress, base HP. */
export function createHud({ store }) {
  const el = document.createElement("header")
  el.className = "hud"
  el.innerHTML = `
    <span class="hud-coins">💰 <b data-coins></b></span>
    <span class="hud-day">
      <span data-phase></span> Day <b data-day></b>
      <span class="hud-cycle"><span class="hud-cycle-fill" data-cycle></span></span>
    </span>
    <span class="hud-hp">❤️ <b data-hp></b></span>
  `
  const coins = el.querySelector("[data-coins]")
  const day = el.querySelector("[data-day]")
  const phase = el.querySelector("[data-phase]")
  const cycle = el.querySelector("[data-cycle]")
  const hp = el.querySelector("[data-hp]")

  const unsub = store.subscribe((s) => {
    coins.textContent = Math.floor(s.coins).toLocaleString()
    day.textContent = s.day
    phase.textContent = s.phase === "day" ? "☀️" : "🌙"
    cycle.style.width = `${((s.time % CYCLE) / CYCLE) * 100}%`
    hp.textContent = `${Math.ceil(s.baseHp)}/${s.baseMaxHp}`
  })

  return { el, destroy: unsub }
}
