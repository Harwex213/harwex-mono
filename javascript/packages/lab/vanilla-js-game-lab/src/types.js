/**
 * @typedef {{ q: number, r: number }} Cell Axial hex coordinate.
 *
 * @typedef {Object} Enemy
 * @property {number} id
 * @property {string} type Key into ENEMIES registry.
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} coins Reward on kill.
 * @property {number} dmg Damage dealt to the base on arrival.
 * @property {number} speed Cells per second.
 * @property {Cell} cell Cell the enemy is leaving.
 * @property {Cell | null} next Cell the enemy is moving toward.
 * @property {number} progress 0..1 between cell and next.
 * @property {boolean} [dead]
 *
 * @typedef {Object} Building
 * @property {string} type Key into BUILDINGS registry.
 * @property {number} [cd] Attack cooldown remaining (towers).
 *
 * @typedef {Object} Projectile
 * @property {number} x World coords (hex size = 1 unit).
 * @property {number} y
 * @property {number} targetId Enemy id.
 * @property {number} damage
 * @property {number} speed World units per second.
 * @property {boolean} [dead]
 *
 * @typedef {Object} Popup Floating text effect.
 * @property {number} x
 * @property {number} y
 * @property {string} text
 * @property {string} color
 * @property {number} ttl Seconds remaining.
 *
 * @typedef {Object} GameState Pure JSON-serializable game state.
 * @property {number} time Total sim seconds.
 * @property {number} day 1-based day counter.
 * @property {"day" | "night"} phase
 * @property {number} coins Fractional; display floored.
 * @property {number} baseHp
 * @property {number} baseMaxHp
 * @property {Object<string, Building>} buildings Keyed by "q,r".
 * @property {Object<string, number>} counts Owned count per building type.
 * @property {Enemy[]} enemies
 * @property {Projectile[]} projectiles
 * @property {Popup[]} effects
 * @property {Object<string, number>} flow BFS distance-to-base per cell key; derived, recomputed on build/sell.
 * @property {string | null} selected Armed building type from the build menu.
 * @property {number} spawnAcc Fractional spawn accumulator.
 * @property {number} nextId
 * @property {boolean} gameOver
 */

export {}
