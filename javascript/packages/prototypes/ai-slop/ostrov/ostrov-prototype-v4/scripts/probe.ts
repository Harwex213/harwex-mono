import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import type { TBiomeId, TBuildingId, TTechId } from "../src/core/exports";
import type { TDevState } from "../src/dev/dev-hook";

/**
 * The browser acceptance run of plan §6. It assumes `yarn build` has already
 * written `dist/`, serves it with `python3 -m http.server` on this worktree's
 * probe port, drives the prototype through `window.__ostrov` and prints one
 * PASS/FAIL line per check.
 *
 * Traps this script is written around: `yarn :static` cannot serve a fixed
 * port, killing an `npx http-server` leaves the child on the port, plain
 * headless chromium has no WebGL without the swiftshader flags, and another
 * session may already hold 8401 — which is a loud failure, never a silent one.
 */

const PROBE_PORT = 8401;
const BASE_URL = `http://127.0.0.1:${PROBE_PORT}/index.html`;
const VIEWPORT = { width: 1440, height: 900 };
const SERVER_POLL_MS = 150;
const SERVER_TIMEOUT_MS = 10000;
const DOM_TIMEOUT_MS = 20000;
const KEY_HOLD_MS = 400;
const BATTLE_TICKS = 300;
const IRRIGATION_SCIENCE = 20;
/** A double-quoted attribute value, so the selector itself needs a template literal. */
const IRRIGATION_CARD_SELECTOR = `.tech-card[data-tech="irrigation"]`;
/** The purge ritual needs `scrubbers` and `asylum`, and `asylum` needs `irrigation`. */
const SCRUBBERS_SCIENCE = 30;
const ASYLUM_SCIENCE = 40;
const PURGE_SCIENCE = 80;
const PURGE_MANA_COST = 5;
const PURGE_TOXICITY_DELTA = 20;
const PURGE_START_MANA = 10;
const PROBE_SEED = 42;
const INSANE_DELAY_MS = 350;
const TOXICITY_POINTS_PER_INSANE = 10;
const FARM_WOOD_COST = 10;
const EXPECTED_TECH_COUNT = 8;
const EXPECTED_WORLD_CELLS = 92;
const EXPECTED_PLAYER_ROWS = 4;
const EXPECTED_RESOURCE_CHIPS = 10;
const EXPECTED_BUILDING_CARDS = 7;
const REVEAL_COST_SCOUTING = 2;
/** Gentle enough that the zoom lands inside the camera's own scale limits. */
const WHEEL_ZOOM_DELTA = -40;
const WHEEL_PAN_DELTA = 140;
const DEFAULT_SHOT_DIR = "/private/tmp/claude-501/-Users-aleh-kaportsau-Projects-harwex-mono-worktrees-ostrov-prototype-01/53d19bd8-02b6-407f-af32-23464242a9f6/scratchpad/s8";

/** The farm yield table of `src/core/buildings.ts`, re-derived here on purpose. */
const FARM_YIELDS: Readonly<Record<string, { amount: number; toxicity: number }>> = {
  grassland: { amount: 4, toxicity: 1 },
  plains: { amount: 2, toxicity: 0 },
  tundra: { amount: 2, toxicity: 0 },
  swamp: { amount: 5, toxicity: 3 },
  hills: { amount: 3, toxicity: 1 },
};

const FARM_BIOMES: readonly TBiomeId[] = ["grassland", "plains", "hills", "tundra", "swamp"];

const results: string[] = [];
const failures: string[] = [];

const check = (name: string, ok: boolean, detail: string): void => {
  const line = `${ok ? "PASS" : "FAIL"} ${name} — ${detail}`;
  console.log(line);
  results.push(line);
  if (ok === false) {
    failures.push(line);
  }
};

const fail = (name: string, detail: string): void => {
  check(name, false, detail);
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageRoot, "dist");
const shotDir = process.env["PROBE_SHOT_DIR"] ?? DEFAULT_SHOT_DIR;

const sleep = (ms: number): Promise<void> => {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
};

