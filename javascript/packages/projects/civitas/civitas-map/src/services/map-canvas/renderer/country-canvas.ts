import {
  buildProvinceIndex,
  fromHex,
  pack,
  paintSlots,
  unionRect,
  type Country,
  type Province,
  type ProvinceIndex,
  type ProvinceLayer,
  type Rect,
} from "../../../domain/index";

// The countries view of the province layer: each province in the colour of its
// country, an unassigned province faintly in its own colour, and a dark line on
// every province edge so single provinces stay visible inside a country.
// The province index is built once per layer state. A change of countries
// repaints only the provinces whose colour changed.

// The faint alpha of an unassigned province, and its edge colour.
const UNASSIGNED_ALPHA = 70;
const UNASSIGNED_EDGE = { r: 24, g: 24, b: 24, a: 170 };
// How much darker the edge of an assigned province is than its fill.
const EDGE_SHADE = 0.55;

class CountryCanvas {
  readonly layer: ProvinceLayer;
  readonly provinces: readonly Province[];
  readonly revision: number;
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly index: ProvinceIndex;
  private readonly pixels: Uint32Array;
  private readonly image: ImageData;
  private readonly fill: Uint32Array;
  private readonly edge: Uint32Array;
  // The colour of each province, so a changed slot can be found by comparison.
  private readonly rgbOfProvince: Map<number, { r: number; g: number; b: number }>;
  private painted = false;

  constructor(layer: ProvinceLayer, provinces: readonly Province[], revision: number) {
    this.layer = layer;
    this.provinces = provinces;
    this.revision = revision;
    this.width = layer.width;
    this.height = layer.height;
    this.canvas = document.createElement("canvas");
    this.canvas.width = layer.width;
    this.canvas.height = layer.height;

    const ctx = this.canvas.getContext("2d");

    if (!ctx) {
      throw new Error("2d canvas context unavailable");
    }

    this.ctx = ctx;
    this.index = buildProvinceIndex(layer.readPixels(), layer.width, layer.height, provinces);
    this.pixels = new Uint32Array(layer.width * layer.height);
    // Two views over one buffer, as in the layer canvas: the canvas byte order
    // and the word order agree on any machine.
    this.image = new ImageData(new Uint8ClampedArray(this.pixels.buffer as ArrayBuffer), layer.width, layer.height);
    this.fill = new Uint32Array(this.index.provinceIds.length);
    this.edge = new Uint32Array(this.index.provinceIds.length);
    this.rgbOfProvince = new Map(provinces.map((province) => {
      return [province.id, fromHex(province.hex) ?? { r: 0, g: 0, b: 0 }];
    }));
  }

  // Recolours the provinces whose country colour changed and uploads the
  // rectangle they cover.
  sync(owners: ReadonlyMap<number, number>, countries: readonly Country[]): void {
    const colorOfCountry = new Map<number, { r: number; g: number; b: number }>();

    for (const country of countries) {
      colorOfCountry.set(country.id, fromHex(country.colorHex) ?? { r: 0, g: 0, b: 0 });
    }

    let dirty: Rect | null = this.painted ? null : { x: 0, y: 0, w: this.width, h: this.height };

    for (let slot = 1; slot < this.index.provinceIds.length; slot += 1) {
      const provinceId = this.index.provinceIds[slot];
      const owner = owners.get(provinceId);
      const country = owner === undefined ? undefined : colorOfCountry.get(owner);
      let fill: number;
      let edge: number;

      if (country) {
        fill = pack(country.r, country.g, country.b, 255);
        edge = pack(
          Math.round(country.r * EDGE_SHADE),
          Math.round(country.g * EDGE_SHADE),
          Math.round(country.b * EDGE_SHADE),
          255,
        );
      } else {
        const own = this.rgbOfProvince.get(provinceId) ?? { r: 0, g: 0, b: 0 };

        fill = pack(own.r, own.g, own.b, UNASSIGNED_ALPHA);
        edge = pack(UNASSIGNED_EDGE.r, UNASSIGNED_EDGE.g, UNASSIGNED_EDGE.b, UNASSIGNED_EDGE.a);
      }

      if (fill !== this.fill[slot] || edge !== this.edge[slot]) {
        this.fill[slot] = fill;
        this.edge[slot] = edge;
        dirty = unionRect(dirty, this.index.bounds[slot]);
      }
    }

    this.painted = true;

    if (!dirty) {
      return;
    }

    paintSlots(this.index, this.fill, this.edge, this.pixels, dirty);
    this.ctx.putImageData(this.image, 0, 0, dirty.x, dirty.y, dirty.w, dirty.h);
  }
}

export { CountryCanvas };
