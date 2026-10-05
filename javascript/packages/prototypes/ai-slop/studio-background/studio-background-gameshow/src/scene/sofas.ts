import * as THREE from "three";
import { named, polar } from "./geometry";
import type { Materials } from "./materials";
import { slab } from "./props";

// Two velvet sofas in the back of the studio, one on each side of the wheel. They face the arches,
// so a guest on them looks out at the city, and the camera sees their backs.
// They stand in the band between the inlay rings (10.55 m and 14.85 m), clear of both.
//
// A sofa is modelled at human size and scaled up as a whole, like the lounge chairs.
// Local frame: +z is the front (the seat side), the back is at -z. Every part is stacked from the floor up:
// a gold plinth; on it two arms, the back between the arms, and the seat in front of the back;
// on the seat, channel ridges against the back and two pillows in front of them; gold caps on the arms and the back.

const SOFA_SCALE = 2.0;
const SOFA_RADIUS = 12.7;
const SOFA_ANGLE = 30;

function createSofa(materials: Materials, pillow: THREE.Material): THREE.Group {
  const sofa = new THREE.Group();
  const plinthTop = 0.08;
  const seatTop = 0.42;
  const armTop = 0.62;
  const backTop = 0.92;
  const back = -0.48;
  const backFront = -0.25;
  const front = 0.45;
  const innerHalf = 0.95;
  const armWidth = 0.2;
  const outerHalf = innerHalf + armWidth;

  sofa.add(slab("Plinth", outerHalf * 2, 0, plinthTop, back, front, materials.goldPolished));
  for (const side of [-1, 1]) {
    const x = side * (innerHalf + armWidth / 2);
    const label = side < 0 ? "Left" : "Right";
    sofa.add(slab(`Arm ${label}`, armWidth, plinthTop, armTop, back, front, materials.velvet, x));
    sofa.add(slab(`Arm Cap ${label}`, armWidth, armTop, armTop + 0.03, back, front, materials.gold, x));
  }
  sofa.add(slab("Back", innerHalf * 2, plinthTop, backTop, back, backFront, materials.velvet));
  sofa.add(slab("Back Cap", innerHalf * 2, backTop, backTop + 0.03, back, backFront, materials.gold));
  sofa.add(slab("Seat", innerHalf * 2, plinthTop, seatTop, backFront, front, materials.velvet));

  // Channel tufting: vertical ridges on the seat, against the back.
  const channels = named(new THREE.Group(), "Channels");
  const count = 8;
  const pitch = (innerHalf * 2) / count;
  const ridgeFront = backFront + 0.04;
  for (let i = 0; i < count; i++) {
    const x = -innerHalf + pitch * (i + 0.5);
    channels.add(slab(`Channel ${i + 1}`, pitch - 0.04, seatTop, backTop - 0.03, backFront, ridgeFront, materials.velvet, x));
  }
  sofa.add(channels);
  for (const side of [-1, 1]) {
    sofa.add(slab(side < 0 ? "Pillow Left" : "Pillow Right", 0.32, seatTop, seatTop + 0.28, ridgeFront, ridgeFront + 0.1, pillow, side * 0.55));
  }
  return sofa;
}

function createSofas(materials: Materials): THREE.Group {
  const group = named(new THREE.Group(), "Sofas", true);
  for (const [index, side] of [-1, 1].entries()) {
    const angle = THREE.MathUtils.degToRad(side * SOFA_ANGLE);
    const sofa = named(createSofa(materials, index === 0 ? materials.navy : materials.goldPolished), side < 0 ? "Sofa Left" : "Sofa Right");
    sofa.position.copy(polar(angle, SOFA_RADIUS));
    // The front faces away from the studio centre, towards the arches and the city.
    const outward = polar(angle, SOFA_RADIUS + 1);
    sofa.rotation.y = Math.atan2(outward.x - sofa.position.x, outward.z - sofa.position.z);
    sofa.scale.setScalar(SOFA_SCALE);
    group.add(sofa);
  }
  return group;
}

export { createSofas };
