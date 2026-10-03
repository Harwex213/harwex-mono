import * as THREE from "three";
import cloud from "../../assets/globe/cloud.png";
import islandA from "../../assets/globe/island-a.png";
import islandB from "../../assets/globe/island-b.png";
import islandC from "../../assets/globe/island-c.png";
import paper from "../../assets/globe/paper.jpg";
import settlement from "../../assets/globe/settlement.png";

/**
 * The hand-drawn tiles of the globe, packed into one atlas canvas. Slots
 * follow `TILE_SLOTS` in `globe-geometry.ts`: three islands, a settlement and
 * a cloud, all generated hand-drawn art. Each image is drawn into the atlas
 * when it loads. Until then its slot is transparent and the cell shows sea.
 */

const SLOT_SIZE = 512;
const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 2;

/** Atlas slot of each image, in slot order. */
const SLOT_SOURCES: readonly string[] = [islandA, islandB, islandC, settlement, cloud];

const slotOrigin = (slot: number) => ({
  x: (slot % ATLAS_COLUMNS) * SLOT_SIZE,
  y: Math.floor(slot / ATLAS_COLUMNS) * SLOT_SIZE,
});

type TGlobeAtlas = {
  readonly atlas: THREE.CanvasTexture;
  readonly paper: THREE.Texture;
  readonly dispose: () => void;
};

const createGlobeAtlas = (): TGlobeAtlas => {
  const canvas = document.createElement("canvas");
  canvas.width = SLOT_SIZE * ATLAS_COLUMNS;
  canvas.height = SLOT_SIZE * ATLAS_ROWS;
  const context = canvas.getContext("2d");

  const atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;

  const images: HTMLImageElement[] = [];

  const load = (source: string, draw: (image: HTMLImageElement) => void) => {
    const image = new Image();
    image.onload = () => {
      draw(image);
      atlas.needsUpdate = true;
    };
    image.src = source;
    images.push(image);
  };

  SLOT_SOURCES.forEach((source, slot) => {
    if (!context) {
      return;
    }

    load(source, (image) => {
      const { x, y } = slotOrigin(slot);
      context.clearRect(x, y, SLOT_SIZE, SLOT_SIZE);
      context.drawImage(image, x, y, SLOT_SIZE, SLOT_SIZE);
    });
  });

  const paperTexture = new THREE.TextureLoader().load(paper);
  paperTexture.colorSpace = THREE.SRGBColorSpace;
  paperTexture.wrapS = THREE.RepeatWrapping;
  paperTexture.wrapT = THREE.RepeatWrapping;

  return {
    atlas,
    paper: paperTexture,
    dispose: () => {
      for (const image of images) {
        image.onload = null;
      }

      atlas.dispose();
      paperTexture.dispose();
    },
  };
};

export type { TGlobeAtlas };
export { ATLAS_COLUMNS, ATLAS_ROWS, createGlobeAtlas };
