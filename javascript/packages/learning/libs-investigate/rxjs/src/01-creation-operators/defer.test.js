import { defer } from "rxjs";

// У defer нет никаких особых подводных камней
// Он просто ожидает функцию, что вернёт Objects, Promise или Array (e.g. `ObservableInput`)

const observable$ = defer(() => {
  return new Promise((res) => {
    setTimeout(() => res(1), 100);
  });
});

observable$.subscribe((v) => console.log(v));
