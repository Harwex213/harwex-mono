//! Composition of the canvas: package boxes with their file cards, and the routes of the
//! dependency arrows. Pure geometry in world units; no egui, no disk.
//!
//! - Cards pack column-major inside their box, so files of one folder stay next to each other.
//!   The column count makes the box close to `Params::box_aspect`.
//! - Packages that have edges get Sugiyama layering: dependents on the left, dependencies on the
//!   right. Long edges get dummy nodes, which reserve a lane through the columns they cross, so
//!   an arrow never runs through a box. Barycenter sweeps order each column; a weighted
//!   isotonic regression then moves boxes toward their neighbours' height without overlap.
//! - Packages without edges are shelf-packed in a separate area below the graph.

mod order;
mod pack;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Size {
    pub w: f32,
    pub h: f32,
}

impl Size {
    pub fn new(w: f32, h: f32) -> Size {
        Size { w, h }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

impl Point {
    pub fn new(x: f32, y: f32) -> Point {
        Point { x, y }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub fn new(x: f32, y: f32, w: f32, h: f32) -> Rect {
        Rect { x, y, w, h }
    }
    pub fn right(&self) -> f32 {
        self.x + self.w
    }
    pub fn bottom(&self) -> f32 {
        self.y + self.h
    }
    pub fn center_y(&self) -> f32 {
        self.y + self.h / 2.0
    }
    pub fn intersects(&self, o: &Rect) -> bool {
        self.x < o.right() && o.x < self.right() && self.y < o.bottom() && o.y < self.bottom()
    }
    pub fn contains_rect(&self, o: &Rect) -> bool {
        o.x >= self.x && o.y >= self.y && o.right() <= self.right() && o.bottom() <= self.bottom()
    }
    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.x && p.x <= self.right() && p.y >= self.y && p.y <= self.bottom()
    }
    pub fn union(&self, o: &Rect) -> Rect {
        let x = self.x.min(o.x);
        let y = self.y.min(o.y);
        Rect::new(x, y, self.right().max(o.right()) - x, self.bottom().max(o.bottom()) - y)
    }
}

/// One piece of an arrow. A curve leaves and enters horizontally (a cubic with both control
/// points pulled half the width sideways), which gives the side-to-side elbow look.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Seg {
    Line(Point, Point),
    Curve(Point, Point),
}

impl Seg {
    pub fn ends(&self) -> (Point, Point) {
        match *self {
            Seg::Line(a, b) | Seg::Curve(a, b) => (a, b),
        }
    }

    fn reversed(self) -> Seg {
        match self {
            Seg::Line(a, b) => Seg::Line(b, a),
            Seg::Curve(a, b) => Seg::Curve(b, a),
        }
    }

