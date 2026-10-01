import * as THREE from "three";

// The studio is laid out on a circle around the origin.
// The angle phi is measured from the back of the studio (-Z) towards +X,
// so phi = 0 is straight behind the wheel and phi > 0 is on the right side of the frame.

function polar(radius: number, phi: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(radius * Math.sin(phi), y, -radius * Math.cos(phi));
}

// Flat ring sector on the floor, extruded upwards by `height`.
function annularSector(innerRadius: number, outerRadius: number, phiFrom: number, phiTo: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const thetaFrom = Math.PI / 2 - phiFrom;
  const thetaTo = Math.PI / 2 - phiTo;
  shape.moveTo(outerRadius * Math.cos(thetaFrom), outerRadius * Math.sin(thetaFrom));
  shape.absarc(0, 0, outerRadius, thetaFrom, thetaTo, true);
  shape.lineTo(innerRadius * Math.cos(thetaTo), innerRadius * Math.sin(thetaTo));
  shape.absarc(0, 0, innerRadius, thetaTo, thetaFrom, false);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 96,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// Vertical curved band (open cylinder part) facing the studio centre.
function arcBand(radius: number, phiFrom: number, phiTo: number, bottom: number, height: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 128, 1, true, Math.PI - phiTo, phiTo - phiFrom);
  geometry.translate(0, bottom + height / 2, 0);
  return geometry;
}

// Horizontal torus arc lying on the floor plane.
function arcTorus(radius: number, tube: number, phiFrom: number, phiTo: number): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(radius, tube, 8, 160, phiTo - phiFrom);
  geometry.rotateZ(Math.PI / 2 - phiTo);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// Round-topped arch outline: straight jambs from `bottom` to `spring`, then a semicircle.
function archPath<T extends THREE.Path>(path: T, halfWidth: number, bottom: number, spring: number): T {
  path.moveTo(-halfWidth, bottom);
  path.lineTo(halfWidth, bottom);
  path.lineTo(halfWidth, spring);
  path.absarc(0, spring, halfWidth, 0, Math.PI, false);
  path.lineTo(-halfWidth, bottom);
  return path;
}

// Gold arch moulding: the outer arch minus the inner arch.
function archFrame(innerHalfWidth: number, outerHalfWidth: number, bottom: number, spring: number, depth: number): THREE.BufferGeometry {
  const shape = archPath(new THREE.Shape(), outerHalfWidth, bottom, spring);
  shape.holes.push(archPath(new THREE.Path(), innerHalfWidth, bottom, spring));
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 48,
  });
}

// Flat ring in the XY plane, extruded along +Z.
function annulus(innerRadius: number, outerRadius: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 128,
  });
}

function mesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.name = name;
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function group(name: string, selectable = true): THREE.Group {
  const result = new THREE.Group();
  result.name = name;
  result.userData.selectable = selectable;
  return result;
}

export { annularSector, annulus, arcBand, arcTorus, archFrame, archPath, group, mesh, polar };
