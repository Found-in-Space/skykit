/**
 * @template T
 * @typedef {{
 *   resolve: (result: IteratorResult<T>) => void;
 *   reject: (error: unknown) => void;
 * }} QueueWaiter
 */

/**
 * Create a tiny async queue for live and bounded provider streams.
 *
 * @template T
 * @returns {{
 *   push(value: T): void;
 *   close(): void;
 *   fail(error: unknown): void;
 *   isClosed(): boolean;
 *   [Symbol.asyncIterator](): AsyncGenerator<T>;
 * }}
 */
export function createAsyncQueue() {
  /** @type {T[]} */
  const values = [];
  /** @type {Array<QueueWaiter<T>>} */
  const waiters = [];
  let closed = false;
  /** @type {unknown} */
  let error = null;

  return {
    push(value) {
      if (closed) return;

      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ value, done: false });
        return;
      }

      values.push(value);
    },

    close() {
      if (closed) return;
      closed = true;

      while (waiters.length) {
        const waiter = waiters.shift();
        if (waiter) {
          waiter.resolve({ value: undefined, done: true });
        }
      }
    },

    fail(nextError) {
      if (closed) return;
      error = nextError;
      closed = true;

      while (waiters.length) {
        const waiter = waiters.shift();
        if (waiter) {
          waiter.reject(nextError);
        }
      }
    },

    isClosed() {
      return closed;
    },

    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (values.length) {
          yield /** @type {T} */ (values.shift());
          continue;
        }

        if (error) {
          throw error;
        }

        if (closed) {
          return;
        }

        const next = await new Promise((resolve, reject) => {
          waiters.push({ resolve, reject });
        });

        if (next.done) {
          return;
        }

        yield next.value;
      }
    },
  };
}
