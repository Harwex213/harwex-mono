// Volumetric-looking light cone: bright at the fixture, fading towards the floor,
// and soft at the silhouette edges where the cone gets thin.
uniform vec3 uColor;
uniform float uIntensity;

varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;

void main() {
  // MSAA extrapolates varyings past the triangle edge: an unclamped negative base makes pow() return NaN,
  // and bloom then spreads that NaN into black blocks.
  float along = pow(clamp(vUv.y, 0.0, 1.0), 1.6);
  float facing = clamp(abs(dot(normalize(vNormalView), normalize(vViewDir))), 0.0, 1.0);
  float core = pow(facing, 2.5);
  gl_FragColor = vec4(uColor * uIntensity * along * core, 1.0);
}
