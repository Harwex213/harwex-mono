/**
 * Two gates in front of Codex.
 *
 * `GenerationQueue` caps how many generations run at once and how many wait.
 * `StartLock` lets only one Codex thread start at a time. Codex has no
 * cross-process lock on auth.json. Two processes that start together near
 * token expiry can both refresh the token, and the second refresh burns the
 * refresh token. After a thread has started, the generations run in parallel.
 */

class BusyError extends Error {
  constructor() {
    super("server busy, retry later");
  }
}

type Waiter = {
  admit: (release: () => void) => void;
  reject: (reason: unknown) => void;
  onPosition: (position: number) => void;
};

class GenerationQueue {
  private running = 0;
  private readonly waiting: Waiter[] = [];

  constructor(
    private readonly maxRunning: number,
    private readonly maxWaiting: number,
  ) {}

  /**
   * Resolves with a release function once a run slot is free.
   * Throws `BusyError` at once when the wait list is full.
   * `onPosition` gets the 1-based place in the line each time that place changes.
   */
  acquire(signal: AbortSignal, onPosition: (position: number) => void): Promise<() => void> {
    if (signal.aborted) {
      return Promise.reject(signal.reason);
    }
    if (this.running < this.maxRunning && this.waiting.length === 0) {
      this.running += 1;
      return Promise.resolve(this.makeRelease());
    }
    if (this.waiting.length >= this.maxWaiting) {
      return Promise.reject(new BusyError());
    }

    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) {
          this.waiting.splice(index, 1);
          this.announcePositions(index);
        }
        reject(signal.reason);
      };
      const waiter: Waiter = {
        admit: (release) => {
          signal.removeEventListener("abort", onAbort);
          resolve(release);
        },
        reject,
        onPosition,
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(waiter);
      onPosition(this.waiting.length);
    });
  }

  get stats(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting.length };
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.running -= 1;
      this.admitNext();
    };
  }

  private admitNext(): void {
    const next = this.waiting.shift();
    if (!next) {
      return;
    }
    this.running += 1;
    next.admit(this.makeRelease());
    this.announcePositions(0);
  }

  /** Tells every waiter from `from` onwards its new place in the line. */
  private announcePositions(from: number): void {
    for (let index = from; index < this.waiting.length; index += 1) {
      this.waiting[index]?.onPosition(index + 1);
    }
  }
}

class StartLock {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly safetyTimeoutMs: number) {}

  /**
   * Resolves with a release function when the previous holder is done.
   * The lock frees itself after the safety timeout, so a stuck start cannot block everyone.
   */
  async acquire(signal: AbortSignal): Promise<() => void> {
    let free: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      free = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => done);

    let released = false;
    let timer: NodeJS.Timeout | undefined;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      if (timer) {
        clearTimeout(timer);
      }
      free();
    };

    await previous;
    if (signal.aborted) {
      release();
      throw signal.reason;
    }
    timer = setTimeout(release, this.safetyTimeoutMs);
    return release;
  }
}

export { BusyError, GenerationQueue, StartLock };
