// Solid parts of the distant casino (casinoDistant.ts). The lighting is baked into `aLit`.
// The vertex stage moves only two kinds of parts: chandeliers sway on their chains, and some
// patrons stroll to and fro along the aisles.

attribute vec3 aLit;
// rgb: emissive colour, w: glow mode.
attribute vec4 aEmit;
// x: surface, y: seed, z: motion.
attribute vec4 aInfo;
// Sway: the hang point. Walk: direction x, direction z, speed, range.
attribute vec4 aPivot;

uniform float uTime;
uniform float uLife;

varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vLit;
varying vec4 vEmit;
varying vec2 vUv;
varying vec2 vInfo;

mat3 rotationX(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

mat3 rotationY(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

mat3 rotationZ(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}

void main() {
  vec3 p = position;
  vec3 n = normal;
  float seed = aInfo.y * 6.2831;
  if (aInfo.z > 0.5 && aInfo.z < 1.5) {
    // Slow pendulum with a slower twist about the chain.
    float swingX = 0.010 * sin(uTime * 0.55 + seed) + 0.004 * sin(uTime * 0.23 + seed * 2.0);
    float swingZ = 0.008 * sin(uTime * 0.47 + seed * 1.3);
    float twist = 0.05 * sin(uTime * 0.13 + seed * 3.0);
    mat3 turn = rotationZ(swingZ * uLife) * rotationX(swingX * uLife) * rotationY(twist * uLife);
    p = aPivot.xyz + turn * (p - aPivot.xyz);
    n = turn * n;
  } else if (aInfo.z > 1.5) {
    // To and fro along the path, easing to a stop at each end.
    float range = aPivot.w;
    float speed = aPivot.z;
    float leg = range / speed;
    float clock = uTime * uLife / leg + aInfo.y * 7.0;
    float tri = abs(fract(clock * 0.5) * 2.0 - 1.0);
    float along = smoothstep(0.0, 1.0, tri);
    p.xz += aPivot.xy * (along - 0.5) * range;
    // A small bob per step.
    p.y += 0.025 * abs(sin(clock * leg * 5.5)) * step(0.3, p.y);
  }
  vLocal = p;
  vNormal = n;
  vLit = aLit;
  vEmit = aEmit;
  vUv = uv;
  vInfo = aInfo.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
