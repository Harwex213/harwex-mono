//! Glyphs the terminal draws itself instead of taking them from the font.
//!
//! Block elements (U+2580–U+259F) and sextants (U+1FB00–U+1FB3B) are pictures of the cell, so
//! they must fill it exactly. The font's glyphs overshoot the cell by a pixel and smear the
//! Claude Code logo, and no bundled font has the sextants. The spinner stars Claude Code uses
//! (`✢ ✳ ✶ ✻ ✽`) and its result marker `⎿` are drawn here too: the bundled fonts lack most of
//! them, and one spinner must not mix font glyphs with tofu.

use std::f32::consts::{FRAC_PI_2, PI, TAU};

use egui::epaint::{TessellationOptions, Tessellator, Vertex};
use egui::{pos2, vec2, Color32, Mesh, Pos2, Rect, Shape, Stroke, Vec2};

/// A filled part of a cell in cell units: 0 is the left or top edge, 1 the right or bottom edge.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Piece {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
    /// Opacity of the foreground color: 1, or the density of a shade.
    pub alpha: f32,
}

/// The pieces of one cell. A sextant needs six, so a fixed array avoids an allocation per cell.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Pieces {
    items: [Piece; 6],
    len: usize,
}

impl Pieces {
    const EMPTY: Pieces = Pieces {
        items: [Piece {
            x0: 0.0,
            y0: 0.0,
            x1: 0.0,
            y1: 0.0,
            alpha: 0.0,
        }; 6],
        len: 0,
    };

    fn push(&mut self, x0: f32, y0: f32, x1: f32, y1: f32) {
        self.items[self.len] = Piece {
            x0,
            y0,
            x1,
            y1,
            alpha: 1.0,
        };
        self.len += 1;
    }

    fn one(x0: f32, y0: f32, x1: f32, y1: f32) -> Pieces {
        let mut p = Pieces::EMPTY;
        p.push(x0, y0, x1, y1);
        p
    }

    pub(crate) fn as_slice(&self) -> &[Piece] {
        &self.items[..self.len]
    }
}

/// True for every char this module draws. Cheap enough for each cell of each frame.
pub(crate) fn is_drawn(c: char) -> bool {
    matches!(c as u32, 0x2580..=0x259F | 0x1FB00..=0x1FB3B)
        || matches!(c, '✢' | '✳' | '✶' | '✻' | '✽' | '⎿')
}

/// Quadrant bits of U+2596..=U+259F: 1 upper left, 2 upper right, 4 lower left, 8 lower right.
const QUADRANTS: [u8; 10] = [
    4,
    8,
    1,
    1 | 4 | 8,
    1 | 8,
    1 | 2 | 4,
    1 | 2 | 8,
    2,
    2 | 4,
    2 | 4 | 8,
];

/// The rectangles of a block element or a sextant. `None` for any other char.
pub(crate) fn pieces(c: char) -> Option<Pieces> {
    let cp = c as u32;
    let eighth = |n: u32| n as f32 / 8.0;
    let p = match cp {
        0x2580 => Pieces::one(0.0, 0.0, 1.0, 0.5),
        // Lower one eighth to lower seven eighths, then the full block.
        0x2581..=0x2588 => Pieces::one(0.0, 1.0 - eighth(cp - 0x2580), 1.0, 1.0),
        // Left seven eighths down to left one eighth.
        0x2589..=0x258F => Pieces::one(0.0, 0.0, eighth(0x2590 - cp), 1.0),
        0x2590 => Pieces::one(0.5, 0.0, 1.0, 1.0),
        0x2591..=0x2593 => {
            let mut p = Pieces::one(0.0, 0.0, 1.0, 1.0);
            p.items[0].alpha = (cp - 0x2590) as f32 / 4.0;
            p
        }
        0x2594 => Pieces::one(0.0, 0.0, 1.0, eighth(1)),
        0x2595 => Pieces::one(eighth(7), 0.0, 1.0, 1.0),
        0x2596..=0x259F => {
            let bits = QUADRANTS[(cp - 0x2596) as usize];
            let mut p = Pieces::EMPTY;
            for (bit, x, y) in [(1, 0.0, 0.0), (2, 0.5, 0.0), (4, 0.0, 0.5), (8, 0.5, 0.5)] {
                if bits & bit != 0 {
                    p.push(x, y, x + 0.5, y + 0.5);
                }
            }
            p
        }
        0x1FB00..=0x1FB3B => {
            // The 60 sextants are the 6-bit patterns 1..=62 without 21 and 42, which are the
            // left and right half blocks (U+258C, U+2590). Bit k is column k % 2, row k / 2.
            let mut bits = cp - 0x1FB00 + 1;
            if bits >= 21 {
                bits += 1;
            }
            if bits >= 42 {
                bits += 1;
            }
            let mut p = Pieces::EMPTY;
            for k in 0..6 {
                if bits & (1 << k) != 0 {
                    let x = (k % 2) as f32 * 0.5;
                    let row = (k / 2) as f32;
                    p.push(x, row / 3.0, x + 0.5, (row + 1.0) / 3.0);
                }
            }
            p
        }
        _ => return None,
    };
    Some(p)
}

