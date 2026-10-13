// Path-traced lightmap texels: the irradiance / π that Cycles' DIFFUSE bake writes with
// direct and indirect light and without color. Bevy multiplies it by the diffuse color.
//
// One thread per texel. Every sample estimates:
// - direct light: one source picked from the light tree, one shadow ray;
// - indirect light: a cosine-weighted path of up to `max_bounces` diffuse bounces, with one
//   light-tree sample and shadow ray at every vertex.
// Emission is only ever reached through light sampling. A bounce ray that hits an emitter
// adds nothing, so nothing is counted twice.

enable wgpu_ray_query;

const PI: f32 = 3.14159265;
const NONE: u32 = 0xffffffffu;

struct Params {
    texel_count: u32,
    sample_base: u32,
    samples: u32,
    light_count: u32,
    max_bounces: u32,
    groups_x: u32,
    filter_step: u32,
    // Lightmap page size in texels.
    atlas_size: u32,
    background: vec3f,
    clamp_indirect: f32,
    probe_center: vec3f,
    face_size: u32,
    haze_scatter: vec3f,
    haze_g: f32,
    haze_extinction: f32,
    _unused: u32,
}

struct Texel {
    pos: vec3f,
    texel: u32,
    ns: vec3f,
    size: f32,
    ng: vec3f,
    material: u32,
    prim: u32,
    tri: u32,
    bary: vec2f,
    dbary_dx: vec2f,
    dbary_dy: vec2f,
}

struct Prim {
    first_index: u32,
    first_vertex: u32,
    material: u32,
    flags: u32,
}

struct Material {
    albedo: vec3f,
    albedo_layer: i32,
    emission: vec3f,
    emission_layer: i32,
    uv_scale: vec2f,
    uv_offset: vec2f,
    alpha_cutoff: f32,
    flags: u32,
    normal_layer: i32,
    specular_layer: i32,
    specular: vec3f,
    roughness: f32,
    transmission: f32,
    ior: f32,
    coat: f32,
    coat_roughness: f32,
    tint: vec3f,
    _pad3: f32,
}

struct Light {
    pos: vec3f,
    kind: u32,
    value: vec3f,
    radius: f32,
    ax: vec3f,
    tan_half: f32,
    ay: vec3f,
    spread_norm: f32,
    normal: vec3f,
    area: f32,
}

struct Emitter {
    p0: vec3f,
    material: u32,
    p1: vec3f,
    area: f32,
    p2: vec3f,
    _pad: f32,
    uv0: vec2f,
    uv1: vec2f,
    uv2: vec2f,
    _pad2: vec2f,
}

struct Node {
    min: vec3f,
    phi: f32,
    max: vec3f,
    cos_o: f32,
    w: vec3f,
    cos_e: f32,
    child: u32,
    flags: u32,
    _pad: vec2u,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var tlas: acceleration_structure;
@group(0) @binding(2) var<storage, read_write> texels: array<Texel>;
@group(0) @binding(3) var<storage, read_write> accum: array<vec4f>;
@group(0) @binding(4) var<storage, read> positions: array<vec4f>;
@group(0) @binding(5) var<storage, read> normals: array<vec4f>;
@group(0) @binding(6) var<storage, read> uvs: array<vec2f>;
@group(0) @binding(7) var<storage, read> indices: array<u32>;
@group(0) @binding(8) var<storage, read> prims: array<Prim>;
@group(0) @binding(9) var<storage, read> materials: array<Material>;
@group(0) @binding(10) var<storage, read> lights: array<Light>;
@group(0) @binding(11) var<storage, read> emitters: array<Emitter>;
@group(0) @binding(12) var<storage, read> nodes: array<Node>;
@group(0) @binding(13) var layers: texture_2d_array<f32>;
@group(0) @binding(14) var layer_sampler: sampler;
@group(0) @binding(15) var normal_maps: texture_2d_array<f32>;
// The baked lightmap and the lightmap UVs; only the probe bake reads them.
@group(0) @binding(16) var lightmap: texture_2d<f32>;
@group(0) @binding(17) var<storage, read> uvs1: array<vec2f>;

// ---------------------------------------------------------------- random numbers

var<private> rng: u32;

fn pcg(v: u32) -> u32 {
    let s = v * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}

// PCG: a linear state step, then the output permutation. Feeding the hash its own output
// instead falls into short cycles; the probe haze draws hundreds of numbers per sample, and
// the repeats showed up as speckles.
fn rand() -> f32 {
    rng = rng * 747796405u + 2891336453u;
    var w = ((rng >> ((rng >> 28u) + 4u)) ^ rng) * 277803737u;
    w = (w >> 22u) ^ w;
    return f32(w >> 8u) * (1.0 / 16777216.0);
}

fn rand2() -> vec2f {
    return vec2f(rand(), rand());
}

// ---------------------------------------------------------------- geometry

// NaN and infinity test on the bits: Metal's fast math folds `x != x` to false.
fn finite3(v: vec3f) -> bool {
    let e = bitcast<vec3u>(v) & vec3u(0x7f800000u);
    return all(e != vec3u(0x7f800000u));
}

fn luminance(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn tangent_frame(n: vec3f) -> mat3x3f {
    // Duff et al., "Building an Orthonormal Basis, Revisited".
    let s = select(-1.0, 1.0, n.z >= 0.0);
    let a = -1.0 / (s + n.z);
    let b = n.x * n.y * a;
    let t = vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
    let bt = vec3f(b, s + n.y * n.y * a, -n.y);
    return mat3x3f(t, bt, n);
}

fn cosine_direction(n: vec3f, u: vec2f) -> vec3f {
    let r = sqrt(u.x);
    let phi = 2.0 * PI * u.y;
    let local = vec3f(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u.x)));
    return normalize(tangent_frame(n) * local);
}

// Ray origins move off the surface by this much, scaled with the distance from the origin
// for float precision.
fn offset(p: vec3f, ng: vec3f) -> vec3f {
    let m = max(max(abs(p.x), abs(p.y)), abs(p.z));
    return p + ng * (1e-3 + 2e-5 * m);
}

fn material_uv(m: Material, uv: vec2f) -> vec2f {
    return uv * m.uv_scale + m.uv_offset;
}

fn albedo_at(material: u32, uv: vec2f) -> vec4f {
    let m = materials[material];
    if m.albedo_layer < 0 {
        return vec4f(m.albedo, 1.0);
    }
    let t = textureSampleLevel(layers, layer_sampler, material_uv(m, uv), m.albedo_layer, 0.0);
    return vec4f(m.albedo * t.rgb, t.a);
}

fn emission_at(material: u32, uv: vec2f) -> vec3f {
    let m = materials[material];
    if m.emission_layer < 0 {
        return m.emission;
    }
    let t = textureSampleLevel(layers, layer_sampler, material_uv(m, uv), m.emission_layer, 0.0);
    return m.emission * t.rgb;
}

// The normal-mapped shading normal. `ns` is the interpolated normal; the bitangent is
// sign × ns × tangent and points along Blender's V. The maps are OpenGL style (+Y = +V).
fn normal_mapped(material: u32, uv: vec2f, ns: vec3f, tangent: vec3f, sign: f32) -> vec3f {
    let m = materials[material];
    if m.normal_layer < 0 {
        return ns;
    }
    let c = textureSampleLevel(normal_maps, layer_sampler, material_uv(m, uv), m.normal_layer, 0.0).xyz * 2.0 - 1.0;
    let n = c.x * tangent + c.y * sign * cross(ns, tangent) + c.z * ns;
    let len = length(n);
    if len < 1e-6 {
        return ns;
    }
    return n / len;
}

// Cycles' ensure_valid_specular_reflection (bump map correction, on in every material here).
// It tilts n towards ng until the mirror direction of wi lies above the surface. Cycles bakes
// with wi = the interpolated normal, so a normal map tilts the normal by at most about 45°.
fn valid_normal(ng: vec3f, wi: vec3f, n: vec3f) -> vec3f {
    let r = 2.0 * dot(n, wi) * n - wi;
    let iz = dot(wi, ng);
    let threshold = min(0.9 * iz, 0.01);
    if dot(ng, r) >= threshold {
        return n;
    }
    var x = n - dot(n, ng) * ng;
    let lx = length(x);
    x = select(n, x / lx, lx > 1e-7);
    let ix = dot(wi, x);
    let a = ix * ix + iz * iz;
    let b = 2.0 * (a + iz * threshold);
    let c = (threshold + iz) * (threshold + iz);
    let root = sqrt(max(b * b - 4.0 * a * c, 0.0));
    let nz2 = select(0.25 * (b - root) / a, 0.25 * (b + root) / a, ix < 0.0);
    return sqrt(max(1.0 - nz2, 0.0)) * x + sqrt(max(nz2, 0.0)) * ng;
}

