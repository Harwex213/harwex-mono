//! Sugiyama layering of the connected packages: ranks, dummy lanes, barycenter ordering,
//! coordinates, and arrow routes along the reserved lanes.

use crate::{Params, Point, Rect, Route, Seg};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum NodeKind {
    Package(usize),
    Dummy,
}

#[derive(Debug, Clone)]
pub(crate) struct NodeInfo {
    pub kind: NodeKind,
    pub w: f32,
    pub h: f32,
}

/// One input edge as a chain of nodes from the left column to the right one.
#[derive(Debug, Clone)]
struct Chain {
    nodes: Vec<usize>,
    /// Drawn right to left: the edge closed a cycle and was flipped for the layering.
    against_flow: bool,
}

pub(crate) struct Graph {
    pub nodes: Vec<NodeInfo>,
    pub col: Vec<usize>,
    /// Top-left of each node. A package node includes its label band.
    pub x: Vec<f32>,
    pub y: Vec<f32>,
    chains: Vec<Option<Chain>>,
    col_x: Vec<f32>,
    col_w: Vec<f32>,
}

/// Sweeps of the barycenter ordering. More rarely helps on graphs of this size.
const ORDER_SWEEPS: usize = 24;
/// Rounds of the vertical alignment.
const ALIGN_ROUNDS: usize = 12;
/// A long edge's lane resists moving more than a box does, so long arrows stay straight.
const LANE_WEIGHT: f32 = 3.0;

impl Graph {
    pub(crate) fn build(n: usize, connected: &[bool], edges: &[(usize, usize)], boxes: &[Rect], p: &Params) -> Graph {
        let mut nodes = Vec::new();
        let mut node_of = vec![usize::MAX; n];
        for i in 0..n {
            if connected[i] {
                node_of[i] = nodes.len();
                nodes.push(NodeInfo { kind: NodeKind::Package(i), w: boxes[i].w, h: boxes[i].h + p.label_h });
            }
        }
        let m = nodes.len();
        let dag = break_cycles(m, edges.iter().map(|&(a, b)| (node_of[a], node_of[b])).collect());
        let mut rank = ranks(m, &dag);
        let heights: Vec<f32> = nodes.iter().map(|n| n.h).collect();
        let area: f32 = nodes.iter().map(|n| (n.w + p.layer_gap) * (n.h + p.node_gap)).sum();
        let tallest = heights.iter().copied().fold(0.0, f32::max);
        let limit = ((area / p.box_aspect).sqrt() * 1.2).max(tallest);
        limit_column_height(&mut rank, &dag, &heights, limit, p.node_gap);
        let max_rank = rank.iter().copied().max().unwrap_or(0);
        let mut col: Vec<usize> = rank.iter().map(|r| max_rank - r).collect();

        let mut chains = Vec::with_capacity(edges.len());
        for &(a, b, flipped) in &dag {
            let mut chain = vec![a];
            for c in col[a] + 1..col[b] {
                chain.push(nodes.len());
                nodes.push(NodeInfo { kind: NodeKind::Dummy, w: 0.0, h: p.lane_h });
                col.push(c);
            }
            chain.push(b);
            chains.push(Some(Chain { nodes: chain, against_flow: flipped }));
        }

        let cols = max_rank + 1;
        let mut left_nb = vec![Vec::new(); nodes.len()];
        let mut right_nb = vec![Vec::new(); nodes.len()];
        for ch in chains.iter().flatten() {
            for w in ch.nodes.windows(2) {
                right_nb[w[0]].push(w[1]);
                left_nb[w[1]].push(w[0]);
            }
        }
        let layers = order_layers(cols, &col, &left_nb, &right_nb);

        // Columns: widest box, then a gap that grows with the arrows crossing it.
        let mut col_w = vec![0.0f32; cols];
        for (v, info) in nodes.iter().enumerate() {
            col_w[col[v]] = col_w[col[v]].max(info.w);
        }
        let mut col_x = vec![0.0f32; cols];
        for c in 1..cols {
            let crossing = layers[c - 1].iter().map(|&v| right_nb[v].len()).sum::<usize>() as f32;
            let gap = (p.layer_gap + p.layer_gap_per_edge * crossing).min(p.max_layer_gap);
            col_x[c] = col_x[c - 1] + col_w[c - 1] + gap;
        }
        let x: Vec<f32> = (0..nodes.len()).map(|v| col_x[col[v]]).collect();
        let y = align(&nodes, &layers, &left_nb, &right_nb, p);

        Graph { nodes, col, x, y, chains, col_x, col_w }
    }