/// Rounds a coordinate in points to the physical pixel grid.
fn snap(v: f32, ppp: f32) -> f32 {
    (v * ppp).round() / ppp
}

/// The pixel-snapped rectangle of `piece` inside `cell`. Neighbouring cells snap their shared
/// edge to the same pixel, so rows and columns of blocks join without a seam or an overlap. A
/// piece thinner than a pixel keeps one pixel at the cell edge it touches.
pub(crate) fn piece_rect(piece: &Piece, cell: Rect, ppp: f32) -> Rect {
    let px = 1.0 / ppp;
    let axis = |lo: f32, hi: f32, a: f32, b: f32| {
        let (mut s0, mut s1) = (snap(lo + a * (hi - lo), ppp), snap(lo + b * (hi - lo), ppp));
        if s1 - s0 < px * 0.5 {
            if a == 0.0 {
                s1 = s0 + px;
            } else {
                s0 = s1 - px;
            }
        }
        (s0, s1)
    };
    let (x0, x1) = axis(cell.left(), cell.right(), piece.x0, piece.x1);
    let (y0, y1) = axis(cell.top(), cell.bottom(), piece.y0, piece.y1);
    Rect::from_min_max(pos2(x0, y0), pos2(x1, y1))
}

/// Draws `c` into `cell` with `color`, appending to `mesh`, which the caller paints once per
/// frame. Rectangles snap to the pixel grid and need no anti-aliasing. Returns false when `c`
/// is not drawn here.
pub(crate) fn paint(
    c: char,
    cell: Rect,
    color: Color32,
    ppp: f32,
    mesh: &mut Mesh,
    symbols: &mut SymbolCache,
) -> bool {
    if let Some(pieces) = pieces(c) {
        for piece in pieces.as_slice() {
            let color = if piece.alpha < 1.0 {
                color.gamma_multiply(piece.alpha)
            } else {
                color
            };
            mesh.add_colored_rect(piece_rect(piece, cell, ppp), color);
        }
        return true;
    }
    // The template is drawn at the origin; a whole-pixel offset keeps its anti-aliasing exact.
    let offset = vec2(snap(cell.left(), ppp), snap(cell.top(), ppp));
    match symbols.get(c, cell.size(), ppp) {
        Some(template) => {
            append_tinted(mesh, template, offset, color);
            true
        }
        None => false,
    }
}

/// Tessellated symbols in white, one per char and cell size, reused every frame. A screen of
/// spinner stars would otherwise cost thousands of feathered polygons each frame.
#[derive(Default)]
pub(crate) struct SymbolCache {
    ppp: f32,
    meshes: Vec<(char, Vec2, Mesh)>,
}

