import { FaenwaldCoreError } from "./model/core-error.js";

export const beautifyPercent = (value: number) => `${Math.round(value * 100)}%`;

// 10000 -> 10.000
export const beautifyNumber = (value: number) => {
  return value.toLocaleString("de-DE");
}

export const numberToFixed2 = (value: number) => Number(value.toFixed(2));

export const mutableSwap = <Item>(arr: Item[], i1: number, i2: number) => {
  if (arr[i1] === undefined) {
    throw new FaenwaldCoreError(`swap: element ${i1} in array is empty`);
  }
  if (arr[i2] === undefined) {
    throw new FaenwaldCoreError(`swap: element ${i2} in array is empty`);
  }

  const el2 = arr[i2];

  arr[i2] = arr[i1];
  arr[i1] = el2;

  return arr;
}