import { test } from "node:test";
import { from, map, of, retry, switchMap } from "rxjs";

test("1. error in merge should lead to all subscriptions finalization", (_, done) => {
  const data$ = from([100, 200, 300]);

  let stream$ = data$.pipe(
    map((v) => {
      if (v > 200) {
        throw new Error("oi");
      }
      return v;
    }),
    retry(2),
  );

  stream$ = stream$.pipe(
    switchMap((v) => {
      return of(v).pipe(
        map((v) => {
          return v * 2;
        }),
        map((v) => {
          if (v > 200) {
            throw new Error("oi 2");
          }
          return v;
        }),
        retry(3),
      )
    }),
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
