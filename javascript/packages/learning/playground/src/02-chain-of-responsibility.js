const fn1 = (data) => {
    console.log("fn1", data);
    return data + 10;
};

const fn2 = (data) => {
    console.log("fn2", data);
    return data + 20;
};

const fn3 = (data) => {
    console.log("fn3", data);
    return data + 30;
};

/**
 * Could be used to create chain of synchronous processors for single unit (one argument)
 */
const chain = () => {
    const currentChain = [];

    const state = {
        add: (fn) => {
            currentChain.push(fn);
            return state;
        },
        build: () => (data) => currentChain.reduce((currData, nextFn) => nextFn(currData), data),
    };

    return state;
};

const processData = chain().add(fn1).add(fn2).add(fn3).build();

const processed = processData(10);
console.log("processed", processed);
