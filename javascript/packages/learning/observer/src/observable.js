import { Observer } from "./observer.js";

class Observable {
    #onSubscribe;

    constructor(onSubscribe) {
        this.#onSubscribe = onSubscribe;
    }

    subscribe(observer) {
        const subscription = new Observer(observer);
        const finalizer = this.#onSubscribe(subscription);
        subscription.add(finalizer);
        return subscription;
    }

    pipe(...operators) {
        let observable = this;
        for (const operator of operators) {
            observable = new Observable(operator(observable));
        }
        return observable;
    }
}

export { Observable };
