# @hw/rxjs

A scratchpad for investigating how RxJS 7.8 actually behaves. Not a library, not a demo app — each file is one question about an operator, answered by running it and reading the output.

## Goals

- Answer a concrete "what happens if…" question per file (does `merge` finalize siblings on error? how does `retry` nest? what order does `queueScheduler` produce?)
- Observability over assertions: `console.log` traces are the primary result, so the log order can be read and reasoned about
- Keep experiments disposable — clarity of the trace beats reuse, abstraction, or coverage

## Layout

```
src/
  02-transformation-operators/   # switchMap, ...
  03-join-creation-operators/    # merge, race, ...
  04-testing/                    # TestScheduler / marble diagrams
  05-error-handling-operators/   # retry, ...
  scheduler.ts                   # scheduler experiments (redux-observable-like dispatch loop)
  utils.js                       # shared helpers (currently empty)
```

Folders are numbered after the [RxJS operator categories](https://rxjs.dev/guide/operators). Add a new numbered folder when investigating a category that has none yet; name the file after the operator under investigation (`switchMap.test.js`, `race-operator.js`).

## Two kinds of file

- **`*.test.js`** — run under `node:test`. Use for anything asynchronous: `test("…", (_, done) => …)` and call `done()` from the `subscribe` callback that ends the stream (`complete` or `error`, whichever the experiment is about). Without `done` the process exits before the stream finishes and the experiment proves nothing.
- **plain `.js` / `.ts`** — run directly with `node`. Use for a one-shot trace with nothing to assert. Node strips TS types natively, so no build step or tsconfig.

## Experiment conventions

- Prefix every test and every log line with the same number (`1. next - …`, `1. complete`) so interleaved traces from several experiments in one file stay attributable.
- Subscribe with the full observer object (`next` / `complete` / `error`) — a bare callback hides the two outcomes the experiment usually cares about.
- Log `performance.now()` when the question is about timing rather than order.
- Leave the open question in the file as a comment when a trace stays unexplained (see the tail of `scheduler.ts`) — an unresolved experiment is still a record.

Parent conventions in `javascript/CLAUDE.md` apply to new code here; some existing files predate them.

## Commands

```bash
node --test                      # run every *.test.js under src/
node --test src/03-*/merge.test.js   # run one
node src/scheduler.ts            # run a plain script (TS included)
```
