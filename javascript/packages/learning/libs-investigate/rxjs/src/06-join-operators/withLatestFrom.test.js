import { test } from "node:test";
import { EMPTY, map, of, take, timer, withLatestFrom } from "rxjs";

// Вопрос всех четырёх опытов: чем withLatestFrom отличается от combineLatest,
// т.е. что именно значит "главный поток задаёт момент эмита".

test("1. only the main stream emits; secondary values just sit in a slot", (_, done) => {
  // main: 50, 100, 150 | secondary: 0, 35, 70, 105, 140 (специально без совпадений по времени)
  const main$ = timer(50, 50).pipe(
    take(3),
    map((i) => `main-${i}`)
  );
  const secondary$ = timer(0, 35).pipe(map((i) => `sec-${i}`));

  main$.pipe(withLatestFrom(secondary$)).subscribe({
    next: ([main, secondary]) => {
      console.log(`1. next - ${main} + ${secondary}`);
    },
    complete: () => {
      // Три эмита на 3 значения main, хотя secondary успел выдать пять:
      // лишние значения secondary молча перезаписали слот.
      console.log(`1. complete`);
      done();
    },
    error: (error) => {
      console.log(`1. error - ${error}`);
      done(error);
    }
  });
});

test("2. main emissions before the secondary's first value are dropped", (_, done) => {
  // main: 0, 50, 100 | secondary: единственное значение на 70
  const main$ = timer(0, 50).pipe(
    take(3),
    map((i) => `main-${i}`)
  );
  const secondary$ = timer(0).pipe(map(() => `sec-0`));

  main$.pipe(withLatestFrom(secondary$)).subscribe({
    next: ([main, secondary]) => {
      // Только main-2: у main-0 и main-1 слот был пуст, и они потеряны без следа.
      console.log(`2. next - ${main} + ${secondary}`);
    },
    complete: () => {
      console.log(`2. complete`);
      done();
    },
    error: (error) => {
      console.log(`2. error - ${error}`);
      done(error);
    }
  });
});

test("3. completed secondary keeps its last value; main's completion ends the output", (_, done) => {
  const main$ = timer(0, 30).pipe(
    take(2),
    map((i) => `main-${i}`)
  );
  // of завершается сразу после единственного значения.
  const secondary$ = of("sec-once");

  main$.pipe(withLatestFrom(secondary$)).subscribe({
    next: ([main, secondary]) => {
      // Оба эмита получают "sec-once": завершение подчинённого не выключает слот.
      console.log(`3. next - ${main} + ${secondary}`);
    },
    complete: () => {
      // Complete приходит от main. Завершись main первым при живом secondary —
      // было бы то же самое: подчинённого просто отпишут.
      console.log(`3. complete`);
      done();
    },
    error: (error) => {
      console.log(`3. error - ${error}`);
      done(error);
    }
  });
});

test("4. secondary that completes empty silences the output entirely", (_, done) => {
  const main$ = timer(0, 30).pipe(
    take(2),
    map((i) => `main-${i}`)
  );
  const secondary$ = EMPTY;

  main$.pipe(withLatestFrom(secondary$)).subscribe({
    next: ([main, secondary]) => {
      console.log(`4. next - ${main} + ${secondary}`);
    },
    complete: () => {
      // Ни одного next: слот так и не заполнился. Но complete всё равно есть —
      // пустой подчинённый не завершает выход досрочно, в отличие от combineLatest.
      console.log(`4. complete`);
      done();
    },
    error: (error) => {
      console.log(`4. error - ${error}`);
      done(error);
    }
  });
});
