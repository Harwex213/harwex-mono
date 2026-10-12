// Projective mapping between the unit square and an arbitrary quad.
// Matrices are 3x3, row-major, as flat arrays of 9 numbers.

pub type Vec2 = [f64; 2];
pub type Mat3 = [f64; 9];

// Maps (0,0),(1,0),(1,1),(0,1) onto p0..p3 (Heckbert's closed form).
pub fn square_to_quad(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2) -> Mat3 {
    let [x0, y0] = p0;
    let [x1, y1] = p1;
    let [x2, y2] = p2;
    let [x3, y3] = p3;
    let sx = x0 - x1 + x2 - x3;
    let sy = y0 - y1 + y2 - y3;
    if sx.abs() < 1e-12 && sy.abs() < 1e-12 {
        return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0.0, 0.0, 1.0];
    }
    let dx1 = x1 - x2;
    let dx2 = x3 - x2;
    let dy1 = y1 - y2;
    let dy2 = y3 - y2;
    let den = dx1 * dy2 - dx2 * dy1;
    let g = (sx * dy2 - dx2 * sy) / den;
    let h = (dx1 * sy - sx * dy1) / den;
    #[rustfmt::skip]
    let m = [
        x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
        y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
        g, h, 1.0,
    ];
    m
}

pub fn invert(m: Mat3) -> Mat3 {
    let [a, b, c, d, e, f, g, h, i] = m;
    let big_a = e * i - f * h;
    let big_b = -(d * i - f * g);
    let big_c = d * h - e * g;
    let det = a * big_a + b * big_b + c * big_c;
    let k = 1.0 / det;
    #[rustfmt::skip]
    let out = [
        big_a * k, -(b * i - c * h) * k, (b * f - c * e) * k,
        big_b * k, (a * i - c * g) * k, -(a * f - c * d) * k,
        big_c * k, -(a * h - b * g) * k, (a * e - b * d) * k,
    ];
    out
}

// Shader matrices are column-major.
pub fn to_column_major(m: Mat3) -> [f32; 9] {
    [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]].map(|v| v as f32)
}

#[cfg(test)]
pub fn apply(m: Mat3, p: Vec2) -> Vec2 {
    let x = m[0] * p[0] + m[1] * p[1] + m[2];
    let y = m[3] * p[0] + m[4] * p[1] + m[5];
    let w = m[6] * p[0] + m[7] * p[1] + m[8];
    [x / w, y / w]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corners_round_trip() {
        let quad = [[0.1, 0.2], [0.9, 0.25], [0.85, 0.8], [0.15, 0.7]];
        let m = square_to_quad(quad[0], quad[1], quad[2], quad[3]);
        let inv = invert(m);
        for (corner, p) in [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]].iter().zip(quad) {
            let q = apply(m, *corner);
            assert!((q[0] - p[0]).abs() < 1e-9 && (q[1] - p[1]).abs() < 1e-9);
            let back = apply(inv, p);
            assert!((back[0] - corner[0]).abs() < 1e-9 && (back[1] - corner[1]).abs() < 1e-9);
        }
    }
}
