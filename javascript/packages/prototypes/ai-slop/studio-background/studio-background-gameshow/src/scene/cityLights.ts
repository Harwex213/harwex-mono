import * as THREE from "three";
import cityLightsFragment from "./shaders/cityLights.frag";

const VERTEX = `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Renders the animated skyline into a mipmapped texture every frame.
function createCityLights(photo: THREE.Texture, windows: THREE.Texture, width: number, height: number) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
  });
  target.texture.anisotropy = 8;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: cityLightsFragment,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uPhoto: { value: photo },
      uWindows: { value: windows },
      uSize: { value: new THREE.Vector2(width, height) },
      uTime: { value: 0 },
    },
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const render = (renderer: THREE.WebGLRenderer, time: number) => {
    // Both images arrive asynchronously; render only once they are there.
    if (!photo.image || !windows.image) {
      return;
    }
    const uniform = material.uniforms.uTime;
    if (uniform) {
      uniform.value = time;
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
  };

  return { texture: target.texture, render };
}

export { createCityLights };
