// Casino backdrop: projective texturing from a fixed virtual projector (see casinoBackdrop.ts).
// The photo coordinate of a surface point comes from its rest position, so the photo stays glued
// to the proxy geometry. A swaying chandelier card moves only its drawn position: the chandelier
// swings and its picture goes with it.

// World space -> projector clip space.
uniform mat4 uWorldToProjector;
#ifdef SWAY
// World position of the ceiling point the chandelier hangs from.
uniform vec3 uSwayPivot;
// x: swing angle in the X-Y plane, y: twist about the vertical axis (radians).
uniform vec2 uSway;
#endif

varying vec4 vProjected;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vProjected = uWorldToProjector * world;
#ifdef SWAY
  vec3 rel = world.xyz - uSwayPivot;
  float c = cos(uSway.x);
  float s = sin(uSway.x);
  rel = vec3(rel.x * c - rel.y * s, rel.x * s + rel.y * c, rel.z);
  float ct = cos(uSway.y);
  float st = sin(uSway.y);
  rel = vec3(rel.x * ct + rel.z * st, rel.y, -rel.x * st + rel.z * ct);
  world.xyz = uSwayPivot + rel;
#endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