// Cycles' bump_shadowing_term (from appleseed). Cycles multiplies a diffuse closure by it
// when the closure's normal differs from the interpolated one. Light that reaches the
// bumped normal at a flatter angle than the true surface allows fades out smoothly.
fn bump_shadowing(ng: vec3f, n: vec3f, l: vec3f) -> f32 {
    let den = dot(n, l) * dot(ng, n);
    if den == 0.0 {
        return 0.0;
    }
    let g = dot(ng, l) / den;
    if g >= 1.0 {
        return 1.0;
    }
    if g < 0.0 {
        return 0.0;
    }
    let g2 = g * g;
    return -g2 * g + g2 + g;
}

struct Surface {
    pos: vec3f,
    ng: vec3f,
    ns: vec3f,
    uv: vec2f,
    uv1: vec2f,
    material: u32,
    tangent: vec3f,
    bitangent_sign: f32,
}

// Tangent along material U, orthogonal to n, and the bitangent sign as raster.rs computes
// them. glTF's V runs down, so Blender's V is −V.
fn tangent_frame_uv(pa: vec3f, pb: vec3f, pc: vec3f, ua: vec2f, ub: vec2f, uc: vec2f, n: vec3f) -> vec4f {
    let e1 = pb - pa;
    let e2 = pc - pa;
    let d1 = ub - ua;
    let d2 = uc - ua;
    let det = d1.x * d2.y - d1.y * d2.x;
    let fallback = vec4f(tangent_frame(n)[0], 1.0);
    if abs(det) < 1e-20 {
        return fallback;
    }
    let dp_du = (e1 * d2.y - e2 * d1.y) / det;
    let dp_dv = (e2 * d1.x - e1 * d2.x) / det;
    let t = dp_du - n * dot(n, dp_du);
    let len = length(t);
    if len < 1e-12 {
        return fallback;
    }
    let tn = t / len;
    return vec4f(tn, select(1.0, -1.0, dot(cross(n, tn), -dp_dv) < 0.0));
}

fn surface(prim_id: u32, tri: u32, bary: vec2f) -> Surface {
    let prim = prims[prim_id];
    let i = prim.first_index + tri * 3u;
    let a = indices[i] + prim.first_vertex;
    let b = indices[i + 1u] + prim.first_vertex;
    let c = indices[i + 2u] + prim.first_vertex;
    let w = vec3f(1.0 - bary.x - bary.y, bary.x, bary.y);
    let pa = positions[a].xyz;
    let pb = positions[b].xyz;
    let pc = positions[c].xyz;
    var s: Surface;
    s.pos = pa * w.x + pb * w.y + pc * w.z;
    s.ns = normalize(normals[a].xyz * w.x + normals[b].xyz * w.y + normals[c].xyz * w.z + vec3f(1e-12));
    var ng = normalize(cross(pb - pa, pc - pa) + vec3f(1e-12));
    if dot(ng, s.ns) < 0.0 {
        ng = -ng;
    }
    s.ng = ng;
    s.uv = uvs[a] * w.x + uvs[b] * w.y + uvs[c] * w.z;
    s.uv1 = uvs1[a] * w.x + uvs1[b] * w.y + uvs1[c] * w.z;
    s.material = prim.material;
    s.tangent = vec3f(1.0, 0.0, 0.0);
    s.bitangent_sign = 1.0;
    if materials[prim.material].normal_layer >= 0 {
        let f = tangent_frame_uv(pa, pb, pc, uvs[a], uvs[b], uvs[c], s.ns);
        s.tangent = f.xyz;
        s.bitangent_sign = f.w;
    }
    return s;
}

// Alpha-masked materials (the plants) let rays through where the texture is transparent.
fn alpha_passes(prim_id: u32, tri: u32, bary: vec2f) -> bool {
    let prim = prims[prim_id];
    let i = prim.first_index + tri * 3u;
    let w = vec3f(1.0 - bary.x - bary.y, bary.x, bary.y);
    let uv = uvs[indices[i] + prim.first_vertex] * w.x + uvs[indices[i + 1u] + prim.first_vertex] * w.y
        + uvs[indices[i + 2u] + prim.first_vertex] * w.z;
    let m = materials[prim.material];
    return albedo_at(prim.material, uv).a >= m.alpha_cutoff;
}

fn trace(origin: vec3f, dir: vec3f, t_max: f32) -> RayIntersection {
    var rq: ray_query;
    rayQueryInitialize(&rq, tlas, RayDesc(RAY_FLAG_NONE, 0xffu, 0.0, t_max, origin, dir));
    while rayQueryProceed(&rq) {
        let c = rayQueryGetCandidateIntersection(&rq);
        if alpha_passes(c.instance_custom_data, c.primitive_index, c.barycentrics) {
            rayQueryConfirmIntersection(&rq);
        }
    }
    return rayQueryGetCommittedIntersection(&rq);
}

fn visible(origin: vec3f, dest: vec3f) -> bool {
    let d = dest - origin;
    let len = length(d);
    let t_max = len - max(1e-3, len * 1e-4);
    if t_max <= 0.0 {
        return true;
    }
    var rq: ray_query;
    rayQueryInitialize(&rq, tlas, RayDesc(RAY_FLAG_TERMINATE_ON_FIRST_HIT, 0xffu, 0.0, t_max, origin, d / len));
    while rayQueryProceed(&rq) {
        let c = rayQueryGetCandidateIntersection(&rq);
        if alpha_passes(c.instance_custom_data, c.primitive_index, c.barycentrics) {
            rayQueryConfirmIntersection(&rq);
        }
    }
    let hit = rayQueryGetCommittedIntersection(&rq);
    return hit.kind == RAY_QUERY_INTERSECTION_NONE;
}

// ---------------------------------------------------------------- light tree

fn cos_sub_clamped(sin_a: f32, cos_a: f32, sin_b: f32, cos_b: f32) -> f32 {
    // cos(max(0, a − b))
    if cos_a > cos_b {
        return 1.0;
    }
    return cos_a * cos_b + sin_a * sin_b;
}

fn sin_sub_clamped(sin_a: f32, cos_a: f32, sin_b: f32, cos_b: f32) -> f32 {
    if cos_a > cos_b {
        return 0.0;
    }
    return sin_a * cos_b - cos_a * sin_b;
}

// PBRT-v4 LightBounds::Importance, with a one-sided receiver.
fn importance(nd: Node, p: vec3f, n: vec3f) -> f32 {
    if nd.phi <= 0.0 {
        return 0.0;
    }
    let pc = 0.5 * (nd.min + nd.max);
    let diag = nd.max - nd.min;
    let to_p = p - pc;
    let dist2 = dot(to_p, to_p);
    let d2 = max(dist2, length(diag) * 0.5);
    let wi = select(n, to_p / sqrt(dist2), dist2 > 1e-12);

    // Directions from p into the bounding sphere of the box.
    let r2 = dot(diag, diag) * 0.25;
    var cos_b = -1.0;
    let inside = all(p >= nd.min) && all(p <= nd.max);
    if !inside && dist2 > r2 {
        cos_b = sqrt(max(0.0, 1.0 - r2 / dist2));
    }
    let sin_b = sqrt(max(0.0, 1.0 - cos_b * cos_b));

    var cos_w = dot(nd.w, wi);
    if (nd.flags & 2u) != 0u {
        cos_w = abs(cos_w);
    }
    let sin_w = sqrt(max(0.0, 1.0 - cos_w * cos_w));
    let sin_o = sqrt(max(0.0, 1.0 - nd.cos_o * nd.cos_o));
    let cos_x = cos_sub_clamped(sin_w, cos_w, sin_o, nd.cos_o);
    let sin_x = sin_sub_clamped(sin_w, cos_w, sin_o, nd.cos_o);
    var cos_p = cos_sub_clamped(sin_x, cos_x, sin_b, cos_b);
    // The haze picks its light at the ray origin but scatters it anywhere along the ray. A
    // light that faces away from the origin can still light the ray, so the haze ignores the
    // emission cone.
    let haze = all(n == vec3f(0.0));
    if haze {
        cos_p = 1.0;
    } else if cos_p <= nd.cos_e {
        return 0.0;
    }
    // PBRT's distance term floors at half the box diagonal, which starves a large emitter
    // right next to the point. The second term uses the distance to the box with a smaller
    // floor; the mean of both keeps far boxes as before.
    let q = clamp(p, nd.min, nd.max);
    let d2_box = max(dot(p - q, p - q), max(1e-4 * dot(diag, diag), 1e-4));
    var imp = nd.phi * cos_p * 0.5 * (1.0 / d2 + 1.0 / d2_box);

    // A point in the haze has no receiver plane.
    if haze {
        return max(imp, 0.0);
    }
    // The receiver only takes light from above its plane.
    let cos_i = dot(n, -wi);
    let sin_i = sqrt(max(0.0, 1.0 - cos_i * cos_i));
    let cos_pi = cos_sub_clamped(sin_i, cos_i, sin_b, cos_b);
    if cos_pi <= 0.0 {
        return 0.0;
    }
    imp *= cos_pi;
    return max(imp, 0.0);
}

