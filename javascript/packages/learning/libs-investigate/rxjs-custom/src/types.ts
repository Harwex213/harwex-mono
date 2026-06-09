import type { Subscription } from "./subscription.js";

interface UnaryFunction<T, R> {
  (source: T): R;
}

type OperatorFunction<T, R> = UnaryFunction<IObservable<T>, IObservable<R>>

interface IObserver<T> {
  next: (value: T) => void;
  error: (err: any) => void;
  complete: () => void;
}

interface IObservable<T> {

  pipe(): IObservable<T>;

  pipe<A>(op1: OperatorFunction<T, A>): IObservable<A>;

  pipe<A, B>(op1: OperatorFunction<T, A>, op2: OperatorFunction<A, B>): IObservable<B>;

  pipe<A, B, C>(op1: OperatorFunction<T, A>, op2: OperatorFunction<A, B>, op3: OperatorFunction<B, C>): IObservable<C>;

  pipe<A, B, C, D>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>
  ): IObservable<D>;

  pipe<A, B, C, D, E>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>
  ): IObservable<E>;

  pipe<A, B, C, D, E, F>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>
  ): IObservable<F>;

  pipe<A, B, C, D, E, F, G>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>
  ): IObservable<G>;

  pipe<A, B, C, D, E, F, G, H>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>
  ): IObservable<H>;

  pipe<A, B, C, D, E, F, G, H, I>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
    op9: OperatorFunction<H, I>
  ): IObservable<I>;

  pipe<A, B, C, D, E, F, G, H, I>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
    op4: OperatorFunction<C, D>,
    op5: OperatorFunction<D, E>,
    op6: OperatorFunction<E, F>,
    op7: OperatorFunction<F, G>,
    op8: OperatorFunction<G, H>,
    op9: OperatorFunction<H, I>,
    ...operations: OperatorFunction<any, any>[]
  ): IObservable<unknown>;

  subscribe(observer: (value: T) => void): Subscription;

  toPromise(promiseCtor?: PromiseConstructorLike): Promise<T | undefined>;
}

interface ISubscription {
  unsubscribe(): void;

  add(teardown: TeardownLogic): void;

  remove(teardown: TeardownLogic): void;
}

type TeardownLogic = ISubscription | (() => void);

export type {
  TeardownLogic,
  ISubscription,
  IObservable,
  IObserver,
  UnaryFunction,
  OperatorFunction,
};