impl SymbolCache {
    fn get(&mut self, c: char, size: Vec2, ppp: f32) -> Option<&Mesh> {
        if self.ppp != ppp || self.meshes.len() > 64 {
            self.meshes.clear();
            self.ppp = ppp;
        }
        if let Some(i) = self
            .meshes
            .iter()
            .position(|(k, s, _)| *k == c && *s == size)
        {
            return Some(&self.meshes[i].2);
        }
        let mut mesh = Mesh::default();
        let mut shapes = Vec::new();
        let cell = Rect::from_min_size(Pos2::ZERO, size);
        if !symbol(c, cell, Color32::WHITE, ppp, &mut mesh, &mut shapes) {
            return None;
        }
        let mut tessellator =
            Tessellator::new(ppp, TessellationOptions::default(), [1, 1], Vec::new());
        for shape in shapes {
            tessellator.tessellate_shape(shape, &mut mesh);
        }
        self.meshes.push((c, size, mesh));
        self.meshes.last().map(|(_, _, m)| m)
    }
}

/// Appends a white `template` moved by `offset`. Its vertex alpha is the coverage, so each
/// vertex becomes `color` scaled by that coverage (colors are premultiplied).
fn append_tinted(out: &mut Mesh, template: &Mesh, offset: Vec2, color: Color32) {
    let base = out.vertices.len() as u32;
    out.indices
        .extend(template.indices.iter().map(|i| base + i));
    out.vertices.extend(template.vertices.iter().map(|v| {
        let a = v.color.a() as u32;
        let scale = |c: u8| ((c as u32 * a + 127) / 255) as u8;
        Vertex {
            pos: v.pos + offset,
            uv: v.uv,
            color: Color32::from_rgba_premultiplied(
                scale(color.r()),
                scale(color.g()),
                scale(color.b()),
                scale(color.a()),
            ),
        }
    }));
}

/// Vertical center of the spinner stars, as a fraction of the cell height. It sits a little
/// below the middle, near the middle of JetBrains Mono's lowercase letters, like a font glyph.
const STAR_CENTER_Y: f32 = 0.53;
/// The `⎿` corner sits where the font's baseline is (JetBrains Mono: ascent 1020 of 1320).
const CORNER_Y: f32 = 0.62;

fn symbol(
    c: char,
    cell: Rect,
    color: Color32,
    ppp: f32,
    mesh: &mut Mesh,
    shapes: &mut Vec<Shape>,
) -> bool {
    let px = 1.0 / ppp;
    let center = pos2(cell.center().x, cell.top() + cell.height() * STAR_CENTER_Y);
    let r = 0.46 * cell.width().min(cell.height());
    // Spokes start upward, as in the dingbat fonts.
    let spokes = |n: usize| (0..n).map(move |k| -FRAC_PI_2 + k as f32 * TAU / n as f32);
    match c {
        '✢' => {
            for a in spokes(4) {
                teardrop(center, a, 0.0, r, 0.32 * r, color, shapes);
            }
        }
        '✳' => {
            let stroke = Stroke::new((0.16 * r).max(px), color);
            for a in spokes(8).take(4) {
                let d = vec2(a.cos(), a.sin()) * r;
                shapes.push(Shape::line_segment([center - d, center + d], stroke));
            }
        }
        '✶' => {
            // A hexagram: two overlapping triangles, each convex, so egui fills them exactly.
            for start in [-FRAC_PI_2, FRAC_PI_2] {
                let points = (0..3)
                    .map(|k| {
                        let a = start + k as f32 * TAU / 3.0;
                        center + vec2(a.cos(), a.sin()) * r
                    })
                    .collect();
                shapes.push(Shape::convex_polygon(points, color, Stroke::NONE));
            }
        }
        '✻' => {
            for a in spokes(6) {
                teardrop(center, a, 0.34 * r, r, 0.24 * r, color, shapes);
            }
            shapes.push(Shape::circle_filled(center, 0.2 * r, color));
        }
        '✽' => {
            for a in spokes(6) {
                teardrop(center, a, 0.0, r, 0.3 * r, color, shapes);
            }
        }
        '⎿' => {
            let w = snap((0.12 * cell.width()).max(px), ppp).max(px);
            let x = snap(cell.center().x - w / 2.0, ppp);
            let y = snap(cell.top() + cell.height() * CORNER_Y, ppp);
            let top = snap(cell.top(), ppp);
            mesh.add_colored_rect(Rect::from_min_max(pos2(x, top), pos2(x + w, y + w)), color);
            let right = snap(cell.right(), ppp);
            mesh.add_colored_rect(Rect::from_min_max(pos2(x, y), pos2(right, y + w)), color);
        }
        _ => return false,
    }
    true
}

