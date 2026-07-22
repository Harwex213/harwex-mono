const POPUP_TTL = 0.8

/** Floating text at a world position (coin gains, damage numbers). */
export function addPopup(s, x, y, text, color) {
  s.effects.push({ x, y, text, color, ttl: POPUP_TTL })
}

export function tickEffects(s, dt) {
  for (const fx of s.effects) {
    fx.ttl -= dt
  }
  s.effects = s.effects.filter((fx) => fx.ttl > 0)
}