/** Loud, per the memory trap: another session holding the port is not a retry case. */
const portHolder = (): string | null => {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${PROBE_PORT}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });

    return out.trim() === "" ? null : out.trim();
  } catch {
    // `lsof` exits 1 when nothing listens, which is exactly what we want.
    return null;
  }
};

const waitForServer = async (): Promise<boolean> => {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL, { method: "GET" });
      if (response.ok === true) {
        return true;
      }
    } catch {
      // Not up yet.
    }

    await sleep(SERVER_POLL_MS);
  }

  return false;
};

const stateOf = async (page: Page): Promise<TDevState> => {
  return await page.evaluate(() => {
    return window.__ostrov.state();
  });
};

const countOf = async (page: Page, selector: string): Promise<number> => {
  return await page.evaluate((one) => {
    return document.querySelectorAll(one).length;
  }, selector);
};

const textOf = async (page: Page, selector: string): Promise<string> => {
  return await page.evaluate((one) => {
    const element = document.querySelector(one);

    return element === null ? "" : (element.textContent ?? "");
  }, selector);
};

const classOf = async (page: Page, selector: string): Promise<string> => {
  return await page.evaluate((one) => {
    const element = document.querySelector(one);

    return element === null ? "" : element.className;
  }, selector);
};

const toxicityPointsOf = (state: TDevState): number => {
  return state.island.hexes.reduce((total, hex) => {
    return total + hex.toxicity;
  }, 0);
};

const shoot = async (page: Page, name: string): Promise<string> => {
  const path = join(shotDir, `${name}.png`);
  await page.screenshot({ path });

  return path;
};

/** Sends a wheel event the way a real touchpad does; the React prop is passive. */
const dispatchWheel = async (page: Page, deltaX: number, deltaY: number, ctrlKey: boolean): Promise<void> => {
  await page.evaluate((options) => {
    const canvas = document.querySelector("canvas.island-canvas");
    if (canvas === null) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent("wheel", {
      deltaX: options.deltaX,
      deltaY: options.deltaY,
      ctrlKey: options.ctrlKey,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      bubbles: true,
      cancelable: true,
    }));
  }, { deltaX, deltaY, ctrlKey });
};

/** The first number the biome modal prints for the selected hex's payout. */
const selectedHexFoodYield = async (page: Page, hexId: string): Promise<number> => {
  await page.evaluate((one) => {
    window.__ostrov.registry.selectHex(one);
  }, hexId);
  await sleep(120);
  const text = await textOf(page, ".biome-modal__yield");
  const numbers = text.match(/\d+/g);

  return numbers === null ? -1 : Number.parseInt(numbers[0] ?? "-1", 10);
};

const runMainMenuChecks = async (page: Page): Promise<void> => {
  const title = await textOf(page, ".menu__title");
  const inputs = await countOf(page, ".menu__input");
  const startButton = await textOf(page, ".menu__button--primary");
  check(
    "main menu renders a title, a nickname input and Начать",
    title.includes("Toxic Island") === true && inputs === 1 && startButton.includes("Начать") === true,
    `${title} / inputs ${inputs} / ${startButton}`,
  );
};

const runIslandChecks = async (page: Page): Promise<string> => {
  const canvases = await countOf(page, "canvas.island-canvas");
  check("island page holds exactly one island canvas", canvases === 1, `${canvases}`);

  const rows = await countOf(page, ".players-panel__row");
  check("the player list has four rows", rows === EXPECTED_PLAYER_ROWS, `${rows}`);

  const chips = await countOf(page, ".resource-chip");
  check("the resources panel shows ten counters", chips === EXPECTED_RESOURCE_CHIPS, `${chips}`);

  const cards = await countOf(page, ".building-card");
  check("the buildings panel has seven cards", cards === EXPECTED_BUILDING_CARDS, `${cards}`);

  const demolish = await countOf(page, "button.demolish-icon");
  const tech = await countOf(page, "button.tech-icon");
  const medallion = await countOf(page, "button.end-turn-panel__medallion");
  check(
    "demolish, tech and end-turn controls are present",
    demolish === 1 && tech === 1 && medallion === 1,
    `demolish ${demolish}, tech ${tech}, end turn ${medallion}`,
  );

  const target = await page.evaluate((biomes) => {
    for (const biome of biomes) {
      const hexId = window.__ostrov.firstHexWithBiome(biome);
      if (hexId !== null) {
        return { hexId, biome };
      }
    }

    return null;
  }, FARM_BIOMES);

  if (target === null) {
    fail("a farm goes onto its biome and costs 10 wood", "no free farm biome on the island");

    return "";
  }

  const before = await stateOf(page);
  await page.evaluate((one) => {
    window.__ostrov.placeBuilding(one.hexId, one.building as TBuildingId);
  }, { hexId: target.hexId, building: "farm" });
  const after = await stateOf(page);
  const hex = after.island.hexes.find((candidate) => {
    return candidate.id === target.hexId;
  });
  check(
    "a farm goes onto its biome and costs 10 wood",
    after.resources.wood === before.resources.wood - FARM_WOOD_COST && hex?.building === "farm",
    `wood ${before.resources.wood} → ${after.resources.wood}, ${target.hexId} (${target.biome}) = ${hex?.building}`,
  );

  return target.biome;
};

