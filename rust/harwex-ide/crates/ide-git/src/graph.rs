//! Lane layout for the branch graph in the log.
//!
//! Each row gets the lane of its commit node plus the line segments that cross it. A segment
//! connects lane `from` at the center of one row to lane `to` at the center of the next row.
//! Row `i` lists the segments that leave it (`down`) and those that arrive in it (`up`), so a
//! virtualized list can draw any row on its own: the upper half of row `i` draws `up` from
//! the midpoint to the center, the lower half draws `down` from the center to the midpoint.
//!
//! A line longer than `LONG_EDGE_ROWS` rows is cut like in IDEA: it shows a one-row stub
//! below the child that ends in a down arrow, and a one-row stub above the parent that
//! starts with an up arrow. Between the stubs the line takes no lane, so it does not widen
//! the graph.

use std::collections::HashMap;

use crate::{CommitInfo, Oid, Repo};

/// A line between a child and its parent that spans more rows than this is cut into two
/// arrow stubs. IDEA cuts at about 30 rows.
pub const LONG_EDGE_ROWS: usize = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GraphEdge {
    /// Lane in the upper row.
    pub from: usize,
    /// Lane in the lower row.
    pub to: usize,
    /// Color index; the app maps it onto its palette (index modulo palette size).
    pub color: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArrowDir {
    /// The stub below a child ends here; the line continues to `target` further down.
    Down,
    /// The stub above a parent starts here; the line comes from `target` further up.
    Up,
}

/// The end of a cut long line, drawn at the row's center in `lane`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GraphArrow {
    pub lane: usize,
    pub color: usize,
    pub dir: ArrowDir,
    /// The commit at the other end of the line (IDEA jumps there on click). For `Down` it
    /// may not be loaded yet.
    pub target: Oid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphRow {
    /// Lane of this row's commit node.
    pub lane: usize,
    pub color: usize,
    /// Segments from the previous row into this one.
    pub up: Vec<GraphEdge>,
    /// Segments from this row into the next one. On the last row they point at parents
    /// that are not loaded yet and continue straight down.
    pub down: Vec<GraphEdge>,
    /// Ends of cut long lines in this row. A `Down` arrow ends an `up` segment; an `Up`
    /// arrow starts a `down` segment.
    pub arrows: Vec<GraphArrow>,
    /// Number of lanes used in this row, for the graph column width.
    pub width: usize,
}

/// A line drawn in a lane, waiting for the commit `oid`.
#[derive(Debug, Clone, Copy)]
struct Line {
    oid: Oid,
    color: usize,
    /// The commit the line starts at, for the up arrow of a cut line.
    child: Oid,
    /// The row where the line's first stub ends, for a long line.
    cut_at: Option<usize>,
}

/// A cut line between its stubs: it holds no lane until the row above its parent.
struct Suspended {
    line: Line,
    /// Row of the parent; None when it is not loaded.
    parent_row: Option<usize>,
}

/// Lane layout for commits in log order (children before parents). Pure function; `Repo`
/// exposes it as a method for the plan's API.
pub fn layout(commits: &[CommitInfo]) -> Vec<GraphRow> {
    let row_of: HashMap<Oid, usize> = commits.iter().enumerate().map(|(i, c)| (c.oid, i)).collect();
    // Each lane waits for one commit: the parent of the line drawn in it.
    let mut lanes: Vec<Option<Line>> = Vec::new();
    let mut suspended: Vec<Suspended> = Vec::new();
    let mut next_color = 0usize;
    let mut rows: Vec<GraphRow> = Vec::with_capacity(commits.len());
    let last = commits.len().saturating_sub(1);

    let alloc = |lanes: &mut Vec<Option<Line>>, avoid: Option<usize>| -> usize {
        match lanes.iter().enumerate().position(|(i, l)| l.is_none() && Some(i) != avoid) {
            Some(i) => i,
            None => {
                lanes.push(None);
                lanes.len() - 1
            }
        }
    };
    let waits_for = |l: &Option<Line>, oid: Oid| l.is_some_and(|l| l.oid == oid);

    for (row, commit) in commits.iter().enumerate() {
        // A line is long when its parent is far below, or not loaded while more than the
        // threshold of rows still follows.
        let new_line = |parent: Oid, color: usize| -> Line {
            let long = match row_of.get(&parent) {
                Some(&p) => p > row + LONG_EDGE_ROWS,
                None => last > row + LONG_EDGE_ROWS,
            };
            Line { oid: parent, color, child: commit.oid, cut_at: long.then_some(row + 1) }
        };

        let node = lanes.iter().position(|l| waits_for(l, commit.oid));
        let (node, color) = match node {
            Some(i) => (i, lanes[i].expect("lane is occupied").color),
            None => {
                // A branch tip: nothing above points at it.
                let i = alloc(&mut lanes, None);
                next_color += 1;
                (i, next_color - 1)
            }
        };
        // Other lines waiting for this commit end here; their `down` segments from the row
        // above already bend into the node.
        for (i, l) in lanes.iter_mut().enumerate() {
            if i != node && waits_for(l, commit.oid) {
                *l = None;
            }
        }

        // Lanes the node itself feeds into the next row, and whether each one already had a
        // line above (a merge into an existing line) or was opened by this node.
        let mut node_targets: Vec<(usize, bool)> = Vec::new();
        lanes[node] = None;
        for (pi, parent) in commit.parents.iter().enumerate() {
            if pi == 0 {
                // The first parent always continues straight down in the node's lane, even if
                // another line already waits for it; the two meet at the parent's row. This
                // keeps the main line straight like IDEA does.
                lanes[node] = Some(new_line(*parent, color));
                node_targets.push((node, false));
                continue;
            }
            // A line that is cut in this row cannot take the merge; it gets its own stub.
            if let Some(existing) = lanes.iter().position(|l| waits_for(l, *parent) && l.is_some_and(|l| l.cut_at.is_none())) {
                // The merged parent already has a line; join it instead of opening a lane.
                node_targets.push((existing, true));
                continue;
            }
            let i = alloc(&mut lanes, Some(node));
            next_color += 1;
            lanes[i] = Some(new_line(*parent, next_color - 1));
            node_targets.push((i, false));
        }

        let mut arrows = Vec::new();
        // Cut lines whose parent is the next row get their second stub here.
        let mut i = 0;
        while i < suspended.len() {
            if suspended[i].parent_row == Some(row + 1) {
                let line = suspended.swap_remove(i).line;
                let lane = alloc(&mut lanes, Some(node));
                lanes[lane] = Some(Line { cut_at: None, ..line });
                arrows.push(GraphArrow { lane, color: line.color, dir: ArrowDir::Up, target: line.child });
            } else {
                i += 1;
            }
        }
        // Long lines whose first stub ends here leave their lane.
        for (lane, l) in lanes.iter_mut().enumerate() {
            let Some(line) = *l else { continue };
            if line.cut_at != Some(row) {
                continue;
            }
            arrows.push(GraphArrow { lane, color: line.color, dir: ArrowDir::Down, target: line.oid });
            suspended.push(Suspended { line, parent_row: row_of.get(&line.oid).copied() });
            *l = None;
        }

        // Where each lane lands in the next row: the line waiting for the next commit bends
        // into that commit's node, which is the lowest lane waiting for it.
        let next_oid = commits.get(row + 1).map(|c| c.oid);
        let next_node = next_oid.and_then(|n| lanes.iter().position(|l| waits_for(l, n)));
        let target = |lane: usize, oid: Oid| -> usize {
            if Some(oid) == next_oid {
                next_node.unwrap_or(lane)
            } else {
                lane
            }
        };

        let mut down = Vec::new();
        for (i, l) in lanes.iter().enumerate() {
            let Some(line) = *l else { continue };
            // Lines opened by this node start at the node, not above it.
            if node_targets.contains(&(i, false)) {
                continue;
            }
            // Lines toward commits outside the loaded page simply run straight on.
            down.push(GraphEdge { from: i, to: target(i, line.oid), color: line.color });
        }
        for &(t, _) in &node_targets {
            let line = lanes[t].expect("target lane is occupied");
            down.push(GraphEdge { from: node, to: target(t, line.oid), color: line.color });
        }

        let width = lanes
            .iter()
            .rposition(Option::is_some)
            .map_or(0, |i| i + 1)
            .max(node + 1)
            .max(arrows.iter().map(|a| a.lane + 1).max().unwrap_or(0));
        rows.push(GraphRow { lane: node, color, up: Vec::new(), down, arrows, width });

        // Trailing empty lanes would only widen later rows.
        while lanes.last().is_some_and(Option::is_none) {
            lanes.pop();
        }
    }

    for i in 1..rows.len() {
        let up = rows[i - 1].down.clone();
        let w = up.iter().map(|e| e.to + 1).max().unwrap_or(0);
        rows[i].width = rows[i].width.max(w);
        rows[i].up = up;
    }
    rows
}

impl Repo {
    /// Lane layout for drawing the branch graph next to `commits` (as returned by `log`).
    pub fn graph(&self, commits: &[CommitInfo]) -> Vec<GraphRow> {
        layout(commits)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(id: u8, parents: &[u8]) -> CommitInfo {
        let oid = |b: u8| Oid::from_bytes(&[b; 20]).unwrap();
        CommitInfo {
            oid: oid(id),
            parents: parents.iter().map(|&p| oid(p)).collect(),
            summary: String::new(),
            author_name: String::new(),
            author_email: String::new(),
            author_time: 0,
            author_offset_minutes: 0,
            committer_time: 0,
            refs: Vec::new(),
        }
    }

    fn oid(b: u8) -> Oid {
        Oid::from_bytes(&[b; 20]).unwrap()
    }

    /// Commit 0 merges a main line 1..=n (each the parent of the previous) and `side`.
    fn merge_over_chain(n: u8, side: u8, side_loaded: bool) -> Vec<CommitInfo> {
        let mut v = vec![c(0, &[1, side])];
        for i in 1..=n {
            let parents: Vec<u8> = if i < n { vec![i + 1] } else { Vec::new() };
            v.push(c(i, &parents));
        }
        if side_loaded {
            v.push(c(side, &[]));
        }
        v
    }

    fn check_up_matches_down(rows: &[GraphRow]) {
        for i in 1..rows.len() {
            assert_eq!(rows[i].up, rows[i - 1].down, "row {i}");
        }
    }

    #[test]
    fn long_edge_is_cut_into_two_arrow_stubs() {
        let rows = layout(&merge_over_chain(40, 100, true));
        check_up_matches_down(&rows);
        let side_row = rows.len() - 1;
        assert!(side_row > LONG_EDGE_ROWS);
        // The stub below the merge ends in row 1 with a down arrow to the side parent.
        assert_eq!(rows[0].down.len(), 2);
        assert_eq!(rows[1].arrows, vec![GraphArrow { lane: 1, color: 1, dir: ArrowDir::Down, target: oid(100) }]);
        assert!(rows[1].down.iter().all(|e| e.from == 0 && e.to == 0));
        // Between the stubs the graph is one lane wide.
        for r in &rows[2..side_row - 1] {
            assert_eq!(r.width, 1);
            assert!(r.arrows.is_empty());
        }
        // The stub above the parent starts with an up arrow pointing back at the merge.
        let above = &rows[side_row - 1];
        assert_eq!(above.arrows, vec![GraphArrow { lane: 1, color: 1, dir: ArrowDir::Up, target: oid(0) }]);
        assert!(above.down.contains(&GraphEdge { from: 1, to: 1, color: 1 }), "{:?}", above.down);
        // The side commit sits in the lane of the stub that reaches it.
        assert_eq!(rows[side_row].lane, 1);
    }

    #[test]
    fn short_edges_and_short_pages_are_not_cut() {
        let rows = layout(&merge_over_chain(LONG_EDGE_ROWS as u8 - 1, 100, true));
        assert!(rows.iter().all(|r| r.arrows.is_empty()));
        // The parent is not loaded, and fewer rows than the threshold follow.
        let rows = layout(&merge_over_chain(10, 100, false));
        assert!(rows.iter().all(|r| r.arrows.is_empty()));
        assert_eq!(rows.last().unwrap().width, 2);
    }

    #[test]
    fn long_edge_to_unloaded_parent_has_only_the_down_stub() {
        let rows = layout(&merge_over_chain(40, 100, false));
        check_up_matches_down(&rows);
        let arrows: Vec<(usize, ArrowDir)> =
            rows.iter().enumerate().flat_map(|(i, r)| r.arrows.iter().map(move |a| (i, a.dir))).collect();
        assert_eq!(arrows, vec![(1, ArrowDir::Down)]);
        assert!(rows[2..].iter().all(|r| r.width == 1));
    }

    #[test]
    fn merge_into_a_line_being_cut_gets_its_own_stub() {
        // 0 and 1 both merge 100, which sits 41 rows down.
        let mut v = merge_over_chain(40, 100, true);
        v[1] = c(1, &[2, 100]);
        let rows = layout(&v);
        check_up_matches_down(&rows);
        let downs = rows.iter().flat_map(|r| &r.arrows).filter(|a| a.dir == ArrowDir::Down).count();
        let ups = rows.iter().flat_map(|r| &r.arrows).filter(|a| a.dir == ArrowDir::Up).count();
        assert_eq!((downs, ups), (2, 2));
        let last = rows.last().unwrap();
        assert!(last.up.iter().all(|e| e.to == last.lane));
    }

    #[test]
    fn two_tips_meet_at_shared_parent() {
        let rows = layout(&[c(1, &[3]), c(2, &[3]), c(3, &[])]);
        assert_eq!(rows[0].lane, 0);
        assert_eq!(rows[1].lane, 1);
        assert_eq!(rows[1].up, vec![GraphEdge { from: 0, to: 0, color: 0 }]);
        assert_eq!(rows[2].lane, 0);
        let mut ups: Vec<(usize, usize)> = rows[2].up.iter().map(|e| (e.from, e.to)).collect();
        ups.sort();
        assert_eq!(ups, vec![(0, 0), (1, 0)]);
        assert_ne!(rows[0].color, rows[1].color);
    }

    #[test]
    fn freed_lane_is_reused_and_missing_parents_continue() {
        // 1 merges 2 and 3; 3 is a short side line, 4 is not loaded yet.
        let rows = layout(&[c(1, &[2, 3]), c(3, &[2]), c(2, &[4])]);
        assert_eq!(rows[1].lane, 1);
        assert_eq!(rows[2].lane, 0);
        assert!(rows[2].up.iter().any(|e| e.from == 1 && e.to == 0));
        assert_eq!(rows[2].down, vec![GraphEdge { from: 0, to: 0, color: 0 }]);
        // A new tip after the side line ended takes the free lane again.
        let rows = layout(&[c(1, &[2, 3]), c(3, &[2]), c(2, &[]), c(5, &[])]);
        assert_eq!(rows[3].lane, 0);
        assert_eq!(rows[3].width, 1);
    }
}
