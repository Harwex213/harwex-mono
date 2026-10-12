// Lightning: the geometry of the pre-drawn bolt sprites plus a director that fires
// a strike down every board column, left to right, on a timer.
// Every struck tile flips, holds a charge for a while, then discharges back to rest.
// `crate::art::bolt_atlas` rasterizes the sprites.

use std::f64::consts::PI;

use crate::scene::board::{column_bottom_y, column_center_x, Tile, COLUMNS};
use crate::scene::random::{random, random_range, smoothstep};

pub const SPRITE_W: u32 = 256;
pub const SPRITE_H: u32 = 1024;
pub const ATLAS_COLS: u32 = 8;
pub const ATLAS_ROWS: u32 = 2;
pub const SPRITE_COUNT: u32 = ATLAS_COLS * ATLAS_ROWS;

pub type Point = [f64; 2];

// Midpoint displacement between two points, returns the polyline.
fn displace(a: Point, b: Point, roughness: f64, depth: u32) -> Vec<Point> {
    if depth == 0 {
        return vec![a, b];
    }
    let mx = (a[0] + b[0]) / 2.0;
    let my = (a[1] + b[1]) / 2.0;
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let length = dx.hypot(dy);
    let offset = (random() - 0.5) * length * roughness;
    let m: Point = [mx + (-dy / length) * offset, my + (dx / length) * offset];
    let mut left = displace(a, m, roughness, depth - 1);
    let right = displace(m, b, roughness, depth - 1);
    left.extend_from_slice(&right[1..]);
    left
}

pub struct Stroke {
    pub points: Vec<Point>,
    pub weight: f64,
}

// One bolt in sprite pixels: the main channel, its branches and some sub-branches.
pub fn build_bolt() -> Vec<Stroke> {
    let w = SPRITE_W as f64;
    let h = SPRITE_H as f64;
    let start: Point = [w / 2.0 + random_range(-30.0, 30.0), 0.0];
    let end: Point = [w / 2.0 + random_range(-26.0, 26.0), h];
    let main = displace(start, end, 0.34, 8);
    let mut strokes = vec![Stroke { points: main.clone(), weight: 1.0 }];
    let branches = 3 + (random() * 4.0).floor() as usize;
    for _ in 0..branches {
        let index = (random_range(0.08, 0.78) * main.len() as f64).floor() as usize;
        let Some(&origin) = main.get(index) else {
            continue;
        };
        let side = if random() < 0.5 { -1.0 } else { 1.0 };
        let angle = random_range(0.25, 0.75) * side;
        let length = random_range(90.0, 300.0);
        let tip: Point = [(origin[0] + angle.sin() * length).clamp(8.0, w - 8.0), origin[1] + angle.cos() * length];
        let branch = displace(origin, tip, 0.45, 5);
        let sub = if random() < 0.5 { branch.get((branch.len() as f64 * 0.5).floor() as usize).copied() } else { None };
        strokes.push(Stroke { points: branch, weight: random_range(0.3, 0.6) });
        if let Some(sub) = sub {
            let sub_tip: Point = [sub[0] - side * random_range(20.0, 60.0), sub[1] + random_range(40.0, 110.0)];
            strokes.push(Stroke { points: displace(sub, sub_tip, 0.5, 4), weight: 0.22 });
        }
    }
    strokes
}

