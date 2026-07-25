import { Container } from "pixi.js";
import {
  type BuildOrder,
  BuildingKind,
  canBuildAt,
  type PlayerId,
  type Selection,
  TILE_SIZE,
  type World,
} from "@hw/colony-sim-v1-core";
import { buildingSprite, resourceBadge } from "./buildings";

const GHOST_ALPHA = 0.7;
const GHOST_BLOCKED_TINT = 0xd06060;
const GHOST_OK_TINT = 0xffffff;

// The frame a variant-picking building shows before it has an id to derive its
// variant from. Fixed rather than random: a ghost that reshuffled its own art under
// the cursor would read as a different building each frame.
const GHOST_VARIANT = 0;

// What the build cursor puts under the pointer: the building that would be placed,
// tinted red where it cannot go. Whether it can go there is asked of core's own
// `canBuildAt` — a second copy of that rule here would advertise tiles the command
// then refuses, which is worse than no preview at all.
//
// Rebuilt whenever the order changes rather than reconciled: there is one ghost, and
// its art depends only on the order.
class BuildGhost {
  private parent: Container;
  private view: Container | null = null;
  private shown: BuildOrder | null = null;

  constructor(parent: Container) {
    this.parent = parent;
  }

  // `target` is what the engine resolved under the cursor; with an order armed it is
  // always the tile (see targetAt), which is exactly what a building needs.
  show(world: World, player: PlayerId, order: BuildOrder | null, target: Selection | null): void {
    if (!order || !target || target.kind !== "tile") {
      this.hide();
      return;
    }
    const view = this.viewFor(player, order);
    view.visible = true;
    view.position.set(target.x * TILE_SIZE, target.y * TILE_SIZE);
    view.tint = canBuildAt(world, target.x, target.y) ? GHOST_OK_TINT : GHOST_BLOCKED_TINT;
  }

  hide(): void {
    if (this.view) {
      this.view.visible = false;
    }
  }

  private viewFor(player: PlayerId, order: BuildOrder): Container {
    if (this.view && this.shown && sameOrder(this.shown, order)) {
      return this.view;
    }
    this.view?.destroy({ children: true });
    const view = new Container();
    view.alpha = GHOST_ALPHA;
    view.addChild(buildingSprite(player, order.kind, GHOST_VARIANT));
    // The store shows what it will hold while it is still a ghost: which resource it
    // is for is chosen before placing, so it is part of what the cursor is offering.
    if (order.kind === BuildingKind.Warehouse) {
      view.addChild(resourceBadge(order.stores));
    }
    this.parent.addChild(view);
    this.view = view;
    this.shown = order;
    return view;
  }
}

// Two orders draw the same ghost when they would place the same building — the
// store's resource is part of the building, not a setting on top of it.
function sameOrder(a: BuildOrder, b: BuildOrder): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === BuildingKind.Warehouse && b.kind === BuildingKind.Warehouse) {
    return a.stores === b.stores;
  }
  return true;
}

export { BuildGhost };
