const fn1 = (a, b, c) => {
    const r = (a + b + c) * 2;
    console.log("fn1", r);
    return r;
};

const fn2 = (r) => {
    console.log("fn2", r);
    return r / 2;
};

const fn3 = (r) => {
    console.log("fn3", r);
    return r + 20;
};

const compose =
    (a, b) =>
    (...data) =>
        b(a(...data));

/**
 * Could be used to create chain of synchronous processors for infinity arguments
 */
const chain = (...currentChain) => {
    let processFn = compose(currentChain[0], currentChain[1]); // лень чекать ошибки
    for (let i = 2; i < currentChain.length; i++) {
        const currFn = currentChain[i];

        processFn = compose(processFn, currFn);
    }
    return processFn;
};

const processData = chain(fn1, fn2, fn3);

const processed = processData(10, 20, 30);
console.log("processed", processed);
