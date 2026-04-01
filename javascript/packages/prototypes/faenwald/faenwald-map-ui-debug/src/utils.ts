import { type Dispatch, type SetStateAction, useState } from "react";

export const not = <Input>(fn: (arg: Input) => boolean) =>
  (arg: Input) => !fn(arg);

export const getLocalStorageRaw = (key: string): string | null => {
  return self.localStorage.getItem(key);
}

export const getLocalStorage = <Type>(key: string): Type | null => {
  const v = self.localStorage.getItem(key);

  return v ? JSON.parse(v) : null;
}

export const setLocalStorage = <Type>(key: string, value: Type) => {
  return self.localStorage.setItem(key, JSON.stringify(value));
}

export const useLocalStorageState = <Type>(initialValue: Type, key: string): [Type, Dispatch<SetStateAction<Type>>] => {
  const [value, setValue] = useState<Type>(() => {
    const value = getLocalStorageRaw(key);
    if (value === null) {
      return initialValue;
    }
    return JSON.parse(value) as Type;
  });

  const setDecoratedValue: Dispatch<SetStateAction<Type>> = (newValue) => {
    setLocalStorage(key, newValue);
    setValue(newValue);
  }

  return [value, setDecoratedValue];
}
