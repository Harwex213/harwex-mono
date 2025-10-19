/**
 * TOPICS
 * - effect dispose process
 * - what if target is Computed ?
 */

/**
 * Currently evaluation context
 * @type {Computed | Effect | null}
 */
let evalContext = null;

/**
 * Node
 *
 * _signal: Signal;
 * _nextSignal: Node;
 * _prevSignal: Node;
 *
 * _target: Computed | Effect;
 * _nextTarget: Node;
 * _prevTarget: Node;
 */

function addDependency(signal) {
    if (evalContext === null) {
        return undefined;
    }

    // undefined <- A <-> B <-> C -> undefined
    //              |
    //              |
    //              |
    //       signal._targets

    const node = {
        _target: evalContext,
        _prevTarget: undefined,
        _nextTarget: undefined,
    };

    if (signal._targets === undefined) {
        signal._targets = node;
    } else {
        signal._targets._prevTarget = node;
        node._nextTarget = signal._targets;
        signal._targets = node;
    }

    return undefined;
}

/**
 * Signal
 */

function Signal(v) {
    this._value = v;
    this._targets = undefined;
}

function signal(v) {
    return new Signal(v);
}

Object.defineProperty(Signal.prototype, "value", {
    get: function () {
        addDependency(this);

        return this._value;
    },
    set: function (v) {
        if (v !== this._value) {
            this._value = v;

            // при оповещении target'ов что value поменялось мы должны очистить this._targets ведь их может не быть при реране
            const targets = this._targets;
            this._targets = undefined;

            for (let node = targets; node !== undefined; node = node._nextTarget) {
                node._target._callback();
            }
        }
    },
});

/**
 * Computed
 */

function Computed() {}

function computed() {}

/**
 * Effect
 */

function Effect(fn) {
    this._fn = fn;
    this._cleanup = undefined;
}

Effect.prototype._callback = function () {
    evalContext = this;

    if (this._fn !== undefined) {
        this._cleanup = this._fn();

        if (typeof this._cleanup !== "function") {
            this._cleanup = undefined;
        }
    }

    evalContext = null;
};

function effect(fn) {
    const effect = new Effect(fn);

    effect._callback();
}

export { effect, computed, signal, Signal };
