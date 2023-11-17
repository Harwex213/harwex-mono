import { Action, ActionCreator } from "redux";
import { EMPTY, filter, mergeMap, Observable, of } from "rxjs";
import { test } from "node:test";
import assert from "node:assert";
import { effect } from "@preact/signals-react";
import { resetMapResolutionAction, setMapResolutionAction } from "./map/map-actions.ts";
import { mapWidthSignal } from "./map/map-selectors.ts";
import { dispatch, runEpic, TEpic } from "./store.ts";

type TActionCreatorArray = readonly ActionCreator<Action>[];

type TUnknownFunction = (...args: any[]) => any;

type TExtractReturnType<T extends readonly TUnknownFunction[]> = {
    [index in keyof T]: T[index] extends T[number] ? ReturnType<T[index]> : never;
};

type TFlatten<Type> = Type extends (infer Item)[] ? Item : Type;

type TResult<ActionCreators extends TActionCreatorArray> = Observable<TFlatten<TExtractReturnType<ActionCreators>>>;

function isCreator<ActionCreators extends TActionCreatorArray>(...creators: [...ActionCreators]) {
    const creatorTypes = creators.map((c) => {
        const type = c().type;

        if (typeof type !== "string") {
            throw new Error(
                `Error occurred in isCreator. Type should be string. But: "${JSON.stringify(type)}" given.`,
            );
        }

        return type;
    });

    return (source: Observable<Action>) =>
        source.pipe(filter(({ type }) => creatorTypes.includes(type))) as TResult<ActionCreators>;
}

const plainEpic: TEpic = (actions$) =>
    actions$.pipe(
        isCreator(setMapResolutionAction),
        mergeMap((action) => {
            if (action.payload.width === 100) {
                return of(resetMapResolutionAction());
            }
            return EMPTY;
        }),
    );

runEpic(plainEpic, dispatch);

test("root middleware should synchronously update state signal without glitches", () => {
    let run = 0;
    let mapWidth: number | null = null;

    effect(() => {
        mapWidth = mapWidthSignal.value;
        run++;
    });

    dispatch(setMapResolutionAction(100, 0));

    assert.strictEqual(run, 1);
    assert.strictEqual(mapWidth, 0);
});
