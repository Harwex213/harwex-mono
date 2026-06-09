import { Subscription } from "./subscription.js";
import type { IObserver } from "./types.js";

class Subscriber<T> extends Subscription implements IObserver<T> {
  constructor(destination?: Subscriber<any> | IObserver<any>) {
    super();
  }

  next(value: T): void {
    // TODO
  }

  error(err?: any): void {
    // TODO
  }

  complete(): void {
    // TODO
  }

  unsubscribe(): void {
    // TODO
  }
}

export { Subscriber };