// Barycentric weights of a point in the triangle's plane; `cr` is (p1 − p0) × (p2 − p0).
fn triangle_barycentric(x: vec3f, p0: vec3f, p1: vec3f, p2: vec3f, cr: vec3f) -> vec3f {
    let inv = 1.0 / max(dot(cr, cr), 1e-30);
    let b1 = clamp(dot(cross(x - p0, p2 - p0), cr) * inv, 0.0, 1.0);
    let b2 = clamp(dot(cross(p1 - p0, x - p0), cr) * inv, 0.0, 1.0 - b1);
    return vec3f(1.0 - b1 - b2, b1, b2);
}

fn angle_between(a: vec3f, b: vec3f) -> f32 {
    if dot(a, b) < 0.0 {
        return PI - 2.0 * asin(clamp(length(a + b) * 0.5, -1.0, 1.0));
    }
    return 2.0 * asin(clamp(length(b - a) * 0.5, -1.0, 1.0));
}

// Uniform direction in the solid angle of a triangle (PBRT-v4 SampleSphericalTriangle,
// after Arvo 1995). Returns the direction and the solid angle, or a zero solid angle.
fn sample_spherical_triangle(p: vec3f, v0: vec3f, v1: vec3f, v2: vec3f, u: vec2f) -> vec4f {
    let a = normalize(v0 - p);
    let b = normalize(v1 - p);
    let c = normalize(v2 - p);
    var n_ab = cross(a, b);
    var n_bc = cross(b, c);
    var n_ca = cross(c, a);
    if dot(n_ab, n_ab) < 1e-20 || dot(n_bc, n_bc) < 1e-20 || dot(n_ca, n_ca) < 1e-20 {
        return vec4f(0.0);
    }
    n_ab = normalize(n_ab);
    n_bc = normalize(n_bc);
    n_ca = normalize(n_ca);
    let alpha = angle_between(n_ab, -n_ca);
    let beta = angle_between(n_bc, -n_ab);
    let gamma = angle_between(n_ca, -n_bc);
    let a_pi = alpha + beta + gamma;
    let area = a_pi - PI;
    if !(area > 0.0) {
        return vec4f(0.0);
    }
    let ap_pi = mix(PI, a_pi, u.x);
    let cos_alpha = cos(alpha);
    let sin_alpha = sin(alpha);
    let sin_phi = sin(ap_pi) * cos_alpha - cos(ap_pi) * sin_alpha;
    let cos_phi = cos(ap_pi) * cos_alpha + sin(ap_pi) * sin_alpha;
    let k1 = cos_phi + cos_alpha;
    let k2 = sin_phi - sin_alpha * dot(a, b);
    let cos_bp = clamp((k2 + (k2 * cos_phi - k1 * sin_phi) * cos_alpha) / ((k2 * sin_phi + k1 * cos_phi) * sin_alpha), -1.0, 1.0);
    let sin_bp = sqrt(max(0.0, 1.0 - cos_bp * cos_bp));
    let ca = c - dot(c, a) * a;
    if dot(ca, ca) < 1e-20 {
        return vec4f(0.0);
    }
    let cp = cos_bp * a + sin_bp * normalize(ca);
    let cos_theta = 1.0 - u.y * (1.0 - dot(cp, b));
    let sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
    let cb = cp - dot(cp, b) * b;
    if dot(cb, cb) < 1e-20 {
        return vec4f(b, area);
    }
    let w = cos_theta * b + sin_theta * normalize(cb);
    if !finite3(w) || dot(w, w) < 0.5 {
        return vec4f(0.0);
    }
    return vec4f(normalize(w), area);
}

struct LightSample {
    dest: vec3f,
    // Radiance × receiver cosine / (solid-angle pdf × π): one sample of irradiance / π.
    value: vec3f,
    // An analytic light that glossy rays see. Emissive triangles say false: the probe bake
    // reaches them by tracing the specular lobe instead.
    glossy: bool,
}

// The receiver cosine. A zero normal stands for a point in the haze, which takes light from
// all directions.
fn receiver_cos(n: vec3f, dir: vec3f) -> f32 {
    if all(n == vec3f(0.0)) {
        return 1.0;
    }
    return dot(n, dir);
}

fn spread_attenuation(l: Light, cos_l: f32) -> f32 {
    if l.tan_half < 0.0 {
        return 1.0;
    }
    let tan_a = sqrt(max(0.0, 1.0 - cos_l * cos_l)) / max(cos_l, 1e-6);
    return max((l.tan_half - tan_a) * l.spread_norm, 0.0);
}

fn sample_light(index: u32, p: vec3f, n: vec3f) -> LightSample {
    var s: LightSample;
    s.value = vec3f(0.0);
    s.dest = p;
    s.glossy = false;
    let u = rand2();
    if index < params.light_count {
        let l = lights[index];
        s.glossy = (l.kind & 2u) != 0u;
        if (l.kind & 1u) == 0u {
            // Sphere light: sample the cone it subtends.
            let to = l.pos - p;
            let d2 = dot(to, to);
            let d = sqrt(d2);
            let wc = to / d;
            let r = l.radius;
            if r > 1e-4 && d > r * 1.001 {
                let sin2 = r * r / d2;
                let cos_max = sqrt(1.0 - sin2);
                let one_minus = sin2 / (1.0 + cos_max);
                let cos_t = 1.0 - u.x * one_minus;
                let sin_t = sqrt(max(0.0, 1.0 - cos_t * cos_t));
                let phi = 2.0 * PI * u.y;
                let dir = tangent_frame(wc) * vec3f(sin_t * cos(phi), sin_t * sin(phi), cos_t);
                let t = d * cos_t - sqrt(max(0.0, r * r - d2 * sin_t * sin_t));
                let cos_r = receiver_cos(n, dir);
                if cos_r <= 0.0 {
                    return s;
                }
                // Radiance I / πr² over a cone of 2π(1 − cos_max) steradians.
                let radiance = l.value / (PI * r * r);
                s.dest = p + dir * t;
                s.value = radiance * cos_r * (2.0 * PI * one_minus) / PI;
            } else if r > 1e-4 {
                // Inside the sphere, as Cycles does it: a cosine-weighted direction to the
                // sphere's surface, which shines with I / πr² all around. A candle flame sits
                // inside its light, glows with that, and shows in the glass and the gold around
                // it. A shadow ray to the center would hit the flame itself.
                if all(n == vec3f(0.0)) {
                    return s;
                }
                let dir = cosine_direction(n, u);
                let b = dot(p - l.pos, dir);
                let t = -b + sqrt(max(0.0, b * b - (d2 - r * r)));
                s.dest = p + dir * t;
                // Radiance × cosine / (pdf × π) with pdf = cosine / π.
                s.value = l.value / (PI * r * r);
            } else {
                let cos_r = receiver_cos(n, wc);
                if cos_r <= 0.0 {
                    return s;
                }
                s.dest = l.pos;
                s.value = l.value * cos_r / max(d2, 1e-6) / PI;
            }
        } else {
            // Rectangle: uniform point on the panel.
            let x = l.pos + (u.x - 0.5) * l.ax + (u.y - 0.5) * l.ay;
            let to = x - p;
            let d2 = max(dot(to, to), 1e-8);
            let dir = to * inverseSqrt(d2);
            let cos_l = dot(l.normal, -dir);
            let cos_r = receiver_cos(n, dir);
            if cos_l <= 0.0 || cos_r <= 0.0 {
                return s;
            }
            s.dest = x;
            s.value = l.value * spread_attenuation(l, cos_l) * cos_r * cos_l * l.area / d2 / PI;
        }
    } else {
        // Emissive triangle, emission from both sides. A close or large triangle is sampled
        // by solid angle, like Cycles does when its longest edge exceeds the distance to its
        // plane. Uniform area samples near such a triangle carry huge values, and the
        // indirect clamp then cuts most of their light.
        let e = emitters[index - params.light_count];
        let cr = cross(e.p1 - e.p0, e.p2 - e.p0);
        let nt = normalize(cr);
        let plane = abs(dot(nt, e.p0 - p));
        let longest2 = max(dot(e.p1 - e.p0, e.p1 - e.p0), max(dot(e.p2 - e.p1, e.p2 - e.p1), dot(e.p0 - e.p2, e.p0 - e.p2)));
        if longest2 > plane * plane {
            let w = sample_spherical_triangle(p, e.p0, e.p1, e.p2, u);
            if w.w > 1e-6 {
                let dir = w.xyz;
                let cos_r = receiver_cos(n, dir);
                let denom = dot(nt, dir);
                if cos_r <= 0.0 || abs(denom) < 1e-8 {
                    return s;
                }
                let t = dot(nt, e.p0 - p) / denom;
                if t <= 0.0 {
                    return s;
                }
                let x = p + dir * t;
                let b = triangle_barycentric(x, e.p0, e.p1, e.p2, cr);
                let uv = e.uv0 * b.x + e.uv1 * b.y + e.uv2 * b.z;
                s.dest = x;
                // Radiance × cosine / pdf, with pdf = 1 / solid angle.
                s.value = emission_at(e.material, uv) * cos_r * w.w / PI;
                return s;
            }
        }
        let su = sqrt(u.x);
        let b0 = 1.0 - su;
        let b1 = u.y * su;
        let b2 = 1.0 - b0 - b1;
        let x = e.p0 * b0 + e.p1 * b1 + e.p2 * b2;
        let to = x - p;
        let d2 = max(dot(to, to), 1e-8);
        let dir = to * inverseSqrt(d2);
        let cos_l = abs(dot(nt, dir));
        let cos_r = receiver_cos(n, dir);
        if cos_r <= 0.0 {
            return s;
        }
        let uv = e.uv0 * b0 + e.uv1 * b1 + e.uv2 * b2;
        s.dest = x;
        s.value = emission_at(e.material, uv) * cos_r * cos_l * e.area / d2 / PI;
    }
    return s;
}