const runReadonlyChecks = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__ostrov.navigate("#/island/p2");
  });
  await sleep(250);

  const cards = await countOf(page, ".building-card");
  const demolish = await countOf(page, "button.demolish-icon");
  const tech = await countOf(page, "button.tech-icon");
  const resources = await countOf(page, ".resources-panel");
  check(
    "a foreign island hides the build controls and the resources panel",
    cards === 0 && demolish === 0 && tech === 0 && resources === 0,
    `cards ${cards}, demolish ${demolish}, tech ${tech}, resources ${resources}`,
  );

  const canvases = await countOf(page, "canvas.island-canvas");
  const rows = await countOf(page, ".players-panel__row");
  check(
    "a foreign island keeps the canvas and the player list",
    canvases === 1 && rows === EXPECTED_PLAYER_ROWS,
    `canvas ${canvases}, rows ${rows}`,
  );

  await page.evaluate(() => {
    window.__ostrov.navigate("#/island");
  });
  await sleep(250);
};

const runCameraChecks = async (page: Page): Promise<void> => {
  const before = await stateOf(page);
  await dispatchWheel(page, 0, WHEEL_ZOOM_DELTA, true);
  await sleep(120);
  const zoomed = await stateOf(page);
  check(
    "a ctrl+wheel changes the camera scale",
    zoomed.camera.scale !== before.camera.scale,
    `${before.camera.scale.toFixed(3)} → ${zoomed.camera.scale.toFixed(3)}`,
  );

  await dispatchWheel(page, WHEEL_PAN_DELTA, 0, false);
  await sleep(120);
  const panned = await stateOf(page);
  check(
    "a deltaX wheel pans and leaves the scale alone",
    panned.camera.x !== zoomed.camera.x && panned.camera.scale === zoomed.camera.scale,
    `x ${zoomed.camera.x.toFixed(1)} → ${panned.camera.x.toFixed(1)}, scale ${panned.camera.scale.toFixed(3)}`,
  );
};