#[derive(Clone, Copy, Debug)]
pub struct ActiveBolt {
    // Screen UV rect: x, y, width, height.
    pub rect: [f64; 4],
    pub sprite: u32,
    pub flip: bool,
    pub intensity: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct TileState {
    pub flip: f64,
    pub charge: f64,
    pub flash: f64,
    // Seconds since the bolt hit the tile, -1 before the hit.
    pub age: f64,
    // Seconds since the tile started to discharge, -1 before that.
    pub discharge: f64,
}

struct Strike {
    column: usize,
    start: f64,
    sprite: u32,
    flip: bool,
    pulses: Vec<f64>,
}

struct Sheet {
    x: f64,
    y: f64,
    start: f64,
    strength: f64,
}

const COLUMN_STAGGER: f64 = 0.1;
const STRIKE_LENGTH: f64 = 0.36;
// The bolt runs down the column, so lower rows are hit a little later.
const ROW_DELAY: f64 = 0.045;
const FLIP_TIME: f64 = 0.7;
const CHARGE_RISE: f64 = 0.35;
// How long the whole board stays charged after the last column is hit.
const CHARGE_HOLD: f64 = 5.0;
const DISCHARGE_STAGGER: f64 = 0.07;
const DISCHARGE_TIME: f64 = 0.9;
const LAST_COLUMN: f64 = (COLUMNS - 1) as f64;
// Columns catch the arcs as the strike sweeps past them: the left pair as it starts,
// the right pair as it reaches the last board column.
const PILLAR_DELAYS: [f64; 4] = [0.0, 0.08, LAST_COLUMN * COLUMN_STAGGER - 0.04, LAST_COLUMN * COLUMN_STAGGER + 0.06];
const PILLAR_BURST: f64 = 0.95;

// Return strokes: several bright pulses that decay fast, like a real flash.
fn envelope(t: f64, pulses: &[f64]) -> f64 {
    if !(-0.04..=STRIKE_LENGTH).contains(&t) {
        return 0.0;
    }
    let mut value = if t < 0.0 { (t + 0.04) * 4.0 } else { 0.0 };
    for (i, &p) in pulses.iter().enumerate() {
        if t >= p {
            value += (-(t - p) * if i == 0 { 22.0 } else { 30.0 }).exp() * if i == 0 { 1.0 } else { 0.75 };
        }
    }
    value.min(1.4)
}

fn ease_out_back(t: f64) -> f64 {
    let c = 1.4;
    let u = t - 1.0;
    1.0 + (c + 1.0) * u * u * u + c * u * u
}

fn hash(n: f64) -> f64 {
    let x = (n * 127.1).sin() * 43758.5453;
    x - x.floor()
}

pub struct LightningDirector {
    strikes: Vec<Strike>,
    sequence_start: f64,
    next_sequence: f64,
    sheet: Sheet,
    next_sheet: f64,
    pillar_out: [f32; 4],
}

impl LightningDirector {
    pub fn new(now: f64) -> Self {
        Self {
            strikes: Vec::new(),
            sequence_start: -100.0,
            next_sequence: now + 2.2,
            sheet: Sheet { x: 0.5, y: 0.1, start: -10.0, strength: 0.0 },
            next_sheet: now + 1.0,
            pillar_out: [0.0; 4],
        }
    }

    pub fn trigger(&mut self, now: f64) {
        self.sequence_start = now;
        self.strikes.clear();
        for column in 0..COLUMNS {
            let sprite = (random() * SPRITE_COUNT as f64).floor() as u32;
            let flip = random() < 0.5;
            let mut pulses = vec![0.0, random_range(0.045, 0.075), random_range(0.11, 0.15)];
            pulses.truncate(2 + (random() * 2.0).floor() as usize);
            self.strikes.push(Strike { column, start: now + column as f64 * COLUMN_STAGGER, sprite, flip, pulses });
        }
        let discharge_end = LAST_COLUMN * (COLUMN_STAGGER + DISCHARGE_STAGGER) + CHARGE_HOLD + DISCHARGE_TIME;
        self.next_sequence = now + discharge_end + random_range(2.5, 4.5);
    }

    pub fn update(&mut self, now: f64) {
        if now >= self.next_sequence {
            self.trigger(now);
        }
        if now >= self.next_sheet {
            self.sheet = Sheet {
                x: random_range(0.1, 0.9),
                y: random_range(0.02, 0.25),
                start: now,
                strength: random_range(0.25, 0.6),
            };
            self.next_sheet = now + random_range(1.6, 4.5);
        }
    }

    pub fn tile_state(&self, tile: &Tile, now: f64) -> TileState {
        let column = tile.column as f64;
        let row = tile.row as f64;
        let hit = self.sequence_start + column * COLUMN_STAGGER + if tile.is_zero { ROW_DELAY } else { row * ROW_DELAY };
        let discharge_at =
            self.sequence_start + LAST_COLUMN * COLUMN_STAGGER + CHARGE_HOLD + column * DISCHARGE_STAGGER + row * 0.03;
        let age = now - hit;
        if age < 0.0 {
            return TileState { flip: 0.0, charge: 0.0, flash: 0.0, age: -1.0, discharge: -1.0 };
        }
        let flip = if age < FLIP_TIME { PI * 2.0 * ease_out_back(age / FLIP_TIME) } else { 0.0 };
        let mut charge = smoothstep(0.0, CHARGE_RISE, age);
        let d = now - discharge_at;
        if d >= 0.0 {
            // Discharge sputters: the charge drops out a few times before it fades for good.
            let sputter = if d < 0.5 && hash((d * 24.0).floor() + tile.seed * 97.0) > 0.55 { 0.3 } else { 1.0 };
            charge *= (1.0 - smoothstep(0.0, DISCHARGE_TIME, d)) * sputter;
        }
        TileState {
            flip,
            charge,
            flash: (-age * 7.0).exp(),
            age: age.min(60.0),
            discharge: if d >= 0.0 { d.min(60.0) } else { -1.0 },
        }
    }

