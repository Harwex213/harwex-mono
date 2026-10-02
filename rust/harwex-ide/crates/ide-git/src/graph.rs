//! Lane layout for the branch graph in the log.
//!
//! Each row gets the lane of its commit node plus the line segments that cross it. A segment
//! connects lane `from` at the center of one row to lane `to` at the center of the next row.
//! Row `i` lists the segments that leave it (`down`) and those that arrive in it (`up`), so a
//! virtualized list can draw any row on its own: the upper half of row `i` draws `up` from
//! the midpoint to the center, the lower half draws `down` from the center to the midpoint.

use crate::{CommitInfo, Oid, Repo};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GraphEdge {
    /// Lane in the upper row.
    pub from: usize,
    /// Lane in the lower row.
    pub to: usize,
    /// Color index; the app maps it onto its palette (index modulo palette size).
    pub color: usize,
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
    /// Number of lanes used in this row, for the graph column width.
    pub width: usize,
}

/// Lane layout for commits in log order (children before parents). Pure function; `Repo`
/// exposes it as a method for the plan's API.
pub fn layout(commits: &[CommitInfo]) -> Vec<GraphRow> {
    // Each lane waits for one commit: the parent of the line drawn in it.
    let mut lanes: Vec<Option<(Oid, usize)>> = Vec::new();
    let mut next_color = 0usize;
    let mut rows: Vec<GraphRow> = Vec::with_capacity(commits.len());

    let alloc = |lanes: &mut Vec<Option<(Oid, usize)>>, avoid: Option<usize>| -> usize {
        match lanes.iter().enumerate().position(|(i, l)| l.is_none() && Some(i) != avoid) {
            Some(i) => i,
            None => {
                lanes.push(None);
                lanes.len() - 1
            }
        }
    };

    for (row, commit) in commits.iter().enumerate() {
        let node = lanes.iter().position(|l| l.is_some_and(|(o, _)| o == commit.oid));
        let (node, color) = match node {
            Some(i) => (i, lanes[i].expect("lane is occupied").1),
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
            if i != node && l.is_some_and(|(o, _)| o == commit.oid) {
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
                lanes[node] = Some((*parent, color));
                node_targets.push((node, false));
                continue;
            }
            if let Some(existing) = lanes.iter().position(|l| l.is_some_and(|(o, _)| o == *parent)) {
                // The merged parent already has a line; join it instead of opening a lane.
                node_targets.push((existing, true));
                continue;
            }
            let i = alloc(&mut lanes, Some(node));
            next_color += 1;
            lanes[i] = Some((*parent, next_color - 1));
            node_targets.push((i, false));
        }

        // Where each lane lands in the next row: the line waiting for the next commit bends
        // into that commit's node, which is the lowest lane waiting for it.
        let next_oid = commits.get(row + 1).map(|c| c.oid);
        let next_node = next_oid.and_then(|n| lanes.iter().position(|l| l.is_some_and(|(o, _)| o == n)));
        let target = |lane: usize, oid: Oid| -> usize {
            if Some(oid) == next_oid {
                next_node.unwrap_or(lane)
            } else {
                lane
            }
        };

        let mut down = Vec::new();
        for (i, l) in lanes.iter().enumerate() {
            let Some((oid, c)) = *l else { continue };
            // Lines opened by this node start at the node, not above it.
            if node_targets.contains(&(i, false)) {
                continue;
            }
            // Lines toward commits outside the loaded page simply run straight on.
            down.push(GraphEdge { from: i, to: target(i, oid), color: c });
        }
        for &(t, _) in &node_targets {
            let (oid, c) = lanes[t].expect("target lane is occupied");
            down.push(GraphEdge { from: node, to: target(t, oid), color: c });
        }

        let width = lanes.iter().rposition(Option::is_some).map_or(0, |i| i + 1).max(node + 1);
        rows.push(GraphRow { lane: node, color, up: Vec::new(), down, width });

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
