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

// One half of the arch frame, from the bottom of a leg up to the cut at `cutAngle`.
// side = -1 is the left half (the arc runs from PI down to the cut), side = 1 the right half (from 0 up to it).
// The cut is radial, so a keystone with radial sides fits it exactly.
function archFrameHalf(side: -1 | 1, innerHalfWidth: number, outerHalfWidth: number, bottom: number, spring: number, cutAngle: number): THREE.Shape {
  const shape = new THREE.Shape();
  const legAngle = side < 0 ? Math.PI : 0;
  shape.moveTo(side * outerHalfWidth, bottom);
  shape.lineTo(side * outerHalfWidth, spring);
  shape.absarc(0, spring, outerHalfWidth, legAngle, cutAngle, side > 0 ? false : true);
  shape.lineTo(Math.cos(cutAngle) * innerHalfWidth, spring + Math.sin(cutAngle) * innerHalfWidth);
  shape.absarc(0, spring, innerHalfWidth, cutAngle, legAngle, side > 0 ? true : false);
  shape.lineTo(side * innerHalfWidth, bottom);
  shape.closePath();
  return shape;
}

// Keystone between the two frame halves: radial sides at `fromAngle` and `toAngle`, the arc at the bottom.
function keystoneShape(innerRadius: number, outerRadius: number, spring: number, fromAngle: number, toAngle: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(Math.cos(toAngle) * innerRadius, spring + Math.sin(toAngle) * innerRadius);
  shape.lineTo(Math.cos(toAngle) * outerRadius, spring + Math.sin(toAngle) * outerRadius);
  shape.lineTo(Math.cos(fromAngle) * outerRadius, spring + Math.sin(fromAngle) * outerRadius);
  shape.lineTo(Math.cos(fromAngle) * innerRadius, spring + Math.sin(fromAngle) * innerRadius);
  shape.absarc(0, spring, innerRadius, fromAngle, toAngle, false);
  shape.closePath();
  return shape;
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

// Upright prism from a floor plan: `plan` holds (x, z) points, the prism rises from `bottom` by `height`.
function planPrism(plan: THREE.Vector2[], bottom: number, height: number, curveSegments = 1): THREE.BufferGeometry {
  // Shape space (x, y) = plan (x, -z): the X rotation below turns shape y into -z and the extrusion into +y.
  const shape = new THREE.Shape(plan.map((point) => new THREE.Vector2(point.x, -point.y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom, 0);
  return geometry;
}

// Gives an object a name in the editor Hierarchy and lets the editor select it.
// A folder only groups objects: a click in the Scene view selects its children, not the folder.
function named<T extends THREE.Object3D>(object: T, name: string, folder = false): T {
  object.name = name;
  object.userData.selectable = true;
  object.userData.folder = folder;
  return object;
}

export { archFrameHalf, keystoneShape, named, planPrism, polar, faceCenter, cylinderArc, annularSector, floorArc, archPath, archFrameShape };