// Walks the light tree from the root, one random choice per level.
fn sample_lights(p: vec3f, n: vec3f) -> LightSample {
    return sample_tree(0u, p, n);
}

struct Pick {
    index: u32,
    // Zero when no source reaches the point.
    pmf: f32,
}

// Walks the light tree from `root`, one random choice per level.
fn pick_light(root: u32, p: vec3f, n: vec3f) -> Pick {
    var node = root;
    var pick: Pick;
    pick.pmf = 1.0;
    for (var depth = 0u; depth < 64u; depth++) {
        let nd = nodes[node];
        if (nd.flags & 1u) != 0u {
            break;
        }
        let left = node + 1u;
        let right = nd.child;
        let il = importance(nodes[left], p, n);
        let ir = importance(nodes[right], p, n);
        let total = il + ir;
        if total <= 0.0 {
            pick.pmf = 0.0;
            return pick;
        }
        let pl = il / total;
        if rand() < pl {
            node = left;
            pick.pmf *= pl;
        } else {
            node = right;
            pick.pmf *= 1.0 - pl;
        }
    }
    pick.index = nodes[node].child;
    return pick;
}

fn sample_tree(root: u32, p: vec3f, n: vec3f) -> LightSample {
    if params.filter_step == 7u {
        // Debug: uniform pick over all sources.
        let total = params.light_count + arrayLength(&emitters);
        let k = min(u32(rand() * f32(total)), total - 1u);
        var u = sample_light(k, p, n);
        u.value *= f32(total);
        return u;
    }
    let pick = pick_light(root, p, n);
    if pick.pmf <= 0.0 {
        var none: LightSample;
        none.value = vec3f(0.0);
        none.dest = p;
        none.glossy = false;
        return none;
    }
    var s = sample_light(pick.index, p, n);
    s.value /= pick.pmf;
    // A degenerate solid-angle sample can produce NaN; it must not reach the sums.
    if !finite3(s.value) {
        s.value = vec3f(0.0);
    }
    return s;
}

// Direct light at a point: one light-tree sample with its shadow ray. `bumped` marks a
// normal-mapped normal, which takes Cycles' bump shadowing term.
fn direct_light(p: vec3f, ns: vec3f, ng: vec3f, bumped: bool) -> vec3f {
    let s = sample_lights(p, ns);
    if all(s.value <= vec3f(0.0)) {
        return vec3f(0.0);
    }
    let origin = offset(p, ng);
    if dot(s.dest - origin, ng) <= 0.0 {
        return vec3f(0.0);
    }
    if !visible(origin, s.dest) {
        return vec3f(0.0);
    }
    if bumped {
        return s.value * bump_shadowing(ng, ns, normalize(s.dest - p));
    }
    return s.value;
}

// ---------------------------------------------------------------- kernels

fn thread_index(gid: vec3u) -> u32 {
    return gid.y * params.groups_x * 64u + gid.x;
}

// Moves texels that sit inside or behind geometry out to the visible side. A floor texel
// under a wall would otherwise see the inside of the wall, or light leaking under it.
// Short rays along the surface find back faces within one texel; the nearest one wins.
// Off by default (`--fixup`): every surface here is double-sided, so pleated drapes and
// folded trim also show back faces, and their texels jumped to the lit side. Cycles does no
// such move, and the bake matches it better without.
@compute @workgroup_size(64)
fn fixup(@builtin(global_invocation_id) gid: vec3u) {
    let i = thread_index(gid);
    if i >= params.texel_count {
        return;
    }
    var t = texels[i];
    let frame = tangent_frame(t.ng);
    let origin = offset(t.pos, t.ng);
    var best = t.size * 0.75;
    var moved = false;
    var new_pos = t.pos;
    for (var k = 0u; k < 8u; k++) {
        let a = f32(k) * (PI / 4.0);
        let dir = normalize(frame * vec3f(cos(a), sin(a), 0.05));
        let hit = trace(origin, dir, best);
        if hit.kind != RAY_QUERY_INTERSECTION_NONE {
            let s = surface(hit.instance_custom_data, hit.primitive_index, hit.barycentrics);
            // A back face: the ray left the inside of a solid.
            if dot(s.ng, dir) > 0.0 {
                best = hit.t;
                new_pos = s.pos + s.ng * 2e-3;
                moved = true;
            }
        }
    }
    if moved {
        t.pos = new_pos;
        texels[i] = t;
    }
}

// Cycles' bake_clamp_mirror_repeat: folds a barycentric weight back into [0, max], so a
// jittered sample past an edge lands inside the triangle again.
fn mirror_repeat(u: f32, max_value: f32) -> f32 {
    let x = u / max_value;
    let f = floor(x);
    let r = x - f;
    return select(r, 1.0 - r, (i32(f) & 1) != 0) * max_value;
}

// A uniform random point of the texel's square on its triangle, as in Cycles'
// integrator_init_from_bake: the barycentric weights move by up to half a texel and fold
// back at the triangle's edges.
fn bake_point(t: Texel) -> Surface {
    let j = rand2() - 0.5;
    let b = t.bary + j.x * t.dbary_dx + j.y * t.dbary_dy;
    let u = mirror_repeat(b.x, 1.0);
    let v = mirror_repeat(b.y, max(1.0 - u, 1e-6));
    var s = surface(t.prim, t.tri, vec2f(u, v));
    // Keep the texel's side of a double-sided surface.
    if dot(s.ng, t.ng) < 0.0 {
        s.ng = -s.ng;
        s.ns = -s.ns;
    }
    return s;
}

@compute @workgroup_size(64)
fn trace_texels(@builtin(global_invocation_id) gid: vec3u) {
    let i = thread_index(gid);
    if i >= params.texel_count {
        return;
    }
    let t = texels[i];
    var sum = vec3f(0.0);
    var sum_sq = 0.0;
    let r2 = vec2f(0.7548776662, 0.5698402910);
    let rotation = vec2f(f32(pcg(t.texel * 2u + 1u) >> 8u), f32(pcg(t.texel * 2u + 2u) >> 8u)) / 16777216.0;
    for (var k = 0u; k < params.samples; k++) {
        let sample_index = params.sample_base + k;
        rng = pcg(t.texel ^ pcg(sample_index * 0x9e3779b9u + 0x85ebca6bu));

        // A random point of the texel, as Cycles' bake jitters its samples over the pixel.
        let x = bake_point(t);
        let n = valid_normal(x.ng, x.ns, normal_mapped(x.material, x.uv, x.ns, x.tangent, x.bitangent_sign));
        // Cycles compares the closure normal with the interpolated one.
        var bumped = any(n != x.ns);
        let albedo = albedo_at(x.material, x.uv).rgb;

        var value = direct_light(x.pos, n, x.ng, bumped);

        // Indirect: the first direction follows a rotated R2 sequence for stratification.
        var indirect = vec3f(0.0);
        var throughput = vec3f(1.0);
        var p = x.pos;
        var ns = n;
        var ng = x.ng;
        for (var bounce = 0u; bounce < params.max_bounces; bounce++) {
            var u = rand2();
            if bounce == 0u {
                u = fract(rotation + f32(sample_index) * r2);
            }
            let dir = cosine_direction(ns, u);
            if dot(dir, ng) <= 0.0 {
                break;
            }
            if bumped {
                throughput *= bump_shadowing(ng, ns, dir);
            }
            let hit = trace(offset(p, ng), dir, 1e5);
            if hit.kind == RAY_QUERY_INTERSECTION_NONE {
                indirect += throughput * params.background;
                break;
            }
            var s = surface(hit.instance_custom_data, hit.primitive_index, hit.barycentrics);
            var interpolated = s.ns;
            s.ns = normal_mapped(s.material, s.uv, s.ns, s.tangent, s.bitangent_sign);
            // Cycles shades both faces: turn the normals towards the incoming ray.
            if dot(s.ng, dir) > 0.0 {
                s.ng = -s.ng;
                s.ns = -s.ns;
                interpolated = -interpolated;
            }
            s.ns = valid_normal(s.ng, -dir, s.ns);
            bumped = any(s.ns != interpolated);
            throughput *= albedo_at(s.material, s.uv).rgb;
            if max(throughput.x, max(throughput.y, throughput.z)) < 1e-4 {
                break;
            }
            // Cycles' sample_clamp_indirect: each indirect contribution is clamped on its
            // radiance with the baked surface's color, by the sum of the channels.
            var c = throughput * direct_light(s.pos, s.ns, s.ng, bumped);
            let colored = dot(c * albedo, vec3f(1.0));
            if !finite3(c) {
                c = vec3f(0.0);
            } else if colored > params.clamp_indirect {
                c *= params.clamp_indirect / colored;
            }
            indirect += c;
            if bounce >= 1u {
                let q = min(max(throughput.x, max(throughput.y, throughput.z)), 0.95);
                if rand() >= q {
                    break;
                }
                throughput /= q;
            }
            p = s.pos;
            ns = s.ns;
            ng = s.ng;
        }
        value += indirect;
        sum += value;
        let l = luminance(value);
        sum_sq += l * l;
    }
    accum[i] += vec4f(sum, sum_sq);
}

