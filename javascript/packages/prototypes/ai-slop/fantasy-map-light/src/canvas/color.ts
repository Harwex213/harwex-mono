// Цвет пикселя слоя провинций. Все каналы — байты 0..255 (как в ImageData).
interface RgbaColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

// Дефолтное состояние буфера провинций: white = «нет провинции» (см. requirements.md).
const WHITE: RgbaColor = { r: 255, g: 255, b: 255, a: 255 };

const clampByte = (value: number): number =>
    Math.max(0, Math.min(255, Math.round(value)));

// "#RRGGBB" → RgbaColor. Alpha задаётся отдельно (по умолчанию непрозрачный).
const hexToRgba = (hex: string, alpha = 255): RgbaColor => {
    const normalized = hex.replace(/^#/, "");
    if (normalized.length !== 6) {
        throw new Error(`Invalid hex color: ${hex}`);
    }
    const value = Number.parseInt(normalized, 16);
    if (Number.isNaN(value)) {
        throw new Error(`Invalid hex color: ${hex}`);
    }
    return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff,
        a: clampByte(alpha),
    };
};

const toHexPart = (value: number): string =>
    clampByte(value).toString(16).padStart(2, "0");

// RgbaColor → "#RRGGBB" (без альфы; альфа слоя провинций всегда непрозрачна при экспорте).
const rgbaToHex = (color: RgbaColor): string =>
    `#${toHexPart(color.r)}${toHexPart(color.g)}${toHexPart(color.b)}`.toUpperCase();

const colorsEqual = (a: RgbaColor, b: RgbaColor): boolean =>
    a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

const isWhite = (color: RgbaColor): boolean =>
    color.r === 255 && color.g === 255 && color.b === 255;

export { WHITE, clampByte, hexToRgba, rgbaToHex, colorsEqual, isWhite };
export type { RgbaColor };
