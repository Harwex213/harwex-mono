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

/**
 * Could be used to create chain of synchronous processors for infinity arguments
 */
const chain = (...currentChain) => {
    return currentChain.reduce(
        (currFn, nextFn) =>
            (...data) =>
                nextFn(currFn(...data)),
    );
};

const processData = chain(fn1, fn2, fn3);

const processed = processData(10, 20, 30);
console.log("processed", processed);
