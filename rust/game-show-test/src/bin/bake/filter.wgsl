// Turns the accumulated samples into texel colors and denoises them.
//
// `resolve` divides the sums by the sample count and estimates the variance of the mean.
// `atrous` is one pass of an edge-aware à-trous wavelet filter (Dammertz et al. 2010, with
// SVGF's variance-guided luminance weight). It runs over the lightmap page with a growing step.
// Neighbours count only when they lie on the same surface: a close position on the texel's
// plane and a similar normal. Page neighbours from another chart fail that test.

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

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> texels: array<Texel>;
@group(0) @binding(2) var<storage, read> texel_map: array<u32>;
@group(0) @binding(3) var<storage, read> color_in: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> color_out: array<vec4f>;

fn thread_index(gid: vec3u) -> u32 {
    return gid.y * params.groups_x * 64u + gid.x;
}

fn luminance(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(64)
fn resolve(@builtin(global_invocation_id) gid: vec3u) {
    let i = thread_index(gid);
    if i >= params.texel_count {
        return;
    }
    let a = color_in[i];
    let n = f32(params.samples);
    let mean = a.rgb / n;
    let l = luminance(mean);
    let variance = max(a.w / n - l * l, 0.0) / n;
    color_out[i] = vec4f(mean, variance);
}

@compute @workgroup_size(64)
fn atrous(@builtin(global_invocation_id) gid: vec3u) {
    let i = thread_index(gid);
    if i >= params.texel_count {
        return;
    }
    let t = texels[i];
    let c = color_in[i];
    let lum = luminance(c.rgb);
    let step = i32(params.filter_step);
    let size = i32(params.atlas_size);
    let x = i32(t.texel % params.atlas_size);
    let y = i32(t.texel / params.atlas_size);
    let reach = t.size * f32(step) * 3.0;
    let kernel = array<f32, 3>(0.375, 0.25, 0.0625);

    var sum = vec3f(0.0);
    var var_sum = 0.0;
    var w_sum = 0.0;
    for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
            let qx = x + dx * step;
            let qy = y + dy * step;
            if qx < 0 || qy < 0 || qx >= size || qy >= size {
                continue;
            }
            let j = texel_map[u32(qy * size + qx)];
            if j == 0xffffffffu {
                continue;
            }
            let q = texels[j];
            let cq = color_in[j];
            let h = kernel[abs(dx)] * kernel[abs(dy)];
            let wn = pow(max(dot(t.ns, q.ns), 0.0), 32.0);
            let d = q.pos - t.pos;
            let plane = abs(dot(t.ng, d));
            let wp = exp(-plane / (0.25 * t.size + 1e-4)) * select(0.0, 1.0, length(d) < reach);
            // SVGF: the luminance weight scales with the noise left in the texels. The larger
            // noise of the pair counts, so a dark texel still takes a bright noisy neighbour
            // and the filter keeps the energy.
            let lq = luminance(cq.rgb);
            let sigma_l = 4.0 * sqrt(max(c.w, cq.w)) + 1e-4 + 0.05 * max(lum, lq);
            let wl = exp(-abs(lq - lum) / sigma_l);
            let w = h * wn * wp * wl;
            sum += w * cq.rgb;
            var_sum += w * w * cq.w;
            w_sum += w;
        }
    }
    // The texel itself always has weight h(0,0) > 0.
    color_out[i] = vec4f(sum / w_sum, var_sum / (w_sum * w_sum));
}
