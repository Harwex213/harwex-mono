import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { BIOMES } from "../../core/exports";
import { PALETTE } from "../palette";
import type { TWorldCell } from "../../core/exports";

/**
 * The 92 cells of the Goldberg dual as three.js meshes: one flat-shaded tile per
 * cell, a thin skirt under it so the tiles read as plates, and one dark wire
 * outline over the whole globe.
 *
 * The module is a pure builder. It never reads a signal and never touches the
 * DOM, so `world-globe.tsx` stays the only place that owns a lifetime.
 */

type TGlobeHandle = {
  readonly group: Group;
  /** Indexed by cell id: `cellMeshes[cell.id]` is that cell's tile. */
  readonly cellMeshes: readonly Mesh[];
  readonly dispose: () => void;
};

type TVector3 = readonly [number, number, number];

/** The tile top is flat and touches the unit sphere at the cell centre; the skirt drops to here. */
const TOP_RADIUS = 1;
const SKIRT_RADIUS = 0.97;

/** The outline floats just above the tile plane so it does not fight it for depth. */
const OUTLINE_LIFT = 1.002;

/** A cell nobody has scouted is a flat grey plate. */
const UNREVEALED_COLOUR = "#555b66";

/** The trail is painted toward this green, and it saturates at this many points. */
const TRAIL_COLOUR = PALETTE.toxic;
const TRAIL_FULL_POINTS = 50;
const TRAIL_MAX_MIX = 1;

/** The selected tile glows in the panel gold. */
const SELECTED_EMISSIVE = PALETTE.gold;
const SELECTED_EMISSIVE_INTENSITY = 0.55;
const NO_EMISSIVE = "#000000";

const TILE_ROUGHNESS = 0.82;
const TILE_METALNESS = 0.06;
const OUTLINE_COLOUR = "#0a1524";
const OUTLINE_OPACITY = 0.65;

const VECTOR_COMPONENTS = 3;

const scaled = (vector: TVector3, factor: number): TVector3 => {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
};

const dot = (a: TVector3, b: TVector3): number => {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
};

/**
 * The corner lifted from the sphere onto the tangent plane at `centre`, so the
 * whole top face of a tile is one flat plate instead of a fan of facets.
 */
const onTangentPlane = (centre: TVector3, corner: TVector3): TVector3 => {
  const projection = dot(centre, corner);
  if (projection <= 0) {
    return corner;
  }

  return scaled(corner, TOP_RADIUS / projection);
};

const pushVertex = (target: number[], vertex: TVector3): void => {
  target.push(vertex[0], vertex[1], vertex[2]);
};

/**
 * A fan-triangulated polygon around `centre` plus a skirt down to
 * `SKIRT_RADIUS`. `corners` are wound counter-clockwise seen from outside, so
 * both the fan and the skirt come out front-facing.
 */
const buildCellGeometry = (cell: TWorldCell): BufferGeometry => {
  const positions: number[] = [];
  const centre = scaled(cell.centre, TOP_RADIUS);
  const top = cell.corners.map((corner) => {
    return onTangentPlane(cell.centre, corner as TVector3);
  });
  const bottom = cell.corners.map((corner) => {
    return scaled(corner as TVector3, SKIRT_RADIUS);
  });

  for (let index = 0; index < top.length; index += 1) {
    const cornerA = top[index];
    const cornerB = top[(index + 1) % top.length];
    const underA = bottom[index];
    const underB = bottom[(index + 1) % bottom.length];
    if (cornerA === undefined || cornerB === undefined || underA === undefined || underB === undefined) {
      continue;
    }

    pushVertex(positions, centre);
    pushVertex(positions, cornerA);
    pushVertex(positions, cornerB);

    pushVertex(positions, cornerA);
    pushVertex(positions, underB);
    pushVertex(positions, cornerB);

    pushVertex(positions, cornerA);
    pushVertex(positions, underA);
    pushVertex(positions, underB);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), VECTOR_COMPONENTS));
  geometry.computeVertexNormals();

  return geometry;
};

/** One `LineSegments` for every cell outline: the same picture as 92 of them, at a fraction of the cost. */
const buildOutlineGeometry = (cells: readonly TWorldCell[]): BufferGeometry => {
  const positions: number[] = [];
  for (const cell of cells) {
    for (let index = 0; index < cell.corners.length; index += 1) {
      const cornerA = cell.corners[index];
      const cornerB = cell.corners[(index + 1) % cell.corners.length];
      if (cornerA === undefined || cornerB === undefined) {
        continue;
      }

      pushVertex(positions, scaled(onTangentPlane(cell.centre, cornerA as TVector3), OUTLINE_LIFT));
      pushVertex(positions, scaled(onTangentPlane(cell.centre, cornerB as TVector3), OUTLINE_LIFT));
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), VECTOR_COMPONENTS));

  return geometry;
};

/** The tile colour before the selection glow: the biome, the fog, and the trail over both. */
const cellColour = (cell: TWorldCell): Color => {
  const base = cell.revealed === true ? BIOMES[cell.biomeHint].colours[0] : UNREVEALED_COLOUR;
  const colour = new Color(base);
  if (cell.trail <= 0) {
    return colour;
  }

  const mix = Math.min(TRAIL_MAX_MIX, cell.trail / TRAIL_FULL_POINTS);

  return colour.lerp(new Color(TRAIL_COLOUR), mix);
};

const createGlobeMesh = (cells: readonly TWorldCell[]): TGlobeHandle => {
  const group = new Group();
  const cellMeshes: Mesh[] = [];

  for (const cell of cells) {
    const material = new MeshStandardMaterial({
      color: cellColour(cell),
      flatShading: true,
      roughness: TILE_ROUGHNESS,
      metalness: TILE_METALNESS,
    });
    const mesh = new Mesh(buildCellGeometry(cell), material);
    mesh.userData = { cellId: cell.id };
    cellMeshes[cell.id] = mesh;
    group.add(mesh);
  }

  const outlineMaterial = new LineBasicMaterial({
    color: new Color(OUTLINE_COLOUR),
    transparent: true,
    opacity: OUTLINE_OPACITY,
  });
  const outline = new LineSegments(buildOutlineGeometry(cells), outlineMaterial);
  group.add(outline);

  const dispose = (): void => {
    for (const mesh of cellMeshes) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) {
          material.dispose();
        }
      } else {
        mesh.material.dispose();
      }
    }

    outline.geometry.dispose();
    outlineMaterial.dispose();
    group.clear();
  };

  return { group, cellMeshes, dispose };
};

/** Repaints the tiles in place. The geometry never changes, so nothing is rebuilt. */
const updateGlobeColours = (
  handle: TGlobeHandle,
  cells: readonly TWorldCell[],
  selectedCellId: number | null,
): void => {
  for (const cell of cells) {
    const mesh = handle.cellMeshes[cell.id];
    if (mesh === undefined) {
      continue;
    }

    const material = mesh.material;
    if (Array.isArray(material) || !(material instanceof MeshStandardMaterial)) {
      continue;
    }

    material.color.copy(cellColour(cell));
    if (cell.id === selectedCellId) {
      material.emissive.set(SELECTED_EMISSIVE);
      material.emissiveIntensity = SELECTED_EMISSIVE_INTENSITY;
    } else {
      material.emissive.set(NO_EMISSIVE);
      material.emissiveIntensity = 0;
    }
  }
};

export type { TGlobeHandle };
export { createGlobeMesh, updateGlobeColours };
