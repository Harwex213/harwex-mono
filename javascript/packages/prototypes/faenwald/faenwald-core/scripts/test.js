class Parser {
    constructor(input) {
        this.input = input.trim();
        this.pos = 0;
    }

    // Текущий остаток строки
    rest() {
        return this.input.slice(this.pos);
    }

    // Пропустить пробелы/переносы
    skipWhitespace() {
        const m = this.rest().match(/^\s*/);
        this.pos += m[0].length;
    }

    // Попробовать съесть regex — возвращает match или null
    eat(regex) {
        const m = this.rest().match(regex);
        if (!m) return null;
        this.pos += m[0].length;
        return m;
    }

    // Съесть или бросить ошибку
    expect(regex, description) {
        const m = this.eat(regex);
        if (!m) throw new Error(
            `Expected ${description} at pos ${this.pos}, got: "${this.rest().slice(0, 30)}"`
        );
        return m;
    }

    parse() {
        const result = {};
        this.skipWhitespace();

        // --- Секция # Армии ---
        this.expect(/^# Армии/, '"# Армии"');
        result.armies = this.parseArmyList();

        // --- Секция # Последствия битв ---
        this.skipWhitespace();
        this.expect(/^# Последствия битв/, '"# Последствия битв"');
        result.aftermath = this.parseArmyList();

        return result;
    }

    parseArmyList() {
        const armies = [];

        while (true) {
            this.skipWhitespace();
            const armyMatch = this.eat(/^- Армия (\S+)/);
            if (!armyMatch) break;

            const army = { name: armyMatch[1], units: [] };

            // Читаем юниты (нумерованные строки)
            while (true) {
                this.skipWhitespace();
                const unitMatch = this.eat(/^\d+\.\s+(.+)/);
                if (!unitMatch) break;
                army.units.push(this.parseUnit(unitMatch[1]));
            }

            armies.push(army);
        }

        return armies;
    }

    parseUnit(str) {
        // СКо (ВО) II (80/120)
        const m = str.match(/^(\S+)\s+\(([^)]+)\)\s+(\S+)\s+\((\d+)\/(\d+)\)/);
        if (!m) throw new Error(`Cannot parse unit: "${str}"`);
        return {
            type: m[1],
            tag: m[2],
            tier: m[3],
            current: parseInt(m[4]),
            max: parseInt(m[5]),
        };
    }
}

// --- Использование ---
const input = `
# Армии
- АрмияИвэрин
1. СКо (ВО) II (100/100)
- Армия ТаурМитрен
1. СКо (ЛО) II (100/100)
# Последствия битв
- Армия Ивэрин
1. СКо (ВО) II (80/120)
- Армия ТаурМитрен
1. СКо (ЛО) II (3/120)
`;

console.log(JSON.stringify(new Parser(input).parse(), null, 2));