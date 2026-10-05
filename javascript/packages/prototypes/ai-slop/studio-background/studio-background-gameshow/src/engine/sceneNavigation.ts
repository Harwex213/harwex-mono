import * as THREE from "three";

// Scene view camera that moves like Unity's:
// - hold RMB and drag to look around; while RMB is held, WASD flies, Q/E go down/up, Shift is faster,
//   and the mouse wheel changes the fly speed;
// - MMB drag pans;
// - Alt + LMB drag orbits around the pivot, Alt + RMB drag zooms;
// - the mouse wheel alone zooms towards the pivot.
// The pivot is a point in front of the camera, `distance` metres away. Focus (F) moves it to the selection.

const LOOK_SPEED = 0.004;
const BASE_FLY_SPEED = 6;
const MIN_FLY_SPEED = 0.5;
const MAX_FLY_SPEED = 60;
// Holding a fly key speeds the camera up to this factor over ACCELERATION_TIME seconds, like Unity.
const MAX_ACCELERATION = 4;
const ACCELERATION_TIME = 2.5;
const SHIFT_FACTOR = 3;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

type Drag = "look" | "pan" | "orbit" | "zoom" | null;

const FLY_KEYS: Record<string, THREE.Vector3> = {
  KeyW: new THREE.Vector3(0, 0, -1),
  KeyS: new THREE.Vector3(0, 0, 1),
  KeyA: new THREE.Vector3(-1, 0, 0),
  KeyD: new THREE.Vector3(1, 0, 0),
  KeyQ: new THREE.Vector3(0, -1, 0),
  KeyE: new THREE.Vector3(0, 1, 0),
};

class SceneNavigation {
  enabled = true;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly keys = new Set<string>();
  private drag: Drag = null;
  private distance = 10;
  private flySpeed = BASE_FLY_SPEED;
  private flyTime = 0;
  private shift = false;

  constructor(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.camera = camera;
    this.canvas = canvas;
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
    window.addEventListener("keydown", this.handleKey);
    window.addEventListener("keyup", this.handleKey);
    window.addEventListener("blur", () => {
      this.stop();
    });
  }

  // True while RMB is held: the WASD keys fly the camera and must not switch tools.
  get flying(): boolean {
    return this.drag === "look";
  }

  lookAt(position: THREE.Vector3, target: THREE.Vector3): void {
    this.camera.position.copy(position);
    this.camera.lookAt(target);
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.distance = position.distanceTo(target);
  }

  // Frames a sphere: keeps the view direction and backs off so the sphere fits.
  frame(center: THREE.Vector3, radius: number): void {
    this.distance = Math.max(1, radius * 2.4);
    this.camera.position.copy(center).addScaledVector(this.forward(), -this.distance);
  }

  update(dt: number): void {
    if (!this.flying) {
      this.flyTime = 0;
      return;
    }
    const direction = new THREE.Vector3();
    for (const key of this.keys) {
      const axis = FLY_KEYS[key];
      if (axis) {
        direction.add(axis);
      }
    }
    if (direction.lengthSq() === 0) {
      this.flyTime = 0;
      return;
    }
    this.flyTime += dt;
    const acceleration = 1 + (MAX_ACCELERATION - 1) * Math.min(this.flyTime / ACCELERATION_TIME, 1);
    const speed = this.flySpeed * acceleration * (this.shift ? SHIFT_FACTOR : 1);
    direction.normalize().applyQuaternion(this.camera.quaternion);
    this.camera.position.addScaledVector(direction, speed * dt);
  }

  private forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  private pivot(): THREE.Vector3 {
    return this.camera.position.clone().addScaledVector(this.forward(), this.distance);
  }

  private applyRotation(): void {
    this.euler.x = THREE.MathUtils.clamp(this.euler.x, -PITCH_LIMIT, PITCH_LIMIT);
    this.euler.z = 0;
    this.camera.quaternion.setFromEuler(this.euler);
  }

  private stop(): void {
    this.drag = null;
    this.keys.clear();
    this.shift = false;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.enabled || this.drag) {
      return;
    }
    if (event.button === 2) {
      this.drag = event.altKey ? "zoom" : "look";
    } else if (event.button === 1) {
      this.drag = "pan";
      event.preventDefault();
    } else if (event.button === 0 && event.altKey) {
      this.drag = "orbit";
    }
    if (this.drag) {
      this.canvas.setPointerCapture(event.pointerId);
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.drag) {
      return;
    }
    const dx = event.movementX;
    const dy = event.movementY;
    if (this.drag === "look") {
      this.euler.y -= dx * LOOK_SPEED;
      this.euler.x -= dy * LOOK_SPEED;
      this.applyRotation();
    } else if (this.drag === "orbit") {
      const pivot = this.pivot();
      this.euler.y -= dx * LOOK_SPEED;
      this.euler.x -= dy * LOOK_SPEED;
      this.applyRotation();
      this.camera.position.copy(pivot).addScaledVector(this.forward(), -this.distance);
    } else if (this.drag === "pan") {
      // One pixel of drag moves the pivot by one pixel on screen.
      const height = Math.max(1, this.canvas.clientHeight);
      const metresPerPixel = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / height;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.camera.position.addScaledVector(right, -dx * metresPerPixel).addScaledVector(up, dy * metresPerPixel);
    } else if (this.drag === "zoom") {
      this.zoom((dx - dy) * 0.01);
    }
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.drag) {
      return;
    }
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    // Like Unity, the fly stops as soon as RMB is released, even with a key still held.
    this.drag = null;
    this.keys.clear();
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (!this.enabled) {
      return;
    }
    event.preventDefault();
    if (this.flying) {
      // Like Unity: the wheel during a fly changes the fly speed.
      this.flySpeed = THREE.MathUtils.clamp(this.flySpeed * Math.pow(1.1, -Math.sign(event.deltaY)), MIN_FLY_SPEED, MAX_FLY_SPEED);
      return;
    }
    this.zoom(-Math.sign(event.deltaY) * 0.12);
  };

  // Moves towards the pivot by a share of the distance. A positive amount moves closer.
  private zoom(amount: number): void {
    const step = this.distance * THREE.MathUtils.clamp(amount, -0.5, 0.5);
    // Close to the pivot the camera keeps moving forward and pushes the pivot ahead.
    const nextDistance = Math.max(0.5, this.distance - step);
    this.camera.position.addScaledVector(this.forward(), step);
    this.distance = nextDistance;
  }

  private readonly handleKey = (event: KeyboardEvent): void => {
    this.shift = event.shiftKey;
    if (event.type === "keyup") {
      this.keys.delete(event.code);
      return;
    }
    if (this.flying && FLY_KEYS[event.code]) {
      this.keys.add(event.code);
      event.preventDefault();
    }
  };
}

export { SceneNavigation };