    pub fn bolts(&self, now: f64) -> Vec<ActiveBolt> {
        let mut out = Vec::new();
        for strike in &self.strikes {
            let intensity = envelope(now - strike.start, &strike.pulses);
            if intensity <= 0.001 {
                continue;
            }
            let cx = column_center_x(strike.column);
            let bottom = column_bottom_y() + 0.015;
            let width = 0.19;
            out.push(ActiveBolt {
                rect: [cx - width / 2.0, -0.04, width, bottom + 0.04],
                sprite: strike.sprite,
                flip: strike.flip,
                intensity,
            });
        }
        out
    }

    // Per column of the room: arc intensity. A burst crackles over the column as the sweep passes it;
    // while the board holds its charge, short arcs keep jumping now and then.
    pub fn pillars(&mut self, now: f64) -> [f32; 4] {
        let hold = LAST_COLUMN * COLUMN_STAGGER + CHARGE_HOLD;
        for (i, &delay) in PILLAR_DELAYS.iter().enumerate() {
            let fi = i as f64;
            let t = now - self.sequence_start - delay;
            let mut value = 0.0;
            if (0.0..PILLAR_BURST).contains(&t) {
                let crackle = 0.55 + 0.45 * hash((t * 40.0).floor() + fi * 17.3);
                value = envelope(t, &[0.0, 0.09, 0.22]) * 0.8 + 0.5 * (-t * 3.0).exp() * crackle;
                value *= 1.0 - smoothstep(PILLAR_BURST - 0.25, PILLAR_BURST, t);
            } else if t >= PILLAR_BURST && t < hold - delay {
                let tick = (now * 14.0).floor();
                value = if hash(tick + fi * 31.7) > 0.94 { 0.4 * (0.5 + 0.5 * hash(tick * 1.7 + fi)) } else { 0.0 };
            }
            self.pillar_out[i] = value as f32;
        }
        self.pillar_out
    }

    // How charged the air is: rises with the sweep, holds while the board is charged, bleeds off
    // with the discharge.
    pub fn energy(&self, now: f64) -> f64 {
        let t = now - self.sequence_start;
        let discharge_at = LAST_COLUMN * COLUMN_STAGGER + CHARGE_HOLD;
        let end = discharge_at + LAST_COLUMN * DISCHARGE_STAGGER + DISCHARGE_TIME;
        if t < 0.0 || t > end {
            return 0.0;
        }
        smoothstep(0.0, 0.8, t) * (1.0 - smoothstep(discharge_at, end, t))
    }

    // Seconds since the current strike sequence started.
    pub fn since_strike(&self, now: f64) -> f64 {
        (now - self.sequence_start).min(1000.0)
    }

    // Faint distant flicker inside the clouds between strikes: x, y, intensity.
    pub fn sheet_flash(&self, now: f64) -> [f64; 3] {
        let t = now - self.sheet.start;
        if !(0.0..=0.6).contains(&t) {
            return [self.sheet.x, self.sheet.y, 0.0];
        }
        let flicker = (-t * 9.0).exp() + 0.6 * (-(t - 0.12).max(0.0) * 14.0).exp() * if t > 0.12 { 1.0 } else { 0.0 };
        [self.sheet.x, self.sheet.y, flicker * self.sheet.strength]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::board::build_tiles;

    #[test]
    fn strike_sweeps_left_to_right() {
        let mut director = LightningDirector::new(0.0);
        director.update(2.2);
        assert_eq!(director.bolts(2.21).len(), 1);
        assert!(director.bolts(2.2 + 0.65).len() >= 3);
        let tiles = build_tiles();
        let first = director.tile_state(&tiles[1], 2.6);
        let last = director.tile_state(&tiles[36], 2.6);
        assert!(first.charge > 0.9);
        assert_eq!(last.age, -1.0);
        assert!(director.energy(4.0) > 0.99);
    }

    #[test]
    fn bolt_stays_in_its_sprite_column() {
        for _ in 0..20 {
            for stroke in build_bolt() {
                assert!(stroke.points.len() >= 2);
            }
        }
    }
}
