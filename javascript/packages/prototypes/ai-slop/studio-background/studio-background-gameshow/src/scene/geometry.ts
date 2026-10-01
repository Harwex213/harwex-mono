import * as THREE from "three";

// Studio layout uses one polar convention everywhere:
// angle 0 points from the wheel straight back (-Z), positive angles go to the camera's right (+X).

function polar(angle: number, radius: number, y = 0): THREE.Vector3 {
  return new THREE.Vector3(radius * Math.sin(angle), y, -radius * Math.cos(angle));
}

// Rotates an object so that its local +Z faces the studio center.
function faceCenter(object: THREE.Object3D, angle: number): void {
  object.rotation.y = -angle;
}

// Three.js cylinders sweep theta from +Z towards +X; this maps a studio angle range onto that sweep.
function cylinderArc(fromAngle: number, toAngle: number): { thetaStart: number; thetaLength: number } {
  return {
    thetaStart: Math.PI - toAngle,
    thetaLength: toAngle - fromAngle,
  };
}

// Flat ring sector lying on the floor, extruded upwards by `height`.
function annularSector(innerRadius: number, outerRadius: number, fromAngle: number, toAngle: number, height: number): THREE.BufferGeometry {
  // Shape space angle phi relates to the studio angle as phi = PI / 2 - angle after the X rotation below.
  const phiStart = Math.PI / 2 - toAngle;
  const phiEnd = Math.PI / 2 - fromAngle;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerRadius, phiStart, phiEnd, false);
  shape.absarc(0, 0, innerRadius, phiEnd, phiStart, true);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 96,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// Torus arc lying flat on the floor plane, centered on the studio axis.
function floorArc(radius: number, tube: number, fromAngle: number, toAngle: number): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(radius, tube, 8, 160, toAngle - fromAngle);
  geometry.rotateZ(Math.PI / 2 - toAngle);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// Arch outline: a rectangle from `bottom` to `spring` topped by a half circle.
function archPath(path: THREE.Path, halfWidth: number, bottom: number, spring: number): void {
  path.moveTo(-halfWidth, bottom);
  path.lineTo(halfWidth, bottom);
  path.lineTo(halfWidth, spring);
  path.absarc(0, spring, halfWidth, 0, Math.PI, false);
  path.lineTo(-halfWidth, bottom);
}

// Upside-down U molding that frames an arch opening.
function archFrameShape(innerHalfWidth: number, outerHalfWidth: number, bottom: number, spring: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-outerHalfWidth, bottom);
  shape.lineTo(-outerHalfWidth, spring);
  shape.absarc(0, spring, outerHalfWidth, Math.PI, 0, true);
  shape.lineTo(outerHalfWidth, bottom);
  shape.lineTo(innerHalfWidth, bottom);
  shape.lineTo(innerHalfWidth, spring);
  shape.absarc(0, spring, innerHalfWidth, 0, Math.PI, false);
  shape.lineTo(-innerHalfWidth, bottom);
  shape.closePath();
  return shape;
}

export { polar, faceCenter, cylinderArc, annularSector, floorArc, archPath, archFrameShape };