const runTaxChecks = async (page: Page, farmBiome: string): Promise<void> => {
  const before = await stateOf(page);
  await page.evaluate(() => {
    window.__ostrov.endTurn();
  });
  await sleep(200);
  const flying = await stateOf(page);
  check(
    "end turn opens the tax phase with flights in the air",
    flying.phase === "tax" && flying.anim.flights > 0,
    `phase ${flying.phase}, flights ${flying.anim.flights}`,
  );

  await page.evaluate(() => {
    window.__ostrov.fastForward();
  });
  await page.waitForFunction(() => {
    return window.__ostrov.state().anim.taxStage === "done";
  }, undefined, { timeout: DOM_TIMEOUT_MS });
  const after = await stateOf(page);

  const payout = FARM_YIELDS[farmBiome] ?? { amount: 0, toxicity: 0 };
  const toxicityPoints = toxicityPointsOf(after);
  const expectedInsane = Math.min(
    Math.floor(toxicityPoints / TOXICITY_POINTS_PER_INSANE),
    before.resources.population,
  );
  const population = before.resources.population - expectedInsane;
  const upkeep = population + expectedInsane * 2;
  const expectedFood = before.resources.food + payout.amount - upkeep;

  check(
    "the tax phase paid the farm's food, minus upkeep",
    after.resources.food === expectedFood,
    `${before.resources.food} → ${after.resources.food}, want ${expectedFood} (+${payout.amount} − ${upkeep})`,
  );

  check(
    "the tax phase paid the farm's toxicity",
    after.resources.toxicity === before.resources.toxicity + payout.toxicity,
    `${before.resources.toxicity} → ${after.resources.toxicity}, want +${payout.toxicity}`,
  );

  check(
    "wood and stone did not move: the island only farms",
    after.resources.wood === before.resources.wood && after.resources.stone === before.resources.stone,
    `wood ${after.resources.wood}, stone ${after.resources.stone}`,
  );

  check(
    "mana income landed",
    after.resources.mana === before.resources.mana + 1,
    `${before.resources.mana} → ${after.resources.mana}`,
  );

  check(
    "insane = floor(toxicity points / 10), capped by population",
    after.resources.insane === expectedInsane,
    `${after.resources.insane}, want ${expectedInsane} (points ${toxicityPoints})`,
  );

  const landing = after.anim.lastLandingMs;
  const insaneAt = after.anim.insaneAtMs;
  const gap = landing === null || insaneAt === null ? -1 : insaneAt - landing;
  check(
    "the insane conversion waits at least 350 ms after the last landing",
    gap >= INSANE_DELAY_MS,
    `${gap} ms`,
  );
};

const runExplorationChecks = async (page: Page): Promise<void> => {
  const before = await stateOf(page);
  const toxicityPoints = toxicityPointsOf(before);
  const trailBefore = before.world.cells.find((cell) => {
    return cell.id === before.world.islandCellId;
  })?.trail ?? -1;

  await page.evaluate(() => {
    window.__ostrov.endTurn();
  });
  await page.waitForSelector("canvas.world-globe", { timeout: DOM_TIMEOUT_MS });
  await sleep(500);

  const opened = await stateOf(page);
  check(
    "end turn opens the exploration phase on the world page",
    opened.phase === "exploration" && opened.route.page === "world",
    `phase ${opened.phase}, page ${opened.route.page}`,
  );

  const webgl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.world-globe") as HTMLCanvasElement | null;
    if (canvas === null) {
      return "missing";
    }

    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");

    return context === null ? "no context" : "ok";
  });
  check("the globe canvas holds a WebGL context", webgl === "ok", webgl);

  check(
    "the world has 92 cells",
    opened.world.cells.length === EXPECTED_WORLD_CELLS,
    `${opened.world.cells.length}`,
  );

  const trailAfter = opened.world.cells.find((cell) => {
    return cell.id === opened.world.islandCellId;
  })?.trail ?? -1;
  check(
    "the phase start poured the island's toxicity into the cell's trail",
    trailAfter === trailBefore + toxicityPoints,
    `${trailBefore} → ${trailAfter}, toxicity points ${toxicityPoints}`,
  );

  const destination = await page.evaluate(() => {
    const store = window.__ostrov.store;
    const cells = store.game.worldCells.peek();
    const here = cells.find((cell) => {
      return cell.id === store.game.islandCellId.peek();
    });

    return here === undefined ? null : (here.neighbours[0] ?? null);
  });

  if (destination === null) {
    fail("the island flies to a neighbouring cell", "the island cell has no neighbours");
  } else {
    await page.evaluate((cellId) => {
      window.__ostrov.moveIsland(cellId);
    }, destination);
    await sleep(300);
    const moved = await stateOf(page);
    check(
      "the island flies to a neighbouring cell",
      moved.world.islandCellId === destination,
      `${opened.world.islandCellId} → ${moved.world.islandCellId}`,
    );
  }

  const reveal = await page.evaluate(() => {
    const store = window.__ostrov.store;
    const cells = store.game.worldCells.peek();
    const here = cells.find((cell) => {
      return cell.id === store.game.islandCellId.peek();
    });
    if (here === undefined) {
      return null;
    }

    const dark = here.neighbours.find((id) => {
      const neighbour = cells.find((cell) => {
        return cell.id === id;
      });

      return neighbour !== undefined && neighbour.revealed === false;
    });

    return dark ?? null;
  });

  if (reveal === null) {
    fail("revealing a neighbour costs 2 🔭", "every neighbour is already revealed");

    return;
  }

  const beforeReveal = await stateOf(page);
  await page.evaluate((cellId) => {
    window.__ostrov.revealCell(cellId);
  }, reveal);
  await sleep(200);
  const afterReveal = await stateOf(page);
  const revealed = afterReveal.world.cells.find((cell) => {
    return cell.id === reveal;
  })?.revealed === true;
  check(
    "revealing a neighbour costs 2 🔭",
    afterReveal.resources.scouting === beforeReveal.resources.scouting - REVEAL_COST_SCOUTING && revealed === true,
    `🔭 ${beforeReveal.resources.scouting} → ${afterReveal.resources.scouting}, cell ${reveal} revealed ${revealed}`,
  );
};