// ---------------------------------------------------------------- reflection probes
//
// A probe texel holds the radiance that arrives at the probe center from its direction, like
// a Cycles panorama. A path starts at the probe center and follows the specular lobes for up
// to `max_bounces` scattering events. Every surface it hits adds:
// - its emission;
// - its diffuse color × the baked lightmap, which already holds all direct and indirect
//   diffuse light;
// - the highlight of one glossy light, picked in proportion to an estimate of its highlight
//   and combined with the lobe sample by multiple importance sampling (MIS);
// - the light along one lobe sample: a GGX reflection off the base layer or the clear coat,
//   or a refraction through glass. A reflected ray sees the lights with glossy visibility; a
//   refracted ray sees every light, as Blender's visible_transmission is on everywhere. The
//   camera ray sees no light, as visible_camera is off everywhere.
// The last vertex reflects the lightmap with its diffuse color plus its F0 instead of tracing
// on. That is exact in an even light field.
//
// The world haze dims every segment. Its glow comes from `trace_haze` at an eighth of the
// resolution.
//
// Clamps follow Cycles' sample_clamp_indirect: emission and lights reached by the camera ray or
// by the first scattered ray, and the light sample at the first vertex, are direct light and
// stay unclamped. Everything else is clamped by the sum of its channels.

fn clamp_indirect(c: vec3f, bounce: u32) -> vec3f {
    if !finite3(c) {
        return vec3f(0.0);
    }
    let total = dot(c, vec3f(1.0));
    if bounce > 0u && total > params.clamp_indirect {
        return c * (params.clamp_indirect / total);
    }
    return c;
}

fn specular_at(material: u32, uv: vec2f) -> vec4f {
    let m = materials[material];
    if m.specular_layer < 0 {
        return vec4f(m.specular, m.roughness);
    }
    return textureSampleLevel(layers, layer_sampler, material_uv(m, uv), m.specular_layer, 0.0);
}

// The emission and the lightmapped light of the surface that a ray from `origin` along `dir`
// hits. With `last`, the surface also reflects the lightmap's irradiance with its specular
// color.
struct Hit {
    emission: vec3f,
    // Diffuse color (plus the specular color with `last`) × lightmap; the background for a miss.
    reflected: vec3f,
    found: bool,
    t: f32,
    s: Surface,
    // The ray hit the side that the surface normal points to.
    front: bool,
}

fn shade_hit(origin: vec3f, dir: vec3f, last: bool) -> Hit {
    return shade(trace(origin, dir, 1e5), dir, last);
}

fn shade(hit: RayIntersection, dir: vec3f, last: bool) -> Hit {
    var h: Hit;
    h.found = false;
    if hit.kind == RAY_QUERY_INTERSECTION_NONE {
        h.reflected = params.background;
        return h;
    }
    var s = surface(hit.instance_custom_data, hit.primitive_index, hit.barycentrics);
    s.ns = normal_mapped(s.material, s.uv, s.ns, s.tangent, s.bitangent_sign);
    h.front = dot(s.ng, dir) < 0.0;
    if !h.front {
        s.ng = -s.ng;
        s.ns = -s.ns;
    }
    s.ns = valid_normal(s.ng, -dir, s.ns);
    let light = textureSampleLevel(lightmap, layer_sampler, s.uv1, 0.0).rgb;
    var reflect = albedo_at(s.material, s.uv).rgb;
    if last {
        let m = materials[s.material];
        let f0 = specular_at(s.material, s.uv).rgb;
        // A glass passes on what lies behind it, which this vertex does not know. Its own
        // lightmap holds the light that falls on it, often from a lamp right behind it, and
        // would show the glass as a lit white wall. It keeps only its reflection.
        reflect += f0 + m.coat * 0.04;
    }
    h.emission = emission_at(s.material, s.uv);
    h.reflected = reflect * light;
    h.found = true;
    h.t = hit.t;
    h.s = s;
    return h;
}

// A GGX half vector around n (Walter et al. 2007), alpha = roughness².
fn sample_ggx(n: vec3f, alpha: f32, u: vec2f) -> vec3f {
    let a2 = alpha * alpha;
    let cos_t = sqrt((1.0 - u.x) / (1.0 + (a2 - 1.0) * u.x));
    let sin_t = sqrt(max(0.0, 1.0 - cos_t * cos_t));
    let phi = 2.0 * PI * u.y;
    return normalize(tangent_frame(n) * vec3f(sin_t * cos(phi), sin_t * sin(phi), cos_t));
}

fn ggx_d(n_m: f32, alpha: f32) -> f32 {
    let a2 = alpha * alpha;
    let d = n_m * n_m * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d);
}

fn smith_g1(n_v: f32, alpha: f32) -> f32 {
    let a2 = alpha * alpha;
    return 2.0 * n_v / (n_v + sqrt(a2 + (1.0 - a2) * n_v * n_v));
}

fn schlick(f0: vec3f, cos_t: f32) -> vec3f {
    return f0 + (1.0 - f0) * pow(1.0 - clamp(cos_t, 0.0, 1.0), 5.0);
}

// Fresnel reflectance of a dielectric interface; eta = n_transmitted / n_incident.
fn fresnel_dielectric(cos_i: f32, eta: f32) -> f32 {
    let c = abs(cos_i);
    let g2 = eta * eta - 1.0 + c * c;
    if g2 <= 0.0 {
        return 1.0;
    }
    let g = sqrt(g2);
    let a = (g - c) / (g + c);
    let b = (c * (g + c) - 1.0) / (c * (g - c) + 1.0);
    return 0.5 * a * a * (1.0 + b * b);
}

// The specular lobes of one surface point, seen from `wo`.
struct Lobes {
    n: vec3f,
    wo: vec3f,
    n_o: f32,
    // Base layer: F0 (metal color or dielectric), alpha = roughness².
    f0: vec3f,
    alpha: f32,
    // Glass: the base layer reflects with the dielectric Fresnel and refracts the rest.
    glass: bool,
    // n_transmitted / n_incident, and the scale of Blender's Specular IOR Level.
    eta: f32,
    f_scale: f32,
    tint: vec3f,
    coat: f32,
    alpha_coat: f32,
    // Probability of sampling the clear coat instead of the base layer.
    p_coat: f32,
}

fn make_lobes(h: Hit, wo: vec3f) -> Lobes {
    let m = materials[h.s.material];
    let spec = specular_at(h.s.material, h.s.uv);
    var lb: Lobes;
    lb.n = h.s.ns;
    lb.wo = wo;
    lb.n_o = dot(h.s.ns, wo);
    lb.f0 = spec.rgb;
    lb.alpha = max(spec.a * spec.a, 1e-3);
    lb.glass = m.transmission > 0.0;
    lb.eta = select(1.0 / m.ior, m.ior, h.front);
    let f0_ior = (m.ior - 1.0) / (m.ior + 1.0);
    lb.f_scale = select(1.0, spec.r / max(f0_ior * f0_ior, 1e-6), lb.glass);
    lb.tint = m.tint;
    lb.coat = m.coat;
    lb.alpha_coat = max(m.coat_roughness * m.coat_roughness, 1e-3);
    let e_coat = m.coat * schlick(vec3f(0.04), lb.n_o).x;
    let e_base = select(luminance(schlick(lb.f0, lb.n_o)), 1.0, lb.glass);
    lb.p_coat = select(0.0, e_coat / (e_coat + e_base), e_coat > 0.0);
    return lb;
}

fn base_fresnel(lb: Lobes, cos_t: f32) -> vec3f {
    if lb.glass {
        return vec3f(min(fresnel_dielectric(cos_t, lb.eta) * lb.f_scale, 1.0));
    }
    return schlick(lb.f0, cos_t);
}

// What the clear coat lets through to the base layer.
fn coat_through(lb: Lobes) -> f32 {
    return 1.0 - lb.coat * schlick(vec3f(0.04), lb.n_o).x;
}

