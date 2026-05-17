import test from "node:test";
import assert from "node:assert/strict";
import { parseUnit } from "./parse-unit.js";

test("parseUnit: корректно парсит валидную строку юнита", () => {
    const result = parseUnit("СКо (ВО) II (80/120)");

    assert.equal(typeof result, "object");
    assert.equal(result.type, "ско");
    assert.equal(result.kind, "во");
    assert.equal(result.rank, 2);
    assert.equal(result.amount, 80);
    assert.equal(result.maxAmount, 120);
    assert.equal(typeof result.rank, "number");
});

test("parseUnit: возвращает объект со всеми обязательными полями", () => {
    const result = parseUnit("СКо (ВО) II (80/120)");

    assert.deepEqual(
        Object.keys(result).sort(),
        ["amount", "kind", "maxAmount", "rank", "type"].sort(),
    );
});

test("parseUnit: amount и maxAmount парсятся как числа", () => {
    const result = parseUnit("СКо (ВО) II (5/10)");

    assert.equal(result.amount, 5);
    assert.equal(result.maxAmount, 10);
    assert.equal(Number.isInteger(result.amount), true);
    assert.equal(Number.isInteger(result.maxAmount), true);
});

test("parseUnit: бросает ошибку на нераспознаваемой строке", () => {
    assert.throws(
        () => parseUnit("полная чушь"),
        /Не получилось спарсить юнит/,
    );
});

test("parseUnit: бросает ошибку на пустой строке", () => {
    assert.throws(
        () => parseUnit(""),
        /Не получилось спарсить юнит/,
    );
});

test("parseUnit: бросает ошибку при неполном формате (нет чисел)", () => {
    assert.throws(
        () => parseUnit("СКо (ВО) II"),
        /Не получилось спарсить юнит/,
    );
});

test("parseUnit: бросает ошибку на неизвестном типе юнита", () => {
    assert.throws(
        () => parseUnit("XXX (ВО) II (80/120)"),
        /Неизвестный тип/,
    );
});

test("parseUnit: бросает ошибку на неизвестном виде юнита", () => {
    assert.throws(
        () => parseUnit("СКо (XXX) II (80/120)"),
        /Неизвестный вид/,
    );
});

test("parseUnit: бросает ошибку на неизвестном ранге юнита", () => {
    assert.throws(
        () => parseUnit("СКо (ВО) ZZZ (80/120)"),
        /Неизвестный ранг/,
    );
});

test("parseUnit: игнорирует лишний текст после совпадения регулярки", () => {
    // Регулярка не привязана к концу строки ($), поэтому хвост допустим
    const result = parseUnit("СКо (ВО) II (80/120) какой-то хвост");

    assert.equal(result.amount, 80);
    assert.equal(result.maxAmount, 120);
});

test("parseUnit: корректно парсит нулевые значения количества", () => {
    const result = parseUnit("СКо (ВО) II (0/0)");

    assert.equal(result.amount, 0);
    assert.equal(result.maxAmount, 0);
});

test("parseUnit: проверка maxAmount фактически проверяет amount", () => {
    const result = parseUnit("СКо (ВО) II (80/120)");
    assert.equal(result.maxAmount, 120);
});