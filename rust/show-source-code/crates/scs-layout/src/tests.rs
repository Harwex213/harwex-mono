use super::*;

fn card(h: f32) -> Size {
    Size::new(400.0, h)
}

/// A layered graph like a small monorepo: apps on top of libraries, one cycle, one long edge,
/// and two packages without edges.
fn sample() -> Input {
    let cards = vec![
        vec![card(300.0), card(120.0), card(200.0)],          // 0 app
        vec![card(180.0); 7],                                 // 1 ui
        vec![card(240.0), card(90.0)],                        // 2 core
        vec![card(60.0)],                                     // 3 utils
        vec![card(150.0), card(150.0)],                       // 4 config
        vec![card(80.0)],                                     // 5 loose
        vec![card(500.0), card(80.0), card(80.0), card(80.0)], // 6 loose
        vec![card(100.0)],                                    // 7 cyc a
        vec![card(100.0)],                                    // 8 cyc b
    ];
    let edges = vec![(0, 1), (0, 2), (0, 3), (1, 2), (2, 3), (0, 4), (4, 3), (7, 8), (8, 7), (7, 3), (1, 1), (0, 1)];
    Input { min_width: vec![0.0; cards.len()], cards, edges }
}

fn labelled(r: &Rect, p: &Params) -> Rect {
    Rect::new(r.x, r.y - p.label_h, r.w, r.h + p.label_h)
}

#[test]
fn boxes_and_labels_never_overlap() {
    let p = Params::default();
    let l = layout(&sample(), &p);
    for i in 0..l.boxes.len() {
        for j in i + 1..l.boxes.len() {
            assert!(!labelled(&l.boxes[i], &p).intersects(&labelled(&l.boxes[j], &p)), "{i} overlaps {j}: {:?} {:?}", l.boxes[i], l.boxes[j]);
        }
    }
}

#[test]
fn cards_sit_inside_their_box_without_overlap() {
    let l = layout(&sample(), &Params::default());
    for (b, cards) in l.boxes.iter().zip(&l.cards) {
        for (i, c) in cards.iter().enumerate() {
            assert!(b.contains_rect(c), "{c:?} outside {b:?}");
            for d in &cards[i + 1..] {
                assert!(!c.intersects(d));
            }
        }
    }
}

#[test]
fn dependencies_sit_right_of_dependents() {
    let l = layout(&sample(), &Params::default());
    for (a, b) in [(0, 1), (0, 2), (0, 3), (1, 2), (2, 3), (0, 4), (4, 3)] {
        assert!(l.column[a].unwrap() < l.column[b].unwrap(), "{a} -> {b}: {:?}", l.column);
        assert!(l.boxes[a].right() < l.boxes[b].x);
    }
    assert_eq!(l.column[5], None);
    assert_eq!(l.column[6], None);
}

#[test]
fn unconnected_packages_get_their_own_area() {
    let p = Params::default();
    let l = layout(&sample(), &p);
    let area = l.unconnected_area.unwrap();
    let graph_bottom = [0, 1, 2, 3, 4, 7, 8].iter().map(|&i| l.boxes[i].bottom()).fold(0.0, f32::max);
    assert!(area.y > graph_bottom || area.x > [0, 1, 2, 3, 4, 7, 8].iter().map(|&i| l.boxes[i].right()).fold(0.0, f32::max));
    for i in [5, 6] {
        assert!(area.contains_rect(&l.boxes[i]));
    }
}

#[test]
fn routes_connect_box_sides_and_skip_ignored_edges() {
    let l = layout(&sample(), &Params::default());
    assert_eq!(l.routes.len(), 12);
    assert!(l.routes[10].is_none(), "self edge");
    assert_eq!(l.routes[11], l.routes[0], "duplicate edge");
    for (k, &(a, b)) in sample().edges.iter().enumerate().take(10) {
        let r = l.routes[k].as_ref().unwrap();
        let (start, _) = r.segs[0].ends();
        let end = r.end();
        let on_side = |x: f32| (start.x - x).abs() < 0.01 && start.y >= l.boxes[a].y && start.y <= l.boxes[a].bottom();
        assert!(on_side(l.boxes[a].right()) || on_side(l.boxes[a].x), "edge {k} starts off box {a}");
        assert!((end.x - l.boxes[b].x).abs() < 0.01 || (end.x - l.boxes[b].right()).abs() < 0.01, "edge {k} ends off box {b}");
        assert!(end.y >= l.boxes[b].y && end.y <= l.boxes[b].bottom());
    }
    let cyc = [&l.routes[7], &l.routes[8]];
    assert_eq!(cyc.iter().filter(|r| r.as_ref().unwrap().against_flow).count(), 1);
}

