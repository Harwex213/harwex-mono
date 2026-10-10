// Casino emitters (casinoShading.ts): passes the colour, the kind and the phase of each emitter on.

attribute vec3 aColor;
attribute vec2 aFx;

varying vec3 vColor;
varying vec2 vFx;
varying vec2 vUv;
varying float vDistance;

void main() {
  vColor = aColor;
  vFx = aFx;
  vUv = uv;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vDistance = -view.z;
  gl_Position = projectionMatrix * view;
}