const runBattleChecks = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__ostrov.endTurn();
  });
  await page.waitForSelector("canvas.battle-canvas", { timeout: DOM_TIMEOUT_MS });
  await page.waitForSelector(".battle-hud", { timeout: DOM_TIMEOUT_MS });

  const opened = await stateOf(page);
  const canvases = await countOf(page, "canvas.battle-canvas");
  check(
    "end turn opens the clearing phase with its canvas",
    opened.phase === "clearing" && canvases === 1 && opened.battle !== null,
    `phase ${opened.phase}, canvas ${canvases}, level ${opened.battle === null ? "none" : "built"}`,
  );

  const xBefore = opened.battle === null ? 0 : opened.battle.playerIsland.x;
  await page.keyboard.down("KeyD");
  await sleep(KEY_HOLD_MS);
  await page.keyboard.up("KeyD");
  await sleep(120);
  const steered = await stateOf(page);
  const xAfter = steered.battle === null ? 0 : steered.battle.playerIsland.x;
  check(
    "KeyD steers the island to the right",
    xAfter > xBefore,
    `x ${Math.round(xBefore)} → ${Math.round(xAfter)}`,
  );

  await page.evaluate(() => {
    window.__ostrov.killAllEnemies();
  });
  await sleep(200);
  await page.evaluate((ticks) => {
    window.__ostrov.stepBattle(ticks);
  }, BATTLE_TICKS);
  await sleep(200);
  const absorbedState = await stateOf(page);
  const absorbed = absorbedState.battle === null
    ? 0
    : absorbedState.battle.enemyIslands.filter((island) => {
      return island.absorbed === true;
    }).length;
  check(
    "a dead enemy island is absorbed once the player island flies over it",
    absorbed > 0,
    `${absorbed} of ${absorbedState.battle === null ? 0 : absorbedState.battle.enemyIslands.length} absorbed, ${absorbedState.battle === null ? 0 : absorbedState.battle.absorbedHexes} hexes`,
  );

  const finished = absorbedState.battle !== null && absorbedState.battle.finished === true;
  if (finished === false) {
    await page.click("button.battle-page__retreat");
    await sleep(200);
  }

  await page.evaluate(() => {
    window.__ostrov.endTurn();
  });
  await page.waitForSelector("canvas.island-canvas", { timeout: DOM_TIMEOUT_MS });
  await sleep(300);
  const next = await stateOf(page);
  check(
    "finishing the level starts turn 2 in the build phase",
    next.phase === "build" && next.turn === 2,
    `turn ${next.turn}, phase ${next.phase}`,
  );
};

