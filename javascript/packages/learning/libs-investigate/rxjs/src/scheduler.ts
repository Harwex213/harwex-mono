import { filter, merge, mergeMap, observeOn, of, queueScheduler, Subject, tap } from "rxjs";

const dispatchedActionsSubject = new Subject<string>();

const dispatch = (action: string) => {
    console.log("dispatching action:", action);
    dispatchedActionsSubject.next(action);
};

const dispatchedActions$ = dispatchedActionsSubject.asObservable().pipe(observeOn(queueScheduler));

const returnedActions$ = merge(
    dispatchedActions$.pipe(
        tap((action) => {
            console.log("dispatchedActions$ FIRST - piped action:", action);
        }),
        filter((action) => action === "trigger"),
        mergeMap(() => of("returnedAction", "returnedAction2")),
    ),
    dispatchedActions$.pipe(
        tap((action) => {
            console.log("dispatchedActions$ SECOND - piped action:", action);
        }),
        filter((action) => action === "returnedAction"),
        mergeMap(() => of("returnedAction-ANOTHER")),
    ),
);

returnedActions$.subscribe((action) => {
    console.log("returnedActions$ - dispatching after subscribe:", action);
    dispatch(action);
});

dispatch("trigger");
dispatch("trigger2");

// мне здесь ничего не понятно
