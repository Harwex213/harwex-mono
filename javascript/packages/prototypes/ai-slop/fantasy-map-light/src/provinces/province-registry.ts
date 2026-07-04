import { rgbaToHex, type RgbaColor } from "@/canvas/color";

interface ProvinceMeta {
    provinceId: string; // hex "#RRGGBB" (uppercase) — уникальный ключ провинции
    provinceName: string;
}

// Реестр провинций: помнит созданные цвета (гарантия уникальности) и их имена.
// Живёт вне React — пересоздаётся при загрузке новой карты.
class ProvinceRegistry {
    private byHex = new Map<string, ProvinceMeta>();
    // Монотонный счётчик для имён: не уменьшается при удалении/восстановлении,
    // поэтому имена провинций не переиспользуются и не конфликтуют.
    private counter = 0;

    // Регистрирует цвет как провинцию (если ещё нет) и возвращает метаданные.
    register(color: RgbaColor): ProvinceMeta {
        const id = rgbaToHex(color);
        const existing = this.byHex.get(id);
        if (existing) {
            return existing;
        }
        this.counter += 1;
        const meta: ProvinceMeta = {
            provinceId: id,
            provinceName: `Province ${this.counter}`,
        };
        this.byHex.set(id, meta);
        return meta;
    }

    get(hex: string): ProvinceMeta | undefined {
        return this.byHex.get(hex.toUpperCase());
    }

    has(color: RgbaColor): boolean {
        return this.byHex.has(rgbaToHex(color));
    }

    get size(): number {
        return this.byHex.size;
    }

    // Снимок реестра для Undo/Redo (копия метаданных всех провинций).
    snapshot(): ProvinceMeta[] {
        return [...this.byHex.values()].map((meta) => ({ ...meta }));
    }

    // Восстанавливает реестр из снимка (Undo/Redo). Счётчик имён только растёт —
    // чтобы будущие провинции не получили имя уже существовавшей.
    restore(metas: readonly ProvinceMeta[]): void {
        this.byHex = new Map(metas.map((meta) => [meta.provinceId, { ...meta }]));
        for (const { provinceName } of metas) {
            const match = /(\d+)$/.exec(provinceName);
            if (match) {
                this.counter = Math.max(this.counter, Number(match[1]));
            }
        }
    }

    // Удаляет из реестра провинции, чьих цветов больше нет среди `aliveHexes`
    // (cleanup «мёртвых» провинций). Возвращает список удалённых hex.
    prune(aliveHexes: ReadonlySet<string>): string[] {
        const removed: string[] = [];
        for (const hex of this.byHex.keys()) {
            if (!aliveHexes.has(hex)) {
                removed.push(hex);
            }
        }
        for (const hex of removed) {
            this.byHex.delete(hex);
        }
        return removed;
    }

    // Генерирует новый цвет провинции: не white и не совпадающий ни с одним
    // уже созданным. Детерминированный перебор HSL-палитры с золотым сечением
    // даёт хорошо различимые цвета; при коллизии сдвигаем оттенок дальше.
    generateUniqueColor(): RgbaColor {
        for (let i = 0; i < 4096; i += 1) {
            const hue = (this.byHex.size + i) * 137.508; // golden-angle spread
            const color = hslToRgba(hue % 360, 0.65, 0.5);
            if (isWhite(color) || this.byHex.has(rgbaToHex(color))) {
                continue;
            }
            return color;
        }
        // Практически недостижимо — палитра исчерпана.
        throw new Error("Не удалось сгенерировать уникальный цвет провинции");
    }
}

const isWhite = (c: RgbaColor): boolean =>
    c.r === 255 && c.g === 255 && c.b === 255;

// HSL (h в градусах, s/l в 0..1) → непрозрачный RgbaColor.
const hslToRgba = (h: number, s: number, l: number): RgbaColor => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp < 1) [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const m = l - c / 2;
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
        a: 255,
    };
};

export { ProvinceRegistry, hslToRgba };
export type { ProvinceMeta };
