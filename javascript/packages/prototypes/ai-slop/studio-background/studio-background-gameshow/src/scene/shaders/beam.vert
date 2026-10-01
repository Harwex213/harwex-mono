varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;

void main() {
  vUv = uv;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vViewDir = normalize(-view.xyz);
  gl_Position = projectionMatrix * view;
}