    /// The point at `t` in 0..=1.
    pub fn at(&self, t: f32) -> Point {
        match *self {
            Seg::Line(a, b) => Point::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
            Seg::Curve(a, b) => {
                let [c1, c2] = curve_controls(a, b);
                let u = 1.0 - t;
                let (w0, w1, w2, w3) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
                Point::new(w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x, w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y)
            }
        }
    }
}

/// The two inner control points of `Seg::Curve(a, b)`.
pub fn curve_controls(a: Point, b: Point) -> [Point; 2] {
    let dx = (b.x - a.x) / 2.0;
    [Point::new(a.x + dx, a.y), Point::new(b.x - dx, b.y)]
}

/// An arrow from the dependent's box to the dependency's box. The head is at the end of the
/// last segment.
#[derive(Debug, Clone, PartialEq)]
pub struct Route {
    pub segs: Vec<Seg>,
    /// The edge goes against the layering (it closed a dependency cycle).
    pub against_flow: bool,
}

impl Route {
    pub fn end(&self) -> Point {
        self.segs.last().map(|s| s.ends().1).unwrap_or_default()
    }
}

#[derive(Debug, Clone)]
pub struct Params {
    /// Inner padding of a package box around its cards.
    pub box_pad: f32,
    pub card_gap: f32,
    /// The band above each box that holds the package name.
    pub label_h: f32,
    /// Vertical gap between nodes of one column.
    pub node_gap: f32,
    /// Horizontal gap between columns, before the extra room for many arrows.
    pub layer_gap: f32,
    /// Extra column gap per arrow that crosses it.
    pub layer_gap_per_edge: f32,
    pub max_layer_gap: f32,
    /// Height a long edge reserves in each column it passes.
    pub lane_h: f32,
    /// Wanted width/height of a box.
    pub box_aspect: f32,
    /// Vertical distance between arrow ports on one box side.
    pub port_gap: f32,
    /// Gap between the graph and the area of unconnected packages, and between packages there.
    pub area_gap: f32,
    /// The band above the unconnected area that holds its title.
    pub area_title_h: f32,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            box_pad: 20.0,
            card_gap: 16.0,
            label_h: 40.0,
            node_gap: 90.0,
            layer_gap: 260.0,
            layer_gap_per_edge: 10.0,
            max_layer_gap: 700.0,
            lane_h: 28.0,
            box_aspect: 1.6,
            port_gap: 18.0,
            area_gap: 320.0,
            area_title_h: 80.0,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct Input {
    /// Card sizes per package, in display order.
    pub cards: Vec<Vec<Size>>,
    /// The smallest width of each box (its label must fit), 0 for none.
    pub min_width: Vec<f32>,
    /// `(dependent, dependency)` pairs. Duplicates and self edges are ignored.
    pub edges: Vec<(usize, usize)>,
}

#[derive(Debug, Clone, Default)]
pub struct Layout {
    /// The frame of each package. Its label sits in the `label_h` band above it.
    pub boxes: Vec<Rect>,
    /// Card rects per package, in input order.
    pub cards: Vec<Vec<Rect>>,
    /// One route per input edge; `None` for ignored edges.
    pub routes: Vec<Option<Route>>,
    /// Column of each connected package (0 = leftmost); `None` for unconnected ones.
    pub column: Vec<Option<usize>>,
    /// The area of unconnected packages, including its title band.
    pub unconnected_area: Option<Rect>,
    /// Everything, labels included.
    pub bounds: Rect,
}

pub fn layout(input: &Input, p: &Params) -> Layout {
    let n = input.cards.len();
    let mut boxes = Vec::with_capacity(n);
    let mut cards = Vec::with_capacity(n);
    for (i, c) in input.cards.iter().enumerate() {
        let min_w = input.min_width.get(i).copied().unwrap_or(0.0);
        let (size, rects) = pack::pack_cards(c, min_w, p);
        boxes.push(Rect::new(0.0, 0.0, size.w, size.h));
        cards.push(rects);
    }

    let mut edges: Vec<(usize, usize)> = Vec::new();
    let mut edge_index = vec![None; input.edges.len()];
    for (k, &(a, b)) in input.edges.iter().enumerate() {
        if a == b || a >= n || b >= n {
            continue;
        }
        edge_index[k] = Some(match edges.iter().position(|&e| e == (a, b)) {
            Some(i) => i,
            None => {
                edges.push((a, b));
                edges.len() - 1
            }
        });
    }

    let mut connected = vec![false; n];
    for &(a, b) in &edges {
        connected[a] = true;
        connected[b] = true;
    }

    // Each connected component gets its own layering; the components are then packed like
    // tiles. One layering over all of them would stack many small pairs into a tall strip.
    let mut column = vec![None; n];
    let mut routes_dedup: Vec<Option<Route>> = vec![None; edges.len()];
    let mut graphs = Vec::new();
    let mut tiles = Vec::new();
    for comp in components(n, &edges) {
        let mut member = vec![false; n];
        for &i in &comp {
            member[i] = true;
        }
        let edge_ids: Vec<usize> = (0..edges.len()).filter(|&k| member[edges[k].0]).collect();
        let comp_edges: Vec<(usize, usize)> = edge_ids.iter().map(|&k| edges[k]).collect();
        let graph = order::Graph::build(n, &member, &comp_edges, &boxes, p);
        let mut bounds: Option<Rect> = None;
        for (node, info) in graph.nodes.iter().enumerate() {
            if let order::NodeKind::Package(i) = info.kind {
                column[i] = Some(graph.col[node]);
                boxes[i].x = graph.x[node];
                boxes[i].y = graph.y[node] + p.label_h;
                let r = Rect::new(boxes[i].x, graph.y[node], boxes[i].w, boxes[i].h + p.label_h);
                bounds = Some(bounds.map_or(r, |u| u.union(&r)));
            }
        }
        let b = bounds.unwrap_or_default();
        tiles.push(Size::new(b.w, b.h));
        graphs.push((comp, edge_ids, graph, b));
    }
    let tile_row = pack::square_row(&tiles, p.area_gap);
    let (graph_area, places) = pack::shelf(&tiles, tile_row, p.area_gap);
    for ((comp, edge_ids, mut graph, b), at) in graphs.into_iter().zip(places) {
        let (dx, dy) = (at.x - b.x, at.y - b.y);
        for &i in &comp {
            boxes[i].x += dx;
            boxes[i].y += dy;
        }
        graph.translate(dx, dy);
        for (route, k) in graph.routes(&boxes, p).into_iter().zip(edge_ids) {
            routes_dedup[k] = route;
        }
    }
    let mut bounds: Option<Rect> = (!tiles.is_empty()).then(|| Rect::new(0.0, 0.0, graph_area.w, graph_area.h));

    let loose: Vec<usize> = (0..n).filter(|&i| !connected[i]).collect();
    let mut unconnected_area = None;
    if !loose.is_empty() {
        let sizes: Vec<Size> = loose.iter().map(|&i| Size::new(boxes[i].w, boxes[i].h + p.label_h)).collect();
        let gap = p.node_gap;
        // Below the graph (rows as wide as the graph) or right of it (as tall as the graph):
        // whichever whole picture is closer to the wanted aspect.
        let (top_left, row_w) = match bounds {
            None => ((0.0, 0.0), pack::square_row(&sizes, gap)),
            Some(g) => {
                let below_w = g.w.max(sizes.iter().map(|s| s.w).fold(0.0, f32::max));
                let below = pack::shelf(&sizes, below_w, gap).0;
                let right_w = pack::row_for_height(&sizes, g.h - p.area_title_h, gap);
                let right = pack::shelf(&sizes, right_w, gap).0;
                let score = |w: f32, h: f32| ((w / h) / p.box_aspect).ln().abs();
                let below_score = score(g.w.max(below.w), g.h + p.area_gap + p.area_title_h + below.h);
                let right_score = score(g.w + p.area_gap + right.w, g.h.max(right.h + p.area_title_h));
                if below_score <= right_score {
                    ((0.0, g.bottom() + p.area_gap), below_w)
                } else {
                    ((g.right() + p.area_gap, 0.0), right_w)
                }
            }
        };
        let (area, places) = pack::shelf(&sizes, row_w, gap);
        for (k, &i) in loose.iter().enumerate() {
            boxes[i].x = top_left.0 + places[k].x;
            boxes[i].y = top_left.1 + p.area_title_h + places[k].y + p.label_h;
        }
        let r = Rect::new(top_left.0, top_left.1, area.w, area.h + p.area_title_h);
        bounds = Some(bounds.map_or(r, |u| u.union(&r)));
        unconnected_area = Some(r);
    }

    for (i, rects) in cards.iter_mut().enumerate() {
        for r in rects.iter_mut() {
            r.x += boxes[i].x;
            r.y += boxes[i].y;
        }
    }

    Layout {
        routes: edge_index.iter().map(|k| k.and_then(|k| routes_dedup[k].clone())).collect(),
        boxes,
        cards,
        column,
        unconnected_area,
        bounds: bounds.unwrap_or_default(),
    }
}

/// Connected components (packages joined by any edge), each sorted, largest first.
fn components(n: usize, edges: &[(usize, usize)]) -> Vec<Vec<usize>> {
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(parent: &mut [usize], mut v: usize) -> usize {
        while parent[v] != v {
            parent[v] = parent[parent[v]];
            v = parent[v];
        }
        v
    }
    let mut touched = vec![false; n];
    for &(a, b) in edges {
        touched[a] = true;
        touched[b] = true;
        let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
        parent[ra.max(rb)] = ra.min(rb);
    }
    let mut groups: std::collections::BTreeMap<usize, Vec<usize>> = Default::default();
    for v in (0..n).filter(|&v| touched[v]) {
        {
            let r = find(&mut parent, v);
            groups.entry(r).or_default().push(v);
        }
    }
    let mut out: Vec<Vec<usize>> = groups.into_values().collect();
    out.sort_by(|a, b| b.len().cmp(&a.len()).then(a[0].cmp(&b[0])));
    out
}

impl Route {
    fn reversed(self) -> Route {
        Route { segs: self.segs.into_iter().rev().map(Seg::reversed).collect(), against_flow: self.against_flow }
    }
}

/// A direct S-curve between two boxes, for arrows that the layering did not plan (imports that
/// package.json does not declare). It may cross other boxes.
pub fn direct_route(from: &Rect, to: &Rect) -> Route {
    if from.right() <= to.x {
        let a = Point::new(from.right(), from.center_y());
        let b = Point::new(to.x, to.center_y());
        Route { segs: vec![Seg::Curve(a, b)], against_flow: false }
    } else if to.right() <= from.x {
        let a = Point::new(from.x, from.center_y());
        let b = Point::new(to.right(), to.center_y());
        Route { segs: vec![Seg::Curve(a, b)], against_flow: true }
    } else {
        // Stacked boxes: an orthogonal detour to the right of both.
        let x = from.right().max(to.right()) + 80.0;
        let a = Point::new(from.right(), from.center_y());
        let b = Point::new(to.right(), to.center_y());
        let (p1, p2) = (Point::new(x, a.y), Point::new(x, b.y));
        Route { segs: vec![Seg::Line(a, p1), Seg::Line(p1, p2), Seg::Line(p2, b)], against_flow: true }
    }
}
