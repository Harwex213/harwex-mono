const voidFn = () => void 0;

const T = () => true;
const F = () => false;

const toFunctionCreator =
    (Constructor) =>
    (...props) =>
        new Constructor(...props);

const isNil = (examine) => examine === undefined || examine === null;
const isNotNil = (examine) => examine !== undefined && examine !== null;

const { isArray } = Array;

export { voidFn, T, F, toFunctionCreator, isNil, isNotNil, isArray };
