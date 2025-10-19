const voidFn = () => void 0;

const T = () => true;
const F = () => false;

const toFunctionCreator =
  (Constructor) =>
    (...props) =>
      new Constructor(...props);

const isNil = (examine) => examine === undefined || examine === null;
const isNotNil = (examine) => examine !== undefined && examine !== null;

const assertNotNil = (examine, source = "unknown source") => {
  if (isNil(examine)) {
    throw `${source}: Expected non-nil`;
  }
}

const { isArray } = Array;

export { voidFn, T, F, toFunctionCreator, isNil, isNotNil, assertNotNil, isArray };
