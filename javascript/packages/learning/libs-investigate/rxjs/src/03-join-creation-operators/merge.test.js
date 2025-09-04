import { test } from "node:test";
import { defer, finalize, merge, of, timer } from "rxjs";

test("1. error in merge should lead to all subscriptions finalization", (_, done) => {
  const timer$ = timer(1000);
  const imposter$ = defer(() => {
    throw new Error("zdarova");
  });

  const stream$ = merge(timer$, of("ameba!"), imposter$, of("ne ameba!")).pipe(
    finalize(() => {
      console.log(`1. finalize`);
    })
  );

  stream$.subscribe({
    next: (v) => {
      console.log(`1. next - ${v}`);
    },
    complete: () => {
      console.log(`1. complete`);
    },
    error: (error) => {
      console.log(`1. error - ${error}`);
      done();
    }
  })
});
