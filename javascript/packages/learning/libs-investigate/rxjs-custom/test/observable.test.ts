import { describe, it } from "node:test";
import { strictEqual } from "node:assert";
import { Subscription } from "../src/subscription.js";

/** @test {Subscription} */
void describe("Subscription", () => {
  void describe("add()", () => {
    void it("should unsubscribe child subscriptions", () => {
      const main = new Subscription();

      let isCalled = false;
      const child = new Subscription(() => {
        isCalled = true;
      });
      main.add(child);
      main.unsubscribe();

      strictEqual(isCalled, true);
    });

    void it("should not call circullar subscriptions", () => {
      let callTimes = 0;
      const main = new Subscription(() => {
        callTimes++;
      }, "main");
      const child = new Subscription(() => {
        callTimes++;
      }, "child");
      const child2 = new Subscription(() => {
        callTimes++;
      }, "child2");
      main.add(child);
      child.add(child2);
      child2.add(main);
      main.unsubscribe();

      strictEqual(callTimes, 3);
    });

    void it("should unsubscribe child subscriptions if it has already been unsubscribed", () => {
      const main = new Subscription();
      main.unsubscribe();

      let isCalled = false;
      const child = new Subscription(() => {
        isCalled = true;
      });
      main.add(child);

      strictEqual(isCalled, true);
    });

    void it("should unsubscribe a finalizer function that was passed", () => {
      let isCalled = false;
      const main = new Subscription();
      main.add(() => {
        isCalled = true;
      });
      main.unsubscribe();
      strictEqual(isCalled, true);
    });

    void it("should unsubscribe a finalizer function that was passed immediately if it has been unsubscribed", () => {
      let isCalled = false;
      const main = new Subscription();
      main.unsubscribe();
      main.add(() => {
        isCalled = true;
      });
      strictEqual(isCalled, true);
    });

    void it("should unsubscribe an Unsubscribable when unsubscribed", () => {
      let isCalled = false;
      const main = new Subscription();
      main.add({
        unsubscribe() {
          isCalled = true;
        },
      });
      main.unsubscribe();
      strictEqual(isCalled, true);
    });

    void it("should unsubscribe an Unsubscribable if it is already unsubscribed", () => {
      let isCalled = false;
      const main = new Subscription();
      main.unsubscribe();
      main.add({
        unsubscribe() {
          isCalled = true;
        },
      });
      strictEqual(isCalled, true);
    });
  });

  void describe("remove()", () => {
    void it("should remove added Subscriptions", () => {
      let isCalled = false;
      const main = new Subscription();
      const child = new Subscription(() => {
        isCalled = true;
      });
      main.add(child);
      main.remove(child);
      main.unsubscribe();
      strictEqual(isCalled, false);
    });

    void it("should remove added functions", () => {
      let isCalled = false;
      const main = new Subscription();
      const finalizer = () => {
        isCalled = true;
      };
      main.add(finalizer);
      main.remove(finalizer);
      main.unsubscribe();
      strictEqual(isCalled, false);
    });

    void it("should remove added unsubscribables", () => {
      let isCalled = false;
      const main = new Subscription();
      const unsubscribable = {
        unsubscribe() {
          isCalled = true;
        },
      };
      main.add(unsubscribable);
      main.remove(unsubscribable);
      main.unsubscribe();
      strictEqual(isCalled, false);
    });
  });

  void describe("unsubscribe()", () => {
    // void it("should unsubscribe from all subscriptions, when some of them throw", (done) => {
    //   const finalizers: number[] = [];
    //
    //   const source1 = new Observable(() => () => {
    //     finalizers.push(1);
    //   });
    //
    //   const source2 = new Observable(() => () => {
    //     finalizers.push(2);
    //     throw new Error("oops, I am a bad unsubscribe!");
    //   });
    //
    //   const source3 = new Observable(() => () => {
    //     finalizers.push(3);
    //   });
    //
    //   const subscription = merge(source1, source2, source3).subscribe();
    //
    //   setTimeout(() => {
    //     throws(() => {
    //       subscription.unsubscribe();
    //     }, UnsubscriptionError);
    //     deepStrictEqual(finalizers, [1, 2, 3]);
    //     done();
    //   });
    // });

    // void it("should unsubscribe from all subscriptions, when adding a bad custom subscription to a subscription", (done) => {
    //   const finalizers: number[] = [];
    //
    //   const sub = new Subscription();
    //
    //   const source1 = new Observable(() => () => {
    //     finalizers.push(1);
    //   });
    //
    //   const source2 = new Observable(() => () => {
    //     finalizers.push(2);
    //     sub.add(<any>({
    //       unsubscribe: () => {
    //         strictEqual(sub.closed, true);
    //         throw new Error("Who is your daddy, and what does he do?");
    //       },
    //     }));
    //   });
    //
    //   const source3 = new Observable(() => () => {
    //     finalizers.push(3);
    //   });
    //
    //   sub.add(merge(source1, source2, source3).subscribe());
    //
    //   setTimeout(() => {
    //     throws(() => {
    //       sub.unsubscribe();
    //     }, UnsubscriptionError);
    //     deepStrictEqual(finalizers, [1, 2, 3]);
    //     done();
    //   });
    // });

    void it("should have idempotent unsubscription", () => {
      let count = 0;
      const subscription = new Subscription(() => ++count);
      strictEqual(count, 0);

      subscription.unsubscribe();
      strictEqual(count, 1);

      subscription.unsubscribe();
      strictEqual(count, 1);
    });

    void it("should unsubscribe from all parents", () => {
      // https://github.com/ReactiveX/rxjs/issues/6351
      const a = new Subscription(() => { /* noop */
      });
      const b = new Subscription(() => { /* noop */
      });
      const c = new Subscription(() => { /* noop */
      });
      const d = new Subscription(() => { /* noop */
      });
      a.add(d);
      b.add(d);
      c.add(d);
      // When d is added to the subscriptions, it's added as a finalizer. The
      // length is 1 because the finalizers passed to the ctors are stored in a
      // separate property.
      strictEqual((a as any)._finalizers.length, 1);
      strictEqual((b as any)._finalizers.length, 1);
      strictEqual((c as any)._finalizers.length, 1);
      d.unsubscribe();
      // When d is unsubscribed, it should remove itself from each of its
      // parents.
      strictEqual((a as any)._finalizers.length, 0);
      strictEqual((b as any)._finalizers.length, 0);
      strictEqual((c as any)._finalizers.length, 0);
    });
  });
});
