/**
 * AsyncStream -
 *
 * -
 * 1. Extension  WebView
 * 2. Extension  SDK
 * 3. WebView  Extension
 *
 * -  (for await...of)
 * -
 * -
 * -
 */

export class AsyncStream<T> implements AsyncIterable<T>, AsyncIterator<T> {
    private queue: T[] = [];
    private readResolve?: (value: IteratorResult<T>) => void;
    private readReject?: (error: any) => void;
    private isDone = false;
    private hasError?: any;
    private started = false;
    private returned?: () => void;

    constructor(returned?: () => void) {
        this.returned = returned;
    }

    /**
     */
    [Symbol.asyncIterator](): AsyncIterator<T> {
        if (this.started) {
            throw new Error("Stream can only be iterated once");
        }
        this.started = true;
        return this;
    }

    /**
     *  API
     */
    async next(): Promise<IteratorResult<T>> {
        // 1.
        if (this.queue.length > 0) {
            return { done: false, value: this.queue.shift()! };
        }

        // 2.
        if (this.isDone) {
            return { done: true, value: undefined as any };
        }

        // 3.  Promise
        if (this.hasError) {
            throw this.hasError;
        }

        // 4.
        return new Promise<IteratorResult<T>>((resolve, reject) => {
            this.readResolve = resolve;
            this.readReject = reject;
        });
    }

    /**
     *  API
     */
    enqueue(value: T): void {
        if (this.readResolve) {
            const resolve = this.readResolve;
            this.readResolve = undefined;
            this.readReject = undefined;
            resolve({ done: false, value });
        } else {
            this.queue.push(value);
        }
    }

    /**
     */
    done(): void {
        this.isDone = true;

        if (this.readResolve) {
            const resolve = this.readResolve;
            this.readResolve = undefined;
            this.readReject = undefined;
            resolve({ done: true, value: undefined as any });
        }
    }

    /**
     */
    error(error: any): void {
        this.hasError = error;

        //  Promise
        if (this.readReject) {
            const reject = this.readReject;
            this.readResolve = undefined;
            this.readReject = undefined;
            reject(error);
        }
    }

    /**
     */
    async return(): Promise<IteratorResult<T>> {
        this.isDone = true;
        if (this.returned) {
            this.returned();
        }
        return { done: true, value: undefined as any };
    }

    /**
     */
    static from<T>(items: T[]): AsyncStream<T> {
        const stream = new AsyncStream<T>();
        for (const item of items) {
            stream.enqueue(item);
        }
        stream.done();
        return stream;
    }
}

/**
 *
 * //
 * const stream = new AsyncStream<string>();
 * setTimeout(() => stream.enqueue("msg1"), 100);
 * setTimeout(() => stream.enqueue("msg2"), 200);
 * setTimeout(() => stream.done(), 300);
 *
 * //
 * for await (const msg of stream) {
 *     console.log(msg);  // "msg1", "msg2"
 * }
 */
