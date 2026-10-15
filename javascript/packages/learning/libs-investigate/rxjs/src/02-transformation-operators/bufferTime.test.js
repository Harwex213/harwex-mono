import { bufferTime, interval, take } from "rxjs";

const observable$ = interval(1);

const piped$ = observable$.pipe(bufferTime(100), take(5));

piped$.subscribe((v) => console.log(v));
