// Math.random() and the range helper the scene modules share.

pub fn random() -> f64 {
    rand::random::<f64>()
}

pub fn random_range(min: f64, max: f64) -> f64 {
    min + random() * (max - min)
}

pub fn smoothstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
