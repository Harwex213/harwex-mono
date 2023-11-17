import {Observable} from "../observable.js";

const of = (...values) => new Observable((subscriber) => {
    for (const value of values) {
        subscriber.next(value)
    }
    subscriber.complete();
});

export { of }