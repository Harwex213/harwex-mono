// A province map is read back by colour: every pixel of a province carries that
// province's exact RGB. So colours are the identity of a province here, and
// every helper below stays bit-exact — no blending, no alpha steps.

type Rgb = {
  r: number;
  g: number;
  b: number;
};

// The pixel mirror in `ProvinceLayer` is a `Uint32Array`, while a canvas
// `ImageData` is bytes in r,g,b,a order. Which u32 lays out as those bytes
// depends on the machine, so the order is probed once instead of assumed.
const LITTLE_ENDIAN = (() => {
  const word = new Uint32Array(1);
  const bytes = new Uint8Array(word.buffer);

  bytes[0] = 1;

  return word[0] === 1;
})();

const TRANSPARENT = 0;

function pack(r: number, g: number, b: number, a: number): number {
  if (LITTLE_ENDIAN) {
    return (((a << 24) | (b << 16) | (g << 8) | r) >>> 0);
  }

  return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
}

function packOpaque(rgb: Rgb): number {
  return pack(rgb.r, rgb.g, rgb.b, 255);
}

function unpack(value: number): Rgb {
  if (LITTLE_ENDIAN) {
    return {
      r: value & 0xff,
      g: (value >>> 8) & 0xff,
      b: (value >>> 16) & 0xff,
    };
  }

  return {
    r: (value >>> 24) & 0xff,
    g: (value >>> 16) & 0xff,
    b: (value >>> 8) & 0xff,
  };
}

function alphaOf(value: number): number {
  if (LITTLE_ENDIAN) {
    return (value >>> 24) & 0xff;
  }

  return value & 0xff;
}

function toHex(rgb: Rgb): string {
  const digits = (rgb.r << 16) | (rgb.g << 8) | rgb.b;

  return `#${digits.toString(16).padStart(6, "0")}`;
}

function fromHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());

  if (!match) {
    return null;
  }

  const digits = Number.parseInt(match[1], 16);

  return {
    r: (digits >>> 16) & 0xff,
    g: (digits >>> 8) & 0xff,
    b: digits & 0xff,
  };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = (h % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const parts: [number, number, number] = (() => {
    if (sector < 1) {
      return [chroma, second, 0];
    }
    if (sector < 2) {
      return [second, chroma, 0];
    }
    if (sector < 3) {
      return [0, chroma, second];
    }
    if (sector < 4) {
      return [0, second, chroma];
    }
    if (sector < 5) {
      return [second, 0, chroma];
    }

    return [chroma, 0, second];
  })();
  const base = l - chroma / 2;

  return {
    r: Math.round((parts[0] + base) * 255),
    g: Math.round((parts[1] + base) * 255),
    b: Math.round((parts[2] + base) * 255),
  };
}

// The golden-angle hue walk keeps consecutive provinces far apart on the wheel,
// so neighbours drawn one after another stay easy to tell apart by eye. The
// saturation and lightness rotation adds a second axis, which matters once the
// hue wheel has wrapped around a few times.
const HUE_STEP = 137.507_764_05;
const TONES: Array<[number, number]> = [
  [0.62, 0.58],
  [0.44, 0.72],
  [0.78, 0.44],
  [0.34, 0.48],
  [0.9, 0.66],
];

function generateColor(index: number, taken: ReadonlySet<number>): Rgb {
  // Bounded probing rather than a `while (true)`: after this many candidates the
  // palette is crowded enough that a random colour is as good as a planned one.
  const ATTEMPTS = 4096;

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const step = index + attempt;
    const tone = TONES[step % TONES.length];
    const candidate = hslToRgb((step * HUE_STEP) % 360, tone[0], tone[1]);

    if (!taken.has(packOpaque(candidate))) {
      return candidate;
    }
  }

  return {
    r: 1 + Math.floor(Math.random() * 254),
    g: 1 + Math.floor(Math.random() * 254),
    b: 1 + Math.floor(Math.random() * 254),
  };
}

export {
  TRANSPARENT,
  alphaOf,
  fromHex,
  generateColor,
  pack,
  packOpaque,
  toHex,
  unpack,
  type Rgb,
};
