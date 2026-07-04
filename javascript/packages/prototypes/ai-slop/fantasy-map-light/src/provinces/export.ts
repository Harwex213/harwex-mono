import type { PixelBuffer } from "@/canvas/pixel-buffer";
import type { ProvinceRegistry } from "@/provinces/province-registry";

interface ProvinceRecord {
    provinceId: string; // hex "#rrggbb"
    provinceName: string;
    center: [number, number]; // центроид пикселей провинции (x, y)
    pixelCount: number;
}

type ProvincesJson = Record<string, ProvinceRecord>;

const toHexPart = (value: number): string => value.toString(16).padStart(2, "0");

// Сканирует буфер провинций и собирает метаданные ПО ФАКТИЧЕСКИМ пикселям PNG:
// каждый не-white цвет → одна провинция. Это гарантирует, что цвета в JSON
// в точности соответствуют цветам в экспортируемом PNG. Имена берутся из
// реестра (если провинция там зарегистрирована), центр — центроид пикселей.
const buildProvincesJson = (
    buffer: PixelBuffer,
    registry: ProvinceRegistry,
): ProvincesJson => {
    const { data, width } = buffer.snapshot();
    const stats = new Map<string, { sumX: number; sumY: number; count: number }>();

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // white (#FFFFFF) = «нет провинции» — пропускаем.
        if (r === 255 && g === 255 && b === 255) {
            continue;
        }
        const hex = `#${toHexPart(r)}${toHexPart(g)}${toHexPart(b)}`;
        const pixel = i / 4;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        const entry = stats.get(hex);
        if (entry) {
            entry.sumX += x;
            entry.sumY += y;
            entry.count += 1;
        } else {
            stats.set(hex, { sumX: x, sumY: y, count: 1 });
        }
    }

    const json: ProvincesJson = {};
    for (const [hex, { sumX, sumY, count }] of stats) {
        const meta = registry.get(hex);
        json[hex] = {
            provinceId: hex,
            provinceName: meta?.provinceName ?? "Unnamed province",
            center: [Math.round(sumX / count), Math.round(sumY / count)],
            pixelCount: count,
        };
    }
    return json;
};

// Множество фактически присутствующих в буфере не-white цветов (hex UPPERCASE —
// как ключи ProvinceRegistry). Основа cleanup «мёртвых» провинций: провинция
// жива ⇔ её цвет встречается хотя бы в одном пикселе слоя.
const collectUsedHexes = (buffer: PixelBuffer): Set<string> => {
    const { data } = buffer.snapshot();
    const used = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r === 255 && g === 255 && b === 255) {
            continue; // white = «нет провинции»
        }
        used.add(`#${toHexPart(r)}${toHexPart(g)}${toHexPart(b)}`.toUpperCase());
    }
    return used;
};

const triggerDownload = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Отзываем URL асинхронно, чтобы клик успел начать скачивание.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
    new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error("Не удалось сформировать PNG слоя провинций"));
            }
        }, "image/png");
    });

// Экспортирует два файла: PNG слоя провинций (точные пиксели буфера, без
// артефактов прозрачности отображения) и JSON метаданных всех провинций.
const exportProvinces = async (
    buffer: PixelBuffer,
    registry: ProvinceRegistry,
): Promise<{ provinceCount: number }> => {
    const json = buildProvincesJson(buffer, registry);
    const jsonBlob = new Blob([JSON.stringify(json, null, 2)], {
        type: "application/json",
    });
    // PNG берётся напрямую из offscreen-буфера — display-opacity его не касается.
    const pngBlob = await canvasToPngBlob(buffer.canvas);

    triggerDownload(pngBlob, "provinces.png");
    triggerDownload(jsonBlob, "provinces.json");

    return { provinceCount: Object.keys(json).length };
};

export { exportProvinces, buildProvincesJson, collectUsedHexes };
export type { ProvinceRecord, ProvincesJson };
