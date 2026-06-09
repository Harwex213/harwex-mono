import type { IObservable, OperatorFunction, TeardownLogic } from "./types.js";
import type { Subscription } from "./subscription.js";
import type { Subscriber } from "./observer.js";

export class Observable<T> implements IObservable<T> {
  constructor(subscribe?: (this: Observable<T>, subscriber: Subscriber<T>) => TeardownLogic) {
  }

  subscribe(observer: (value: T) => void): Subscription {
    // TODO
  }

  pipe(...operations: OperatorFunction<any, any>[]): Observable<any> {
    // TODO
  }

  toPromise(promiseCtor?: PromiseConstructorLike): Promise<T | undefined> {
    // TODO
  }
}