    pub(crate) fn translate(&mut self, dx: f32, dy: f32) {
        self.x.iter_mut().for_each(|x| *x += dx);
        self.y.iter_mut().for_each(|y| *y += dy);
        self.col_x.iter_mut().for_each(|x| *x += dx);
    }

    /// Routes for the edges given to `build`, in the same order.
    pub(crate) fn routes(&self, boxes: &[Rect], p: &Params) -> Vec<Option<Route>> {
        let rect = |v: usize| match self.nodes[v].kind {
            NodeKind::Package(i) => boxes[i],
            NodeKind::Dummy => Rect::new(self.x[v], self.y[v], 0.0, self.nodes[v].h),
        };
        // Ports: arrows on one side of a box are spread around its middle, ordered by where
        // their other end is, so they leave without crossing each other.
        let mut out_ports: Vec<Vec<(f32, usize)>> = vec![Vec::new(); self.nodes.len()];
        let mut in_ports: Vec<Vec<(f32, usize)>> = vec![Vec::new(); self.nodes.len()];
        for (k, ch) in self.chains.iter().enumerate() {
            let Some(ch) = ch else { continue };
            let (first, second) = (ch.nodes[0], ch.nodes[1]);
            let (last, before) = (ch.nodes[ch.nodes.len() - 1], ch.nodes[ch.nodes.len() - 2]);
            out_ports[first].push((rect(second).center_y(), k));
            in_ports[last].push((rect(before).center_y(), k));
        }
        let mut start_y = vec![0.0f32; self.chains.len()];
        let mut end_y = vec![0.0f32; self.chains.len()];
        for v in 0..self.nodes.len() {
            let r = rect(v);
            spread(&mut out_ports[v], r, p.port_gap, &mut start_y);
            spread(&mut in_ports[v], r, p.port_gap, &mut end_y);
        }

        self.chains
            .iter()
            .enumerate()
            .map(|(k, ch)| {
                let ch = ch.as_ref()?;
                let a = rect(ch.nodes[0]);
                let mut segs = Vec::new();
                let mut at = Point::new(a.right(), start_y[k]);
                let col_right = |v: usize| self.col_x[self.col[v]] + self.col_w[self.col[v]];
                // Run to the column's edge first: below or above a narrow box may sit a wider one.
                let edge = Point::new(col_right(ch.nodes[0]), at.y);
                if edge.x > at.x {
                    segs.push(Seg::Line(at, edge));
                    at = edge;
                }
                for &v in &ch.nodes[1..ch.nodes.len() - 1] {
                    let y = rect(v).center_y();
                    let enter = Point::new(self.col_x[self.col[v]], y);
                    let leave = Point::new(col_right(v), y);
                    segs.push(Seg::Curve(at, enter));
                    if leave.x > enter.x {
                        segs.push(Seg::Line(enter, leave));
                    }
                    at = leave;
                }
                let b = rect(ch.nodes[ch.nodes.len() - 1]);
                segs.push(Seg::Curve(at, Point::new(b.x, end_y[k])));
                let route = Route { segs, against_flow: ch.against_flow };
                Some(if ch.against_flow { route.reversed() } else { route })
            })
            .collect()
    }
}

fn spread(ports: &mut [(f32, usize)], r: Rect, gap: f32, out: &mut [f32]) {
    if ports.is_empty() {
        return;
    }
    ports.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    let n = ports.len() as f32;
    let room = (r.h - 16.0).max(0.0);
    let step = if n > 1.0 { gap.min(room / (n - 1.0)) } else { 0.0 };
    let top = r.center_y() - step * (n - 1.0) / 2.0;
    for (i, &(_, k)) in ports.iter().enumerate() {
        out[k] = top + step * i as f32;
    }
}

/// DFS from every node in index order; an edge into a node still on the stack closes a cycle
/// and is flipped. Returns `(left, right, flipped)` per input edge.
fn break_cycles(m: usize, edges: Vec<(usize, usize)>) -> Vec<(usize, usize, bool)> {
    let mut out_edges = vec![Vec::new(); m];
    for (k, &(a, b)) in edges.iter().enumerate() {
        out_edges[a].push((b, k));
    }
    let mut flipped = vec![false; edges.len()];
    // 0 = new, 1 = on stack, 2 = done.
    let mut state = vec![0u8; m];
    for start in 0..m {
        if state[start] != 0 {
            continue;
        }
        let mut stack = vec![(start, 0usize)];
        state[start] = 1;
        while let Some(top) = stack.last_mut() {
            let v = top.0;
            if let Some(&(w, k)) = out_edges[v].get(top.1) {
                top.1 += 1;
                match state[w] {
                    0 => {
                        state[w] = 1;
                        stack.push((w, 0));
                    }
                    1 => flipped[k] = true,
                    _ => {}
                }
            } else {
                state[v] = 2;
                stack.pop();
            }
        }
    }
    edges.into_iter().enumerate().map(|(k, (a, b))| if flipped[k] { (b, a, true) } else { (a, b, false) }).collect()
}

