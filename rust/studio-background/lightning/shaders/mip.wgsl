// One mip level from the level above: a bilinear tap at the centre of each 2x2 block,
// which is the box filter of glGenerateMipmap.

@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var src_samp: sampler;

@vertex
fn vs(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  return fullscreen(id);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(src_tex)) * 0.5;
  return textureSampleLevel(src_tex, src_samp, frag.xy / max(floor(size), vec2f(1.0)), 0.0);
}
