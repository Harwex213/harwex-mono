import type { ISubscription, TeardownLogic } from "./types.js";

class Subscription implements ISubscription {
  public closed = false;
  public name?: string;
  public initialTeardown;

  constructor(initialTeardown?: () => void, name?: string) {
    this.name = name;
    this.initialTeardown = initialTeardown;
  }

  unsubscribe(): void {
    // TODO
  }

  add(teardown: TeardownLogic): void {
    // TODO
  }

  remove(teardown: Exclude<TeardownLogic, void>): void {
    // TODO
  }
}

export { Subscription };