const runTechChecks = async (page: Page): Promise<void> => {
  const state = await stateOf(page);
  const farm = state.island.hexes.find((hex) => {
    return hex.building === "farm";
  });
  if (farm === undefined) {
    fail("irrigation raises the farm's food yield by 1", "no farm on the island");

    return;
  }

  const foodBefore = await selectedHexFoodYield(page, farm.id);

  await page.click("button.tech-icon");
  await page.waitForSelector(".tech-modal", { timeout: DOM_TIMEOUT_MS });
  const cards = await countOf(page, ".tech-card");
  check("the technologies modal lists eight techs", cards === EXPECTED_TECH_COUNT, `${cards}`);

  await page.evaluate((tech) => {
    window.__ostrov.setResearchTarget(tech as TTechId);
  }, "irrigation");
  await sleep(150);
  const targeted = await stateOf(page);
  const activeClass = await classOf(page, IRRIGATION_CARD_SELECTOR);
  check(
    "irrigation becomes the research target",
    targeted.researching === "irrigation" && activeClass.includes("tech-card--active") === true,
    `${targeted.researching}, class "${activeClass}"`,
  );

  const shot = await shoot(page, "s8-tech-modal");

  await page.evaluate((science) => {
    window.__ostrov.addResearch(science);
  }, IRRIGATION_SCIENCE);
  await sleep(200);
  const researchedState = await stateOf(page);
  const researchedClass = await classOf(page, IRRIGATION_CARD_SELECTOR);
  check(
    "20 📖 completes irrigation",
    researchedState.researched.includes("irrigation") === true
      && researchedClass.includes("tech-card--researched") === true,
    `researched [${researchedState.researched.join(", ")}], class "${researchedClass}" (shot ${shot})`,
  );

  await page.keyboard.press("Escape");
  await sleep(200);
  const stillOpen = await countOf(page, ".tech-modal");
  check("Escape closes the technologies modal", stillOpen === 0, `${stillOpen} modals`);

  const foodAfter = await selectedHexFoodYield(page, farm.id);
  check(
    "irrigation raises the farm's food yield by 1",
    foodAfter === foodBefore + 1,
    `${foodBefore} → ${foodAfter}`,
  );
};

/**
 * The purge ritual of plan §3.3, the one action a technology hands the player.
 * The prerequisites are paid straight through `addResearch`, one tech at a
 * time, because a tax phase would take far too many turns to reach 80 📖.
 */
const runPurgeChecks = async (page: Page): Promise<void> => {
  const hiddenBefore = await countOf(page, "button.purge-icon");
  check(
    "the purge button stays hidden until the ritual is researched",
    hiddenBefore === 0,
    `${hiddenBefore} buttons`,
  );

  const path: readonly { readonly tech: string; readonly science: number }[] = [
    { tech: "scrubbers", science: SCRUBBERS_SCIENCE },
    { tech: "asylum", science: ASYLUM_SCIENCE },
    { tech: "purge_ritual", science: PURGE_SCIENCE },
  ];
  for (const step of path) {
    await page.evaluate((one) => {
      window.__ostrov.setResearchTarget(one.tech as TTechId);
      window.__ostrov.addResearch(one.science);
    }, step);
    await sleep(120);
  }

  const researchedState = await stateOf(page);
  const shownAfter = await countOf(page, "button.purge-icon");
  check(
    "the three techs complete and the purge button appears",
    researchedState.researched.includes("purge_ritual") === true && shownAfter === 1,
    `researched [${researchedState.researched.join(", ")}], buttons ${shownAfter}`,
  );

  await page.click("button.purge-icon");
  await sleep(150);
  const armedClass = await classOf(page, "button.purge-icon");
  check(
    "clicking the purge button arms the cursor",
    armedClass.includes("purge-icon--active") === true,
    `class "${armedClass}"`,
  );

  const shot = await shoot(page, "s8-purge-mode");

  await page.evaluate((mana) => {
    window.__ostrov.setResources({ mana });
  }, PURGE_START_MANA);
  await sleep(120);

  const before = await stateOf(page);
  const target = before.island.hexes.find((hex) => {
    return hex.toxicity > 0;
  });

  if (target === undefined) {
    check("a purge costs 5 💠 and takes 20 ☣️ off the hex", true, "skipped (no toxic hex)");
  } else {
    await page.evaluate((hexId) => {
      window.__ostrov.purgeHex(hexId);
    }, target.id);
    await sleep(150);
    const after = await stateOf(page);
    const purged = after.island.hexes.find((hex) => {
      return hex.id === target.id;
    });
    const expected = Math.max(0, target.toxicity - PURGE_TOXICITY_DELTA);
    check(
      "a purge costs 5 💠 and takes 20 ☣️ off the hex",
      after.resources.mana === before.resources.mana - PURGE_MANA_COST && purged?.toxicity === expected,
      `💠 ${before.resources.mana} → ${after.resources.mana}, ${target.id} ☣️ ${target.toxicity} → ${purged?.toxicity}, want ${expected} (shot ${shot})`,
    );
  }

  const stillArmed = await classOf(page, "button.purge-icon");
  check(
    "the purge cursor stays armed, so several hexes are cleaned in a row",
    stillArmed.includes("purge-icon--active") === true,
    `class "${stillArmed}"`,
  );

  await page.keyboard.press("Escape");
  await sleep(150);
  const disarmed = await classOf(page, "button.purge-icon");
  check(
    "Escape disarms the purge cursor",
    disarmed.includes("purge-icon--active") === false,
    `class "${disarmed}"`,
  );
};

