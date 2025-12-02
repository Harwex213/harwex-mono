import { race, timer, map, tap } from 'rxjs';

const stream1$ = timer(1000).pipe(
  map(() => 'Stream 1 won'),
  tap(() => console.log('Stream 1 completed'))
);

const stream2$ = timer(500).pipe(
  map(() => 'Stream 2 won'),
  tap(() => console.log('Stream 2 completed'))
);

const finalStream$ = race(stream1$, stream2$).pipe(
    map((v) => v + ":AMIGO!"),
)

finalStream$.subscribe(winner => {
  console.log(winner); // "Stream 2 won" (since it's faster)
});