// BRDF × cosine of both reflection lobes, for the direction wi.
fn eval_reflect(lb: Lobes, wi: vec3f) -> vec3f {
    let n_i = dot(lb.n, wi);
    if n_i <= 0.0 || lb.n_o <= 0.0 {
        return vec3f(0.0);
    }
    let hv = normalize(wi + lb.wo);
    let n_h = max(dot(lb.n, hv), 0.0);
    let o_h = max(dot(lb.wo, hv), 0.0);
    let base = base_fresnel(lb, o_h) * ggx_d(n_h, lb.alpha) * smith_g1(lb.n_o, lb.alpha) * smith_g1(n_i, lb.alpha);
    var f = base * coat_through(lb);
    if lb.coat > 0.0 {
        let coat = schlick(vec3f(0.04), o_h).x * ggx_d(n_h, lb.alpha_coat) * smith_g1(lb.n_o, lb.alpha_coat)
            * smith_g1(n_i, lb.alpha_coat);
        f += vec3f(lb.coat * coat);
    }
    return f / (4.0 * lb.n_o);
}

// Solid-angle density of the lobe sampling below for a reflected direction wi.
fn pdf_reflect(lb: Lobes, wi: vec3f) -> f32 {
    let hv = normalize(wi + lb.wo);
    let n_h = dot(lb.n, hv);
    let o_h = dot(lb.wo, hv);
    if n_h <= 0.0 || o_h <= 0.0 {
        return 0.0;
    }
    var p_base = ggx_d(n_h, lb.alpha) * n_h / (4.0 * o_h);
    if lb.glass {
        p_base *= min(fresnel_dielectric(o_h, lb.eta) * lb.f_scale, 1.0);
    }
    let p_coat = ggx_d(n_h, lb.alpha_coat) * n_h / (4.0 * o_h);
    return mix(p_base, p_coat, lb.p_coat);
}

struct LobeSample {
    wi: vec3f,
    weight: vec3f,
    // The pdf for MIS against the light sample.
    pdf: f32,
    refracted: bool,
    ok: bool,
}

fn sample_lobes(lb: Lobes, ng: vec3f) -> LobeSample {
    var ls: LobeSample;
    ls.ok = false;
    ls.refracted = false;
    if lb.n_o <= 0.0 {
        return ls;
    }
    let use_coat = rand() < lb.p_coat;
    let alpha = select(lb.alpha, lb.alpha_coat, use_coat);
    let m = sample_ggx(lb.n, alpha, rand2());
    let o_m = dot(lb.wo, m);
    let n_m = dot(lb.n, m);
    if o_m <= 0.0 || n_m <= 0.0 {
        return ls;
    }
    // The weight of a half-vector sample: G (wo·m) / ((n·wo)(n·m)).
    let g_o = smith_g1(lb.n_o, alpha);
    if use_coat {
        ls.wi = 2.0 * o_m * m - lb.wo;
        let n_i = dot(lb.n, ls.wi);
        if n_i <= 0.0 || dot(ls.wi, ng) <= 0.0 {
            return ls;
        }
        ls.weight = vec3f(lb.coat * schlick(vec3f(0.04), o_m).x) * g_o * smith_g1(n_i, alpha) * o_m
            / (lb.n_o * n_m * lb.p_coat);
    } else if lb.glass {
        let f = min(fresnel_dielectric(o_m, lb.eta) * lb.f_scale, 1.0);
        if rand() < f {
            ls.wi = 2.0 * o_m * m - lb.wo;
            let n_i = dot(lb.n, ls.wi);
            if n_i <= 0.0 || dot(ls.wi, ng) <= 0.0 {
                return ls;
            }
            ls.weight = vec3f(g_o * smith_g1(n_i, alpha) * o_m / (lb.n_o * n_m * (1.0 - lb.p_coat)));
        } else {
            // Snell's law about the microfacet normal; eta_r = n_incident / n_transmitted.
            let eta_r = 1.0 / lb.eta;
            let sin2_t = eta_r * eta_r * (1.0 - o_m * o_m);
            if sin2_t >= 1.0 {
                return ls;
            }
            let cos_t = sqrt(1.0 - sin2_t);
            ls.wi = normalize(-eta_r * lb.wo + (eta_r * o_m - cos_t) * m);
            let n_i = -dot(lb.n, ls.wi);
            if n_i <= 0.0 || dot(ls.wi, ng) >= 0.0 {
                return ls;
            }
            ls.weight = lb.tint * g_o * smith_g1(n_i, alpha) * o_m / (lb.n_o * n_m * (1.0 - lb.p_coat));
            ls.refracted = true;
        }
    } else {
        ls.wi = 2.0 * o_m * m - lb.wo;
        let n_i = dot(lb.n, ls.wi);
        if n_i <= 0.0 || dot(ls.wi, ng) <= 0.0 {
            return ls;
        }
        ls.weight = schlick(lb.f0, o_m) * coat_through(lb) * g_o * smith_g1(n_i, alpha) * o_m
            / (lb.n_o * n_m * (1.0 - lb.p_coat));
    }
    ls.pdf = select(pdf_reflect(lb, ls.wi), pdf_refract(lb, ls.wi), ls.refracted);
    ls.ok = finite3(ls.weight);
    return ls;
}

// The analytic light that a ray meets first before `t_max`. Lights do not block rays.
struct LightHit {
    t: f32,
    radiance: vec3f,
    index: u32,
}

fn intersect_lights(origin: vec3f, dir: vec3f, t_max: f32, glossy_only: bool) -> LightHit {
    var best: LightHit;
    best.t = t_max;
    best.radiance = vec3f(0.0);
    best.index = NONE;
    for (var i = 0u; i < params.light_count; i++) {
        let l = lights[i];
        if glossy_only && (l.kind & 2u) == 0u {
            continue;
        }
        if (l.kind & 1u) == 0u {
            let r = l.radius;
            let oc = origin - l.pos;
            let c = dot(oc, oc) - r * r;
            if r <= 1e-4 || c <= 0.0 {
                continue;
            }
            let b = dot(oc, dir);
            let disc = b * b - c;
            if disc < 0.0 {
                continue;
            }
            let t = -b - sqrt(disc);
            if t > 0.0 && t < best.t {
                best.t = t;
                best.radiance = l.value / (PI * r * r);
                best.index = i;
            }
        } else {
            // A one-sided panel that emits along its normal.
            let denom = dot(l.normal, dir);
            if denom >= 0.0 {
                continue;
            }
            let t = dot(l.pos - origin, l.normal) / denom;
            if t <= 0.0 || t >= best.t {
                continue;
            }
            let x = origin + dir * t - l.pos;
            let u = dot(x, l.ax) / dot(l.ax, l.ax);
            let v = dot(x, l.ay) / dot(l.ay, l.ay);
            if abs(u) > 0.5 || abs(v) > 0.5 {
                continue;
            }
            best.t = t;
            best.radiance = l.value * spread_attenuation(l, -denom);
            best.index = i;
        }
    }
    return best;
}

// The refraction half vector (Walter et al. 2007), turned towards n.
fn refract_half(lb: Lobes, wi: vec3f) -> vec3f {
    var hv = normalize(lb.wo + lb.eta * wi);
    if dot(hv, lb.n) < 0.0 {
        hv = -hv;
    }
    return hv;
}

// Jacobian from the half vector to the refracted direction.
fn refract_jacobian(lb: Lobes, wi: vec3f, hv: vec3f) -> f32 {
    let den = dot(lb.wo, hv) + lb.eta * dot(wi, hv);
    return lb.eta * lb.eta * abs(dot(wi, hv)) / max(den * den, 1e-12);
}

// BTDF × cosine of a glass for a direction wi below the surface. Radiance passes without the
// 1 / η² factor, as in Cycles.
fn eval_refract(lb: Lobes, wi: vec3f) -> vec3f {
    let n_i = -dot(lb.n, wi);
    if !lb.glass || n_i <= 0.0 || lb.n_o <= 0.0 {
        return vec3f(0.0);
    }
    let hv = refract_half(lb, wi);
    let o_h = dot(lb.wo, hv);
    if o_h <= 0.0 || dot(wi, hv) >= 0.0 {
        return vec3f(0.0);
    }
    let f = min(fresnel_dielectric(o_h, lb.eta) * lb.f_scale, 1.0);
    let g = smith_g1(lb.n_o, lb.alpha) * smith_g1(n_i, lb.alpha);
    return lb.tint * (1.0 - f) * g * ggx_d(dot(lb.n, hv), lb.alpha) * o_h * refract_jacobian(lb, wi, hv) / lb.n_o;
}

fn pdf_refract(lb: Lobes, wi: vec3f) -> f32 {
    if !lb.glass || dot(lb.n, wi) >= 0.0 {
        return 0.0;
    }
    let hv = refract_half(lb, wi);
    let o_h = dot(lb.wo, hv);
    if o_h <= 0.0 || dot(wi, hv) >= 0.0 {
        return 0.0;
    }
    let f = min(fresnel_dielectric(o_h, lb.eta) * lb.f_scale, 1.0);
    let n_h = dot(lb.n, hv);
    return (1.0 - lb.p_coat) * (1.0 - f) * ggx_d(n_h, lb.alpha) * n_h * refract_jacobian(lb, wi, hv);
}

