import { Geometry } from "pixi.js";

// Pixi injects uProjectionMatrix / uWorldTransformMatrix as plain uniforms and
// uTransformMatrix as the mesh's local transform, so a custom program only has to
// multiply them. The `#version 300 es` line is not decoration: GlProgram switches
// its whole preprocessing path on finding it, and without it `in`/`out`/`texture()`
// are compiled as GLSL ES 1.00 and fail.
const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aUV;

out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

// A 0..1 quad: the mesh's scale decides what it covers, so one geometry serves a
// full-screen pass and a 1 x N reduction alike.
function unitQuad(): Geometry {
  return new Geometry({
    attributes: {
      aPosition: [0, 0, 1, 0, 1, 1, 0, 1],
      aUV: [0, 0, 1, 0, 1, 1, 0, 1],
    },
    indexBuffer: [0, 1, 2, 0, 2, 3],
  });
}

export { QUAD_VERTEX, unitQuad };
