import { isArray, isNotNil } from "@hw/utils";
import { SqliteBuilderError } from "./constants.js";

const SELECT_CLAUSE = {
    PROPS: 0b1,
    WHERE: 0b1_0,
    AND: 0b1_00,
    OR: 0b1_000,
    ORDER_BY: 0b1_000_00,
    LIMIT: 0b1_000_000,
    OFFSET: 0b1_000_000_0,
};

class SelectBuilder {
    #possibleClauses =
        SELECT_CLAUSE.PROPS | SELECT_CLAUSE.WHERE | SELECT_CLAUSE.ORDER_BY | SELECT_CLAUSE.LIMIT | SELECT_CLAUSE.OFFSET;

    #tableName;
    #props = [];
    #where;
    #orderBy;
    #limit;
    #offset;

    constructor(tableName) {
        this.#tableName = tableName;
    }

    #withClause(clause) {
        this.#possibleClauses |= clause;
    }

    #withoutClause(clause) {
        this.#possibleClauses &= ~clause;
    }

    #withoutAndOrClauses() {
        this.#withoutClause(SELECT_CLAUSE.AND);
        this.#withoutClause(SELECT_CLAUSE.OR);
    }

    #expectClause(clause) {
        if (!(this.#possibleClauses & clause)) {
            throw new SqliteBuilderError();
        }
    }

    where(key, operator, value) {
        this.#expectClause(SELECT_CLAUSE.WHERE);

        this.#where = "WHERE " + key + " " + operator + " " + value;

        this.#withoutClause(SELECT_CLAUSE.WHERE);
        this.#withClause(SELECT_CLAUSE.AND);
        this.#withClause(SELECT_CLAUSE.OR);

        return this;
    }

    and(key, operator, value) {
        this.#expectClause(SELECT_CLAUSE.AND);

        this.#where += " AND " + key + " " + operator + " " + value;

        return this;
    }

    or(key, operator, value) {
        this.#expectClause(SELECT_CLAUSE.OR);

        this.#where += " OR " + key + " " + operator + " " + value;

        return this;
    }

    props(keys = []) {
        this.#expectClause(SELECT_CLAUSE.PROPS);

        for (const key of keys) {
            if (isArray(key)) {
                this.#props.push([key[0], key[1]]);
            } else {
                this.#props.push([key, null]);
            }
        }

        this.#withoutClause(SELECT_CLAUSE.PROPS);
        this.#withoutAndOrClauses();

        return this;
    }

    orderBy(key, flow) {
        this.#expectClause(SELECT_CLAUSE.ORDER_BY);

        this.#orderBy = [key, flow];

        this.#withoutClause(SELECT_CLAUSE.ORDER_BY);
        this.#withoutAndOrClauses();

        return this;
    }

    limit(value) {
        this.#expectClause(SELECT_CLAUSE.LIMIT);

        this.#limit = value;

        this.#withoutClause(SELECT_CLAUSE.LIMIT);
        this.#withoutAndOrClauses();

        return this;
    }

    offset(value) {
        this.#expectClause(SELECT_CLAUSE.OFFSET);

        this.#offset = value;

        this.#withoutClause(SELECT_CLAUSE.OFFSET);
        this.#withoutAndOrClauses();

        return this;
    }

    build() {
        const query = ["SELECT"];

        if (this.#props.length === 0) {
            query.push("*");
        } else {
            const propsPart = this.#props
                .map(([key, keyRenamed]) => (keyRenamed ? `${key} AS ${keyRenamed}` : key))
                .join(", ");

            query.push(propsPart);
        }

        query.push(`FROM ${this.#tableName}`);

        if (isNotNil(this.#where)) {
            query.push(this.#where);
        }

        if (isNotNil(this.#orderBy)) {
            query.push(`ORDER BY ${this.#orderBy[0]} ${this.#orderBy[1]}`);
        }

        if (isNotNil(this.#limit)) {
            query.push(`LIMIT ${this.#limit}`);
        }

        if (isNotNil(this.#offset)) {
            query.push(`OFFSET ${this.#offset}`);
        }

        return query.join(" ");
    }
}

const select = (tableName) => new SelectBuilder(tableName);

export { select };