// The importance of a sphere light for the light sample at a surface point: its intensity /
// distance², times the GGX density of its half vector with the lobe widened by the light's
// angular radius, times the cosine. A reflection sees only the lights with glossy visibility;
// a glass refraction sees every light. Every light that can contribute gets a positive weight.
fn light_weight(l: Light, p: vec3f, lb: Lobes) -> f32 {
    if (l.kind & 1u) != 0u || l.radius <= 1e-4 {
        return 0.0;
    }
    let to = l.pos - p;
    let d2 = max(dot(to, to), 1e-8);
    let d = sqrt(d2);
    let dir = to / d;
    let sin_r = min(l.radius / d, 1.0);
    let cos_n = dot(lb.n, dir);
    var w = 0.0;
    if (l.kind & 2u) != 0u && cos_n + sin_r > 0.0 {
        let hv = normalize(dir + lb.wo);
        let a = min(min(lb.alpha, select(1.0, lb.alpha_coat, lb.coat > 0.0)) + sin_r, 1.0);
        w = ggx_d(max(dot(lb.n, hv), 0.0), a) * min(cos_n + sin_r, 1.0);
    }
    if lb.glass && sin_r - cos_n > 0.0 {
        let hv = refract_half(lb, dir);
        let a = min(lb.alpha + 2.0 * sin_r, 1.0);
        w = max(w, ggx_d(max(dot(lb.n, hv), 0.0), a) * min(sin_r - cos_n, 1.0));
    }
    return luminance(l.value) / max(d2, l.radius * l.radius) * w;
}

// Solid angle of a sphere light seen from p, or zero from inside it.
fn sphere_solid_angle(l: Light, p: vec3f) -> f32 {
    let to = l.pos - p;
    let d2 = dot(to, to);
    let sin2 = l.radius * l.radius / d2;
    if sin2 >= 1.0 {
        return 0.0;
    }
    return 2.0 * PI * sin2 / (1.0 + sqrt(1.0 - sin2));
}

// The light of one probe vertex that MIS shares between the light sample and the lobe sample:
// the light sample's contribution, and the MIS weight of a light that the lobe sample hits.
// Cycles clamps each of the two separately. A light seen only through lobe hits would lose
// far more to the clamp than the many small light samples do.
struct Highlight {
    // Light sample: radiance × BSDF × cosine × MIS weight / pdf.
    value: vec3f,
    // The analytic light that the lobe sample's ray meets before the surface it hits.
    hit: LightHit,
    hit_weight: f32,
}

fn highlight(p: vec3f, ng: vec3f, lb: Lobes, ls: LobeSample, t_surface: f32) -> Highlight {
    var out: Highlight;
    out.value = vec3f(0.0);
    out.hit.index = NONE;
    out.hit_weight = 1.0;
    if lb.n_o <= 0.0 {
        return out;
    }
    let up = offset(p, ng);
    let down = offset(p, -ng);
    let ray_origin = select(up, down, ls.refracted);
    // A reflected ray sees the glossy lights, a refracted ray every light.
    if ls.ok {
        out.hit = intersect_lights(ray_origin, ls.wi, t_surface, !ls.refracted);
    }
    // One pass over the lights: pick one in proportion to its weight (weighted reservoir
    // sampling), and keep the weight of the light that the lobe sample meets.
    var w_sum = 0.0;
    var w_pick = 0.0;
    var pick = NONE;
    var w_hit = 0.0;
    for (var i = 0u; i < params.light_count; i++) {
        let w = light_weight(lights[i], p, lb);
        if w <= 0.0 {
            continue;
        }
        w_sum += w;
        if rand() * w_sum < w {
            pick = i;
            w_pick = w;
        }
        if i == out.hit.index {
            w_hit = w;
        }
    }
    if out.hit.index != NONE && w_hit > 0.0 {
        let omega = sphere_solid_angle(lights[out.hit.index], p);
        let p_light = select(0.0, (w_hit / w_sum) / omega, omega > 0.0);
        out.hit_weight = ls.pdf / (ls.pdf + p_light);
    }
    if pick == NONE {
        return out;
    }
    // A uniform direction in the cone of the picked sphere.
    let l = lights[pick];
    let to = l.pos - p;
    let d2 = dot(to, to);
    let sin2 = l.radius * l.radius / d2;
    if sin2 >= 1.0 {
        return out;
    }
    let d = sqrt(d2);
    let one_minus = sin2 / (1.0 + sqrt(1.0 - sin2));
    let u2 = rand2();
    let cos_t = 1.0 - u2.x * one_minus;
    let sin_t = sqrt(max(0.0, 1.0 - cos_t * cos_t));
    let phi = 2.0 * PI * u2.y;
    let wi = tangent_frame(to / d) * vec3f(sin_t * cos(phi), sin_t * sin(phi), cos_t);
    let below = dot(wi, ng) <= 0.0;
    var f: vec3f;
    if below {
        f = eval_refract(lb, wi);
    } else if (l.kind & 2u) != 0u {
        f = eval_reflect(lb, wi);
    } else {
        f = vec3f(0.0);
    }
    if all(f <= vec3f(0.0)) {
        return out;
    }
    let t = d * cos_t - sqrt(max(0.0, l.radius * l.radius - d2 * sin_t * sin_t));
    let origin = select(up, down, below);
    if !visible(origin, p + wi * t) {
        return out;
    }
    let p_light = (w_pick / w_sum) / (2.0 * PI * one_minus);
    let p_bsdf = select(pdf_reflect(lb, wi), pdf_refract(lb, wi), below);
    let radiance = l.value / (PI * l.radius * l.radius);
    out.value = radiance * f / (p_light + p_bsdf) * exp(-params.haze_extinction * t);
    return out;
}

// Bevy's cubemap layout: faces +X −X +Y −Y +Z −Z, v down each face, and z negated at lookup.
// `st` runs from −1 to 1 along the face's u and v.
fn probe_direction(face: u32, st: vec2f) -> vec3f {
    let sc = st.x;
    let tc = st.y;
    var d: vec3f;
    switch face {
        case 0u: { d = vec3f(1.0, -tc, -sc); }
        case 1u: { d = vec3f(-1.0, -tc, sc); }
        case 2u: { d = vec3f(sc, 1.0, tc); }
        case 3u: { d = vec3f(sc, -1.0, -tc); }
        case 4u: { d = vec3f(sc, -tc, 1.0); }
        default: { d = vec3f(-sc, -tc, -1.0); }
    }
    d.z = -d.z;
    return normalize(d);
}

@compute @workgroup_size(64)
fn trace_probe(@builtin(global_invocation_id) gid: vec3u) {
    let i = thread_index(gid);
    if i >= params.texel_count {
        return;
    }
    let n = params.face_size;
    let face = i / (n * n);
    let x = (i % (n * n)) % n;
    let y = (i % (n * n)) / n;
    let haze = params.haze_extinction > 0.0;
    var sum = vec3f(0.0);
    for (var k = 0u; k < params.samples; k++) {
        let sample_index = params.sample_base + k;
        rng = pcg(i ^ pcg(sample_index * 0x9e3779b9u + 0x85ebca6bu));
        let st = (vec2f(f32(x), f32(y)) + rand2()) / f32(n) * 2.0 - 1.0;
        var dir = probe_direction(face, st);
        var ray = trace(params.probe_center, dir, 1e5);
        var throughput = vec3f(1.0);
        var value = vec3f(0.0);
        // The light that the previous lobe sample meets on its way, already weighted.
        var pending = vec3f(0.0);
        var pending_t = 0.0;
        for (var bounce = 0u; bounce <= params.max_bounces; bounce++) {
            let last = bounce == params.max_bounces;
            let h = shade(ray, dir, last);
            let t = select(1e5, h.t, h.found);
            if pending_t > 0.0 && pending_t < t {
                value += clamp_indirect(pending * exp(-params.haze_extinction * pending_t), bounce - 1u);
            }
            // The world volume fills all space, so a ray that leaves the hall never reaches
            // the background through the haze.
            if !h.found && haze {
                break;
            }
            throughput *= exp(-params.haze_extinction * select(0.0, h.t, h.found));
            // Emission seen by the camera ray or the first scattered ray is direct light for
            // Cycles. The lightmapped part has bounced at least once.
            value += clamp_indirect(throughput * h.emission, max(bounce, 1u) - 1u);
            value += clamp_indirect(throughput * h.reflected, bounce);
            if !h.found || last {
                break;
            }
            let lb = make_lobes(h, -dir);
            let ls = sample_lobes(lb, h.s.ng);
            // Where the lobe sample's ray ends: the light test needs it before the next trace.
            var t_next = 1e5;
            if ls.ok {
                ray = trace(offset(h.s.pos, select(h.s.ng, -h.s.ng, ls.refracted)), ls.wi, 1e5);
                if ray.kind != RAY_QUERY_INTERSECTION_NONE {
                    t_next = ray.t;
                }
            }
            let hl = highlight(h.s.pos, h.s.ng, lb, ls, t_next);
            value += clamp_indirect(throughput * hl.value, bounce);
            pending_t = 0.0;
            if !ls.ok {
                break;
            }
            throughput *= ls.weight;
            if hl.hit.index != NONE {
                pending = throughput * hl.hit.radiance * hl.hit_weight;
                pending_t = hl.hit.t;
            }
            if !finite3(throughput) || max(throughput.x, max(throughput.y, throughput.z)) < 1e-3 {
                // The light that the ray meets still counts.
                if pending_t > 0.0 {
                    value += clamp_indirect(pending * exp(-params.haze_extinction * pending_t), bounce);
                }
                break;
            }
            dir = ls.wi;
        }
        sum += value;
    }
    accum[i] += vec4f(sum, 0.0);
}
// Peak intensity of an analytic light, for picking one.
fn light_power(l: Light) -> f32 {
    if (l.kind & 1u) == 0u {
        return luminance(l.value);
    }
    let gain = select(l.tan_half * l.spread_norm, 1.0, l.tan_half < 0.0);
    return luminance(l.value) * l.area * gain;
}