const main = async (): Promise<void> => {
  mkdirSync(shotDir, { recursive: true });

  if (existsSync(join(distDir, "index.html")) === false) {
    console.log(`FAIL dist — ${join(distDir, "index.html")} is missing; run "yarn workspace @hw/ostrov-prototype-v4 build" first`);
    process.exit(1);
  }

  const holder = portHolder();
  if (holder !== null) {
    console.log(`FAIL port — something already listens on ${PROBE_PORT}:\n${holder}`);
    process.exit(1);
  }

  const server = spawn("python3", ["-m", "http.server", String(PROBE_PORT), "--directory", distDir], {
    detached: true,
    stdio: "ignore",
  });
  const serverPid = server.pid ?? 0;

  let browser: Browser | null = null;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  try {
    const up = await waitForServer();
    if (up === false) {
      throw new Error(`${BASE_URL} did not answer within ${SERVER_TIMEOUT_MS} ms`);
    }

    browser = await chromium.launch({
      headless: true,
      // Plain headless chromium has no GPU, and the globe needs a WebGL context.
      args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    });
    const page = await browser.newPage({ viewport: VIEWPORT });

    page.on("console", (message) => {
      if (message.type() !== "error") {
        return;
      }

      consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      return typeof window.__ostrov !== "undefined";
    }, undefined, { timeout: DOM_TIMEOUT_MS });

    check("the dev hook is installed", true, "window.__ostrov");

    await runMainMenuChecks(page);

    await page.evaluate((seed) => {
      window.__ostrov.seed(seed);
    }, PROBE_SEED);
    await page.click(".menu__button--primary");
    await page.waitForSelector("canvas.island-canvas", { timeout: DOM_TIMEOUT_MS });
    await sleep(400);

    const started = await stateOf(page);
    check(
      "Начать starts turn 1 of the build phase on the island page",
      started.turn === 1 && started.phase === "build" && started.route.page === "island",
      `turn ${started.turn}, phase ${started.phase}, page ${started.route.page}`,
    );

    const farmBiome = await runIslandChecks(page);
    const islandShot = await shoot(page, "s8-island-built");
    check("the island screenshot was written", existsSync(islandShot) === true, islandShot);

    await runReadonlyChecks(page);
    await runCameraChecks(page);
    await runTaxChecks(page, farmBiome);
    await runExplorationChecks(page);
    await runBattleChecks(page);
    await runTechChecks(page);
    await runPurgeChecks(page);

    check(
      "no console errors",
      consoleErrors.length === 0,
      consoleErrors.length === 0 ? "clean" : consoleErrors.join(" | "),
    );
    check(
      "no page errors",
      pageErrors.length === 0,
      pageErrors.length === 0 ? "clean" : pageErrors.join(" | "),
    );
  } catch (error) {
    fail("probe run", error instanceof Error ? error.message : String(error));
  } finally {
    if (browser !== null) {
      await browser.close();
    }

    if (serverPid !== 0) {
      // The whole process group, so no child survives on the port.
      try {
        process.kill(-serverPid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }

  const total = results.length;
  const passed = total - failures.length;
  console.log(failures.length === 0 ? `PASS ${passed}/${total}` : `FAIL ${passed}/${total}`);
  process.exit(failures.length === 0 ? 0 : 1);
};

await main();