#[test]
fn arrows_never_run_through_other_boxes() {
    let l = layout(&sample(), &Params::default());
    for (k, &(a, b)) in sample().edges.iter().enumerate() {
        let Some(r) = &l.routes[k] else { continue };
        for seg in &r.segs {
            for s in 1..40 {
                let pt = seg.at(s as f32 / 40.0);
                for (i, bx) in l.boxes.iter().enumerate() {
                    if i == a || i == b {
                        continue;
                    }
                    let inner = Rect::new(bx.x + 1.0, bx.y + 1.0, bx.w - 2.0, bx.h - 2.0);
                    assert!(!inner.contains(pt), "edge {a}->{b} crosses box {i} at {pt:?}");
                }
            }
        }
    }
}

#[test]
fn barycenter_ordering_removes_avoidable_crossings() {
    // Two parallel chains given in crossing order: 0->3, 1->2 with 2 above 3 initially.
    let cards = vec![vec![card(100.0)]; 4];
    let input = Input { min_width: vec![0.0; 4], cards, edges: vec![(0, 3), (1, 2)] };
    let l = layout(&input, &Params::default());
    let above = |i: usize, j: usize| l.boxes[i].y < l.boxes[j].y;
    assert_eq!(above(0, 1), above(3, 2));
}

#[test]
fn card_grid_prefers_landscape_boxes() {
    let p = Params::default();
    let (size, rects) = pack::pack_cards(&vec![card(200.0); 30], 0.0, &p);
    let aspect = size.w / size.h;
    assert!(aspect > 1.0 && aspect < 3.0, "aspect {aspect}");
    // Column-major: the second card sits under the first.
    assert_eq!(rects[0].x, rects[1].x);
    assert!(rects[1].y > rects[0].y);
}

#[test]
fn empty_package_still_gets_a_box_wide_enough_for_its_label() {
    let input = Input { cards: vec![vec![]], min_width: vec![700.0], edges: vec![] };
    let l = layout(&input, &Params::default());
    assert!(l.boxes[0].w >= 700.0 && l.boxes[0].h > 0.0);
}

#[test]
fn large_graph_lays_out_quickly() {
    // About the size of a real monorepo: 120 packages, ~3 deps each, thousands of cards.
    let n = 120;
    let mut seed = 7u32;
    let mut rnd = |m: u32| {
        seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        (seed >> 16) % m
    };
    let cards: Vec<Vec<Size>> = (0..n).map(|_| (0..1 + rnd(40)).map(|_| card(60.0 + rnd(500) as f32)).collect()).collect();
    let mut edges = Vec::new();
    for a in 0..n {
        for _ in 0..rnd(4) {
            let b = rnd(n as u32) as usize;
            if b > a {
                edges.push((a, b));
            }
        }
    }
    let start = std::time::Instant::now();
    let l = layout(&Input { min_width: vec![0.0; n], cards, edges }, &Params::default());
    assert!(start.elapsed().as_secs_f32() < 2.0, "{:?}", start.elapsed());
    let p = Params::default();
    for i in 0..n {
        for j in i + 1..n {
            assert!(!labelled(&l.boxes[i], &p).intersects(&labelled(&l.boxes[j], &p)));
        }
    }
}

#[test]
fn a_hub_with_many_dependents_wraps_into_more_columns() {
    // 30 packages depend on one: a single column of 30 would be a tall strip.
    let n = 31;
    let cards = vec![vec![card(200.0)]; n];
    let edges: Vec<(usize, usize)> = (1..n).map(|i| (i, 0)).collect();
    let l = layout(&Input { min_width: vec![0.0; n], cards, edges: edges.clone() }, &Params::default());
    let cols = l.column.iter().flatten().max().unwrap() + 1;
    assert!(cols >= 3, "only {cols} columns");
    let aspect = l.bounds.w / l.bounds.h;
    assert!(aspect > 0.5, "aspect {aspect}");
    for (k, &(a, b)) in edges.iter().enumerate() {
        let r = l.routes[k].as_ref().unwrap();
        for seg in &r.segs {
            for s in 1..20 {
                let pt = seg.at(s as f32 / 20.0);
                for (i, bx) in l.boxes.iter().enumerate() {
                    if i != a && i != b {
                        assert!(!Rect::new(bx.x + 1.0, bx.y + 1.0, bx.w - 2.0, bx.h - 2.0).contains(pt), "edge {a}->{b} crosses {i}");
                    }
                }
            }
        }
    }
}