/// Rank 0 has no dependencies (the right column). A dependent ranks above all its
/// dependencies. A node then moves up next to its lowest dependent when that shortens more
/// arrows than it stretches.
fn ranks(m: usize, dag: &[(usize, usize, bool)]) -> Vec<usize> {
    let mut outs = vec![Vec::new(); m];
    let mut ins = vec![Vec::new(); m];
    for &(a, b, _) in dag {
        outs[a].push(b);
        ins[b].push(a);
    }
    // Longest path to a sink, in reverse topological order (Kahn on the reversed graph).
    let mut rank = vec![0usize; m];
    let mut pending: Vec<usize> = outs.iter().map(Vec::len).collect();
    let mut ready: Vec<usize> = (0..m).filter(|&v| pending[v] == 0).collect();
    let mut topo = Vec::with_capacity(m);
    while let Some(v) = ready.pop() {
        topo.push(v);
        for &u in &ins[v] {
            rank[u] = rank[u].max(rank[v] + 1);
            pending[u] -= 1;
            if pending[u] == 0 {
                ready.push(u);
            }
        }
    }
    for _ in 0..m {
        let mut changed = false;
        // Dependents first, so a move can make room for the nodes below it.
        for &v in topo.iter().rev() {
            if ins[v].is_empty() || ins[v].len() < outs[v].len() {
                continue;
            }
            let ceiling = ins[v].iter().map(|&u| rank[u]).min().unwrap_or(0).saturating_sub(1);
            if ceiling > rank[v] {
                rank[v] = ceiling;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    rank
}

/// Columns taller than `limit` give nodes to the next column on the left. Nodes nothing
/// depends on go first, since moving them stretches no other arrow. Dependents of a moved node
/// move further left as needed; their longer arrows get lanes like any long edge.
fn limit_column_height(rank: &mut [usize], dag: &[(usize, usize, bool)], heights: &[f32], limit: f32, gap: f32) {
    let m = rank.len();
    let mut ins = vec![Vec::new(); m];
    for &(a, b, _) in dag {
        ins[b].push(a);
    }
    let mut r = 0;
    while r <= rank.iter().copied().max().unwrap_or(0) {
        let mut at: Vec<usize> = (0..m).filter(|&v| rank[v] == r).collect();
        // Keep the nodes others depend on; overflow the free ones, last in index order first.
        at.sort_by_key(|&v| (std::cmp::Reverse(ins[v].len()), v));
        let mut h = 0.0;
        let mut moved = Vec::new();
        for (k, &v) in at.iter().enumerate() {
            h += heights[v] + if k > 0 { gap } else { 0.0 };
            if h > limit && k > 0 {
                moved.push(v);
            }
        }
        for v in moved {
            rank[v] = r + 1;
            let mut stack = vec![v];
            while let Some(x) = stack.pop() {
                for &u in &ins[x] {
                    if rank[u] <= rank[x] {
                        rank[u] = rank[x] + 1;
                        stack.push(u);
                    }
                }
            }
        }
        r += 1;
    }
}

/// Barycenter ordering, alternating left-to-right and right-to-left sweeps. Keeps the order
/// with the fewest crossings.
fn order_layers(cols: usize, col: &[usize], left_nb: &[Vec<usize>], right_nb: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let mut layers = vec![Vec::new(); cols];
    for (v, &c) in col.iter().enumerate() {
        layers[c].push(v);
    }
    let mut pos = vec![0.0f32; col.len()];
    let set_pos = |layers: &Vec<Vec<usize>>, pos: &mut Vec<f32>| {
        for l in layers {
            for (i, &v) in l.iter().enumerate() {
                pos[v] = i as f32;
            }
        }
    };
    // Start from a DFS order, which keeps the nodes of one chain at similar heights.
    let mut seen = vec![false; col.len()];
    let mut dfs_order = Vec::with_capacity(col.len());
    for start in 0..col.len() {
        let mut stack = vec![start];
        while let Some(v) = stack.pop() {
            if std::mem::replace(&mut seen[v], true) {
                continue;
            }
            dfs_order.push(v);
            stack.extend(right_nb[v].iter().rev());
        }
    }
    let mut rank_in_dfs = vec![0; col.len()];
    for (i, &v) in dfs_order.iter().enumerate() {
        rank_in_dfs[v] = i;
    }
    for l in &mut layers {
        l.sort_by_key(|&v| rank_in_dfs[v]);
    }
    set_pos(&layers, &mut pos);
    let mut best = layers.clone();
    let mut best_cross = crossings(&layers, &pos, right_nb);
    // Each sweep sorts every column; on a graph with very many lanes the late sweeps buy
    // little and cost seconds.
    let sweeps = if col.len() > 200_000 {
        4
    } else if col.len() > 20_000 {
        8
    } else {
        ORDER_SWEEPS
    };
    for sweep in 0..sweeps {
        let forward = sweep % 2 == 0;
        let cs: Vec<usize> = if forward { (1..cols).collect() } else { (0..cols.saturating_sub(1)).rev().collect() };
        for c in cs {
            let nbs = if forward { left_nb } else { right_nb };
            let mut keyed: Vec<(f32, usize)> = layers[c]
                .iter()
                .map(|&v| {
                    let nb = &nbs[v];
                    let key = if nb.is_empty() { pos[v] } else { nb.iter().map(|&u| pos[u]).sum::<f32>() / nb.len() as f32 };
                    (key, v)
                })
                .collect();
            keyed.sort_by(|a, b| a.0.total_cmp(&b.0));
            layers[c] = keyed.into_iter().map(|(_, v)| v).collect();
            for (i, &v) in layers[c].iter().enumerate() {
                pos[v] = i as f32;
            }
        }
        let cross = crossings(&layers, &pos, right_nb);
        if cross < best_cross {
            best_cross = cross;
            best = layers.clone();
        }
    }
    best
}

/// Edge crossings between neighbouring columns: sort the links by their left end, then count
/// inversions of their right ends with a Fenwick tree. O(m log m) per column pair; the direct
/// pair test is quadratic and takes minutes on ten thousand edges.
pub(crate) fn crossings(layers: &[Vec<usize>], pos: &[f32], right_nb: &[Vec<usize>]) -> usize {
    let mut total = 0;
    for l in layers {
        let mut links: Vec<(usize, usize)> = l.iter().flat_map(|&v| right_nb[v].iter().map(move |&w| (pos[v] as usize, pos[w] as usize))).collect();
        if links.len() < 2 {
            continue;
        }
        links.sort_unstable();
        let size = links.iter().map(|l| l.1).max().unwrap_or(0) + 2;
        let mut tree = vec![0usize; size];
        for (seen, &(_, b)) in links.iter().enumerate() {
            // Links already seen whose right end is strictly below b's cross this one.
            let mut not_above = 0;
            let mut i = b + 1;
            while i > 0 {
                not_above += tree[i];
                i -= i & i.wrapping_neg();
            }
            total += seen - not_above;
            let mut i = b + 1;
            while i < size {
                tree[i] += 1;
                i += i & i.wrapping_neg();
            }
        }
    }
    total
}

/// Vertical positions: each column is stacked in its order, then every round pulls each node
/// toward the mean height of its neighbours. A weighted isotonic regression (pool adjacent
/// violators) keeps the order and the gaps.
fn align(nodes: &[NodeInfo], layers: &[Vec<usize>], left_nb: &[Vec<usize>], right_nb: &[Vec<usize>], p: &Params) -> Vec<f32> {
    let mut y = vec![0.0f32; nodes.len()];
    let sep = |a: usize, b: usize| {
        let lanes = matches!(nodes[a].kind, NodeKind::Dummy) && matches!(nodes[b].kind, NodeKind::Dummy);
        if lanes {
            0.0
        } else {
            p.node_gap
        }
    };
    for l in layers {
        let mut at = 0.0;
        for (i, &v) in l.iter().enumerate() {
            if i > 0 {
                at += sep(l[i - 1], v);
            }
            y[v] = at;
            at += nodes[v].h;
        }
    }
    // The tallest column is the spine: shorter columns start centred on it.
    let heights: Vec<f32> = layers.iter().map(|l| l.last().map_or(0.0, |&v| y[v] + nodes[v].h)).collect();
    let tallest = heights.iter().copied().fold(0.0, f32::max);
    for (l, h) in layers.iter().zip(heights) {
        let shift = (tallest - h) / 2.0;
        for &v in l {
            y[v] += shift;
        }
    }
    let center = |y: &[f32], v: usize| y[v] + nodes[v].h / 2.0;
    for round in 0..ALIGN_ROUNDS {
        let order: Vec<usize> = if round % 2 == 0 { (0..layers.len()).collect() } else { (0..layers.len()).rev().collect() };
        for c in order {
            let l = &layers[c];
            if l.is_empty() {
                continue;
            }
            let mut offsets = Vec::with_capacity(l.len());
            let mut acc = 0.0;
            for (i, &v) in l.iter().enumerate() {
                if i > 0 {
                    acc += nodes[l[i - 1]].h + sep(l[i - 1], v);
                }
                offsets.push(acc);
            }
            let targets: Vec<(f32, f32)> = l
                .iter()
                .zip(&offsets)
                .map(|(&v, &off)| {
                    let nbs: Vec<usize> = left_nb[v].iter().chain(&right_nb[v]).copied().collect();
                    let want_center = if nbs.is_empty() { center(&y, v) } else { nbs.iter().map(|&u| center(&y, u)).sum::<f32>() / nbs.len() as f32 };
                    let weight = if matches!(nodes[v].kind, NodeKind::Dummy) { LANE_WEIGHT } else { 1.0 };
                    (want_center - nodes[v].h / 2.0 - off, weight)
                })
                .collect();
            let fitted = isotonic(&targets);
            for (i, &v) in l.iter().enumerate() {
                y[v] = fitted[i] + offsets[i];
            }
        }
    }
    let min = y.iter().copied().fold(f32::INFINITY, f32::min);
    if min.is_finite() {
        for v in &mut y {
            *v -= min;
        }
    }
    y
}

/// Weighted least-squares fit of a non-decreasing sequence (pool adjacent violators).
fn isotonic(values: &[(f32, f32)]) -> Vec<f32> {
    // Blocks of (mean, weight, count).
    let mut blocks: Vec<(f32, f32, usize)> = Vec::with_capacity(values.len());
    for &(v, w) in values {
        blocks.push((v, w, 1));
        while blocks.len() > 1 && blocks[blocks.len() - 2].0 > blocks[blocks.len() - 1].0 {
            let b = blocks.pop().expect("two blocks");
            let a = blocks.last_mut().expect("two blocks");
            let w = a.1 + b.1;
            *a = ((a.0 * a.1 + b.0 * b.1) / w, w, a.2 + b.2);
        }
    }
    blocks.into_iter().flat_map(|(m, _, c)| std::iter::repeat_n(m, c)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isotonic_pools_violators() {
        let fit = isotonic(&[(1.0, 1.0), (3.0, 1.0), (2.0, 1.0), (4.0, 1.0)]);
        assert_eq!(fit, [1.0, 2.5, 2.5, 4.0]);
    }

    #[test]
    fn crossings_match_the_pair_test() {
        // Column 0: nodes 0..4, column 1: nodes 4..8, with some links crossing.
        let layers = vec![vec![0, 1, 2, 3], vec![4, 5, 6, 7]];
        let pos: Vec<f32> = [0, 1, 2, 3, 0, 1, 2, 3].iter().map(|&p| p as f32).collect();
        let mut right_nb = vec![Vec::new(); 8];
        right_nb[0] = vec![7, 5];
        right_nb[1] = vec![4];
        right_nb[2] = vec![6, 4];
        right_nb[3] = vec![5];
        let pos_ref = &pos;
        let links: Vec<(f32, f32)> = (0..4).flat_map(|v| right_nb[v].iter().map(move |&w| (v as f32, pos_ref[w]))).collect();
        let mut pairs = 0;
        for i in 0..links.len() {
            for j in i + 1..links.len() {
                if (links[i].0 - links[j].0) * (links[i].1 - links[j].1) < 0.0 {
                    pairs += 1;
                }
            }
        }
        assert_eq!(crossings(&layers, &pos, &right_nb), pairs);
    }

    #[test]
    fn cycles_are_flipped_once() {
        let dag = break_cycles(3, vec![(0, 1), (1, 2), (2, 0)]);
        assert_eq!(dag.iter().filter(|e| e.2).count(), 1);
        let r = ranks(3, &dag);
        for &(a, b, _) in &dag {
            assert!(r[a] > r[b]);
        }
    }
}