/// A spoke shaped like a teardrop: a point `r_in` from `center`, widening to a round tip of
/// radius `tip` that ends `r_out` from `center`. The shape is the convex hull of the point and
/// the tip circle, so egui can fill it as a convex polygon.
fn teardrop(
    center: Pos2,
    angle: f32,
    r_in: f32,
    r_out: f32,
    tip: f32,
    color: Color32,
    shapes: &mut Vec<Shape>,
) {
    let u = vec2(angle.cos(), angle.sin());
    let apex = center + u * r_in;
    let tip_center = center + u * (r_out - tip);
    let d = (tip_center - apex).length();
    if d <= tip {
        shapes.push(Shape::circle_filled(tip_center, tip, color));
        return;
    }
    // The tangents from the apex touch the circle at ±acos(tip / d) from the direction back to
    // the apex. The arc between them on the far side is the round end.
    let back = angle + PI;
    let half = (tip / d).acos();
    const ARC: usize = 5;
    let mut points = Vec::with_capacity(ARC + 2);
    points.push(apex);
    for i in 0..=ARC {
        let a = back + half + (TAU - 2.0 * half) * i as f32 / ARC as f32;
        points.push(tip_center + vec2(a.cos(), a.sin()) * tip);
    }
    shapes.push(Shape::convex_polygon(points, color, Stroke::NONE));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rects(c: char) -> Vec<[f32; 5]> {
        pieces(c)
            .unwrap_or_else(|| panic!("{c:?} has no pieces"))
            .as_slice()
            .iter()
            .map(|p| [p.x0, p.y0, p.x1, p.y1, p.alpha])
            .collect()
    }

    fn area(c: char) -> f32 {
        rects(c).iter().map(|r| (r[2] - r[0]) * (r[3] - r[1])).sum()
    }

    #[test]
    fn halves_eighths_and_full() {
        assert_eq!(rects('▀'), [[0.0, 0.0, 1.0, 0.5, 1.0]]);
        assert_eq!(rects('▁'), [[0.0, 0.875, 1.0, 1.0, 1.0]]);
        assert_eq!(rects('▄'), [[0.0, 0.5, 1.0, 1.0, 1.0]]);
        assert_eq!(rects('▇'), [[0.0, 0.125, 1.0, 1.0, 1.0]]);
        assert_eq!(rects('█'), [[0.0, 0.0, 1.0, 1.0, 1.0]]);
        assert_eq!(rects('▉'), [[0.0, 0.0, 0.875, 1.0, 1.0]]);
        assert_eq!(rects('▌'), [[0.0, 0.0, 0.5, 1.0, 1.0]]);
        assert_eq!(rects('▏'), [[0.0, 0.0, 0.125, 1.0, 1.0]]);
        assert_eq!(rects('▐'), [[0.5, 0.0, 1.0, 1.0, 1.0]]);
        assert_eq!(rects('▔'), [[0.0, 0.0, 1.0, 0.125, 1.0]]);
        assert_eq!(rects('▕'), [[0.875, 0.0, 1.0, 1.0, 1.0]]);
        for (i, c) in ('▁'..='█').enumerate() {
            assert_eq!(area(c), (i + 1) as f32 / 8.0, "{c}");
        }
        for (i, c) in ('▉'..='▏').enumerate() {
            assert_eq!(area(c), (7 - i) as f32 / 8.0, "{c}");
        }
    }

    #[test]
    fn shades_are_alpha_fills() {
        assert_eq!(rects('░'), [[0.0, 0.0, 1.0, 1.0, 0.25]]);
        assert_eq!(rects('▒'), [[0.0, 0.0, 1.0, 1.0, 0.5]]);
        assert_eq!(rects('▓'), [[0.0, 0.0, 1.0, 1.0, 0.75]]);
    }

    #[test]
    fn quadrants() {
        const UL: [f32; 5] = [0.0, 0.0, 0.5, 0.5, 1.0];
        const UR: [f32; 5] = [0.5, 0.0, 1.0, 0.5, 1.0];
        const LL: [f32; 5] = [0.0, 0.5, 0.5, 1.0, 1.0];
        const LR: [f32; 5] = [0.5, 0.5, 1.0, 1.0, 1.0];
        assert_eq!(rects('▖'), [LL]);
        assert_eq!(rects('▗'), [LR]);
        assert_eq!(rects('▘'), [UL]);
        assert_eq!(rects('▙'), [UL, LL, LR]);
        assert_eq!(rects('▚'), [UL, LR]);
        assert_eq!(rects('▛'), [UL, UR, LL]);
        assert_eq!(rects('▜'), [UL, UR, LR]);
        assert_eq!(rects('▝'), [UR]);
        assert_eq!(rects('▞'), [UR, LL]);
        assert_eq!(rects('▟'), [UR, LL, LR]);
    }

    #[test]
    fn sextants() {
        let third = 1.0 / 3.0;
        // 🬀 is sextant 1 (top left), 🬻 is every sextant but 1.
        assert_eq!(rects('\u{1FB00}'), [[0.0, 0.0, 0.5, third, 1.0]]);
        assert_eq!(rects('\u{1FB01}'), [[0.5, 0.0, 1.0, third, 1.0]]);
        assert_eq!(rects('\u{1FB3B}').len(), 5);
        assert!(!rects('\u{1FB3B}').contains(&[0.0, 0.0, 0.5, third, 1.0]));
        // The patterns of ▌ and ▐ are skipped: 🬓 (U+1FB13) is pattern 20, 🬔 (U+1FB14) is 22.
        assert_eq!(rects('\u{1FB13}').len(), 2);
        assert_eq!(rects('\u{1FB14}').len(), 3);
        // 60 distinct patterns, none of them empty, full or a half block.
        let mut seen = std::collections::HashSet::new();
        for cp in 0x1FB00..=0x1FB3B {
            let c = char::from_u32(cp).unwrap();
            let key: Vec<_> = rects(c).iter().map(|r| r.map(f32::to_bits)).collect();
            assert!((1..6).contains(&key.len()), "{c}");
            assert!(seen.insert(key), "{c} repeats a pattern");
        }
    }

    #[test]
    fn every_block_element_is_inside_its_cell() {
        for cp in (0x2580..=0x259F).chain(0x1FB00..=0x1FB3B) {
            let c = char::from_u32(cp).unwrap();
            assert!(is_drawn(c));
            for p in pieces(c).unwrap().as_slice() {
                assert!(0.0 <= p.x0 && p.x0 < p.x1 && p.x1 <= 1.0, "{c}: {p:?}");
                assert!(0.0 <= p.y0 && p.y0 < p.y1 && p.y1 <= 1.0, "{c}: {p:?}");
                assert!(p.alpha > 0.0 && p.alpha <= 1.0, "{c}: {p:?}");
            }
        }
        assert!(pieces('a').is_none() && pieces('─').is_none() && pieces('✻').is_none());
        assert!(!is_drawn('a') && !is_drawn('─') && !is_drawn('●'));
    }

    /// Cells of a fractional width still meet on one pixel edge, and a full block covers its
    /// whole cell, so a run of blocks has no seam and no overlap.
    #[test]
    fn snapped_cells_join_without_gaps() {
        for ppp in [1.0, 1.5, 2.0] {
            let (cell_w, cell_h) = (7.73, 17.0);
            let origin = pos2(3.3, 10.6);
            let cell = |col: usize, row: usize| {
                Rect::from_min_size(
                    origin + vec2(col as f32 * cell_w, row as f32 * cell_h),
                    vec2(cell_w, cell_h),
                )
            };
            let full = pieces('█').unwrap().as_slice()[0];
            for col in 0..40 {
                let a = piece_rect(&full, cell(col, 0), ppp);
                let b = piece_rect(&full, cell(col + 1, 0), ppp);
                let below = piece_rect(&full, cell(col, 1), ppp);
                assert_eq!(a.right(), b.left(), "ppp {ppp} col {col}");
                assert_eq!(a.bottom(), below.top(), "ppp {ppp} col {col}");
                let on_grid = |v: f32| ((v * ppp).round() - v * ppp).abs() < 1e-3;
                assert!(on_grid(a.left()) && on_grid(a.right()) && on_grid(a.top()));
                // The left and the right halves meet inside the cell.
                let left = piece_rect(&pieces('▌').unwrap().as_slice()[0], cell(col, 0), ppp);
                let right = piece_rect(&pieces('▐').unwrap().as_slice()[0], cell(col, 0), ppp);
                assert_eq!(left.right(), right.left());
                assert_eq!((left.left(), right.right()), (a.left(), a.right()));
            }
        }
    }

    #[test]
    fn thin_pieces_keep_one_pixel() {
        let cell = Rect::from_min_size(pos2(0.0, 0.0), vec2(6.0, 14.0));
        let thin = |c: char| piece_rect(&pieces(c).unwrap().as_slice()[0], cell, 1.0);
        assert_eq!(thin('▏').width(), 1.0);
        assert_eq!(thin('▏').left(), 0.0);
        assert_eq!(thin('▕').width(), 1.0);
        assert_eq!(thin('▕').right(), 6.0);
        assert!(thin('▁').height() >= 1.0 && thin('▁').bottom() == 14.0);
    }

    #[test]
    fn symbols_stay_inside_their_cell() {
        let cell = Rect::from_min_size(pos2(100.0, 50.0), vec2(7.73, 17.0));
        let mut cache = SymbolCache::default();
        for c in ['✢', '✳', '✶', '✻', '✽', '⎿'] {
            assert!(is_drawn(c));
            let mut mesh = Mesh::default();
            assert!(
                paint(c, cell, Color32::WHITE, 2.0, &mut mesh, &mut cache),
                "{c}"
            );
            assert!(!mesh.is_empty(), "{c} drew nothing");
            let bounds = mesh.calc_bounds();
            assert!(
                cell.expand(0.51).contains_rect(bounds),
                "{c}: {bounds:?} outside {cell:?}"
            );
        }
        let mut mesh = Mesh::default();
        assert!(!paint(
            'a',
            cell,
            Color32::WHITE,
            2.0,
            &mut mesh,
            &mut cache
        ));
        assert!(mesh.is_empty());
    }

    /// A cached symbol is the same template moved to its cell and tinted with the cell color.
    #[test]
    fn cached_symbols_are_moved_and_tinted() {
        let mut cache = SymbolCache::default();
        let size = vec2(8.0, 17.0);
        let draw = |cache: &mut SymbolCache, x: f32, color: Color32| {
            let mut mesh = Mesh::default();
            paint(
                '✻',
                Rect::from_min_size(pos2(x, 0.0), size),
                color,
                1.0,
                &mut mesh,
                cache,
            );
            mesh
        };
        let a = draw(&mut cache, 0.0, Color32::WHITE);
        let b = draw(&mut cache, 16.0, Color32::from_rgb(215, 119, 87));
        assert_eq!(cache.meshes.len(), 1);
        assert_eq!(a.vertices.len(), b.vertices.len());
        assert_eq!(a.indices, b.indices);
        for (va, vb) in a.vertices.iter().zip(&b.vertices) {
            assert_eq!(vb.pos, va.pos + vec2(16.0, 0.0));
            assert_eq!(vb.color.a(), va.color.a());
            if va.color.a() == 255 {
                assert_eq!(vb.color, Color32::from_rgb(215, 119, 87));
            }
        }
    }
}