// The distance below which a light counts as near for the haze: the sphere radius (at least
// 5 cm), or half the size of a panel.
fn haze_floor(l: Light) -> f32 {
    if (l.kind & 1u) == 0u {
        return max(l.radius, 0.05);
    }
    return 0.5 * sqrt(l.area);
}

// Solid angle of a triangle seen from the origin (Van Oosterom and Strackee 1983).
fn triangle_solid_angle(a: vec3f, b: vec3f, c: vec3f) -> f32 {
    let la = length(a);
    let lb = length(b);
    let lc = length(c);
    let num = abs(dot(a, cross(b, c)));
    let den = la * lb * lc + dot(a, b) * lc + dot(a, c) * lb + dot(b, c) * la;
    return 2.0 * atan2(num, den);
}

// Single scattering of the world haze along the ray from `origin` to `t_end`, from the
// analytic lights. The emissive triangles add little haze and are left out.
//
// One light is picked in proportion to its power times the integral of 1 / distance² along
// the ray, by weighted reservoir sampling over all lights. A light picked from the tree at
// the ray origin, or a uniform distance next to a candle, carried huge values, and the
// probes were full of speckles.
// - A point light takes equiangular distance sampling (Kulla and Fajardo 2012), which
//   cancels its 1 / distance².
// - A panel has no such peak: it sends at most π × its radiance. It takes a uniform
//   distance, and its light at that point is its radiance times its solid angle.
fn haze_scattering(origin: vec3f, dir: vec3f, t_end: f32) -> vec3f {
    var w_sum = 0.0;
    var w_pick = 0.0;
    var pick = 0u;
    for (var i = 0u; i < params.light_count; i++) {
        let l = lights[i];
        let along = dot(l.pos - origin, dir);
        let d = max(length(origin + dir * along - l.pos), haze_floor(l));
        let w = light_power(l) * (atan2(t_end - along, d) - atan2(-along, d)) / d;
        w_sum += w;
        if rand() * w_sum < w {
            pick = i;
            w_pick = w;
        }
    }
    if w_pick <= 0.0 {
        return vec3f(0.0);
    }
    let pmf = w_pick / w_sum;
    let l = lights[pick];
    var t: f32;
    var pdf_t: f32;
    var light_at_x: vec3f;
    var dest: vec3f;
    if (l.kind & 1u) == 0u {
        // The distance floor keeps a ray through the light sphere from carrying 1 / 0.
        let r = haze_floor(l);
        let along = dot(l.pos - origin, dir);
        let d = max(length(origin + dir * along - l.pos), r);
        let theta_a = atan2(-along, d);
        let theta_b = atan2(t_end - along, d);
        t = along + d * tan(mix(theta_a, theta_b, rand()));
        pdf_t = d / ((theta_b - theta_a) * (d * d + (t - along) * (t - along)));
        dest = l.pos;
        let to = l.pos - origin - dir * t;
        light_at_x = l.value / max(dot(to, to), r * r);
    } else {
        t = rand() * t_end;
        pdf_t = 1.0 / t_end;
        let x = origin + dir * t;
        let from_panel = x - l.pos;
        let cos_l = dot(l.normal, normalize(from_panel));
        if cos_l <= 0.0 {
            return vec3f(0.0);
        }
        let c00 = l.pos - 0.5 * l.ax - 0.5 * l.ay - x;
        let c10 = c00 + l.ax;
        let c11 = c10 + l.ay;
        let c01 = c00 + l.ay;
        let omega = triangle_solid_angle(c00, c10, c11) + triangle_solid_angle(c00, c11, c01);
        let u = rand2();
        dest = l.pos + (u.x - 0.5) * l.ax + (u.y - 0.5) * l.ay;
        light_at_x = l.value * spread_attenuation(l, cos_l) * omega;
    }
    let x = origin + dir * t;
    if all(light_at_x <= vec3f(0.0)) || !visible(x, dest) {
        return vec3f(0.0);
    }
    let phase = henyey_greenstein(dot(normalize(dest - x), dir), params.haze_g);
    let c = params.haze_scatter * phase * light_at_x * exp(-params.haze_extinction * t) / (pmf * pdf_t);
    return select(vec3f(0.0), c, finite3(c));
}

// Henyey-Greenstein phase function; cos_t is the cosine between the light's direction of
// travel and the scattered direction.
fn henyey_greenstein(cos_t: f32, g: f32) -> f32 {
    let k = 1.0 + g * g - 2.0 * g * cos_t;
    return (1.0 - g * g) / (4.0 * PI * k * sqrt(k));
}

// A direction around `dir` drawn from the Henyey-Greenstein phase function.
fn sample_hg(dir: vec3f, g: f32, u: vec2f) -> vec3f {
    var cos_t: f32;
    if abs(g) < 1e-3 {
        cos_t = 1.0 - 2.0 * u.x;
    } else {
        let s = (1.0 - g * g) / (1.0 - g + 2.0 * g * u.x);
        cos_t = (1.0 + g * g - s * s) / (2.0 * g);
    }
    let sin_t = sqrt(max(0.0, 1.0 - cos_t * cos_t));
    let phi = 2.0 * PI * u.y;
    return normalize(tangent_frame(dir) * vec3f(sin_t * cos(phi), sin_t * sin(phi), cos_t));
}

// The haze lit by the surfaces around it: Cycles' volume bounce. One uniform distance along
// the ray, one direction from the phase function, and the emission and lightmapped light of
// the surface it hits. This covers the emissive meshes (crystal, candles, screens, windows)
// and the light that the walls send back. The analytic lights are not geometry, so
// `haze_scattering` keeps them.
fn haze_ambient(origin: vec3f, dir: vec3f, t_end: f32) -> vec3f {
    let t = rand() * t_end;
    let x = origin + dir * t;
    // The phase function weighs the direction of travel of the light: from the surface
    // towards x, then along −dir to the camera. Sampling it around dir picks the surfaces that
    // lie ahead.
    let l = sample_hg(dir, params.haze_g, rand2());
    let h = shade_hit(x, l, true);
    if !h.found {
        return vec3f(0.0);
    }
    let radiance = (h.emission + h.reflected) * exp(-params.haze_extinction * h.t);
    let c = params.haze_scatter * radiance * exp(-params.haze_extinction * t) * t_end;
    return select(vec3f(0.0), c, finite3(c));
}

// The haze glow of a probe at a lower resolution than the probe itself. The glow is smooth,
// and the extra samples per texel smooth out the beams of the narrow panels, which a single
// distance sample finds only now and then. Glossy surfaces also reflect the glow: one GGX
// sample follows the reflection through the haze. The glossy floor shows the halos of the
// lamps that way.
@compute @workgroup_size(64)
fn trace_haze(@builtin(global_invocation_id) gid: vec3u) {
    let i = thread_index(gid);
    if i >= params.texel_count {
        return;
    }
    let n = params.face_size;
    let face = i / (n * n);
    let x = (i % (n * n)) % n;
    let y = (i % (n * n)) / n;
    var sum = vec3f(0.0);
    for (var k = 0u; k < params.samples; k++) {
        let sample_index = params.sample_base + k;
        rng = pcg(i ^ pcg(sample_index * 0x9e3779b9u + 0x85ebca6bu));
        let st = (vec2f(f32(x), f32(y)) + rand2()) / f32(n) * 2.0 - 1.0;
        let dir = probe_direction(face, st);
        let h = shade_hit(params.probe_center, dir, false);
        let t_end = select(200.0, h.t, h.found);
        sum += haze_scattering(params.probe_center, dir, t_end);
        sum += clamp_indirect(haze_ambient(params.probe_center, dir, min(t_end, 200.0)), 1u);
        if !h.found {
            continue;
        }
        let lb = make_lobes(h, -dir);
        let ls = sample_lobes(lb, h.s.ng);
        if !ls.ok || ls.refracted {
            continue;
        }
        let weight = ls.weight * exp(-params.haze_extinction * t_end);
        let origin = offset(h.s.pos, h.s.ng);
        let hit = trace(origin, ls.wi, 1e5);
        let t_reflected = select(200.0, hit.t, hit.kind != RAY_QUERY_INTERSECTION_NONE);
        sum += clamp_indirect(weight * haze_scattering(origin, ls.wi, t_reflected), 1u);
    }
    accum[i] += vec4f(sum, 0.0);
}
