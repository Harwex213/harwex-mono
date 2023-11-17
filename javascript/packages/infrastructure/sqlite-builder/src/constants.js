class SqliteBuilderError extends Error {}

const WHERE_OPERATOR = {
    MORE: ">",
    LESS: "<",
    EQUAL: "=",
    NOT_EQUAL: "!=",
};

const ORDER_BY_DIRECTION = {
    DESC: "DESC",
    ASC: "ASC",
};

export { WHERE_OPERATOR, ORDER_BY_DIRECTION, SqliteBuilderError };
