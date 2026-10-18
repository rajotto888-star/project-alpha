export class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: Array<(v: IteratorResult<T>) => void> = [];
  private closed = false;
  private error: unknown = null;

  push(item: T): void {
    if (this.closed) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  close(): void {
    this.closed = true;
    while (this.resolvers.length) {
      const resolver = this.resolvers.shift();
      resolver?.({ value: undefined as unknown as T, done: true });
    }
  }

  // BUG 3 fix: every producer failure path must call fail() or the consumer
  // hangs forever on `for await`.
  fail(err: unknown): void {
    this.error = err;
    this.closed = true;
    while (this.resolvers.length) {
      const resolver = this.resolvers.shift();
      resolver?.({ value: undefined as unknown as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.items.length > 0) {
          return Promise.resolve({ value: this.items.shift() as T, done: false });
        }
        if (this.error) {
          const e = this.error;
          this.error = null;
          return Promise.reject(e);
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise((resolve, reject) => {
          this.resolvers.push((res) => {
            if (this.error) {
              const e = this.error;
              this.error = null;
              reject(e);
            } else {
              resolve(res);
            }
          });
        });
      },
    };
  }
}
