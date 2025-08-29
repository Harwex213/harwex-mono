const RUNNING = 1 << 0;
const NOTIFIED = 1 << 1;
const OUTDATED = 1 << 2;
const DISPOSED = 1 << 3;
const HAS_ERROR = 1 << 4;
const TRACKING = 1 << 5;

// Effects collected into a batch
let batchedEffect = undefined; // Effect | undefined
let batchDepth = 0;
let batchIteration = 0;

// A global version number for signals, used for fast-pathing repeated
// computed.peek()/computed.value calls when nothing has changed globally
let globalVersion = 0;

// Currently evaluated computed or effect
let evalContext = undefined; // Computed | Effect | undefined

function startBatch() {
    batchDepth++;
}

function endBatch() {
    if (batchDepth > 1) {
        batchDepth--;
    }

    // TODO
}

/**
 * type Node = {
 *      _source: Signal;
 *      _prevSource?: Node;
 *      _nextSource?: Node;
 *
 *      _target: Computed | Effect;
 *      _prevTarget?: Node;
 *      _nextTarget?: Node;
 *
 *      _version: number;
 *
 *      _rollbackNode?: Node;
 * }
 */

function addDependency(signal) {
    if (evalContext === undefined) {
        return undefined;
    }

    let node = signal._node;
    if (node === undefined || node._target !== evalContext) {
        node = {
            _version: 0,
            _source: signal,
            _prevSource: evalContext._sources,
            _nextSource: undefined,
            _target: evalContext,
            _nextTarget: undefined,
            _rollbackNode: node,
        };

        if (evalContext._sources !== undefined) {
            evalContext._sources._nextSource = node;
        }
        evalContext._sources = node;
        signal._node = node;

        if (evalContext._flags & TRACKING) {
            signal._subscribe(node);
        }
        return node;
    } else if (node._version === -1) {
        node._version = 0;

        if (node._nextSource !== undefined) {
            node._nextSource._prevSource = node._prevSource;

            if (node._prevSource !== undefined) {
                node._prevSource._nextSource = node._nextSource;
            }

            node._prevSource = evalContext._sources;
            node._nextSource = undefined;

            evalContext._sources._nextSource = node;
            evalContext._sources = node;
        }

        return node;
    }

    return undefined;
}

/**
 * declare class Signal<T = any> {
 *     _value: unknown;
 *
 *     _version: number;
 *
 *     _node?: Node;
 *
 *     _targets?: Node;
 *
 *     constructor(value?: T);
 *
 *     _refresh(): boolean;
 *
 *     _subscribe(node: Node): void;
 *
 *     _unsubscribe(node: Node): void;
 *
 *     subscribe(fn: (value: T) => void): () => void;
 *
 *     valueOf(): T;
 *
 *     toString(): string;
 *
 *     toJSON(): T;
 *
 *     peek(): T;
 *
 *     brand: typeof BRAND_SYMBOL;
 *
 *     get value(): T;
 *     set value(value: T);
 * }
 */

function Signal(value) {
    this._value = value;
    this._version = 0;
    this._node = undefined;
    this._targets = undefined;
}

Object.defineProperty(Signal.prototype, "value", {
    get() {
        const node = addDependency(this);
        if (node !== undefined) {
            node._version = this._version;
        }
        return this._value;
    },
    set(value) {
        if (this._value !== value) {
            if (batchIteration > 100) {
                throw new Error("Cycle detected");
            }

            this._value = value;
            this._version++;
            globalVersion++;

            startBatch();
            try {
                for (let node = this._targets; node !== undefined; node = node._nextTarget) {
                    node._nextTarget._notify();
                }
            } finally {
                endBatch();
            }
        }
    },
});

function signal(v) {
    return new Signal(v);
}

function prepareSources(target) {
    for (let node = target._sources; node !== undefined; node = node._nextSource) {
        const rollbackNode = node._source._node;
        if (rollbackNode !== undefined) {
            node._rollbackNode = rollbackNode;
        }
        node._source._node = node;
        node._version = -1;

        if (node._nextSource === undefined) {
            target._sources = node;
            break;
        }
    }
}

/**
 * declare class Computed<T = any> extends Signal<T> {
 *     _fn: () => T;
 *     _sources?: Node;
 *     _globalVersion: number;
 *     _flags: number;
 *
 *     constructor(fn: () => T);
 *
 *     _notify(): void;
 *     get value(): T;
 * }
 */

function Computed(fn) {
    Signal.call(this, undefined);

    this._fn = fn;
    this._sources = undefined;
    this._globalVersion = globalVersion - 1;
    this._flags = OUTDATED;
}

Computed.prototype = new Signal();

Computed.prototype._refresh = function () {};

function cleanupEffect(effect) {
    const cleanup = effect._cleanup;
    effect._cleanup = undefined;

    if (typeof cleanup === "function") {
        startBatch();

        const prevContext = evalContext;
        evalContext = undefined;
        try {
            cleanup();
        } catch (err) {
            effect._flags &= ~RUNNING;
            effect._flags |= DISPOSED;
            disposeEffect(effect);
            throw err;
        } finally {
            evalContext = prevContext;
            endBatch();
        }
    }
}

function disposeEffect(effect) {
    for (let node = effect._sources; node !== undefined; node = node._nextSource) {
        node._source._unsubscribe(node);
    }
    effect._fn = undefined;
    effect._sources = undefined;

    cleanupEffect();
}

function endEffect(prevContext) {
    if (evalContext !== this) {
        throw new Error("Out-of-error effect");
    }
    cleanupSources(this);
    evalContext = prevContext;

    this._flags &= ~RUNNING;
    if (this._flags & DISPOSED) {
        disposeEffect(this);
    }
    endBatch();
}

/**
 * type EffectFn = () => void | (() => void);
 *
 * declare class Effect {
 *     _fn?: EffectFn;
 *     _cleanup?: () => void;
 *     _sources?: Node;
 *     _nextBatchedEffect?: Effect;
 *     _flags: number;
 *
 *     constructor(fn: EffectFn);
 *
 *     _callback(): void;
 *     _start(): () => void;
 *     _notify(): void;
 *     _dispose(): void;
 * }
 */

function Effect(fn) {
    this._fn = fn;
    this._cleanup = undefined;
    this._sources = undefined;
    this._nextBatchedEffect = undefined;
    this._flags = TRACKING;
}

Effect.prototype._callback = function () {
    const finish = this._start();
    try {
        if (this._flags & DISPOSED) {
            return;
        }
        if (this._fn === undefined) {
            return;
        }

        const cleanup = this._fn();
        if (typeof cleanup === "function") {
            this._cleanup = cleanup;
        }
    } finally {
        finish();
    }
};

Effect.prototype._start = function () {
    if (this._flags === RUNNING) {
        throw new Error("Cycle detected");
    }
    this._flags |= RUNNING;
    this._flags &= ~DISPOSED;
    cleanupEffect(this);
    prepareSources(this);

    startBatch();
    const prevContext = evalContext;
    evalContext = this;
    return endEffect.bind(this, prevContext);
};

Effect.prototype._notify = function () {
    if (!(this._flags & NOTIFIED)) {
        this._flags |= NOTIFIED;
        this._nextBatchedEffect = batchedEffect;
        batchedEffect = this;
    }
};

function effect(fn) {
    const effect = new Effect(fn);
    try {
        effect._callback();
    } catch (err) {
        effect._dispose();
        throw err;
    }

    return effect._dispose.bind(effect);
}

export { signal, effect, Signal };
