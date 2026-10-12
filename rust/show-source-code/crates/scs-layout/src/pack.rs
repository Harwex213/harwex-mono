//! Packing inside one box (cards) and of loose boxes (shelves).

use crate::{Params, Point, Rect, Size};

/// Places cards column-major in the column count whose box comes closest to the wanted aspect.
/// Returns the box size and the card rects relative to the box.
pub(crate) fn pack_cards(cards: &[Size], min_w: f32, p: &Params) -> (Size, Vec<Rect>) {
    if cards.is_empty() {
        return (Size::new(min_w.max(2.0 * p.box_pad + 120.0), 2.0 * p.box_pad + 40.0), Vec::new());
    }
    let card_w = cards.iter().map(|c| c.w).fold(0.0, f32::max);
    let heights: Vec<f32> = cards.iter().map(|c| c.h).collect();
    // Candidates around the column count of a box with the wanted aspect: trying every count
    // is quadratic, and a package can have thousands of files.
    let total_h: f32 = heights.iter().map(|h| h + p.card_gap).sum();
    let ideal = ((total_h * p.box_aspect / card_w).sqrt()).max(1.0);
    let mut candidates: Vec<usize> = (0..=16).map(|i| (ideal * 0.5 * 4f32.powf(i as f32 / 16.0)).round() as usize).collect();
    candidates.extend(1..=4);
    candidates.retain(|&c| c >= 1 && c <= cards.len());
    candidates.sort_unstable();
    candidates.dedup();
    let mut best: Option<(f32, Vec<usize>, f32)> = None;
    for cols in candidates {
        let breaks = partition(&heights, cols, p.card_gap);
        let h = column_heights(&heights, &breaks, p.card_gap).into_iter().fold(0.0, f32::max);
        let used = breaks.len() + 1;
        let w = used as f32 * card_w + (used - 1) as f32 * p.card_gap;
        let score = ((w / h.max(1.0)) / p.box_aspect).ln().abs();
        if best.as_ref().is_none_or(|b| score < b.0) {
            best = Some((score, breaks, h));
        }
    }
    let (_, breaks, inner_h) = best.expect("at least one column count");
    let mut rects = Vec::with_capacity(cards.len());
    let mut col = 0;
    let mut y = 0.0;
    for (i, c) in cards.iter().enumerate() {
        if breaks.get(col) == Some(&i) {
            col += 1;
            y = 0.0;
        }
        let x = col as f32 * (card_w + p.card_gap);
        rects.push(Rect::new(p.box_pad + x, p.box_pad + y, c.w, c.h));
        y += c.h + p.card_gap;
    }
    let cols = breaks.len() + 1;
    let inner_w = cols as f32 * card_w + (cols - 1) as f32 * p.card_gap;
    let w = (inner_w + 2.0 * p.box_pad).max(min_w);
    (Size::new(w, inner_h + 2.0 * p.box_pad), rects)
}

/// Splits `heights` into `cols` contiguous runs with the smallest tallest run. Returns the start
/// index of every run after the first. Binary search on the height limit, greedy fill.
fn partition(heights: &[f32], cols: usize, gap: f32) -> Vec<usize> {
    let fits = |limit: f32| -> Option<Vec<usize>> {
        let mut breaks = Vec::new();
        let mut h = 0.0;
        for (i, &c) in heights.iter().enumerate() {
            if c > limit {
                return None;
            }
            let next = if h == 0.0 { c } else { h + gap + c };
            if next > limit {
                breaks.push(i);
                if breaks.len() >= cols {
                    return None;
                }
                h = c;
            } else {
                h = next;
            }
        }
        Some(breaks)
    };
    let total: f32 = heights.iter().sum::<f32>() + gap * heights.len().saturating_sub(1) as f32;
    let mut lo = heights.iter().copied().fold(0.0, f32::max);
    let mut hi = total;
    if let Some(b) = fits(lo) {
        return b;
    }
    for _ in 0..40 {
        let mid = (lo + hi) / 2.0;
        if fits(mid).is_some() {
            hi = mid;
        } else {
            lo = mid;
        }
        if hi - lo < 1.0 {
            break;
        }
    }
    fits(hi).unwrap_or_default()
}

fn column_heights(heights: &[f32], breaks: &[usize], gap: f32) -> Vec<f32> {
    let mut out = Vec::new();
    let mut start = 0;
    for &end in breaks.iter().chain(std::iter::once(&heights.len())) {
        let run = &heights[start..end];
        out.push(run.iter().sum::<f32>() + gap * run.len().saturating_sub(1) as f32);
        start = end;
    }
    out
}

/// A row width that makes a shelf of `items` roughly `aspect` 1.6 overall.
pub(crate) fn square_row(items: &[Size], gap: f32) -> f32 {
    let area: f32 = items.iter().map(|s| (s.w + gap) * (s.h + gap)).sum();
    let widest = items.iter().map(|s| s.w).fold(0.0, f32::max);
    (area * 1.6).sqrt().max(widest)
}

/// The narrowest row width whose shelf is at most `height` tall (or the widest single row).
pub(crate) fn row_for_height(items: &[Size], height: f32, gap: f32) -> f32 {
    let widest = items.iter().map(|s| s.w).fold(0.0, f32::max);
    let (mut lo, mut hi) = (widest, items.iter().map(|s| s.w + gap).sum::<f32>().max(widest));
    for _ in 0..40 {
        let mid = (lo + hi) / 2.0;
        if shelf(items, mid, gap).0.h <= height {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    hi
}

/// Shelf packing, tallest first, into rows `row_w` wide. Returns the area size and each item's
/// top-left.
pub(crate) fn shelf(items: &[Size], row_w: f32, gap: f32) -> (Size, Vec<Point>) {
    let mut order: Vec<usize> = (0..items.len()).collect();
    order.sort_by(|&a, &b| items[b].h.total_cmp(&items[a].h).then(a.cmp(&b)));
    let mut places = vec![Point::default(); items.len()];
    let (mut x, mut y, mut row_h, mut max_w) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
    for i in order {
        let s = items[i];
        if x > 0.0 && x + s.w > row_w {
            y += row_h + gap;
            x = 0.0;
            row_h = 0.0;
        }
        places[i] = Point::new(x, y);
        x += s.w + gap;
        row_h = row_h.max(s.h);
        max_w = max_w.max(x - gap);
    }
    (Size::new(max_w, y + row_h), places)
}
