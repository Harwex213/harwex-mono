import { test } from "node:test";
import { interval, switchMap, take, timer } from "rxjs";

test("1. switchMap", (_, done) => {
  const interval$ = interval(100);

  const stream$ = interval$.pipe(
    take(10),
    switchMap((v) => {
      console.log(`1. switchMap - ${v}`, performance.now());

      return timer(200);
    }),
  );

  stream$.subscribe({
    next: (v) => {
      console.log(`1. next - ${v}`, performance.now());
    },
    complete: () => {
      console.log(`1. complete`);
      done();
    },
    error: (error) => {
      console.log(`1. error - ${error}`);
    },
  });
});
