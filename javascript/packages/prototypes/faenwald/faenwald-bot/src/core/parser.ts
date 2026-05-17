class Parser {
    input: string;
    pos: number;

    constructor(input: string) {
        this.input = input.trim();
        this.pos = 0;
    }

    rest() {
        return this.input.slice(this.pos);
    }

    skipWhitespace() {
        const m = this.rest().match(/^\s*/);
        if (m) {
            this.pos += m[0].length;
        }
    }

    eat(regex: RegExp) {
        const m = this.rest().match(regex);
        if (!m) {
            return;
        }
        this.pos += m[0].length;
        return m;
    }

    expect(regex: RegExp, expected: string) {
        const m = this.eat(regex);
        if (!m) {
            throw new Error(
                `Ожидал ${expected} на позиции ${this.pos}, получил: "${this.rest().slice(0, 30)}"`
            );
        }
        return m;
    }
}

export { Parser };