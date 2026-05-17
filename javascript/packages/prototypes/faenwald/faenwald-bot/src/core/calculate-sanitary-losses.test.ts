import { calculateSanitaryLosses } from "./calculate-sanitary-losses.js";
import { describe, test } from "node:test";
import assert from "node:assert";

describe("calculateSanitaryLosses", () => {
    test("should not pass wrong structure", () => {
        const input = "aaa";

        assert.throws(
            () => calculateSanitaryLosses(input),
            /Ожидал "# Армии" на позиции/,
        );
    })

    test("should not pass wrong armies", () => {
        const input = `
            # Армии_ass
            
            - Армия Ивэрин
            1. СКо (ВО) II (100/100)
            
            - Армия ТаурМитрен
            1. СКо (ЛО) II (100/100)
            
            # Последствия битв
            
            - Армия Ивэрин
            1. СКо (ВО) II (80/120)
            
            - Армия ТаурМитрен
            1. СКо (ЛО) II (3/120)
        `;

        assert.throws(
            () => calculateSanitaryLosses(input),
            /Ожидал "# Последствия битв" на позиции/,
        );
    });

    test("should calculate sanitary losses", () => {
        const input = `
            # Армии
            
            - Армия Ивэрин
            1. СКо (ВО) II (100/100)
            
            - Армия ТаурМитрен
            1. СКо (ЛО) II (100/100)
            
            # Последствия битв
            
            - Армия Ивэрин
            1. СКо (ВО) II (80/120)
            
            - Армия ТаурМитрен
            1. СКо (ЛО) II (3/120)
        `;

        const result = calculateSanitaryLosses(input);

        const expected = "Армия Ивэрин\n" +
            "1. СКо (ВО) 2 (83/100)\n" +
            "Итого потерь: 17 мужиков\n" +
            "\n" +
            "Армия ТаурМитрен\n" +
            "1. СКо (ЛО) 2 (51/100)\n" +
            "Итого потерь: 49 мужиков\n" +
            "\n";

        assert.strictEqual(result, expected);
    });
})
