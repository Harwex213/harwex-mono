export const not = <Input>(fn: (arg: Input) => boolean) =>
  (arg: Input) => !fn(arg);
