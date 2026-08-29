import { World, generateWorld } from "../exports";
import { offsetToAxial, rangeSize } from "../src/core/hex/offset";
import { hexDistance } from "@hw/ostrov-utils";

let failures = 0;

const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const seeds = ["МИР", "ALPHA", "42", "z", "ОСТРОВ-2", "qwerty", "seed-7", "long seed text here"];

for (const seedText of seeds) {
  const world = generateWorld({ seedText });

  // 1. separation: no two tiles of different islands may be neighbours or closer than 2 steps
  let minCross = Infinity;
  let worst = "";
  for (let a = 0; a < world.islands.length; a += 1) {
    for (let b = a + 1; b < world.islands.length; b += 1) {
      for (const ta of world.islands[a]!.tiles) {
        for (const tb of world.islands[b]!.tiles) {
          const d = hexDistance({ q: ta.q, r: ta.r }, { q: tb.q, r: tb.r });
          if (d < minCross) {
            minCross = d;
            worst = `${world.islands[a]!.id}(${ta.x},${ta.y}) vs ${world.islands[b]!.id}(${tb.x},${tb.y})`;
          }
        }
      }
    }
  }
  check(`[${seedText}] separation >= 2`, minCross >= 2, `min=${minCross} ${worst}`);

  // 2. every land tile sits inside the configured rectangle
  const inside = world.tiles.every(
    (t) => t.x >= world.xRange.min && t.x <= world.xRange.max && t.y >= world.yRange.min && t.y <= world.yRange.max
  );
  check(`[${seedText}] all tiles in range`, inside);

  // 3. offset <-> axial round trip on every tile
  const roundTrip = world.tiles.every((t) => {
    const a = offsetToAxial({ x: t.x, y: t.y });
    return a.q === t.q && a.r === t.r;
  });
  check(`[${seedText}] offset/axial round trip`, roundTrip);

  // 4. no two islands share a cell, no duplicate keys
  const keys = new Set(world.tiles.map((t) => t.key));
  check(`[${seedText}] no overlapping tiles`, keys.size === world.tiles.length, `${keys.size}/${world.tiles.length}`);

  // 5. tile counts respect the configured min/max
  const sizesOk = world.islands.every(
    (i) => i.tileCount >= World.DEFAULT_CONFIG.islandTiles.min && i.tileCount <= World.DEFAULT_CONFIG.islandTiles.max
  );
  check(`[${seedText}] island sizes in range`, sizesOk, world.islands.map((i) => i.tileCount).join(","));

  // 6. every island is one connected landmass
  const connected = world.islands.every((island) => {
    const own = new Set(island.tiles.map((t) => `${t.q},${t.r}`));
    const seen = new Set<string>();
    const first = island.tiles[0]!;
    const queue = [`${first.q},${first.r}`];
    seen.add(queue[0]!);
    while (queue.length > 0) {
      const [q, r] = queue.shift()!.split(",").map(Number) as [number, number];
      for (const d of [[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]]) {
        const k = `${q + d[0]!},${r + d[1]!}`;
        if (own.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push(k);
        }
      }
    }
    return seen.size === own.size;
  });
  check(`[${seedText}] islands are connected`, connected);

  // 7. counts add up
  const summed = Object.values(world.counts).reduce((s, n) => s + n, 0);
  check(`[${seedText}] counts sum to landCount`, summed === world.landCount, `${summed} vs ${world.landCount}`);

  // 8. determinism
  const again = generateWorld({ seedText });
  check(
    `[${seedText}] deterministic`,
    JSON.stringify(again.tiles) === JSON.stringify(world.tiles) && again.islands.length === world.islands.length
  );

  console.log(
    `      placed ${world.islands.length}/${world.requestedCount}, unplaced ${world.unplaced.length}, land ${world.landCount}, grid ${world.width}x${world.height}=${world.cellCount}, cells() ${world.cells().length}`
  );
}

// 9. a deliberately crowded world must report unplaced islands instead of breaking the rule
const tight = generateWorld({
  seedText: "TIGHT",
  xRange: { min: 0, max: 9 },
  yRange: { min: 0, max: 9 },
  islandTiles: { min: 10, max: 20 },
  islandTypeCounts: { meadow: 4, forest: 4, hills: 4, mountain: 4, mixed: 4 },
});
let tightMin = Infinity;
for (let a = 0; a < tight.islands.length; a += 1) {
  for (let b = a + 1; b < tight.islands.length; b += 1) {
    for (const ta of tight.islands[a]!.tiles) {
      for (const tb of tight.islands[b]!.tiles) {
        tightMin = Math.min(tightMin, hexDistance({ q: ta.q, r: ta.r }, { q: tb.q, r: tb.r }));
      }
    }
  }
}
check("crowded world keeps separation", tightMin >= 2, `min=${tightMin}`);
check("crowded world reports unplaced", tight.unplaced.length > 0, `${tight.islands.length} placed, ${tight.unplaced.length} unplaced`);

// 10. flipped ranges are normalised, not fatal
const flipped = generateWorld({ seedText: "FLIP", xRange: { min: 10, max: -10 }, yRange: { min: 5, max: -5 } });
check("flipped range normalised", flipped.xRange.min === -10 && flipped.xRange.max === 10 && rangeSize(flipped.xRange) === 21);

// 11. lookups
const w = generateWorld({ seedText: "МИР" });
const sample = w.tiles[0]!;
check("tileAt / islandAt / isLand", w.tileAt(sample.x, sample.y)?.key === sample.key && w.islandAt(sample.x, sample.y)?.id === sample.islandId && w.isLand(sample.x, sample.y));
check("sea cell is not land", !w.isLand(w.xRange.min - 100, w.yRange.min - 100));

// 12. island types honoured
const forestOnly = generateWorld({
  seedText: "FOREST",
  islandTypeCounts: { meadow: 0, forest: 6, hills: 0, mountain: 0, mixed: 0 },
});
check("type counts honoured", forestOnly.islands.every((i) => i.type === "forest"), forestOnly.islands.map((i) => i.type).join(","));
check("forest islands are mostly forest", forestOnly.counts.forest > forestOnly.counts.mountain);
check("requested count is the sum of the type counts", forestOnly.requestedCount === 6, `${forestOnly.requestedCount}`);
check("every requested island was placed", forestOnly.islands.length === 6, `${forestOnly.islands.length}`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
